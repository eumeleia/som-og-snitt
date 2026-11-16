// Garn → oppskrifter: hvilke oppskrifter et garn kan brukes til, og hvorfor. Brukt både av
// «Finn alternativt garn» i Garnlager og av garnfilteret i Oppskrifter, så de gir samme treff.
// Pure, testes uten database.
import { rankAlternatives, type Alternative, type RawCombo, type RawSwatch } from './yarn-alternatives'
import { fibreFamily, formatFibers, formatRange, mainFibre, type YarnRow } from './yarns'

export interface RecipeYarnLine {
  id: string
  position: number
  color_group: number
  yarn_id: string | null
  yarn_name?: string | null
  brand?: string | null
  fiber?: string | null
  strands?: number | null
}
export interface RecipeYarnAlternative {
  yarn_line_id: string | null
  color_group: number | null
  yarn_id?: string | null
  source: 'pattern' | 'app'
}
export interface YarnRecipe {
  id: string
  title: string
  is_collection: boolean
  gauge_stitches_10cm: number | string | null
  strikk_yarn_line: RecipeYarnLine[]
  strikk_yarn_alternative: RecipeYarnAlternative[]
}

export interface YarnContext {
  catalogue: Map<string, YarnRow>
  combos: RawCombo[]
  swatches: RawSwatch[]
}

// Highest trust first.
export const HIT_SOURCES = ['recommended', 'pattern', 'own_swatch', 'skaberglaede', 'drops', 'same_gauge'] as const
export type HitSource = typeof HIT_SOURCES[number]
export type HitGroup = 'recommended' | 'pattern' | 'alternatives'
export const HIT_GROUP: Record<HitSource, HitGroup> = {
  recommended: 'recommended', pattern: 'pattern',
  own_swatch: 'alternatives', skaberglaede: 'alternatives', drops: 'alternatives', same_gauge: 'alternatives',
}
export const HIT_GROUP_LABEL: Record<HitGroup, string> = {
  recommended: 'Anbefalt garn', pattern: 'Oppskriftens eget alternativ', alternatives: 'Fra garnalternativene',
}
export const HIT_SOURCE_LABEL: Record<HitSource, string> = {
  recommended: 'Oppskriftens garn', pattern: 'Oppskriftens eget alternativ', own_swatch: 'Egen strikkeprøve',
  skaberglaede: 'Skaberglæde', drops: 'DROPS', same_gauge: 'Samme strikkefasthet og hovedfiber',
}

export interface RecipeHit {
  source: HitSource
  colorGroup: number
  // The yarns of that colour in the recipe, which this yarn would replace.
  instead: string[]
  // The colour is knitted with more than one strand (a carry-along yarn, or doubled).
  heldTogether: boolean
  // Other yarns the combination needs, for a combination hit.
  with: string[]
}

export interface RecipeForYarn<R extends YarnRecipe = YarnRecipe> {
  recipe: R
  hits: RecipeHit[]
  best: RecipeHit
}

const GAUGE_TOLERANCE = 1
const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v))

// Discontinued yarns are never offered as an alternative. Yarns with plastic are, with their
// fibres shown beside them.
export const suggestable = (y: YarnRow) => !y.discontinued

export const yarnName = (y: Pick<YarnRow, 'brand' | 'name'>) => [y.brand, y.name].filter(Boolean).join(' ')

function lineLabel(l: RecipeYarnLine, catalogue: Map<string, YarnRow>): string {
  const y = l.yarn_id ? catalogue.get(l.yarn_id) : undefined
  const name = y ? yarnName(y) : [l.brand, l.yarn_name].filter(Boolean).join(' ') || 'ukjent garn'
  return (l.strands ?? 1) > 1 ? `${name} (${l.strands} tråder)` : name
}

// The catalogue rule: the yarn's own gauge range, widened by one stitch per 10 cm, covers
// the recipe's gauge, and the main fibre is the same.
export function catalogueMatches(yarn: YarnRow, gauge: number | null, fibre: string | null): boolean {
  if (gauge === null || fibre === null || yarn.gauge_stitches_min === null) return false
  const max = yarn.gauge_stitches_max ?? yarn.gauge_stitches_min
  if (gauge < yarn.gauge_stitches_min - GAUGE_TOLERANCE || gauge > max + GAUGE_TOLERANCE) return false
  return mainFibre(yarn.fibers) === fibre
}

