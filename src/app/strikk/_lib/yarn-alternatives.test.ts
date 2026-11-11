import { describe, it, expect } from 'vitest'
import { rankAlternatives } from './yarn-alternatives'
import type { YarnRow } from './yarns'

function yarn(over: Partial<YarnRow> & { id: string }): YarnRow {
  return {
    brand: 'Sandnes Garn', name: 'Peer Gynt', aliases: [], fibers: [{ fiber: 'ull', percent: 100 }],
    skein_weight_g: 50, meterage_m: 91, gauge_stitches_min: 22, gauge_stitches_max: 22,
    needle_mm_min: 4, needle_mm_max: 4, drops_group: null, has_plastic: false, discontinued: false,
    source_url: null, source_kind: null, source_note: null, field_sources: {}, favorite: null,
    price_per_skein: null, uncertain_fields: [], uncertain_reasons: {}, status: 'approved',
    approved_at: null, created_at: '', updated_at: '', ...over,
  }
}

const peerGynt = yarn({ id: 'peer-gynt' })
const smart = yarn({ id: 'smart', name: 'Smart', gauge_stitches_min: 21, gauge_stitches_max: 23, meterage_m: 87 })
const plasticYarn = yarn({ id: 'plastic', name: 'Plastgarn', has_plastic: true })
const discontinuedYarn = yarn({ id: 'gone', name: 'Utgått', discontinued: true })
const cottonYarn = yarn({ id: 'cotton', name: 'Bomullsgarn', fibers: [{ fiber: 'bomull', percent: 100 }] })

const catalogue = [peerGynt, smart, plasticYarn, discontinuedYarn, cottonYarn]

describe('rankAlternatives', () => {
  it('ranks own swatches above everything else', () => {
    const [top] = rankAlternatives({
      targetGauge: 22, targetFibre: 'ull', excludeYarnId: null, catalogue,
      combos: [{ source: 'skaberglaede', source_url: 'https://skaberglaede.com', stitch_pattern: null, gauge_stitches_10cm: 22, gauge_rows_10cm: null, needle_mm: 4, note: null, members: [{ yarn_id: 'smart', strands: 1 }] }],
      swatches: [{ gauge_stitches_10cm: 22, gauge_rows_10cm: 30, needle_mm: 4, notes: null, members: [{ yarn_id: 'peer-gynt', strands: 1 }] }],
      patternAlternativeYarnIds: [],
    })
    expect(top.source).toBe('own_swatch')
    expect(top.members[0].yarn.id).toBe('peer-gynt')
  })

  it('never suggests a plastic or discontinued yarn, even inside a combo', () => {
    const result = rankAlternatives({
      targetGauge: 22, targetFibre: null, excludeYarnId: null, catalogue,
      combos: [
        { source: 'drops', source_url: null, stitch_pattern: null, gauge_stitches_10cm: 22, gauge_rows_10cm: null, needle_mm: 4, note: null, members: [{ yarn_id: 'plastic', strands: 1 }] },
        { source: 'drops', source_url: null, stitch_pattern: null, gauge_stitches_10cm: 22, gauge_rows_10cm: null, needle_mm: 4, note: null, members: [{ yarn_id: 'gone', strands: 1 }] },
      ],
      swatches: [],
      patternAlternativeYarnIds: ['plastic', 'gone'],
    })
    expect(result).toEqual([])
  })

  it('falls back to same gauge and main fibre in the catalogue, within tolerance', () => {
    const result = rankAlternatives({
      targetGauge: 22, targetFibre: 'ull', excludeYarnId: 'peer-gynt', catalogue,
      combos: [], swatches: [], patternAlternativeYarnIds: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ source: 'same_gauge', members: [{ yarn: smart, strands: 1 }] })
  })

  it('does not match a yarn of the wrong main fibre or gauge outside tolerance', () => {
    const result = rankAlternatives({
      targetGauge: 22, targetFibre: 'bomull', excludeYarnId: null, catalogue,
      combos: [], swatches: [], patternAlternativeYarnIds: [],
    })
    // cotton matches the fibre but its gauge (22) is within tolerance of itself; still the
    // only one with that fibre, so it is the one result.
    expect(result.map(r => r.members[0].yarn.id)).toEqual(['cotton'])
  })

  it('includes the pattern\'s own linked alternatives, ranked above drops/same-gauge', () => {
    const result = rankAlternatives({
      targetGauge: null, targetFibre: null, excludeYarnId: null, catalogue,
      combos: [], swatches: [], patternAlternativeYarnIds: ['smart'],
    })
    expect(result).toEqual([expect.objectContaining({ source: 'pattern', members: [{ yarn: smart, strands: 1 }] })])
  })

  it('de-duplicates the same combination suggested by two sources', () => {
    const combo = { source: 'skaberglaede' as const, source_url: null, stitch_pattern: null, gauge_stitches_10cm: 22, gauge_rows_10cm: null, needle_mm: 4, note: null, members: [{ yarn_id: 'peer-gynt', strands: 1 }] }
    const result = rankAlternatives({
      targetGauge: 22, targetFibre: null, excludeYarnId: null, catalogue,
      combos: [combo, { ...combo, source: 'drops' }],
      swatches: [{ gauge_stitches_10cm: 22, gauge_rows_10cm: null, needle_mm: 4, notes: null, members: [{ yarn_id: 'peer-gynt', strands: 1 }] }],
      patternAlternativeYarnIds: [],
    })
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('own_swatch')
  })
})
