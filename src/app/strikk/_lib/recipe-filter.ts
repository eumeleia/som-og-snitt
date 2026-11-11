// Filtering and sorting in Strikk › Oppskrifter. Pure: the list component loads the rows
// (RECIPE_FILTER_SELECT) and the catalogue, and keeps the filter state.
import type { Audience, StoredRecipe } from './extraction'
import { discontinuedSuggestions, spellingKey, type YarnRow } from './yarns'

export const RECIPE_FILTER_SELECT =
  'id, title, designer, drive_file_id, file_name, source, created_at, updated_at, extraction_status, ' +
  'audience, garment_type, is_collection, gauge_stitches_10cm, mentions_leftover, leftover_note, rating, favorite, ' +
  'strikk_size(id, position, label), ' +
  'strikk_yarn_line(id, position, color_group, yarn_id, skein_weight_g), ' +
  'strikk_yarn_amount(size_id, color_group, yarn_line_id, amount, amount_max, unit), ' +
  'strikk_yarn_alternative(yarn_line_id, color_group, yarn_id, source)'

export interface FilterRecipe {
  id: string
  title: string
  designer: string | null
  drive_file_id: string
  file_name: string
  source: 'upload'
  created_at: string
  updated_at: string
  extraction_status: StoredRecipe['extraction_status']
  audience: Audience | null
  garment_type: string | null
  is_collection: boolean
  gauge_stitches_10cm: number | string | null
  mentions_leftover: boolean | null
  leftover_note: string | null
  rating: number | null
  favorite: boolean
  strikk_size: { id: string; position: number; label: string }[]
  strikk_yarn_line: { id: string; position: number; color_group: number; yarn_id: string | null; skein_weight_g: number | string | null }[]
  strikk_yarn_amount: { size_id: string; color_group: number; yarn_line_id: string | null; amount: number | string | null; amount_max: number | string | null; unit: 'g' | 'skeins' }[]
  strikk_yarn_alternative: { yarn_line_id: string | null; color_group: number | null; yarn_id?: string | null; source: 'pattern' | 'app' }[]
}

export const SORTS = ['title', 'designer', 'gauge', 'newest', 'rating', 'favorites'] as const
export type Sort = typeof SORTS[number]
export const SORT_LABEL: Record<Sort, string> = {
  title: 'Navn', designer: 'Designer', gauge: 'Strikkefasthet', newest: 'Sist lagt til', rating: 'Stjerner', favorites: 'Favoritter først',
}

export interface RecipeFilter {
  query: string
  garmentTypes: string[]
  audiences: Audience[]
  gaugeMin: number | null
  gaugeMax: number | null
  yarnIds: string[]
  leftover: boolean
  favorites: boolean
  // At least this many stars; null for any.
  minRating: number | null
  sort: Sort
}

export const EMPTY_FILTER: RecipeFilter = {
  query: '', garmentTypes: [], audiences: [], gaugeMin: null, gaugeMax: null, yarnIds: [], leftover: false, favorites: false, minRating: null, sort: 'newest',
}

export const AUDIENCE_LABEL: Record<Audience, string> = {
  woman: 'Kvinne', man: 'Mann', unisex: 'Unisex', child: 'Barn', interior: 'Interiør', other: 'Annet',
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v))
export const garmentKey = (s: string | null) => (s ?? '').trim().toLowerCase()
export const yarnLabel = (y: Pick<YarnRow, 'brand' | 'name' | 'discontinued'>) =>
  [y.brand, y.name].filter(Boolean).join(' ') + (y.discontinued ? ' (utgått)' : '')

// ── Yarn ────────────────────────────────────────────────────────────────────────────

export type YarnHit =
  | { kind: 'uses' }
  | { kind: 'alternative' }
  | { kind: 'suggested'; instead: string }

