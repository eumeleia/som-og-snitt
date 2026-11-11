// Garnkombinasjoner (strikk_yarn_combo, migrasjon 021) og Marias egne strikkeprøver
// (strikk_swatch), lastet som de rå formene rankAlternatives (yarn-alternatives.ts) tar imot.

export const COMBO_SELECT =
  'id, source, source_url, stitch_pattern, gauge_stitches_10cm, gauge_rows_10cm, needle_mm, note, ' +
  'strikk_yarn_combo_member(position, yarn_id, strands)'

export const SWATCH_SELECT =
  'id, gauge_stitches_10cm, gauge_rows_10cm, needle_mm, notes, created_at, ' +
  'strikk_swatch_yarn(position, yarn_id, strands)'

export interface ComboRow {
  id: string
  source: 'skaberglaede' | 'drops'
  source_url: string | null
  stitch_pattern: string | null
  gauge_stitches_10cm: number | string | null
  gauge_rows_10cm: number | string | null
  needle_mm: number | string | null
  note: string | null
  strikk_yarn_combo_member: { position: number; yarn_id: string | null; strands: number }[]
}

export interface SwatchRow {
  id: string
  gauge_stitches_10cm: number | string | null
  gauge_rows_10cm: number | string | null
  needle_mm: number | string | null
  notes: string | null
  created_at: string
  strikk_swatch_yarn: { position: number; yarn_id: string; strands: number }[]
}

const num = (v: number | string | null) => (v === null ? null : Number(v))
const sorted = <T extends { position: number }>(members: T[]) => [...members].sort((a, b) => a.position - b.position)

export function comboFromRow(r: ComboRow) {
  return {
    source: r.source, source_url: r.source_url, stitch_pattern: r.stitch_pattern,
    gauge_stitches_10cm: num(r.gauge_stitches_10cm), gauge_rows_10cm: num(r.gauge_rows_10cm),
    needle_mm: num(r.needle_mm), note: r.note,
    members: sorted(r.strikk_yarn_combo_member).map(m => ({ yarn_id: m.yarn_id, strands: m.strands })),
  }
}

export function swatchFromRow(r: SwatchRow) {
  return {
    gauge_stitches_10cm: num(r.gauge_stitches_10cm), gauge_rows_10cm: num(r.gauge_rows_10cm),
    needle_mm: num(r.needle_mm), notes: r.notes,
    members: sorted(r.strikk_swatch_yarn).map(m => ({ yarn_id: m.yarn_id, strands: m.strands })),
  }
}
