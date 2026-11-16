// Strikkefasthetskalkulator (Garnlager › Alternativt garn › Kalkulator): an estimate of the
// gauge of one to three catalogue yarns knitted together on a chosen needle, and Maria's own
// swatches of the same yarns on the same needle. Pure, so every rule is tested.
import type { RawSwatch } from './yarn-alternatives'
import type { YarnRow } from './yarns'

export const MAX_YARNS = 3
export const MAX_STRANDS = 6
export const NEEDLE_MIN = 1.5
export const NEEDLE_MAX = 25

export const RULE_TEXT =
  'Tråder strikket sammen: strikkefasthet ≈ 1 / √(summen av 1/g² for hver tråd), der g er garnets strikkefasthet i katalogen. ' +
  'Naturlig pinne ≈ √(summen av n² for hver tråd), der n er garnets anbefalte pinne. ' +
  'På en annen pinne ganges strikkefastheten med naturlig pinne delt på valgt pinne. Spenn i katalogen regnes fra midten.'

export interface CalcMember {
  yarn: Pick<YarnRow, 'id' | 'brand' | 'name' | 'gauge_stitches_min' | 'gauge_stitches_max' | 'needle_mm_min' | 'needle_mm_max' | 'gauge_neutral'>
  strands: number
}

export type Estimate =
  | {
      ok: true
      // Stitches per 10 cm on the chosen needle, rounded, and the ±1 range shown around it.
      gauge: number
      low: number
      high: number
      exact: number
      // The needle the combination knits to its own gauge on, to the nearest 0.5 mm.
      naturalNeedle: number
      naturalNeedleExact: number
      // Yarns taken along without changing the result (gauge_neutral in the catalogue).
      neutral: string[]
    }
  | { ok: false; error: string }

const label = (y: CalcMember['yarn']) => [y.brand, y.name].filter(Boolean).join(' ')
const middle = (min: number | null, max: number | null) =>
  min === null ? null : max === null ? Number(min) : (Number(min) + Number(max)) / 2

export function parseNeedle(input: string): number | null {
  const n = Number(input.replace(',', '.').replace(/mm$/i, '').trim())
  return input.trim() && Number.isFinite(n) ? n : null
}

export function estimateGauge(members: CalcMember[], needleMm: number | null): Estimate {
  if (members.length === 0) return { ok: false, error: 'Velg minst ett garn.' }
  if (members.length > MAX_YARNS) return { ok: false, error: `Høyst ${MAX_YARNS} garn.` }
  for (const m of members) {
    if (!Number.isInteger(m.strands) || m.strands < 1 || m.strands > MAX_STRANDS) {
      return { ok: false, error: `Antall tråder må være 1–${MAX_STRANDS}.` }
    }
  }
  if (needleMm === null) return { ok: false, error: 'Skriv inn pinnestørrelse.' }
  if (needleMm < NEEDLE_MIN || needleMm > NEEDLE_MAX) {
    return { ok: false, error: `Pinnen må være mellom ${String(NEEDLE_MIN).replace('.', ',')} og ${NEEDLE_MAX} mm.` }
  }

  const counted = members.filter(m => !m.yarn.gauge_neutral)
  const neutral = members.filter(m => m.yarn.gauge_neutral).map(m => label(m.yarn))
  if (counted.length === 0) return { ok: false, error: 'Ingen av garnene påvirker strikkefastheten etter katalogen.' }

  const missing: string[] = []
  let inverseSquares = 0
  let needleSquares = 0
  for (const m of counted) {
    const g = middle(m.yarn.gauge_stitches_min, m.yarn.gauge_stitches_max)
    const n = middle(m.yarn.needle_mm_min, m.yarn.needle_mm_max)
    const gaps = [g === null || g <= 0 ? 'strikkefasthet' : null, n === null || n <= 0 ? 'pinne' : null].filter(Boolean)
    if (gaps.length) { missing.push(`${label(m.yarn)} mangler ${gaps.join(' og ')} i katalogen`); continue }
    inverseSquares += m.strands / (g! * g!)
    needleSquares += m.strands * n! * n!
  }
  if (missing.length) return { ok: false, error: `Kan ikke regne: ${missing.join('; ')}.` }

  const natural = 1 / Math.sqrt(inverseSquares)
  const naturalNeedleExact = Math.sqrt(needleSquares)
  const exact = (natural * naturalNeedleExact) / needleMm
  const gauge = Math.round(exact)
  return {
    ok: true, gauge, low: gauge - 1, high: gauge + 1, exact,
    naturalNeedle: Math.round(naturalNeedleExact * 2) / 2, naturalNeedleExact, neutral,
  }
}