// How a recipe matches one catalogue yarn: it uses the yarn, names it as one of its own
// alternatives, or the app suggests it instead of a discontinued yarn. A discontinued yarn
// is never an alternative.
export function yarnHits(r: FilterRecipe, yarnId: string, catalogue: Map<string, YarnRow>, all: YarnRow[]): YarnHit[] {
  const hits: YarnHit[] = []
  if (r.strikk_yarn_line.some(l => l.yarn_id === yarnId)) hits.push({ kind: 'uses' })
  const alts = r.strikk_yarn_alternative.filter(a => a.source === 'pattern')
  if (!catalogue.get(yarnId)?.discontinued && alts.some(a => a.yarn_id === yarnId)) hits.push({ kind: 'alternative' })
  const lines = [...r.strikk_yarn_line].sort((a, b) => a.position - b.position)
  const index = new Map(lines.map((l, i) => [l.id, i]))
  const linked = alts.map(a => ({ yarn_id: a.yarn_id ?? null, color_group: a.color_group, yarn_line: a.yarn_line_id ? index.get(a.yarn_line_id) ?? null : null }))
  for (const s of discontinuedSuggestions(lines, linked, catalogue, all)) {
    if (s.suggestions.some(y => y.id === yarnId)) hits.push({ kind: 'suggested', instead: [s.gone.brand, s.gone.name].filter(Boolean).join(' ') })
  }
  return hits
}

// ── Leftover yarn ───────────────────────────────────────────────────────────────────

export type LeftoverReason = { kind: 'mentions'; note: string | null } | { kind: 'colours'; count: number }

// Skeins one colour needs in a size; null when an amount or the skein weight is unknown.
// A range counts by its upper end. Yarns knitted together in a colour each count.
function colourSkeins(r: FilterRecipe, sizeId: string, group: number, catalogue: Map<string, YarnRow>): number | null {
  const amounts = r.strikk_yarn_amount.filter(a => a.size_id === sizeId && a.color_group === group)
  if (amounts.length === 0) return null
  let most = 0
  for (const a of amounts) {
    const n = num(a.amount_max) ?? num(a.amount)
    if (n === null) return null
    if (a.unit === 'skeins') { most = Math.max(most, n); continue }
    const line = r.strikk_yarn_line.find(l => l.id === a.yarn_line_id) ?? r.strikk_yarn_line.find(l => l.color_group === group)
    const weight = num(line?.skein_weight_g) ?? num(line?.yarn_id ? catalogue.get(line.yarn_id)?.skein_weight_g : null)
    if (!weight) return null
    most = Math.max(most, n / weight)
  }
  return most
}

// A recipe that mentions leftover yarn itself, or that has at least three colours that
// each need under two skeins in the smallest size (other colours may need more).
export function leftoverReason(r: FilterRecipe, catalogue: Map<string, YarnRow>): LeftoverReason | null {
  if (r.mentions_leftover) return { kind: 'mentions', note: r.leftover_note }
  const smallest = [...r.strikk_size].sort((a, b) => a.position - b.position)[0]
  if (!smallest) return null
  const groups = [...new Set(r.strikk_yarn_line.map(l => l.color_group))]
  const small = groups.filter(g => { const s = colourSkeins(r, smallest.id, g, catalogue); return s !== null && s < 2 }).length
  return small >= 3 ? { kind: 'colours', count: small } : null
}

// ── Filtering and sorting ───────────────────────────────────────────────────────────

export interface FilterResult {
  recipe: FilterRecipe
  yarnHits: { yarnId: string; hits: YarnHit[] }[]
  leftover: LeftoverReason | null
}

const read = (r: FilterRecipe) => r.extraction_status === 'extracted' || r.extraction_status === 'approved'

// Categories combine with «and»; choices within one category with «or». Collections take
// part in garment type and audience, but not in gauge or yarn.
export function applyFilter(recipes: FilterRecipe[], f: RecipeFilter, yarns: YarnRow[]): FilterResult[] {
  const catalogue = new Map(yarns.map(y => [y.id, y]))
  const q = spellingKey(f.query)
  const types = new Set(f.garmentTypes.map(garmentKey))
  const out: FilterResult[] = []
  for (const r of recipes) {
    if (q && !spellingKey(`${r.title} ${r.designer ?? ''}`).includes(q)) continue
    if (types.size && !types.has(garmentKey(r.garment_type))) continue
    if (f.audiences.length && !(r.audience && f.audiences.includes(r.audience))) continue
    if (f.favorites && !r.favorite) continue
    if (f.minRating !== null && (r.rating ?? 0) < f.minRating) continue
    if (f.gaugeMin !== null || f.gaugeMax !== null) {
      const g = num(r.gauge_stitches_10cm)
      if (r.is_collection || g === null) continue
      if (f.gaugeMin !== null && g < f.gaugeMin) continue
      if (f.gaugeMax !== null && g > f.gaugeMax) continue
    }
    const yarnHitList = f.yarnIds.map(yarnId => ({ yarnId, hits: r.is_collection ? [] : yarnHits(r, yarnId, catalogue, yarns) }))
    if (f.yarnIds.length && !yarnHitList.some(h => h.hits.length)) continue
    const leftover = read(r) ? leftoverReason(r, catalogue) : null
    if (f.leftover && !leftover) continue
    out.push({ recipe: r, yarnHits: yarnHitList.filter(h => h.hits.length), leftover })
  }
  return sortResults(out, f.sort)
}

