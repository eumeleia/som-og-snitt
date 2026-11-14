import { describe, it, expect } from 'vitest'
import { normalizeYarn, type YarnRow } from './yarns'
import type { RawCombo, RawSwatch } from './yarn-alternatives'
import {
  factDiffs, formatPair, pairAlternatives, pairGauge, parsePair, recipeHitsForYarn, recipesForYarn,
  type YarnContext, type YarnRecipe,
} from './yarn-recipes'

const yarn = (id: string, name: string, data: Record<string, unknown> = {}, extra: Partial<YarnRow> = {}): YarnRow => ({
  ...normalizeYarn({
    brand: 'Garn', name, fibers: [{ fiber: 'merinoull', percent: 100 }], skein_weight_g: 50, meterage_m: 110,
    gauge_stitches_min: 22, gauge_stitches_max: 22, needle_mm_min: 4, needle_mm_max: 4, ...data,
  }),
  id, aliases: [], has_plastic: false, status: 'approved', approved_at: null, created_at: '', updated_at: '', ...extra,
})
const MERINO = yarn('merino', 'Merino')
const MERINO2 = yarn('merino2', 'Merino To', { gauge_stitches_min: 21, gauge_stitches_max: 23, meterage_m: 105 })
const FAR = yarn('far', 'Tykk Merino', { gauge_stitches_min: 14, gauge_stitches_max: 14 })
const COTTON = yarn('cotton', 'Bomull', { fibers: [{ fiber: 'bomull', percent: 100 }] })
const PLASTIC = yarn('plastic', 'Sokkegarn', { fibers: [{ fiber: 'ull', percent: 75 }, { fiber: 'polyamid', percent: 25 }] }, { has_plastic: true })
const GONE = yarn('gone', 'Utgått Merino', { discontinued: true })
const MOHAIR = yarn('mohair', 'Silk Mohair', { fibers: [{ fiber: 'mohair', percent: 70 }, { fiber: 'silke', percent: 30 }], gauge_stitches_min: 18, gauge_stitches_max: 26 })
const ALPACA = yarn('alpaca', 'Alpakka', { fibers: [{ fiber: 'alpakka', percent: 100 }] })
const THICK = yarn('thick', 'Tykk Alpakka', { fibers: [{ fiber: 'alpakka', percent: 100 }], gauge_stitches_min: 16, gauge_stitches_max: 17 })
const YARNS = [MERINO, MERINO2, FAR, COTTON, PLASTIC, GONE, MOHAIR, ALPACA, THICK]

const ctx = (combos: RawCombo[] = [], swatches: RawSwatch[] = []): YarnContext => ({ catalogue: new Map(YARNS.map(y => [y.id, y])), combos, swatches })

let n = 0
function recipe(title: string, lines: { yarn_id: string | null; group?: number; strands?: number; fiber?: string }[], over: Partial<YarnRecipe> = {}): YarnRecipe {
  const id = `r${++n}`
  return {
    id, title, is_collection: false, gauge_stitches_10cm: 22,
    strikk_yarn_line: lines.map((l, i) => ({ id: `${id}-l${i}`, position: i, color_group: l.group ?? 0, yarn_id: l.yarn_id, strands: l.strands ?? 1, fiber: l.fiber ?? null, yarn_name: 'Navn', brand: null })),
    strikk_yarn_alternative: [],
    ...over,
  }
}

