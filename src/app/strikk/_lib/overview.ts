// The rows of «Strikkeoversikt.xlsx»: one sheet of recipes (a row per size) and one of the
// yarn catalogue. Pure: the workbook and the Drive upload are in src/lib/strikk-overview.ts.
import {
  UNIT_LABEL,
  formatAmount,
  storedToExtraction,
  type AccessoryKind,
  type Audience,
  type ExtractionData,
  type StoredRecipe,
} from './extraction'
import { discontinuedSuggestions, formatFibers, formatRange, type SourceKind, type YarnRow, type YarnStatus } from './yarns'

export const OVERVIEW_FILE_NAME = 'Strikkeoversikt.xlsx'

export type Cell = string | number | { text: string; hyperlink: string } | null
export interface Sheet { name: string; headers: string[]; rows: Cell[][] }

const STATUS: Record<StoredRecipe['extraction_status'], string> = {
  pending: 'Ikke lest', extracted: 'Til gjennomgang', failed: 'Feilet', approved: 'Godkjent',
}
const YARN_STATUS: Record<YarnStatus, string> = { draft: 'Ikke slått opp', looked_up: 'Til godkjenning', approved: 'Godkjent' }
const AUDIENCE: Record<Audience, string> = { woman: 'Kvinne', man: 'Mann', unisex: 'Unisex', child: 'Barn', interior: 'Interiør', other: 'Annet' }
const KIND: Record<AccessoryKind, string> = { buttons: 'Knapper', zipper: 'Glidelås', elastic: 'Elastikk', other: 'Annet' }
const SOURCE_KIND: Record<SourceKind, string> = { manufacturer: 'Produsent', pattern: 'Oppskrift', retailer: 'Butikk', other: 'Annet' }

const decimal = (n: number) => String(n).replace('.', ',')
const pdfLink = (r: StoredRecipe): Cell => ({ text: r.file_name, hyperlink: `https://drive.google.com/file/d/${r.drive_file_id}/view` })

// ── Oppskrifter ─────────────────────────────────────────────────────────────────────

const fullName = (y: Pick<YarnRow, 'brand' | 'name'>) => [y.brand, y.name].filter(Boolean).join(' ')

// The catalogue name when the line is linked, otherwise the yarn as the pattern writes it.
function yarnName(l: { yarn_id: string | null; brand: string | null; yarn_name: string }, catalogue: Map<string, YarnRow>): string {
  const y = l.yarn_id ? catalogue.get(l.yarn_id) : undefined
  return y ? fullName(y) + (y.discontinued ? ' (utgått)' : '') : [l.brand, l.yarn_name].filter(Boolean).join(' ')
}

const isDiscontinued = (l: { yarn_id: string | null }, catalogue: Map<string, YarnRow>) => !!(l.yarn_id && catalogue.get(l.yarn_id)?.discontinued)

// The pattern's own alternatives, except discontinued ones. A discontinued original yarn
// with no alternative left gets substitutes from the catalogue.
function alternatives(d: ExtractionData, catalogue: Map<string, YarnRow>, all: YarnRow[]): string {
  const kept = d.alternatives.filter(a => !isDiscontinued(a, catalogue))
  const out = kept.map(a => `${a.color_group !== null ? `${groupLabel(d, a.color_group)}: ` : ''}${yarnName(a, catalogue)}`)
  for (const { gone, suggestions } of discontinuedSuggestions(d.yarn_lines, d.alternatives, catalogue, all)) {
    const comparable = gone.fibers.length > 0 && gone.gauge_stitches_min !== null && gone.meterage_m !== null && gone.skein_weight_g !== null
    const none = comparable ? 'ingen sammenlignbare garn i katalogen' : 'mangler fiber, strikkefasthet eller løpelengde til å sammenligne'
    out.push(`Forslag for ${fullName(gone)}: ${suggestions.length ? suggestions.map(fullName).join(', ') : none}`)
  }
  return out.join('; ')
}

function colourGroups(d: ExtractionData): number[] {
  return [...new Set(d.yarn_lines.map(l => l.color_group))].sort((a, b) => a - b)
}

function groupYarns(d: ExtractionData, g: number, catalogue: Map<string, YarnRow>): string[] {
  return d.yarn_lines.filter(l => l.color_group === g)
    .map(l => yarnName(l, catalogue) + (l.strands > 1 ? ` (${l.strands} tråder)` : ''))
}

function groupLabel(d: ExtractionData, g: number): string {
  return d.yarn_lines.find(l => l.color_group === g && l.color_label)?.color_label ?? `Farge ${g}`
}

function groupAmount(d: ExtractionData, size: number, g: number): string {
  return d.amounts
    .filter(a => a.size === size && a.color_group === g)
    .map(a => (a.amount !== null ? `${formatAmount(a)} ${UNIT_LABEL[a.unit]}` : a.candidates.join(' eller ')))
    .filter(Boolean)
    .join(' + ')
}

function gauge(d: ExtractionData): string {
  const parts = [d.gauge_stitches_10cm !== null && `${decimal(d.gauge_stitches_10cm)} m`, d.gauge_rows_10cm !== null && `${decimal(d.gauge_rows_10cm)} p`].filter(Boolean)
  const main = parts.length ? `${parts.join(' × ')} = 10 cm` : ''
  return [main, d.gauge_note].filter(Boolean).join(' – ')
}

