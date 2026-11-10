import { describe, it, expect } from 'vitest'
import { normalizeYarn, type YarnRow } from './yarns'
import {
  EMPTY_FILTER, activeChips, applyFilter, garmentTypes, leftoverReason, removeChip, yarnHits,
  type FilterRecipe, type RecipeFilter,
} from './recipe-filter'

const yarn = (id: string, name: string, data: Record<string, unknown> = {}): YarnRow => ({
  ...normalizeYarn({ brand: 'Sandnes Garn', name, fibers: [{ fiber: 'merinoull', percent: 100 }], skein_weight_g: 50, meterage_m: 110, gauge_stitches_min: 22, gauge_stitches_max: 22, ...data }),
  id, aliases: [], has_plastic: false, status: 'approved', approved_at: null, created_at: '', updated_at: '',
})
const MANDARIN = yarn('mandarin', 'Mandarin Merino', { discontinued: true })
const MERINO = yarn('merino', 'Merinoull')
const SUNDAY = yarn('sunday', 'Sunday', { meterage_m: 235, gauge_stitches_min: 28, gauge_stitches_max: 28 })
const SMART = yarn('smart', 'Smart')
const YARNS = [MANDARIN, MERINO, SUNDAY, SMART]

let n = 0
function recipe(over: Partial<FilterRecipe> & { colours?: { yarn_id: string | null; grams: number; weight?: number | null }[] } = {}): FilterRecipe {
  const { colours = [], ...rest } = over
  const id = over.id ?? `r${++n}`
  return {
    id, title: id, designer: null, drive_file_id: 'f', file_name: 'x.pdf', source: 'upload', created_at: '2026-01-01',
    updated_at: '', extraction_status: 'approved', audience: null, garment_type: null, is_collection: false,
    gauge_stitches_10cm: null, mentions_leftover: false, leftover_note: null,
    strikk_size: [{ id: `${id}-s0`, position: 0, label: 'S' }, { id: `${id}-s1`, position: 1, label: 'M' }],
    strikk_yarn_line: colours.map((c, i) => ({ id: `${id}-l${i}`, position: i, color_group: i, yarn_id: c.yarn_id, skein_weight_g: c.weight === undefined ? null : c.weight })),
    strikk_yarn_amount: colours.flatMap((c, i) => [
      { size_id: `${id}-s0`, color_group: i, yarn_line_id: `${id}-l${i}`, amount: c.grams, amount_max: null, unit: 'g' as const },
      { size_id: `${id}-s1`, color_group: i, yarn_line_id: `${id}-l${i}`, amount: c.grams * 3, amount_max: null, unit: 'g' as const },
    ]),
    strikk_yarn_alternative: [],
    ...rest,
  }
}
const f = (over: Partial<RecipeFilter>): RecipeFilter => ({ ...EMPTY_FILTER, sort: 'title', ...over })
const titles = (rs: FilterRecipe[], filter: RecipeFilter) => applyFilter(rs, filter, YARNS).map(r => r.recipe.title)