function groupsOf(r: YarnRecipe): { group: number; lines: RecipeYarnLine[] }[] {
  const lines = [...r.strikk_yarn_line].sort((a, b) => a.position - b.position)
  const order: number[] = []
  for (const l of lines) if (!order.includes(l.color_group)) order.push(l.color_group)
  return order.map(group => ({ group, lines: lines.filter(l => l.color_group === group) }))
}

// The main fibre a colour asks for: its first yarn's, from the catalogue or the pattern.
function groupFibre(lines: RecipeYarnLine[], catalogue: Map<string, YarnRow>): string | null {
  const main = lines[0]
  if (!main) return null
  const y = main.yarn_id ? catalogue.get(main.yarn_id) : undefined
  if (y && y.fibers.length) return mainFibre(y.fibers)
  return main.fiber ? fibreFamily(main.fiber) : null
}

export function recipeHitsForYarn(r: YarnRecipe, yarnId: string, ctx: YarnContext): RecipeHit[] {
  if (r.is_collection) return []
  const yarn = ctx.catalogue.get(yarnId)
  if (!yarn) return []
  const gauge = num(r.gauge_stitches_10cm)
  const hits: RecipeHit[] = []

  for (const { group, lines } of groupsOf(r)) {
    const heldTogether = lines.length > 1 || lines.some(l => (l.strands ?? 1) > 1)
    const instead = lines.map(l => lineLabel(l, ctx.catalogue))
    const base = { colorGroup: group, instead, heldTogether, with: [] as string[] }

    if (lines.some(l => l.yarn_id === yarnId)) {
      hits.push({ ...base, source: 'recommended', instead: [] })
      continue
    }
    if (!suggestable(yarn)) continue

    const ids = new Set(lines.map(l => l.id))
    const named = r.strikk_yarn_alternative.some(a => a.source === 'pattern' && a.yarn_id === yarnId &&
      (a.yarn_line_id ? ids.has(a.yarn_line_id) : a.color_group === null || a.color_group === group))
    if (named) hits.push({ ...base, source: 'pattern' })

    if (gauge === null) continue
    const close = (g: number | null) => g !== null && Math.abs(g - gauge) <= GAUGE_TOLERANCE
    const others = (members: { yarn_id: string | null }[]) => {
      if (!members.some(m => m.yarn_id === yarnId)) return null
      const rest: string[] = []
      for (const m of members) {
        const y = m.yarn_id ? ctx.catalogue.get(m.yarn_id) : undefined
        if (!y || !suggestable(y)) return null
        if (y.id !== yarnId) rest.push(yarnName(y))
      }
      return rest
    }
    for (const s of ctx.swatches) {
      const rest = close(s.gauge_stitches_10cm) ? others(s.members) : null
      if (rest) hits.push({ ...base, source: 'own_swatch', with: rest })
    }
    for (const c of ctx.combos) {
      const rest = close(c.gauge_stitches_10cm) ? others(c.members) : null
      if (rest) hits.push({ ...base, source: c.source === 'skaberglaede' ? 'skaberglaede' : 'drops', with: rest })
    }
    if (catalogueMatches(yarn, gauge, groupFibre(lines, ctx.catalogue))) {
      hits.push({ ...base, source: 'same_gauge' })
    }
  }
  return hits.sort((a, b) => HIT_SOURCES.indexOf(a.source) - HIT_SOURCES.indexOf(b.source))
}

// Every recipe the yarn can be used for, the most trusted first.
export function recipesForYarn<R extends YarnRecipe>(recipes: R[], yarnId: string, ctx: YarnContext): RecipeForYarn<R>[] {
  const out: RecipeForYarn<R>[] = []
  for (const recipe of recipes) {
    const hits = recipeHitsForYarn(recipe, yarnId, ctx)
    if (hits.length) out.push({ recipe, hits, best: hits[0] })
  }
  return out.sort((a, b) =>
    HIT_SOURCES.indexOf(a.best.source) - HIT_SOURCES.indexOf(b.best.source) ||
    a.recipe.title.localeCompare(b.recipe.title, 'nb', { sensitivity: 'base' }))
}

// ── Pairs: a main yarn and a carry-along yarn ───────────────────────────────────────