describe('recipeHitsForYarn', () => {
  it('finds the recipe yarn, the recipe\'s own alternative and catalogue yarns, most trusted first', () => {
    const uses = recipe('Bruker', [{ yarn_id: 'merino' }])
    const named = recipe('Nevner', [{ yarn_id: 'cotton' }])
    named.strikk_yarn_alternative = [{ yarn_line_id: named.strikk_yarn_line[0].id, color_group: 0, yarn_id: 'merino2', source: 'pattern' }]
    const same = recipe('Samme fasthet', [{ yarn_id: 'merino' }])
    expect(recipeHitsForYarn(uses, 'merino', ctx()).map(h => h.source)).toEqual(['recommended'])
    expect(recipeHitsForYarn(named, 'merino2', ctx()).map(h => h.source)).toEqual(['pattern'])
    expect(recipeHitsForYarn(same, 'merino2', ctx()).map(h => [h.source, h.needsSwatch, h.instead])).toEqual([['same_gauge', true, ['Garn Merino']]])
    expect(recipeHitsForYarn(uses, 'merino', ctx())[0].needsSwatch).toBe(false)
  })

  it('takes catalogue yarns only within one stitch per 10 cm and with the same main fibre', () => {
    expect(recipeHitsForYarn(recipe('22', [{ yarn_id: 'merino' }], { gauge_stitches_10cm: 24 }), 'merino2', ctx()).map(h => h.source)).toEqual(['same_gauge'])
    expect(recipeHitsForYarn(recipe('25', [{ yarn_id: 'merino' }], { gauge_stitches_10cm: 25 }), 'merino2', ctx())).toEqual([])
    expect(recipeHitsForYarn(recipe('Tykk', [{ yarn_id: 'merino' }]), 'far', ctx())).toEqual([])
    expect(recipeHitsForYarn(recipe('Fiber', [{ yarn_id: 'merino' }]), 'cotton', ctx())).toEqual([])
    // The pattern's own fibre counts when its yarn is not in the catalogue; unknown fibre gives nothing.
    expect(recipeHitsForYarn(recipe('Ukjent garn', [{ yarn_id: null, fiber: '100% merino' }]), 'merino', ctx()).map(h => h.source)).toEqual(['same_gauge'])
    expect(recipeHitsForYarn(recipe('Ukjent fiber', [{ yarn_id: null }]), 'merino', ctx())).toEqual([])
    expect(recipeHitsForYarn(recipe('Ingen fasthet', [{ yarn_id: 'merino' }], { gauge_stitches_10cm: null }), 'merino2', ctx())).toEqual([])
  })

  it('never offers a plastic or discontinued yarn as an alternative, only as the recipe yarn', () => {
    const r = recipe('Merino', [{ yarn_id: 'merino' }])
    r.strikk_yarn_alternative = [{ yarn_line_id: null, color_group: 0, yarn_id: 'gone', source: 'pattern' }]
    expect(recipeHitsForYarn(r, 'gone', ctx())).toEqual([])
    expect(recipeHitsForYarn(recipe('Sokker', [{ yarn_id: 'merino' }]), 'plastic', ctx())).toEqual([])
    expect(recipeHitsForYarn(recipe('Sokker', [{ yarn_id: 'plastic' }]), 'plastic', ctx()).map(h => h.source)).toEqual(['recommended'])
  })

  it('counts own swatches and combinations at the recipe gauge, and names the yarns a combination needs', () => {
    const swatch: RawSwatch = { gauge_stitches_10cm: 22.5, gauge_rows_10cm: null, needle_mm: 4, notes: null, members: [{ yarn_id: 'alpaca', strands: 1 }] }
    const combo: RawCombo = { source: 'skaberglaede', source_url: null, stitch_pattern: null, gauge_stitches_10cm: 21, gauge_rows_10cm: null, needle_mm: 4.5, note: null, members: [{ yarn_id: 'alpaca', strands: 1 }, { yarn_id: 'mohair', strands: 1 }] }
    const withPlastic: RawCombo = { ...combo, source: 'drops', members: [{ yarn_id: 'alpaca', strands: 1 }, { yarn_id: 'plastic', strands: 1 }] }
    const hits = recipeHitsForYarn(recipe('Genser', [{ yarn_id: 'merino' }]), 'alpaca', ctx([combo, withPlastic], [swatch]))
    expect(hits.map(h => [h.source, h.needsSwatch, h.with])).toEqual([['own_swatch', false, []], ['skaberglaede', true, ['Garn Silk Mohair']]])
  })

  it('marks a colour knitted with a carry-along yarn, and lets one yarn replace the pair', () => {
    const pair = recipe('Par', [{ yarn_id: 'alpaca' }, { yarn_id: 'mohair' }], { gauge_stitches_10cm: 17 })
    const hits = recipeHitsForYarn(pair, 'thick', ctx())
    expect(hits).toEqual([{ source: 'same_gauge', colorGroup: 0, heldTogether: true, instead: ['Garn Alpakka', 'Garn Silk Mohair'], with: [], needsSwatch: true }])
  })

  it('leaves collections out', () => {
    expect(recipeHitsForYarn(recipe('Katalog', [{ yarn_id: 'merino' }], { is_collection: true }), 'merino', ctx())).toEqual([])
  })
})

describe('recipesForYarn', () => {
  it('sorts by trust, then title', () => {
    const a = recipe('B samme', [{ yarn_id: 'merino2' }])
    const b = recipe('A samme', [{ yarn_id: 'merino2' }])
    const c = recipe('Z bruker', [{ yarn_id: 'merino' }])
    expect(recipesForYarn([a, b, c], 'merino', ctx()).map(r => [r.recipe.title, r.best.source])).toEqual([
      ['Z bruker', 'recommended'], ['A samme', 'same_gauge'], ['B samme', 'same_gauge'],
    ])
  })
})

describe('pairs', () => {
  const combo: RawCombo = { source: 'skaberglaede', source_url: null, stitch_pattern: null, gauge_stitches_10cm: 17, gauge_rows_10cm: null, needle_mm: 5, note: null, members: [{ yarn_id: 'mohair', strands: 1 }, { yarn_id: 'alpaca', strands: 1 }] }
  const other: RawCombo = { ...combo, gauge_stitches_10cm: 16.5, members: [{ yarn_id: 'merino', strands: 2 }] }

  it('reads and writes the pair in the link', () => {
    expect(parsePair('alpaca,mohairx2')).toEqual([{ yarnId: 'alpaca', strands: 1 }, { yarnId: 'mohair', strands: 2 }])
    expect(formatPair(parsePair('alpaca,mohairx2'))).toBe('alpaca,mohairx2')
    expect(parsePair(null)).toEqual([])
  })

  it('finds the pair gauge in the combination tables, in any member order, or nothing', () => {
    expect(pairGauge(parsePair('alpaca,mohair'), [combo], [])).toBe(17)
    expect(pairGauge(parsePair('alpaca,mohairx2'), [combo], [])).toBeNull()
  })

  it('gives other thread combinations and single yarns at the pair gauge, without the pair itself', () => {
    const res = pairAlternatives({ members: parsePair('alpaca,mohair'), gauge: 17, catalogue: YARNS, combos: [combo, other], swatches: [] })
    expect(res.combinations.map(a => a.members.map(m => `${m.yarn.id}x${m.strands}`).join('+'))).toEqual(['merinox2'])
    expect(res.singles.map(a => a.members[0].yarn.id)).toEqual(['thick'])
  })
})

describe('factDiffs', () => {
  it('marks the fields that differ, and not the ones unknown on either side', () => {
    expect([...factDiffs(MERINO, MERINO2)].sort()).toEqual(['gauge', 'meterage'])
    expect([...factDiffs(MERINO, COTTON)]).toEqual(['fibre'])
    const unknown = yarn('u', 'Ukjent', { meterage_m: null, fibers: [] })
    expect([...factDiffs(MERINO, unknown)]).toEqual([])
  })
})
