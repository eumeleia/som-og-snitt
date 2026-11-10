import { describe, it, expect } from 'vitest'
import {
  YARN_SCHEMA,
  aliasKey,
  formatFibers,
  formatRange,
  hasPlastic,
  isPlasticFiber,
  matchYarn,
  substitutes,
  mainFibre,
  missingFields,
  normalizeYarn,
  type Alias,
} from './yarns'
import { normalizeExtraction, schemaErrors, storedToExtraction } from './extraction'
import { SIMULATED_ANSWER, storedFrom } from './extraction.fixture'

describe('plastic', () => {
  it('counts polyamide, nylon, acrylic, polyester and elastane, not viscose or wool', () => {
    for (const f of ['polyamid', 'Nylon', 'akryl', 'polyester', 'elastan', 'Polyamide (PA)']) expect(isPlasticFiber(f)).toBe(true)
    for (const f of ['viskose', 'merinoull', 'alpakka', 'mohair', 'silke', 'bomull', 'lin']) expect(isPlasticFiber(f)).toBe(false)
  })
  it('is unknown without fibre, yes with any plastic part', () => {
    expect(hasPlastic([])).toBeNull()
    expect(hasPlastic([{ fiber: 'merinoull', percent: 80 }, { fiber: 'polyamid', percent: 20 }])).toBe(true)
    expect(hasPlastic([{ fiber: 'mohair', percent: 72 }, { fiber: 'silke', percent: 28 }])).toBe(false)
    expect(hasPlastic([{ fiber: 'bomull', percent: 50 }, { fiber: 'viskose', percent: 50 }])).toBe(false)
  })
})

describe('fibre and range text', () => {
  it('writes «80 % merinoull, 20 % polyamid» and ranges', () => {
    expect(formatFibers([{ fiber: 'merinoull', percent: 80 }, { fiber: 'polyamid', percent: 20 }])).toBe('80 % merinoull, 20 % polyamid')
    expect(formatFibers([{ fiber: 'ull', percent: 57.5 }, { fiber: 'silke', percent: null }])).toBe('57,5 % ull, silke')
    expect(formatRange(3.5, 4)).toBe('3,5–4')
    expect(formatRange(22, 22)).toBe('22')
    expect(formatRange(null, null)).toBe('')
  })
})

describe('spellings and matching', () => {
  const alias = (brand: string, name: string, certain = true, reason: string | null = null): Alias => ({ brand, name, certain, reason })
  const yarns = [
    { id: 'pg', brand: 'Sandnes Garn', name: 'Peer Gynt', aliases: [alias('', 'Sandnes Garn Peer Gynt'), alias('Sandnesgarn', 'Peer Gynt')] },
    { id: 'st', brand: 'Du Store Alpakka', name: 'Sterk', aliases: [alias('', 'Sterk', false, 'Uten produsent; DSA ut fra designeren')] },
  ]
  it('compares spellings regardless of case, spacing, punctuation and decomposed letters', () => {
    expect(aliasKey('Sandnes  Garn', 'PEER GYNT')).toBe(aliasKey('sandnes garn', 'Peer Gynt'))
    expect(aliasKey('', 'Tynn Merinoull'.normalize('NFD'))).toBe(aliasKey(null, 'Tynn Merinoull'))
    expect(aliasKey('Hobbii', 'Rainbow Cotton 8/4')).toBe('hobbii|rainbow cotton 8/4')
  })
  it('finds the yarn by its own name or any spelling, and marks a link through an uncertain spelling', () => {
    expect(matchYarn(yarns, 'Sandnes Garn', 'Peer Gynt')).toMatchObject({ yarn: { id: 'pg' }, certain: true })
    expect(matchYarn(yarns, null, 'sandnes garn peer gynt')).toMatchObject({ yarn: { id: 'pg' }, certain: true })
    expect(matchYarn(yarns, 'Sandnesgarn', 'Peer Gynt')).toMatchObject({ yarn: { id: 'pg' }, certain: true })
    expect(matchYarn(yarns, '', 'Sterk')).toMatchObject({ yarn: { id: 'st' }, certain: false, reason: 'Uten produsent; DSA ut fra designeren' })
    expect(matchYarn(yarns, 'Drops', 'Air')).toBeNull()
  })
})

