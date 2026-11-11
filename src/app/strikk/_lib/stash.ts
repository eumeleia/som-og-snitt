// Garnlageret i Strikk (strikk_yarn_stash, migration 024): hva Maria faktisk har liggende,
// én rad per garn og farge. Registrert fra bilder, se docs/garnlager-registrering.md. Pure,
// with no imports, so the app, the tests and scripts/strikk can all load it.

export const STASH_STATUSES = ['til_gjennomgang', 'godkjent'] as const
export type StashStatus = typeof STASH_STATUSES[number]

export interface StashYarnRef { id: string; brand: string; name: string; discontinued: boolean }

export interface StashData {
  color_number: string | null
  color_name: string | null
  skein_count: number
  leftover_g: number | null
  note: string | null
  uncertain_fields: string[]
  uncertain_reasons: Record<string, string>
}

export interface StashRow extends StashData {
  id: string
  yarn_id: string | null
  thumbnail_path: string | null
  source_images: string[]
  status: StashStatus
  approved_at: string | null
  created_at: string
  updated_at: string
  strikk_yarn: StashYarnRef | null
}

export const STASH_SELECT =
  'id, yarn_id, color_number, color_name, skein_count, leftover_g, thumbnail_path, source_images, note, ' +
  'uncertain_fields, uncertain_reasons, status, approved_at, created_at, updated_at, ' +
  'strikk_yarn(id, brand, name, discontinued)'

export const THUMBNAIL_PREFIX = 'garnlager/'
export const THUMBNAIL_MAX_BYTES = 50 * 1024

export function stashThumbnailUrl(path: string | null, base = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!path || !base) return null
  return `${base}/storage/v1/object/public/strikk-thumbnails/${encodeURIComponent(path)}`
}

// ── Parsing a funn.json entry (scripts/strikk/stash.mjs) ────────────────────────────

const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown): string | null => {
  const t = typeof v === 'string' ? v.trim() : ''
  return t || null
}
const nonNegative = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

function marks(list: unknown, reasons: unknown): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of asArr(list)) {
    const field = typeof item === 'string' ? text(item) : text(asObj(item).field)
    if (field && !out.has(field)) out.set(field, (typeof item === 'string' ? null : text(asObj(item).reason)) ?? '')
  }
  for (const [f, r] of Object.entries(asObj(reasons))) if (out.has(f) && !out.get(f) && typeof r === 'string') out.set(f, r)
  return out
}

const str = { type: 'string' }
const obj = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
})

// One find in a review round's funn.json: a garn + farge seen in one or more photos.
export const FINDING_SCHEMA = obj({
  brand: str,
  name: str,
  color_number: str,
  color_name: str,
  skein_count: { type: 'number', description: '0 when only a started skein (leftover_g) was found' },
  leftover_g: { type: 'number', description: '0 when nothing is left over' },
  images: { type: 'array', items: str },
  thumbnail_image: str,
  note: str,
  uncertain: { type: 'array', items: obj({ field: str, reason: str }) },
})

export interface Finding {
  brand: string
  name: string
  color_number: string | null
  color_name: string | null
  skein_count: number
  leftover_g: number | null
  images: string[]
  thumbnail_image: string | null
  note: string | null
  uncertain_fields: string[]
  uncertain_reasons: Record<string, string>
}

export function normalizeFinding(input: unknown): Finding {
  const r = asObj(input)
  const images = asArr(r.images).map(text).filter((x): x is string => x !== null)
  const m = marks(r.uncertain, {})
  return {
    brand: text(r.brand) ?? '',
    name: text(r.name) ?? '',
    color_number: text(r.color_number),
    color_name: text(r.color_name),
    skein_count: nonNegative(r.skein_count) ?? 0,
    leftover_g: nonNegative(r.leftover_g),
    images,
    thumbnail_image: text(r.thumbnail_image),
    note: text(r.note),
    uncertain_fields: [...m.keys()],
    uncertain_reasons: Object.fromEntries([...m].filter(([, why]) => why)),
  }
}

// ── Merging two rows in the review queue (Maria confirms they are the same garn + farge) ──

export function mergeStashData(a: StashData & { source_images: string[] }, b: StashData & { source_images: string[] }): StashData & { source_images: string[] } {
  const skeinSum = a.skein_count + b.skein_count
  const leftoverSum = a.leftover_g === null && b.leftover_g === null ? null : (a.leftover_g ?? 0) + (b.leftover_g ?? 0)
  const uncertainReasons = { ...a.uncertain_reasons, ...b.uncertain_reasons }
  return {
    color_number: a.color_number ?? b.color_number,
    color_name: a.color_name ?? b.color_name,
    skein_count: skeinSum,
    leftover_g: leftoverSum,
    note: [a.note, b.note].filter(Boolean).join(' / ') || null,
    uncertain_fields: [...new Set([...a.uncertain_fields, ...b.uncertain_fields])],
    uncertain_reasons: uncertainReasons,
    source_images: [...new Set([...a.source_images, ...b.source_images])],
  }
}
