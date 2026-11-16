import { describe, it, expect } from 'vitest'
import { estimateGauge, matchingSwatches, parseNeedle, parseSwatch, type CalcMember } from './gauge-calc'

const yarn = (id: string, name: string, g: [number | null, number | null], n: [number | null, number | null], neutral = false): CalcMember['yarn'] => ({
  id, brand: 'Test', name, gauge_stitches_min: g[0], gauge_stitches_max: g[1], needle_mm_min: n[0], needle_mm_max: n[1], gauge_neutral: neutral,
})
// Catalogue values: Dale Garn Lerke 22 m on 4 mm; DROPS Kid-Silk 23 m on 3.5 mm; Dale Garn Bling neutral.
const lerke = yarn('l', 'Lerke', [22, 22], [4, 4])
const kidSilk = yarn('k', 'Kid-Silk', [23, 23], [3.5, 3.5])
const bling = yarn('b', 'Bling', [null, null], [null, null], true)

describe('estimateGauge', () => {
  it('two strands of Lerke on needle 6 give about 15 stitches (acceptance 1)', () => {
    const e = estimateGauge([{ yarn: lerke, strands: 2 }], 6)
    expect(e.ok && e.gauge).toBe(15)
    expect(e.ok && [e.low, e.high]).toEqual([14, 16])
    expect(e.ok && e.exact).toBeCloseTo(14.67, 2)
    expect(e.ok && e.naturalNeedleExact).toBeCloseTo(5.66, 2)
    expect(e.ok && e.naturalNeedle).toBe(5.5)
  })
  it('on its natural needle a doubled yarn gives g / √2', () => {
    const e = estimateGauge([{ yarn: lerke, strands: 2 }], 4 * Math.SQRT2)
    expect(e.ok && e.exact).toBeCloseTo(22 / Math.SQRT2, 6)
  })
  it('Lerke with Kid-Silk on needle 6 gives an estimate (acceptance 2)', () => {
    const e = estimateGauge([{ yarn: lerke, strands: 1 }, { yarn: kidSilk, strands: 1 }], 6)
    expect(e.ok).toBe(true)
    // 1/√(1/22² + 1/23²) = 15.90; √(4² + 3.5²) = 5.32; 15.90 × 5.32 / 6 = 14.08
    expect(e.ok && e.exact).toBeCloseTo(14.08, 2)
    expect(e.ok && e.gauge).toBe(14)
  })
  it('Bling as well does not change the result (acceptance 3)', () => {
    const without = estimateGauge([{ yarn: lerke, strands: 1 }, { yarn: kidSilk, strands: 1 }], 6)
    const withBling = estimateGauge([{ yarn: lerke, strands: 1 }, { yarn: kidSilk, strands: 1 }, { yarn: bling, strands: 1 }], 6)
    expect(withBling.ok && withBling.exact).toBe(without.ok && without.exact)
    expect(withBling.ok && withBling.neutral).toEqual(['Test Bling'])
  })
  it('uses the middle of a range', () => {
    const e = estimateGauge([{ yarn: yarn('r', 'Spenn', [23, 26], [3, 5]), strands: 1 }], 4)
    expect(e.ok && e.exact).toBeCloseTo(24.5, 6)
  })
  it('says what is missing instead of calculating', () => {
    const e = estimateGauge([{ yarn: lerke, strands: 1 }, { yarn: yarn('t', 'Tilia', [null, null], [null, null]), strands: 1 }], 5)
    expect(e).toEqual({ ok: false, error: 'Kan ikke regne: Test Tilia mangler strikkefasthet og pinne i katalogen.' })
    const before032 = estimateGauge([{ yarn: lerke, strands: 1 }, { yarn: { ...bling, gauge_neutral: undefined }, strands: 1 }], 5)
    expect(before032.ok).toBe(false)
  })
  it('refuses bad input', () => {
    expect(estimateGauge([], 4).ok).toBe(false)
    expect(estimateGauge([{ yarn: lerke, strands: 7 }], 4).ok).toBe(false)
    expect(estimateGauge([{ yarn: lerke, strands: 1 }], null).ok).toBe(false)
    expect(estimateGauge([{ yarn: lerke, strands: 1 }], 0.5).ok).toBe(false)
    expect(estimateGauge([{ yarn: bling, strands: 1 }], 4).ok).toBe(false)
  })
})

describe('parseNeedle', () => {
  it('reads comma decimals and «mm»', () => {
    expect(parseNeedle('4,5')).toBe(4.5)
    expect(parseNeedle('6 mm')).toBe(6)
    expect(parseNeedle('')).toBe(null)
    expect(parseNeedle('abc')).toBe(null)
  })
})

describe('matchingSwatches', () => {
  const sw = (id: string, members: [string, number][], needle: number, at: string) => ({
    id, gauge_stitches_10cm: 15, gauge_rows_10cm: null, needle_mm: needle, notes: null, created_at: at,
    members: members.map(([yarn_id, strands]) => ({ yarn_id, strands })),
  })
  const swatches = [
    sw('old', [['l', 2]], 6, '2026-01-01'), sw('new', [['l', 2]], 6, '2026-11-01'),
    sw('other-needle', [['l', 2]], 5.5, '2026-11-02'), sw('one-strand', [['l', 1]], 6, '2026-11-03'),
    sw('pair', [['k', 1], ['l', 1]], 6, '2026-11-04'), sw('with-bling', [['l', 1], ['k', 1], ['b', 1]], 6, '2026-11-05'),
  ]
  it('finds the same yarns, strands and needle, newest first (acceptance 4)', () => {
    expect(matchingSwatches(swatches, [{ yarnId: 'l', strands: 2 }], 6).map(s => s.id)).toEqual(['new', 'old'])
  })
  it('ignores the order of the yarns but counts Bling as a yarn', () => {
    expect(matchingSwatches(swatches, [{ yarnId: 'l', strands: 1 }, { yarnId: 'k', strands: 1 }], 6).map(s => s.id)).toEqual(['pair'])
  })
  it('finds nothing without a needle', () => {
    expect(matchingSwatches(swatches, [{ yarnId: 'l', strands: 2 }], null)).toEqual([])
  })
})

describe('parseSwatch', () => {
  const id = '0b5360cd-3686-4f5d-814b-1367ff13663d'
  it('accepts a measured swatch', () => {
    const p = parseSwatch({ members: [{ yarn_id: id, strands: 2 }], needle_mm: '6', gauge_stitches_10cm: '14,5', gauge_rows_10cm: '', notes: ' glatt ' })
    expect(p).toEqual({ ok: true, value: { members: [{ yarn_id: id, strands: 2 }], needle_mm: 6, gauge_stitches_10cm: 14.5, gauge_rows_10cm: null, notes: 'glatt' } })
  })
  it('refuses missing or bad values', () => {
    expect(parseSwatch({ members: [], needle_mm: 6, gauge_stitches_10cm: 15 }).ok).toBe(false)
    expect(parseSwatch({ members: [{ yarn_id: 'x', strands: 1 }], needle_mm: 6, gauge_stitches_10cm: 15 }).ok).toBe(false)
    expect(parseSwatch({ members: [{ yarn_id: id, strands: 1 }], needle_mm: 6 }).ok).toBe(false)
    expect(parseSwatch({ members: [{ yarn_id: id, strands: 1 }, { yarn_id: id, strands: 1 }], needle_mm: 6, gauge_stitches_10cm: 15 }).ok).toBe(false)
  })
})