describe('combining filters', () => {
  const rs = [
    recipe({ id: 'Genser kvinne 22', garment_type: 'genser', audience: 'woman', gauge_stitches_10cm: 22 }),
    recipe({ id: 'Genser barn 28', garment_type: 'Genser', audience: 'child', gauge_stitches_10cm: 28 }),
    recipe({ id: 'Jakke barn 20', garment_type: 'jakke', audience: 'child', gauge_stitches_10cm: 20 }),
    recipe({ id: 'Katalog barn', garment_type: 'genser', audience: 'child', is_collection: true, gauge_stitches_10cm: 22 }),
  ]
  it('ands categories and ors choices within one, and counts the hits', () => {
    expect(titles(rs, f({ garmentTypes: ['genser'] }))).toEqual(['Genser barn 28', 'Genser kvinne 22', 'Katalog barn'])
    expect(titles(rs, f({ garmentTypes: ['genser', 'jakke'], audiences: ['child'] }))).toEqual(['Genser barn 28', 'Jakke barn 20', 'Katalog barn'])
    expect(applyFilter(rs, f({ audiences: ['woman', 'child'] }), YARNS)).toHaveLength(4)
  })
  it('takes a gauge range, and leaves collections out of gauge and yarn filters only', () => {
    expect(titles(rs, f({ gaugeMin: 18, gaugeMax: 22 }))).toEqual(['Genser kvinne 22', 'Jakke barn 20'])
    expect(titles(rs, f({ gaugeMin: 25 }))).toEqual(['Genser barn 28'])
    expect(titles(rs, f({ garmentTypes: ['genser'], gaugeMax: 30 }))).toEqual(['Genser barn 28', 'Genser kvinne 22'])
  })
  it('searches name and designer', () => {
    const named = [recipe({ id: 'Rein genser', designer: 'Ber-Lin Design' }), recipe({ id: 'Tusseladd' })]
    expect(titles(named, f({ query: 'ber-lin' }))).toEqual(['Rein genser'])
    expect(titles(named, f({ query: 'TUSSE' }))).toEqual(['Tusseladd'])
  })
})

describe('yarn filter', () => {
  const uses = recipe({ id: 'Bruker', colours: [{ yarn_id: 'merino', grams: 300 }] })
  const alternative = recipe({ id: 'Alternativ', colours: [{ yarn_id: 'smart', grams: 300 }], strikk_yarn_alternative: [{ yarn_line_id: 'Alternativ-l0', color_group: 0, yarn_id: 'merino', source: 'pattern' }] })
  const suggested = recipe({ id: 'Forslag', colours: [{ yarn_id: 'mandarin', grams: 300 }] })
  const keptAlt = recipe({ id: 'Har eget alternativ', colours: [{ yarn_id: 'mandarin', grams: 300 }], strikk_yarn_alternative: [{ yarn_line_id: 'Har eget alternativ-l0', color_group: 0, yarn_id: 'smart', source: 'pattern' }] })
  const goneAlt = recipe({ id: 'Utgått alternativ', colours: [{ yarn_id: 'sunday', grams: 300 }], strikk_yarn_alternative: [{ yarn_line_id: 'Utgått alternativ-l0', color_group: 0, yarn_id: 'mandarin', source: 'pattern' }] })
  const catalogue = new Map(YARNS.map(y => [y.id, y]))

  it('tells using the yarn, naming it as an alternative and the app suggesting it apart', () => {
    expect(yarnHits(uses, 'merino', catalogue, YARNS)).toEqual([{ kind: 'uses' }])
    expect(yarnHits(alternative, 'merino', catalogue, YARNS)).toEqual([{ kind: 'alternative' }])
    expect(yarnHits(suggested, 'merino', catalogue, YARNS)).toEqual([{ kind: 'suggested', instead: 'Sandnes Garn Mandarin Merino' }])
    const res = applyFilter([uses, alternative, suggested, keptAlt], f({ yarnIds: ['merino'] }), YARNS)
    expect(res.map(r => [r.recipe.title, r.yarnHits[0].hits[0].kind])).toEqual([['Alternativ', 'alternative'], ['Bruker', 'uses'], ['Forslag', 'suggested']])
  })
  it('leaves collections out', () => {
    const collection = recipe({ id: 'Katalog', is_collection: true, colours: [{ yarn_id: 'merino', grams: 300 }] })
    expect(titles([uses, collection], f({ yarnIds: ['merino'] }))).toEqual(['Bruker'])
  })
  it('suggests nothing when the pattern has an alternative still made, and never offers a discontinued yarn', () => {
    expect(yarnHits(keptAlt, 'merino', catalogue, YARNS)).toEqual([])
    expect(yarnHits(goneAlt, 'mandarin', catalogue, YARNS)).toEqual([])
    expect(yarnHits(suggested, 'mandarin', catalogue, YARNS)).toEqual([{ kind: 'uses' }])
  })
})

