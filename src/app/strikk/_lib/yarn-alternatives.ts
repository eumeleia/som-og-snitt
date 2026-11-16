// Garnalternativer: hvilke garn (eller garn holdt sammen) gir en bestemt strikkefasthet,
// rangert etter hvor mye vi stoler på kilden. Pure, ingen imports utenom typene fra yarns.ts,
// så den kan testes uten database.
import { fibreFamily, mainFibre, type YarnRow } from './yarns'

export const ALT_SOURCES = ['own_swatch', 'skaberglaede', 'pattern', 'drops', 'yarn_info', 'same_gauge', 'same_thickness'] as const
export type AltSource = typeof ALT_SOURCES[number]

// Høyest tillit først: egne strikkeprøver, Skaberglæde, oppskriftens egne alternativer,
// DROPS (garnkombinasjonssiden og garngruppe-regelen slått sammen), garnets egne opplysninger
// (f.eks. strikkefasthet med dobbel tråd hos forhandleren), lik strikkefasthet og
// hovedfiber i katalogen, og til sist samme tykkelse (hovedfiber og løpelengde) i katalogen.
const SOURCE_RANK: Record<AltSource, number> = {
  own_swatch: 0, skaberglaede: 1, pattern: 2, drops: 3, yarn_info: 4, same_gauge: 5, same_thickness: 6,
}

// Strikkefasthet er sjelden helt eksakt; innenfor denne mange masker per 10 cm regnes to
// strikkefastheter som samme.
const GAUGE_TOLERANCE = 1
// Metres per 50 g within this share count as the same thickness, as for substitutes of a
// discontinued yarn (yarns.ts). Makers state gauge differently for the same thickness:
// Viking says 15 stitches for Alpaca Bris, DROPS 17 for Air, both 150 m per 50 g. The gauge
// must still be within a few stitches: metres alone also match a thin, dense yarn to an airy
// one (DROPS Alpaca, 24 stitches, has 167 m per 50 g).
const METRES_TOLERANCE = 0.15
const THICKNESS_GAUGE_TOLERANCE = 3
const per50 = (y: Pick<YarnRow, 'meterage_m' | 'skein_weight_g'>) =>
  (y.meterage_m && y.skein_weight_g ? (Number(y.meterage_m) * 50) / Number(y.skein_weight_g) : null)

export interface AltMember {
  yarn: YarnRow
  strands: number
  // Set when the same yarn is also suggested with several strands (Tilia, 2 tråder), so a
  // single strand is shown as «1 tråd» and the two are told apart.
  showStrands?: boolean
}

export const strandText = (m: AltMember) =>
  m.strands > 1 ? ` (${m.strands} tråder)` : m.showStrands ? ' (1 tråd)' : ''

export interface Alternative {
  source: AltSource
  members: AltMember[]
  gauge_stitches_10cm: number | null
  gauge_rows_10cm: number | null
  needle_mm: number | null
  note: string | null
  source_url: string | null
}

function gaugeMatches(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= GAUGE_TOLERANCE
}

// Utgått garn blir aldri foreslått, uansett kilde. Garn med plast foreslås som annet garn;
// fibersammensetningen vises ved hvert forslag, så Maria vurderer selv.
const suggestable = (y: YarnRow) => !y.discontinued

export interface RawCombo {
  source: 'skaberglaede' | 'drops' | 'yarn_info'
  source_url: string | null
  stitch_pattern: string | null
  gauge_stitches_10cm: number | null
  gauge_rows_10cm: number | null
  needle_mm: number | null
  note: string | null
  members: { yarn_id: string | null; strands: number }[]
}

export interface RawSwatch {
  gauge_stitches_10cm: number | null
  gauge_rows_10cm: number | null
  needle_mm: number | null
  notes: string | null
  members: { yarn_id: string; strands: number }[]
  created_at?: string | null
}

export interface PatternAlternative {
  yarn_id: string | null
  // When the pattern only names the yarn (not yet linked to the catalogue), it cannot be
  // offered as a structured alternative — only linked ones are.
}

// members → resolved AltMember[] via the catalogue, or null when a member is missing from
// the catalogue or not suggestable (the whole combo/swatch is then dropped, not just that
// member — a combination is only as good as all of its yarns).
function resolveMembers(
  members: { yarn_id: string | null; strands: number }[],
  catalogue: Map<string, YarnRow>,
): AltMember[] | null {
  const out: AltMember[] = []
  for (const m of members) {
    if (!m.yarn_id) return null
    const yarn = catalogue.get(m.yarn_id)
    if (!yarn || !suggestable(yarn)) return null
    out.push({ yarn, strands: m.strands })
  }
  return out.length > 0 ? out : null
}