// ── Saved swatches ──────────────────────────────────────────────────────────────────

const comboKey = (members: { yarn_id: string; strands: number }[]) =>
  members.map(m => `${m.yarn_id}x${m.strands}`).sort().join('+')

// Swatches of exactly these yarns and strands (a neutral yarn counts as a yarn here) on the
// same needle, newest first.
export function matchingSwatches<S extends RawSwatch & { created_at?: string | null }>(
  swatches: S[], members: { yarnId: string; strands: number }[], needleMm: number | null,
): S[] {
  if (needleMm === null || members.length === 0) return []
  const key = comboKey(members.map(m => ({ yarn_id: m.yarnId, strands: m.strands })))
  return swatches
    .filter(s => s.needle_mm !== null && Math.abs(Number(s.needle_mm) - needleMm) < 0.01 && comboKey(s.members) === key)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

export interface SwatchInput {
  members: { yarn_id: string; strands: number }[]
  needle_mm: number
  gauge_stitches_10cm: number
  gauge_rows_10cm: number | null
  notes: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const toNum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN)

export function parseSwatch(body: unknown): { ok: true; value: SwatchInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Ugyldige data' }
  const b = body as Record<string, unknown>
  if (!Array.isArray(b.members) || b.members.length < 1 || b.members.length > MAX_YARNS) {
    return { ok: false, error: `Velg 1–${MAX_YARNS} garn` }
  }
  const members: SwatchInput['members'] = []
  for (const m of b.members as unknown[]) {
    const r = (m ?? {}) as Record<string, unknown>
    if (typeof r.yarn_id !== 'string' || !UUID.test(r.yarn_id)) return { ok: false, error: 'Ukjent garn' }
    const strands = toNum(r.strands)
    if (!Number.isInteger(strands) || strands < 1 || strands > MAX_STRANDS) return { ok: false, error: `Antall tråder må være 1–${MAX_STRANDS}` }
    if (members.some(x => x.yarn_id === r.yarn_id)) return { ok: false, error: 'Samme garn er valgt to ganger' }
    members.push({ yarn_id: r.yarn_id, strands })
  }
  const needle = toNum(b.needle_mm)
  if (!Number.isFinite(needle) || needle < NEEDLE_MIN || needle > NEEDLE_MAX) return { ok: false, error: 'Ugyldig pinnestørrelse' }
  const gauge = toNum(b.gauge_stitches_10cm)
  if (!Number.isFinite(gauge) || gauge <= 0 || gauge > 80) return { ok: false, error: 'Skriv inn målte masker per 10 cm' }
  let rows: number | null = null
  if (b.gauge_rows_10cm !== undefined && b.gauge_rows_10cm !== null && b.gauge_rows_10cm !== '') {
    rows = toNum(b.gauge_rows_10cm)
    if (!Number.isFinite(rows) || rows <= 0 || rows > 120) return { ok: false, error: 'Ugyldig antall pinner/omganger' }
  }
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null
  return { ok: true, value: { members, needle_mm: needle, gauge_stitches_10cm: gauge, gauge_rows_10cm: rows, notes } }
}
