// The yarn catalogue in Strikk (strikk_yarn, migration 017): fibre and plastic, ranges for
// gauge and needles, the spellings yarns have in the patterns, and checking one yarn
// before it is saved. Pure, with no imports, so the app, the tests and scripts/strikk can
// all load it.

export const DROPS_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export const SOURCE_KINDS = ['manufacturer', 'pattern', 'retailer', 'other'] as const
export const YARN_STATUSES = ['draft', 'looked_up', 'approved'] as const

export type DropsGroup = typeof DROPS_GROUPS[number]
export type SourceKind = typeof SOURCE_KINDS[number]
export type YarnStatus = typeof YARN_STATUSES[number]

export interface Fiber { fiber: string; percent: number | null }
export interface Alias { brand: string; name: string; certain: boolean; reason: string | null }

export interface YarnData {
  brand: string
  name: string
  fibers: Fiber[]
  skein_weight_g: number | null
  meterage_m: number | null
  gauge_stitches_min: number | null
  gauge_stitches_max: number | null
  needle_mm_min: number | null
  needle_mm_max: number | null
  drops_group: DropsGroup | null
  discontinued: boolean
  source_url: string | null
  source_kind: SourceKind | null
  source_note: string | null
  field_sources: Record<string, string>
  favorite: boolean | null
  price_per_skein: number | null
  uncertain_fields: string[]
  uncertain_reasons: Record<string, string>
}

export interface YarnRow extends YarnData {
  id: string
  aliases: Alias[]
  has_plastic: boolean | null
  status: YarnStatus
  approved_at: string | null
  created_at: string
  updated_at: string
}

// ── Plastic ─────────────────────────────────────────────────────────────────────────
// Polyamide, nylon, acrylic, polyester and elastane. Viscose is made from cellulose and
// does not count.

const PLASTIC = ['polyamid', 'polyamide', 'nylon', 'akryl', 'acrylic', 'polyakryl', 'polyester', 'elastan', 'elastane', 'spandex', 'lycra']

export function isPlasticFiber(fiber: string): boolean {
  const f = fiber.toLowerCase()
  return PLASTIC.some(p => f.includes(p))
}

// null when the fibre content is not known.
export function hasPlastic(fibers: Fiber[]): boolean | null {
  if (fibers.length === 0) return null
  return fibers.some(f => isPlasticFiber(f.fiber))
}

// «80 % merinoull, 20 % polyamid» ↔ [{fiber, percent}], for the edit field.
export function formatFibers(fibers: Fiber[]): string {
  return fibers.map(f => (f.percent !== null ? `${String(f.percent).replace('.', ',')} % ${f.fiber}` : f.fiber)).join(', ')
}

export function parseFibers(input: string): Fiber[] {
  // A comma right before a digit is a decimal comma («57,5 %»), not a separator.
  return input.split(/,(?!\d)|[;+\n]/).map(s => s.trim()).filter(Boolean).map(part => {
    const m = part.match(/^(\d+(?:[.,]\d+)?)\s*%\s*(.+)$/) ?? part.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*%$/)
    if (!m) return { fiber: part, percent: null }
    const [num, fiber] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]]
    return { fiber: fiber.trim(), percent: Number(num.replace(',', '.')) }
  })
}

// ── Ranges ──────────────────────────────────────────────────────────────────────────

const decimal = (n: number) => String(n).replace('.', ',')

export function formatRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return ''
  if (min === null || max === null || min === max) return decimal((min ?? max)!)
  return `${decimal(min)}–${decimal(max)}`
}

// «22», «3,5», «22-24», «3,5–4». Empty is no value; anything else is null.
export function parseRange(input: string): { min: number | null; max: number | null } | null {
  const t = input.trim()
  if (!t) return { min: null, max: null }
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(\d+(?:[.,]\d+)?))?$/)
  if (!m) return null
  const a = Number(m[1].replace(',', '.'))
  const b = m[2] ? Number(m[2].replace(',', '.')) : a
  return { min: Math.min(a, b), max: Math.max(a, b) }
}

// ── Spellings ───────────────────────────────────────────────────────────────────────

// How a brand or yarn name is compared: case, spacing, punctuation and decomposed letters
// (macOS) do not matter. «8/4» and digits are kept.
export function spellingKey(s: string | null | undefined): string {
  return (s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}/]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function aliasKey(brand: string | null | undefined, name: string): string {
  return `${spellingKey(brand)}|${spellingKey(name)}`
}

// The catalogue yarn for a yarn as written in a pattern. A spelling marked uncertain, or
// a match on the name alone when the pattern gave no brand, is an uncertain link.
export function matchYarn<T extends { id: string; brand: string; name: string; aliases: Alias[] }>(
  yarns: T[],
  brand: string | null | undefined,
  name: string,
): { yarn: T; certain: boolean; reason: string | null } | null {
  const k = aliasKey(brand, name)
  for (const y of yarns) {
    if (aliasKey(y.brand, y.name) === k) return { yarn: y, certain: true, reason: null }
    const a = y.aliases.find(x => aliasKey(x.brand, x.name) === k)
    if (a) return { yarn: y, certain: a.certain, reason: a.certain ? null : a.reason ?? 'Usikker sammenslåing av skrivemåter' }
  }
  return null
}