export interface PairMember { yarnId: string; strands: number }

const memberKey = (members: { yarnId: string; strands: number }[]) =>
  members.map(m => `${m.yarnId}x${m.strands}`).sort().join('+')

// "id" or "idx2" per member, comma-separated, as in the link from a recipe.
export function parsePair(param: string | null): PairMember[] {
  if (!param) return []
  return param.split(',').map(p => {
    const [yarnId, strands] = p.split('x')
    return { yarnId, strands: Math.max(1, Number(strands) || 1) }
  }).filter(m => m.yarnId)
}
export const formatPair = (members: PairMember[]) => members.map(m => (m.strands > 1 ? `${m.yarnId}x${m.strands}` : m.yarnId)).join(',')

// The pair's gauge from the combination tables: a swatch or combination of exactly these
// yarns. Maria's own swatch first.
export function pairGauge(members: PairMember[], combos: RawCombo[], swatches: RawSwatch[]): number | null {
  const key = memberKey(members)
  const same = (ms: { yarn_id: string | null; strands: number }[]) =>
    ms.every(m => m.yarn_id) && memberKey(ms.map(m => ({ yarnId: m.yarn_id!, strands: m.strands }))) === key
  for (const s of swatches) if (s.gauge_stitches_10cm !== null && same(s.members)) return s.gauge_stitches_10cm
  for (const c of combos) if (c.gauge_stitches_10cm !== null && same(c.members)) return c.gauge_stitches_10cm
  return null
}

// Alternatives to the pair as a whole: other thread combinations and single yarns at the
// pair's gauge, with the main yarn's main fibre for catalogue yarns.
export function pairAlternatives(args: {
  members: PairMember[]
  gauge: number
  catalogue: YarnRow[]
  combos: RawCombo[]
  swatches: RawSwatch[]
  patternAlternativeYarnIds?: string[]
}): { combinations: Alternative[]; singles: Alternative[] } {
  const byId = new Map(args.catalogue.map(y => [y.id, y]))
  const main = byId.get(args.members[0]?.yarnId ?? '')
  const all = rankAlternatives({
    targetGauge: args.gauge,
    targetFibre: main ? mainFibre(main.fibers) : null,
    excludeYarnId: null,
    catalogue: args.catalogue,
    combos: args.combos,
    swatches: args.swatches,
    patternAlternativeYarnIds: args.patternAlternativeYarnIds ?? [],
  })
  const key = memberKey(args.members)
  const rest = all.filter(a => memberKey(a.members.map(m => ({ yarnId: m.yarn.id, strands: m.strands }))) !== key)
  return {
    combinations: rest.filter(a => a.members.length > 1 || a.members.some(m => m.strands > 1)),
    singles: rest.filter(a => a.members.length === 1 && a.members[0].strands === 1),
  }
}

// ── Comparing a yarn with the one it replaces ───────────────────────────────────────

export const FACT_FIELDS = ['fibre', 'meterage', 'weight', 'gauge', 'needle'] as const
export type FactField = typeof FACT_FIELDS[number]
export const FACT_LABEL: Record<FactField, string> = {
  fibre: 'Fiber', meterage: 'Løpelengde', weight: 'Vekt per nøste', gauge: 'Strikkefasthet', needle: 'Pinne',
}

export function yarnFacts(y: YarnRow): Record<FactField, string> {
  const range = formatRange(y.gauge_stitches_min, y.gauge_stitches_max)
  const needle = formatRange(y.needle_mm_min, y.needle_mm_max)
  return {
    fibre: formatFibers(y.fibers) || '–',
    meterage: y.meterage_m !== null ? `${y.meterage_m} m` : '–',
    weight: y.skein_weight_g !== null ? `${y.skein_weight_g} g` : '–',
    gauge: range ? `${range} m/10 cm` : '–',
    needle: needle ? `${needle} mm` : '–',
  }
}

// Which fields differ from the yarn being replaced. A field unknown on either side is not
// marked: there is nothing to compare.
export function factDiffs(target: YarnRow, other: YarnRow): Set<FactField> {
  const a = yarnFacts(target)
  const b = yarnFacts(other)
  const out = new Set<FactField>()
  for (const f of FACT_FIELDS) if (a[f] !== '–' && b[f] !== '–' && a[f] !== b[f]) out.add(f)
  return out
}
