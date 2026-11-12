import { describe, it, expect } from 'vitest'
import { ONE_SIZE, choicesText, matchRecipe, matchRecipes, mergeColours, rowMetres, sizeRangeText, type MatchRecipe, type MatchStashRow, type MatchYarn } from './stash-match'
import type { AmountData, ExtractionData, YarnLineData } from './extraction'

const yarn = (id: string, name: string, meterage: number | null, weight: number | null, gauge: number | null, fibre = 'ull'): MatchYarn =>
  ({ id, brand: 'Merke', name, meterage_m: meterage, skein_weight_g: weight, gauge_stitches_min: gauge, gauge_stitches_max: gauge, fibers: [{ fiber: fibre, percent: 100 }] })
const MERINO = yarn('merino', 'Tynn Merinoull', 175, 50, 27)
const SUNDAY = yarn('sunday', 'Sunday', 235, 50, 28)
const SMART = yarn('smart', 'Smart', 100, 50, 22)
const LERKE = yarn('lerke', 'Lerke', 115, 50, 22)
const MOHAIR = yarn('mohair', 'Silk Mohair', 280, 25, 22, 'mohair')
const NOLENGTH = yarn('melody', 'Melody', null, null, 22)
const PEER = yarn('peer', 'Peer Gynt', 91, 50, 22)
const YARNS = new Map([MERINO, SUNDAY, SMART, LERKE, MOHAIR, NOLENGTH, PEER].map(y => [y.id, y]))

let n = 0
const row = (yarn_id: string, color_number: string, skein_count: number, over: Partial<MatchStashRow> = {}): MatchStashRow =>
  ({ id: `row${++n}`, yarn_id, color_number, color_name: null, skein_count, leftover_g: null, status: 'godkjent', project_id: null, ...over })

const line = (yarn_id: string | null, color_group: number, over: Partial<YarnLineData> = {}): YarnLineData => ({
  yarn_id, yarn_link_uncertain: false, yarn_link_reason: null, color_group, color_label: `Farge ${color_group + 1}`,
  yarn_name: yarn_id ? YARNS.get(yarn_id)!.name : 'restegarn', brand: null, meterage_m: null, skein_weight_g: null,
  fiber: null, strands: 1, uncertain_fields: [], uncertain_reasons: {}, ...over,
} as YarnLineData)
const amount = (size: number, color_group: number, value: number | null, unit: 'g' | 'skeins' = 'g', over: Partial<AmountData> = {}): AmountData =>
  ({ size, color_group, yarn_line: null, amount: value, amount_max: null, unit, candidates: [], needs_choice: false, uncertain: false, uncertain_reason: null, ...over })

const recipe = (sizes: string[], yarn_lines: YarnLineData[], amounts: AmountData[], over: Partial<ExtractionData> & { mentions_leftover?: boolean } = {}): MatchRecipe => {
  const { mentions_leftover = false, ...data } = over
  return {
    id: `r${++n}`, title: 'Oppskrift', designer: null, mentions_leftover,
    data: { sizes: sizes.map(label => ({ label, uncertain: false, uncertain_reason: null })), yarn_lines, amounts, alternatives: [], gauge_stitches_10cm: null, ...data },
  }
}

// Two colours of Tynn Merinoull, 100/150/200 g of the main colour and 50/50/100 g of the contrast.
const twoColours = () => recipe(['1 år', '2 år', '4 år'], [line('merino', 0), line('merino', 1)], [
  amount(0, 0, 100), amount(1, 0, 150), amount(2, 0, 200),
  amount(0, 1, 50), amount(1, 1, 50), amount(2, 1, 100),
])