describe('normalizeYarn', () => {
  const answer = {
    brand: 'Sandnes Garn', name: 'Peer Gynt',
    fibers: [{ fiber: 'ull', percent: 100 }],
    skein_weight_g: 50, meterage_m: 91, gauge_stitches_min: 22, gauge_stitches_max: 0, needle_mm_min: 4, needle_mm_max: 3.5,
    drops_group: '', discontinued: false,
    source_url: 'https://www.sandnesgarn.no/garn/peer-gynt', source_kind: 'manufacturer', source_note: '',
    field_sources: [{ field: 'meterage_m', source: 'oppskrift: Rein genser' }],
    uncertain: [{ field: 'gauge_stitches_min', reason: 'Bare oppgitt på banderolen' }],
  }
  it('takes a lookup answer that follows the schema', () => {
    expect(schemaErrors(YARN_SCHEMA as Record<string, unknown>, answer)).toEqual([])
    const y = normalizeYarn(answer)
    expect(y).toMatchObject({
      brand: 'Sandnes Garn', name: 'Peer Gynt', skein_weight_g: 50, meterage_m: 91,
      gauge_stitches_min: 22, gauge_stitches_max: 22, needle_mm_min: 3.5, needle_mm_max: 4,
      drops_group: null, source_kind: 'manufacturer', source_note: null, favorite: null, price_per_skein: null,
      field_sources: { meterage_m: 'oppskrift: Rein genser' },
      uncertain_fields: ['gauge_stitches_min'], uncertain_reasons: { gauge_stitches_min: 'Bare oppgitt på banderolen' },
    })
    expect(missingFields(y)).toEqual([])
  })
  it('reads the edit form back the same way', () => {
    const y = normalizeYarn(answer)
    expect(normalizeYarn({ ...y, favorite: true, price_per_skein: '59,90' })).toEqual({ ...y, favorite: true, price_per_skein: 59.9 })
  })
  it('lists what is missing, and keeps only DROPS groups A–F', () => {
    const y = normalizeYarn({ brand: 'Drops', name: 'Air', drops_group: 'c', fibers: [], source_kind: 'manufacturer' })
    expect(y.drops_group).toBe('C')
    expect(missingFields(y)).toEqual(['fibers', 'skein_weight_g', 'meterage_m', 'gauge_stitches_min', 'needle_mm_min', 'source_url'])
    expect(normalizeYarn({ name: 'X', drops_group: 'G' }).drops_group).toBeNull()
  })
})

describe('yarn links on recipe lines', () => {
  const id = '3f2a8b1c-1111-4222-8333-944455556666'
  it('travel through normalising and through the stored rows, so an edit keeps them', () => {
    const d = normalizeExtraction({ ...SIMULATED_ANSWER, yarn_lines: SIMULATED_ANSWER.yarn_lines.map((l, i) => (i === 0 ? { ...l, yarn_id: id, yarn_link_uncertain: true, yarn_link_reason: 'Usikker' } : l)) })
    expect(d.yarn_lines[0]).toMatchObject({ yarn_id: id, yarn_link_uncertain: true, yarn_link_reason: 'Usikker' })
    expect(d.yarn_lines[1]).toMatchObject({ yarn_id: null, yarn_link_uncertain: false, yarn_link_reason: null })
    expect(storedToExtraction(storedFrom(d)).yarn_lines[0]).toMatchObject({ yarn_id: id, yarn_link_uncertain: true })
  })
  it('drop an id that is not a uuid', () => {
    const d = normalizeExtraction({ ...SIMULATED_ANSWER, alternatives: [{ ...SIMULATED_ANSWER.alternatives[0], yarn_id: 'peer-gynt' }] })
    expect(d.alternatives[0].yarn_id).toBeNull()
  })
})

describe('substitutes for a discontinued yarn', () => {
  const y = (id: string, fiber: string, g: number, m: number, w = 50, over: Record<string, unknown> = {}) =>
    ({ id, ...normalizeYarn({ name: id, fibers: [{ fiber, percent: 100 }], skein_weight_g: w, meterage_m: m, gauge_stitches_min: g, gauge_stitches_max: g + 2, ...over }) })
  const old = y('old', 'merinoull', 22, 110, 50, { discontinued: true })
  const cat = [
    old,
    y('close', 'ekstrafin merinoull', 22, 112),
    y('heavier-skein', 'Merino wool', 23, 220, 100),
    y('wool', 'ull', 22, 110),
    y('thin', 'merinoull', 28, 175),
    y('gone', 'merinoull', 22, 110, 50, { discontinued: true }),
    y('no-gauge', 'merinoull', 0, 110),
  ]
  it('picks yarns that are not discontinued, as thick and of the same main fibre, closest first', () => {
    expect(substitutes(old, cat).map(c => c.id)).toEqual(['close', 'heavier-skein'])
  })
  it('gives nothing when the old yarn lacks gauge or meterage', () => {
    expect(substitutes({ ...old, meterage_m: null }, cat)).toEqual([])
  })
  it('groups fibres into families by their largest share', () => {
    expect(mainFibre([{ fiber: 'baby alpakka', percent: 68 }, { fiber: 'polyamid', percent: 22 }, { fiber: 'merinoull', percent: 10 }])).toBe('alpakka')
    expect(mainFibre([{ fiber: 'nylon', percent: 60 }, { fiber: 'ull', percent: 40 }])).toBe('syntetisk')
    expect(mainFibre([])).toBeNull()
  })
})
