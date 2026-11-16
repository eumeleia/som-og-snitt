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

  it('never suggests a discontinued yarn, even inside a combo, but does suggest a yarn with plastic', () => {
    const result = rankAlternatives({
      targetGauge: 22, targetFibre: null, excludeYarnId: null, catalogue,
      combos: [
        { source: 'drops', source_url: null, stitch_pattern: null, gauge_stitches_10cm: 22, gauge_rows_10cm: null, needle_mm: 4, note: null, members: [{ yarn_id: 'plastic', strands: 1 }] },
        { source: 'drops', source_url: null, stitch_pattern: null, gauge_stitches_10cm: 22, gauge_rows_10cm: null, needle_mm: 4, note: null, members: [{ yarn_id: 'gone', strands: 1 }] },
      ],
      swatches: [],
      patternAlternativeYarnIds: ['plastic', 'gone'],
    })
    expect(result.map(r => [r.source, r.members.map(m => m.yarn.id)])).toEqual([['drops', ['plastic']]])
  })

  it('falls back to same gauge and main fibre in the catalogue, within tolerance', () => {
    const result = rankAlternatives({
      targetGauge: 22, targetFibre: 'ull', excludeYarnId: 'peer-gynt', catalogue,
      combos: [], swatches: [], patternAlternativeYarnIds: [],
    })
    // Plastgarn has plastic and the same gauge and main fibre: it is suggested too.
    expect(result.map(r => [r.source, r.members[0].yarn.id])).toEqual([['same_gauge', 'smart'], ['same_gauge', 'plastic']])
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

describe('same thickness', () => {
  // Alpaca Bris (15 m/10 cm), Air (17) and Kos (16–18): all 150 m per 50 g, alpaca first.
  const fibres = [{ fiber: 'alpakka', percent: 65 }, { fiber: 'polyamid', percent: 28 }, { fiber: 'ull', percent: 7 }]
  const mk = (id: string, gMin: number, gMax: number, m: number) => ({
    id, brand: 'B', name: id, aliases: [], fibers: fibres, skein_weight_g: 50, meterage_m: m, gauge_stitches_min: gMin, gauge_stitches_max: gMax,
    needle_mm_min: 5, needle_mm_max: 5, drops_group: null, has_plastic: true, discontinued: false, status: 'approved', approved_at: null,
    created_at: '', updated_at: '', favorite: null, price_per_skein: null,
  }) as unknown as Parameters<typeof rankAlternatives>[0]['catalogue'][number]
  const bris = mk('bris', 15, 15, 150), air = mk('air', 17, 17, 150), kos = mk('kos', 16, 18, 150), thin = mk('thin', 17, 17, 200)
  // Same metres per 50 g, but a thin, dense yarn: too far from the gauge.
  const dense = mk('dense', 24, 24, 160)

  it('suggests a yarn of the same main fibre and metres per 50 g even when the stated gauge differs', () => {
    const r = rankAlternatives({ targetGauge: 15, targetFibre: 'alpakka', targetYarn: bris, excludeYarnId: 'bris', catalogue: [bris, air, kos, thin, dense], combos: [], swatches: [], patternAlternativeYarnIds: [] })
    expect(r.map(a => [a.members[0].yarn.id, a.source])).toEqual([['kos', 'same_gauge'], ['air', 'same_thickness']])
  })
  it('keeps to the gauge alone when the yarn being replaced is not given', () => {
    const r = rankAlternatives({ targetGauge: 15, targetFibre: 'alpakka', excludeYarnId: 'bris', catalogue: [bris, air, kos, thin], combos: [], swatches: [], patternAlternativeYarnIds: [] })
    expect(r.map(a => a.members[0].yarn.id)).toEqual(['kos'])
  })
})

describe('single and double strand (Tilia)', () => {
  const tilia = yarn({ id: 'tilia', brand: 'Filcolana', name: 'Tilia', fibers: [{ fiber: 'kid mohair', percent: 70 }, { fiber: 'silke', percent: 30 }], meterage_m: 210, skein_weight_g: 25, gauge_stitches_min: 24, gauge_stitches_max: 32 })
  const double = { source: 'yarn_info' as const, source_url: 'https://shop.saturniagarn.no/categories/tilia', stitch_pattern: 'glattstrikk', gauge_stitches_10cm: 20, gauge_rows_10cm: null, needle_mm: 4.5, note: 'Dobbel tråd: ca. 19–21 m = 10 cm, pinne 4–5', members: [{ yarn_id: 'tilia', strands: 2 }] }

  it('suggests two strands of Tilia for about 20 stitches, labelled as the yarn\'s own information', () => {
    const result = rankAlternatives({ targetGauge: 20, targetFibre: null, excludeYarnId: null, catalogue: [tilia], combos: [double], swatches: [], patternAlternativeYarnIds: [] })
    expect(result.map(a => [a.source, a.members.map(m => `${m.yarn.id}x${m.strands}`).join('+')])).toEqual([['yarn_info', 'tiliax2']])
  })
  it('marks a single strand of Tilia as «1 tråd» when two strands are also known', async () => {
    const { strandText } = await import('./yarn-alternatives')
    const kid = yarn({ id: 'kid', name: 'Kid', fibers: [{ fiber: 'mohair', percent: 75 }], meterage_m: 210, skein_weight_g: 25, gauge_stitches_min: 28, gauge_stitches_max: 28 })
    const result = rankAlternatives({ targetGauge: 28, targetFibre: 'mohair', targetYarn: kid, excludeYarnId: 'kid', catalogue: [tilia, kid], combos: [double], swatches: [], patternAlternativeYarnIds: [] })
    const single = result.find(a => a.members[0].yarn.id === 'tilia')!
    expect(strandText(single.members[0])).toBe(' (1 tråd)')
    expect(strandText({ yarn: tilia, strands: 2 })).toBe(' (2 tråder)')
    expect(strandText({ yarn: kid, strands: 1 })).toBe('')
  })
})