describe('one colour per yarn line', () => {
  it('needs a row of its own for each line, not the yarn added up across colours', () => {
    // 1 skein of each of two colours: 175 m each, enough for neither 100 g (350 m) main colour.
    const m = matchRecipe(twoColours(), [row('merino', '1013', 1), row('merino', '2052', 1)], YARNS)
    expect(m.available).toBe(false)
    expect(m.missing[0].lines).toEqual(['Farge 1: mangler ca. 175 m (ca. 1 nøste)'])
  })
  it('covers each size where both colours have enough, and says which yarn gives which sizes', () => {
    const m = matchRecipe(twoColours(), [row('merino', '1013', 3, { color_name: 'Hvit' }), row('merino', '2052', 1, { color_name: 'Lys brun' })], YARNS)
    expect(m.groups.map(g => g.text)).toEqual(['Med Tynn Merinoull 1013 Hvit og Tynn Merinoull 2052 Lys brun kan du strikke 1 år til 2 år'])
    // 4 år: 200 g (700 m) main colour; 1013 has 525 m. The contrast could come from 1013 alone.
    expect(m.missing).toEqual([{ size: '4 år', lines: ['Farge 1: mangler ca. 175 m (ca. 1 nøste)'] }])
  })
  it('says so when the one colour that is enough is needed by two lines at once', () => {
    const m = matchRecipe(twoColours(), [row('merino', '1013', 5)], YARNS)
    expect(m.available).toBe(false)
    expect(m.missing[0].lines[0]).toMatch(/trengs til flere garnlinjer samtidig/)
  })
  it('adds up rows of the same yarn and colour number, registered from two piles', () => {
    const rows = mergeColours([row('merino', '1013', 1), row('merino', '1013 ', 2), row('merino', '2052', 1)])
    expect(rows.map(r => [r.color_number?.trim(), r.skein_count, r.ids.length])).toEqual([['1013', 3, 2], ['2052', 1, 1]])
    const m = matchRecipe(twoColours(), [row('merino', '1013', 1), row('merino', '1013', 2), row('merino', '2052', 1)], YARNS)
    expect(m.groups[0].sizes).toEqual([0, 1])
    expect(m.groups[0].rowIds).toHaveLength(3)
  })
})

describe('unknown amounts are never enough', () => {
  it('a yarn line without an amount, or one that cannot be turned into metres', () => {
    const noAmount = recipe(['S'], [line('merino', 0)], [])
    expect(matchRecipe(noAmount, [row('merino', '1', 10)], YARNS).missing[0].lines).toEqual(['Farge 1: mengde ukjent i oppskriften'])
    const noLength = recipe(['S'], [line(null, 0, { yarn_name: 'tynt garn' })], [amount(0, 0, 50)], { gauge_stitches_10cm: 27 })
    expect(matchRecipe(noLength, [row('merino', '1', 10)], YARNS).available).toBe(false)
  })
  it('a stash row with no skeins and no leftover, or whose yarn has no length', () => {
    expect(rowMetres({ skein_count: 0, leftover_g: null }, MERINO)).toBeNull()
    expect(rowMetres({ skein_count: 4, leftover_g: null }, NOLENGTH)).toBeNull()
    const r = recipe(['S'], [line('melody', 0)], [amount(0, 0, 1, 'skeins')])
    const m = matchRecipe(r, [row('melody', '07', 4)], YARNS)
    expect(m.available).toBe(false)
    expect(m.missing[0].lines[0]).toMatch(/mengde ukjent/)
  })
})

describe('sizes, skeins, leftovers and free yarn', () => {
  it('treats a recipe without sizes as one size', () => {
    const toy = recipe([], [line('sunday', 0)], [amount(0, 0, 20)])
    const m = matchRecipe(toy, [row('sunday', '1012', 1)], YARNS)
    expect(m.sizeLabels).toEqual([ONE_SIZE])
    expect(m.groups[0].text).toBe(`Med Sunday 1012 kan du strikke ${ONE_SIZE}`)
  })
  it('turns skeins into metres with the yarn length', () => {
    // 2 skeins of Smart = 200 m; 1 skein of Lerke (115 m) is not enough even if it were the same yarn.
    const r = recipe(['S'], [line('smart', 0)], [amount(0, 0, 2, 'skeins')])
    expect(matchRecipe(r, [row('smart', '1', 2)], YARNS).available).toBe(true)
    expect(matchRecipe(r, [row('smart', '1', 1)], YARNS).missing[0].lines).toEqual(['Farge 1: mangler ca. 100 m (ca. 1 nøste)'])
  })
  it('counts leftovers as yarn, and calls a small project knittable from leftovers', () => {
    expect(rowMetres({ skein_count: 0, leftover_g: 25 }, SUNDAY)).toBeCloseTo(117.5)
    const acorns = recipe([], [line('sunday', 0), line('sunday', 1)], [amount(0, 0, 2), amount(0, 1, 1)])
    const m = matchRecipe(acorns, [row('sunday', '3821', 0, { leftover_g: 10 }), row('sunday', '5023', 0, { leftover_g: 5 })], YARNS)
    expect(m.available).toBe(true)
    expect(m.fromLeftovers).toBe(true)
    const sweater = matchRecipe(twoColours(), [row('merino', '1013', 3), row('merino', '2052', 1)], YARNS)
    expect(sweater.fromLeftovers).toBe(false)
  })
  it('leaves out yarn set aside for a project, and yarn not approved yet', () => {
    const toy = recipe([], [line('sunday', 0)], [amount(0, 0, 20)])
    expect(matchRecipe(toy, [row('sunday', '1', 1, { project_id: 'p1' })], YARNS).available).toBe(false)
    expect(matchRecipe(toy, [row('sunday', '1', 1, { status: 'til_gjennomgang' })], YARNS).available).toBe(false)
  })
  it('lets any of the yarns cover an amount the pattern lets Maria choose between', () => {
    const r = recipe(['S'], [line('sunday', 0), line('smart', 0)], [amount(0, 0, 50, 'g', { needs_choice: true, candidates: ['Sunday', 'Smart'] })])
    const m = matchRecipe(r, [row('smart', '1', 1)], YARNS)
    expect(m.available).toBe(true)
    expect(m.groups[0].alternative).toBe(false)
  })
})