function accessories(d: ExtractionData, size: number | null): string {
  return d.accessories
    .filter(a => a.size === null || a.size === size)
    .map(a => `${KIND[a.kind]}: ${[a.quantity !== null && `${decimal(a.quantity)} stk`, a.description, a.dimension].filter(Boolean).join(', ')}`)
    .join('; ')
}

export function recipeSheet(recipes: StoredRecipe[], yarns: YarnRow[]): Sheet {
  const catalogue = new Map(yarns.map(y => [y.id, y]))
  const prepared = recipes
    .map(r => ({ r, d: storedToExtraction(r) }))
    .sort((a, b) => a.r.title.localeCompare(b.r.title, 'nb') || (a.r.designer ?? '').localeCompare(b.r.designer ?? '', 'nb'))
  const width = Math.max(1, ...prepared.map(p => colourGroups(p.d).length))
  const headers = [
    'ID', 'Oppskrift', 'Designer', 'Målgruppe', 'Plaggtype', 'Størrelse',
    ...Array.from({ length: width }, (_, i) => [`Garn ${i + 1}`, `Mengde ${i + 1}`]).flat(),
    'Strikkes sammen', 'Pinner', 'Strikkefasthet', 'Tilbehør', 'Garnalternativer', 'Katalog inneholder', 'Status', 'PDF',
  ]
  const rows: Cell[][] = []
  for (const { r, d } of prepared) {
    const groups = colourGroups(d)
    const together = groups.filter(g => d.yarn_lines.filter(l => l.color_group === g).length > 1)
      .map(g => `${groupLabel(d, g)}: ${groupYarns(d, g, catalogue).join(' + ')}`).join('; ')
    const alts = alternatives(d, catalogue, yarns)
    // A collection gets one row and no sizes; a recipe not read yet has no sizes either.
    const sizes: (number | null)[] = d.is_collection || d.sizes.length === 0 ? [null] : d.sizes.map((_, i) => i)
    for (const s of sizes) {
      const colour = Array.from({ length: width }, (_, i) => {
        const g = groups[i]
        if (g === undefined) return [null, null]
        const label = d.yarn_lines.find(l => l.color_group === g && l.color_label)?.color_label
        return [`${label ? `${label}: ` : ''}${groupYarns(d, g, catalogue).join(' + ')}`, s === null ? null : groupAmount(d, s, g) || null]
      }).flat()
      rows.push([
        r.id, d.title ?? r.title, d.designer, d.audience && AUDIENCE[d.audience], d.garment_type,
        s === null ? null : d.sizes[s].label,
        ...colour,
        together || null, d.needles.join(', ') || null, gauge(d) || null, accessories(d, s) || null, alts || null,
        d.is_collection ? d.collection_titles.join('; ') || null : null,
        STATUS[r.extraction_status], pdfLink(r),
      ])
    }
  }
  return { name: 'Oppskrifter', headers, rows }
}

// ── Garn ────────────────────────────────────────────────────────────────────────────

const yesNo = (v: boolean | null) => (v === null ? null : v ? 'Ja' : 'Nei')

export function yarnSheet(yarns: YarnRow[]): Sheet {
  const sorted = [...yarns].sort((a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`, 'nb'))
  return {
    name: 'Garn',
    headers: [
      'ID', 'Produsent', 'Navn', 'Fiber', 'Plast', 'Vekt per nøste (g)', 'Løpelengde per nøste (m)',
      'Strikkefasthet (m per 10 cm)', 'Pinne (mm)', 'DROPS-garngruppe', 'Utgått', 'Favoritt', 'Pris per nøste (kr)', 'Kilde', 'Status',
    ],
    rows: sorted.map(y => [
      y.id, y.brand || null, y.name, formatFibers(y.fibers) || null, yesNo(y.has_plastic),
      y.skein_weight_g, y.meterage_m,
      formatRange(y.gauge_stitches_min, y.gauge_stitches_max) || null, formatRange(y.needle_mm_min, y.needle_mm_max) || null,
      y.drops_group, y.discontinued ? 'Ja' : 'Nei', yesNo(y.favorite), y.price_per_skein,
      y.source_url ? { text: y.source_kind ? SOURCE_KIND[y.source_kind] : y.source_url, hyperlink: y.source_url } : null,
      YARN_STATUS[y.status],
    ]),
  }
}

export function overviewSheets(recipes: StoredRecipe[], yarns: YarnRow[]): Sheet[] {
  return [recipeSheet(recipes, yarns), yarnSheet(yarns)]
}

// What to do with the file in Drive. The content is compared by its fingerprint, so a
// change made anywhere (the app, or Claude Code working on the database) is picked up.
export function planOverviewWrite(o: { fileId: string | null; storedHash: string | null; hash: string; force: boolean }): 'create' | 'update' | 'unchanged' {
  if (!o.fileId) return 'create'
  return o.force || o.storedHash !== o.hash ? 'update' : 'unchanged'
}