const nb = (a: string, b: string) => a.localeCompare(b, 'nb', { sensitivity: 'base' })

export function sortResults(list: FilterResult[], sort: Sort): FilterResult[] {
  const byTitle = (a: FilterResult, b: FilterResult) => nb(a.recipe.title, b.recipe.title)
  const newest = (a: FilterResult, b: FilterResult) => b.recipe.created_at.localeCompare(a.recipe.created_at) || byTitle(a, b)
  const cmp: Record<Sort, (a: FilterResult, b: FilterResult) => number> = {
    title: byTitle,
    // Missing designer or gauge goes last.
    designer: (a, b) => (!a.recipe.designer ? 1 : 0) - (!b.recipe.designer ? 1 : 0) || nb(a.recipe.designer ?? '', b.recipe.designer ?? '') || byTitle(a, b),
    gauge: (a, b) => {
      const x = num(a.recipe.gauge_stitches_10cm), y = num(b.recipe.gauge_stitches_10cm)
      return (x === null ? 1 : 0) - (y === null ? 1 : 0) || (x ?? 0) - (y ?? 0) || byTitle(a, b)
    },
    newest,
    // Most stars first; recipes without stars last.
    rating: (a, b) => (b.recipe.rating ?? 0) - (a.recipe.rating ?? 0) || newest(a, b),
    favorites: (a, b) => (b.recipe.favorite ? 1 : 0) - (a.recipe.favorite ? 1 : 0) || newest(a, b),
  }
  return [...list].sort(cmp[sort])
}

// ── Active filters ──────────────────────────────────────────────────────────────────

export interface Chip { key: string; label: string }

export function activeChips(f: RecipeFilter, yarns: YarnRow[]): Chip[] {
  const byId = new Map(yarns.map(y => [y.id, y]))
  const chips: Chip[] = []
  if (f.query.trim()) chips.push({ key: 'query', label: `Søk: ${f.query.trim()}` })
  for (const t of f.garmentTypes) chips.push({ key: `type:${t}`, label: t })
  for (const a of f.audiences) chips.push({ key: `audience:${a}`, label: AUDIENCE_LABEL[a] })
  if (f.gaugeMin !== null || f.gaugeMax !== null) {
    const range = f.gaugeMin !== null && f.gaugeMax !== null ? `${f.gaugeMin}–${f.gaugeMax}` : f.gaugeMin !== null ? `minst ${f.gaugeMin}` : `høyst ${f.gaugeMax}`
    chips.push({ key: 'gauge', label: `${range} m/10 cm` })
  }
  for (const id of f.yarnIds) { const y = byId.get(id); chips.push({ key: `yarn:${id}`, label: y ? yarnLabel(y) : 'Ukjent garn' }) }
  if (f.leftover) chips.push({ key: 'leftover', label: 'Restegarn' })
  if (f.favorites) chips.push({ key: 'favorites', label: 'Favoritter' })
  if (f.minRating !== null) chips.push({ key: 'rating', label: f.minRating === 5 ? '5 stjerner' : `Minst ${f.minRating} stjerner` })
  return chips
}

export function removeChip(f: RecipeFilter, key: string): RecipeFilter {
  const [kind, value] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)]
  switch (kind) {
    case 'query': return { ...f, query: '' }
    case 'type': return { ...f, garmentTypes: f.garmentTypes.filter(t => t !== value) }
    case 'audience': return { ...f, audiences: f.audiences.filter(a => a !== value) }
    case 'gauge': return { ...f, gaugeMin: null, gaugeMax: null }
    case 'yarn': return { ...f, yarnIds: f.yarnIds.filter(id => id !== value) }
    case 'leftover': return { ...f, leftover: false }
    case 'favorites': return { ...f, favorites: false }
    case 'rating': return { ...f, minRating: null }
    default: return f
  }
}

// Every garment type in use, with how many recipes have it, most used first.
export function garmentTypes(recipes: FilterRecipe[]): { type: string; count: number }[] {
  const m = new Map<string, number>()
  for (const r of recipes) { const k = garmentKey(r.garment_type); if (k) m.set(k, (m.get(k) ?? 0) + 1) }
  return [...m].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || nb(a.type, b.type))
}