describe('alternatives from the stash', () => {
  it('matches a line that names no yarn on the gauge alone', () => {
    const toy = recipe([], [line(null, 0, { yarn_name: 'garn til p 3,5', meterage_m: 100, skein_weight_g: 50 })], [amount(0, 0, 40)], { gauge_stitches_10cm: 22 })
    const m = matchRecipe(toy, [row('lerke', '4018', 1), row('sunday', '1', 5)], YARNS)
    expect(m.groups).toHaveLength(1)
    expect(m.groups[0]).toMatchObject({ alternative: true, text: `Med Lerke 4018 kan du strikke ${ONE_SIZE}` })
  })
  it('needs the same gauge and main fibre for a line that names a yarn, or the pattern naming it', () => {
    const r = recipe(['S'], [line('smart', 0)], [amount(0, 0, 50)])
    expect(matchRecipe(r, [row('lerke', '1', 2)], YARNS).groups[0]).toMatchObject({ alternative: true })
    expect(matchRecipe(r, [row('mohair', '1', 4)], YARNS).available).toBe(false)
    expect(matchRecipe(r, [row('sunday', '1', 2)], YARNS).available).toBe(false)
    const named = recipe(['S'], [line('smart', 0)], [amount(0, 0, 50)], {
      alternatives: [{ yarn_id: 'sunday', yarn_link_uncertain: false, yarn_link_reason: null, color_group: 0, yarn_line: null, yarn_name: 'Sunday', brand: null, meterage_m: null, skein_weight_g: null, fiber: null, uncertain: false, uncertain_reason: null }],
    })
    expect(matchRecipe(named, [row('sunday', '1', 2)], YARNS).groups[0]).toMatchObject({ alternative: true })
  })
  it('shows the pattern own yarn first, and an alternative only where it reaches further', () => {
    const r = recipe(['S', 'M'], [line('smart', 0)], [amount(0, 0, 50), amount(1, 0, 150)])
    // M needs 150 g Smart = 300 m: 1 skein of Smart (100 m) is not, 3 of Lerke (345 m) are.
    const m = matchRecipe(r, [row('smart', '1', 1), row('lerke', '2', 3)], YARNS)
    expect(m.groups.map(g => [g.alternative, g.sizes])).toEqual([[false, [0]], [true, [0, 1]]])
    const enough = matchRecipe(r, [row('smart', '1', 3), row('lerke', '2', 3)], YARNS)
    expect(enough.groups.map(g => g.alternative)).toEqual([false])
  })
})

describe('matchRecipes and the texts', () => {
  it('lists only recipes with a size Maria can knit, own yarn first', () => {
    const own = { ...recipe(['S'], [line('smart', 0)], [amount(0, 0, 50)]), title: 'B egen' }
    // Peer Gynt is not in the stash; Smart and Lerke have its gauge and fibre.
    const alt = { ...recipe(['S'], [line('peer', 0)], [amount(0, 0, 40)]), title: 'A alternativ' }
    const none = { ...recipe(['S'], [line('merino', 0)], [amount(0, 0, 500)]), title: 'C ingen' }
    const out = matchRecipes([alt, none, own], [row('smart', '1', 1), row('lerke', '2', 1)], [...YARNS.values()])
    expect(out.map(m => m.title)).toEqual(['B egen', 'A alternativ'])
  })
  it('writes runs of sizes as from–to, and the yarn name once per yarn', () => {
    const labels = ['1–3 mnd', '6 mnd', '9 mnd', '1 år', '2 år']
    expect(sizeRangeText([0, 1, 2, 3, 4], labels)).toBe('1–3 mnd til 2 år')
    expect(sizeRangeText([0, 2, 3], labels)).toBe('1–3 mnd, 9 mnd til 1 år')
    expect(choicesText([row('merino', '1013', 1, { color_name: 'Hvit' }), row('merino', '2052', 1), row('sunday', '1', 1)], YARNS))
      .toBe('Tynn Merinoull 1013 Hvit eller 2052 eller Sunday 1')
  })
})