export function rankAlternatives(args: {
  targetGauge: number | null
  targetFibre: string | null
  // The yarn being replaced: catalogue yarns of its main fibre and thickness count too.
  targetYarn?: Pick<YarnRow, 'meterage_m' | 'skein_weight_g'> | null
  excludeYarnId: string | null
  catalogue: YarnRow[]
  combos: RawCombo[]
  swatches: RawSwatch[]
  patternAlternativeYarnIds: string[]
}): Alternative[] {
  const { targetGauge, targetFibre, excludeYarnId, catalogue, combos, swatches, patternAlternativeYarnIds } = args
  const byId = new Map(catalogue.map(y => [y.id, y]))
  const out: Alternative[] = []

  for (const s of swatches) {
    if (!gaugeMatches(s.gauge_stitches_10cm, targetGauge)) continue
    const members = resolveMembers(s.members, byId)
    if (!members) continue
    out.push({
      source: 'own_swatch', members,
      gauge_stitches_10cm: s.gauge_stitches_10cm, gauge_rows_10cm: s.gauge_rows_10cm,
      needle_mm: s.needle_mm, note: s.notes, source_url: null,
    })
  }

  for (const c of combos) {
    if (!gaugeMatches(c.gauge_stitches_10cm, targetGauge)) continue
    const members = resolveMembers(c.members, byId)
    if (!members) continue
    out.push({
      source: c.source === 'skaberglaede' || c.source === 'yarn_info' ? c.source : 'drops', members,
      gauge_stitches_10cm: c.gauge_stitches_10cm, gauge_rows_10cm: c.gauge_rows_10cm,
      needle_mm: c.needle_mm, note: c.note, source_url: c.source_url,
    })
  }

  for (const yarnId of patternAlternativeYarnIds) {
    if (yarnId === excludeYarnId) continue
    const yarn = byId.get(yarnId)
    if (!yarn || !suggestable(yarn)) continue
    out.push({
      source: 'pattern', members: [{ yarn, strands: 1 }],
      gauge_stitches_10cm: null, gauge_rows_10cm: null, needle_mm: null,
      note: 'Oppskriftens eget alternativ', source_url: null,
    })
  }

  if (targetFibre) {
    // Same gauge first, then those that only share the thickness.
    const byThickness: Alternative[] = []
    const target = args.targetYarn ? per50(args.targetYarn) : null
    for (const y of catalogue) {
      if (y.id === excludeYarnId || !suggestable(y)) continue
      if (mainFibre(y.fibers) !== targetFibre) continue
      const max = y.gauge_stitches_max ?? y.gauge_stitches_min
      const sameGauge = y.gauge_stitches_min !== null && max !== null && targetGauge !== null &&
        targetGauge >= y.gauge_stitches_min - GAUGE_TOLERANCE && targetGauge <= max + GAUGE_TOLERANCE
      const mine = per50(y)
      const nearGauge = y.gauge_stitches_min !== null && max !== null && targetGauge !== null &&
        targetGauge >= y.gauge_stitches_min - THICKNESS_GAUGE_TOLERANCE && targetGauge <= max + THICKNESS_GAUGE_TOLERANCE
      const sameThickness = nearGauge && target !== null && mine !== null && Math.abs(mine - target) / target <= METRES_TOLERANCE
      if (!sameGauge && !sameThickness) continue
      const list = sameGauge ? out : byThickness
      list.push({
        source: sameGauge ? 'same_gauge' : 'same_thickness', members: [{ yarn: y, strands: 1 }],
        gauge_stitches_10cm: y.gauge_stitches_min, gauge_rows_10cm: null, needle_mm: y.needle_mm_min,
        note: sameGauge ? 'Samme strikkefasthet og hovedfiber i katalogen' : 'Samme hovedfiber og løpelengde i katalogen; produsenten oppgir litt annen strikkefasthet',
        source_url: null,
      })
    }
    out.push(...byThickness)
  }

  const multi = new Set([...combos, ...swatches].flatMap(c => c.members.filter(m => m.strands > 1 && m.yarn_id).map(m => m.yarn_id!)))
  return out
    .filter((a, i, all) => all.findIndex(b => sameSuggestion(a, b)) === i)
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source])
    .map(a => (a.members.some(m => m.strands === 1 && multi.has(m.yarn.id))
      ? { ...a, members: a.members.map(m => (m.strands === 1 && multi.has(m.yarn.id) ? { ...m, showStrands: true } : m)) }
      : a))
}

function sameSuggestion(a: Alternative, b: Alternative): boolean {
  if (a.members.length !== b.members.length) return false
  const key = (alt: Alternative) => alt.members.map(m => `${m.yarn.id}x${m.strands}`).sort().join('+')
  return key(a) === key(b)
}

// Re-exported so callers that already have a fibre string (e.g. from a linked catalogue
// yarn) don't need their own import of fibreFamily just to build targetFibre.
export { fibreFamily, mainFibre }