// ── Checking one yarn ───────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>
const asObj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {})
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t || null
}
const positive = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : null

// Accepts {field, reason} lists (from the lookup) and plain names plus a reason map (from the app).
function marks(list: unknown, reasons: unknown): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of asArr(list)) {
    const field = typeof item === 'string' ? text(item) : text(asObj(item).field)
    if (field && !out.has(field)) out.set(field, (typeof item === 'string' ? null : text(asObj(item).reason)) ?? '')
  }
  for (const [f, r] of Object.entries(asObj(reasons))) if (out.has(f) && !out.get(f) && typeof r === 'string') out.set(f, r)
  return out
}

function range(minV: unknown, maxV: unknown): [number | null, number | null] {
  const a = positive(minV)
  const b = positive(maxV)
  if (a === null || b === null) return [a ?? b, a ?? b]
  return [Math.min(a, b), Math.max(a, b)]
}

// What gets stored for one yarn, from a lookup answer or from the edit form. Unknown
// enums and non-numbers become null; brand and name are required.
export function normalizeYarn(input: unknown): YarnData {
  const r = asObj(input)
  const fibers: Fiber[] = []
  for (const f of asArr(r.fibers)) {
    const o = asObj(f)
    const fiber = text(o.fiber)
    if (fiber) fibers.push({ fiber, percent: positive(o.percent) })
  }
  const [gMin, gMax] = range(r.gauge_stitches_min, r.gauge_stitches_max)
  const [nMin, nMax] = range(r.needle_mm_min, r.needle_mm_max)
  const sources: Record<string, string> = {}
  for (const [k, v] of Object.entries(asObj(r.field_sources))) if (text(v)) sources[k] = text(v)!
  for (const item of asArr(r.field_sources)) {
    const o = asObj(item)
    if (text(o.field) && text(o.source)) sources[text(o.field)!] = text(o.source)!
  }
  const m = marks(r.uncertain ?? r.uncertain_fields, r.uncertain_reasons)
  return {
    brand: text(r.brand) ?? '',
    name: text(r.name) ?? '',
    fibers,
    skein_weight_g: positive(r.skein_weight_g),
    meterage_m: positive(r.meterage_m),
    gauge_stitches_min: gMin,
    gauge_stitches_max: gMax,
    needle_mm_min: nMin,
    needle_mm_max: nMax,
    drops_group: pick(typeof r.drops_group === 'string' ? r.drops_group.toUpperCase() : r.drops_group, DROPS_GROUPS),
    discontinued: r.discontinued === true,
    source_url: text(r.source_url),
    source_kind: pick(r.source_kind, SOURCE_KINDS),
    source_note: text(r.source_note),
    field_sources: sources,
    favorite: typeof r.favorite === 'boolean' ? r.favorite : null,
    price_per_skein: positive(r.price_per_skein),
    uncertain_fields: [...m.keys()],
    uncertain_reasons: Object.fromEntries([...m].filter(([, why]) => why)),
  }
}

// The fields every yarn should have; a missing one is shown as missing in the catalogue.
export const REQUIRED_YARN_FIELDS = ['fibers', 'skein_weight_g', 'meterage_m', 'gauge_stitches_min', 'needle_mm_min', 'source_url'] as const

export function missingFields(y: YarnData): string[] {
  const out: string[] = []
  if (y.fibers.length === 0) out.push('fibers')
  if (y.skein_weight_g === null) out.push('skein_weight_g')
  if (y.meterage_m === null) out.push('meterage_m')
  if (y.gauge_stitches_min === null) out.push('gauge_stitches_min')
  if (y.needle_mm_min === null) out.push('needle_mm_min')
  if (!y.source_url && y.source_kind !== 'pattern') out.push('source_url')
  return out
}

// ── Lookup answer format (for scripts/strikk/yarns.mjs) ─────────────────────────────
// Same structured-output subset as the recipe schema: closed objects, every key required,
// no unions; "" / 0 for a value not found.

const str = { type: 'string' }
const num = { type: 'number', description: '0 when not found' }
const obj = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
})

export const YARN_SCHEMA = obj({
  brand: str,
  name: str,
  fibers: { type: 'array', items: obj({ fiber: str, percent: num }) },
  skein_weight_g: num,
  meterage_m: num,
  gauge_stitches_min: num,
  gauge_stitches_max: num,
  needle_mm_min: num,
  needle_mm_max: num,
  drops_group: { type: 'string', enum: [...DROPS_GROUPS, ''] },
  discontinued: { type: 'boolean' },
  source_url: str,
  source_kind: { type: 'string', enum: [...SOURCE_KINDS] },
  source_note: str,
  field_sources: { type: 'array', items: obj({ field: str, source: str }) },
  uncertain: { type: 'array', items: obj({ field: str, reason: str }) },
})
