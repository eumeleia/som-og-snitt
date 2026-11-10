import { describe, it, expect } from 'vitest'
import { GENERIC_REASON, NOT_IN_CATALOGUE, RENAMED, linkPlan, mergeAliases, toAnswer } from './yarn-lib.mjs'
import { YARN_SCHEMA, aliasKey, normalizeYarn } from '../../src/app/strikk/_lib/yarns'
import { schemaErrors } from '../../src/app/strikk/_lib/extraction'

const yarns = [
  { id: 'pg', brand: 'Sandnes Garn', name: 'Peer Gynt', aliases: [{ brand: '', name: 'Sandnes Garn Peer Gynt', certain: true, reason: null }] },
  { id: 'st', brand: 'Du Store Alpakka', name: 'Sterk', aliases: [{ brand: '', name: 'Sterk', certain: false, reason: 'Uten produsent; DSA ut fra designeren' }] },
  { id: 'su', brand: 'Sandnes Garn', name: 'Sunday', aliases: [] },
]
const line = (id: string, brand: string | null, yarn_name: string, link: Record<string, unknown> = {}) =>
  ({ table: 'strikk_yarn_line', id, brand, yarn_name, yarn_id: null, yarn_link_uncertain: false, yarn_link_reason: null, ...link })

describe('mergeAliases', () => {
  it('keeps one of each spelling, and a certain spelling wins over an uncertain one', () => {
    const out = mergeAliases(
      [{ brand: '', name: 'Sterk', certain: false, reason: 'gjetning' }],
      [{ brand: null, name: 'STERK', certain: true }, { brand: 'DSA', name: 'Sterk' }],
    )
    expect(out).toEqual([
      { brand: '', name: 'STERK', certain: true, reason: null },
      { brand: 'DSA', name: 'Sterk', certain: true, reason: null },
    ])
  })
})

describe('linkPlan', () => {
  it('links by name or spelling, marks uncertain spellings, and flags generic and unknown yarns', () => {
    const lines = [
      line('a', 'Sandnes Garn', 'Peer Gynt'),
      line('b', null, 'Sandnes Garn Peer Gynt'),
      line('c', '', 'Sterk'),
      line('d', null, 'Sunday'),
      line('e', null, 'Restegarn'),
      line('f', 'Drops', 'Air'),
    ]
    const { counts, updates } = linkPlan(lines, yarns, new Set([aliasKey(null, 'restegarn')]))
    const by = Object.fromEntries(updates.map(u => [u.id, u.values]))
    expect(by.a).toEqual({ yarn_id: 'pg', yarn_link_uncertain: false, yarn_link_reason: null })
    expect(by.b).toEqual({ yarn_id: 'pg', yarn_link_uncertain: false, yarn_link_reason: null })
    expect(by.c).toEqual({ yarn_id: 'st', yarn_link_uncertain: true, yarn_link_reason: 'Uten produsent; DSA ut fra designeren' })
    // A name without a brand is not taken to be a known yarn unless the grouping said so.
    expect(by.d).toEqual({ yarn_id: null, yarn_link_uncertain: true, yarn_link_reason: NOT_IN_CATALOGUE })
    expect(by.e).toEqual({ yarn_id: null, yarn_link_uncertain: false, yarn_link_reason: GENERIC_REASON })
    expect(by.f).toEqual({ yarn_id: null, yarn_link_uncertain: true, yarn_link_reason: NOT_IN_CATALOGUE })
    expect(counts).toEqual({ linked: 2, linked_uncertain: 1, generic: 1, not_in_catalogue: 2, renamed: 0 })
  })

  it('writes nothing for a line that is already linked the same way', () => {
    const { updates } = linkPlan([line('a', 'Sandnes Garn', 'Peer Gynt', { yarn_id: 'pg' })], yarns, new Set())
    expect(updates).toEqual([])
  })

  it('keeps a link whose yarn name has since changed in the recipe, and marks it stale', () => {
    const { updates, counts } = linkPlan([
      line('a', 'Sandnes Garn', 'Sunday', { yarn_id: 'pg' }),
      line('b', 'Ukjent', 'Garn', { yarn_id: 'pg' }),
    ], yarns, new Set())
    expect(updates.map(u => u.values)).toEqual([
      { yarn_id: 'pg', yarn_link_uncertain: true, yarn_link_reason: RENAMED },
      { yarn_id: 'pg', yarn_link_uncertain: true, yarn_link_reason: RENAMED },
    ])
    expect(counts.renamed).toBe(2)
  })
})

describe('toAnswer', () => {
  it('turns a catalogue row into an answer that follows the schema and reads back the same', () => {
    const row = {
      brand: 'Mjuk', name: 'Spire', fibers: [{ fiber: 'merinoull', percent: 100 }], skein_weight_g: 50, meterage_m: 175,
      gauge_stitches_min: null, gauge_stitches_max: null, needle_mm_min: 3, needle_mm_max: 3, drops_group: null, discontinued: false,
      source_url: 'https://www.obs.no/x', source_kind: 'retailer', source_note: 'opplyst av Maria', field_sources: { meterage_m: 'https://www.obs.no/x' },
      favorite: null, price_per_skein: null, uncertain_fields: ['gauge_stitches_min'], uncertain_reasons: { gauge_stitches_min: 'Ikke oppgitt' },
    }
    const a = toAnswer(row)
    expect(schemaErrors(YARN_SCHEMA as Record<string, unknown>, a)).toEqual([])
    const { favorite, price_per_skein, ...rest } = row
    expect(normalizeYarn(a)).toEqual({ ...rest, favorite, price_per_skein })
  })
})