describe('leftover yarn', () => {
  const catalogue = new Map(YARNS.map(y => [y.id, y]))
  it('counts a recipe that mentions leftover yarn itself', () => {
    expect(leftoverReason(recipe({ mentions_leftover: true, leftover_note: '…restegarn…' }), catalogue)).toEqual({ kind: 'mentions', note: '…restegarn…' })
  })
  it('counts three colours under two skeins in the smallest size, using the skein weight from the line or the catalogue', () => {
    const three = recipe({ colours: [{ yarn_id: null, grams: 60, weight: 50 }, { yarn_id: 'merino', grams: 90 }, { yarn_id: 'sunday', grams: 40 }, { yarn_id: 'merino', grams: 500 }] })
    expect(leftoverReason(three, catalogue)).toEqual({ kind: 'colours', count: 3 })
  })
  it('does not count two such colours, a colour of two skeins, or a colour of unknown weight', () => {
    expect(leftoverReason(recipe({ colours: [{ yarn_id: 'merino', grams: 40 }, { yarn_id: 'merino', grams: 40 }, { yarn_id: 'merino', grams: 100 }] }), catalogue)).toBeNull()
    expect(leftoverReason(recipe({ colours: [{ yarn_id: 'merino', grams: 40 }, { yarn_id: 'merino', grams: 40 }, { yarn_id: null, grams: 40 }] }), catalogue)).toBeNull()
  })
  it('filters on it', () => {
    const rs = [recipe({ id: 'Nevner', mentions_leftover: true }), recipe({ id: 'Ingen' })]
    expect(titles(rs, f({ leftover: true }))).toEqual(['Nevner'])
  })
})

describe('sorting', () => {
  const rs = [
    recipe({ id: 'Øvre', designer: 'Anna', gauge_stitches_10cm: 18, created_at: '2026-03-01' }),
    recipe({ id: 'Alfa', designer: null, gauge_stitches_10cm: null, created_at: '2026-01-01' }),
    recipe({ id: 'Beta', designer: 'Berit', gauge_stitches_10cm: '24', created_at: '2026-02-01' }),
  ]
  it('sorts by name in Norwegian order, designer, gauge and newest, with missing values last', () => {
    expect(titles(rs, f({ sort: 'title' }))).toEqual(['Alfa', 'Beta', 'Øvre'])
    expect(titles(rs, f({ sort: 'designer' }))).toEqual(['Øvre', 'Beta', 'Alfa'])
    expect(titles(rs, f({ sort: 'gauge' }))).toEqual(['Øvre', 'Beta', 'Alfa'])
    expect(titles(rs, f({ sort: 'newest' }))).toEqual(['Øvre', 'Beta', 'Alfa'])
  })
})

describe('active filters', () => {
  it('lists each active filter, and removes them one at a time', () => {
    const filter = f({ query: 'rein', garmentTypes: ['genser'], audiences: ['child'], gaugeMin: 18, gaugeMax: 22, yarnIds: ['mandarin'], leftover: true })
    const chips = activeChips(filter, YARNS)
    expect(chips.map(c => c.label)).toEqual(['Søk: rein', 'genser', 'Barn', '18–22 m/10 cm', 'Sandnes Garn Mandarin Merino (utgått)', 'Restegarn'])
    const emptied = chips.reduce((acc, c) => removeChip(acc, c.key), filter)
    expect(emptied).toEqual({ ...EMPTY_FILTER, sort: filter.sort })
  })
  it('offers the garment types in use, most used first', () => {
    expect(garmentTypes([recipe({ garment_type: 'Genser' }), recipe({ garment_type: 'genser ' }), recipe({ garment_type: 'jakke' })]))
      .toEqual([{ type: 'genser', count: 2 }, { type: 'jakke', count: 1 }])
  })
})
