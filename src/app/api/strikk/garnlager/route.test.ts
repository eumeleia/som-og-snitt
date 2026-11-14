import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Simulated Supabase: the catalogue, and what the route inserts.
const sim = vi.hoisted(() => ({
  catalogue: [] as Record<string, unknown>[],
  inserted: [] as { table: string; row: Record<string, unknown> }[],
  noLotColumn: false,
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      let id: string | null = null
      let pending: Record<string, unknown> | null = null
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => { id = v; return q },
        maybeSingle: async () => ({ data: sim.catalogue.find(y => y.id === id) ?? null, error: null }),
        insert: (row: Record<string, unknown>) => { pending = row; return q },
        single: async () => {
          if (table === 'strikk_yarn_stash' && sim.noLotColumn && pending && 'dye_lot' in pending) {
            return { data: null, error: { code: '42703', message: 'column dye_lot does not exist' } }
          }
          sim.inserted.push({ table, row: pending! })
          return { data: { id: `${table}-new`, ...pending }, error: null }
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: sim.catalogue, error: null }),
      }
      return q
    },
  }),
}))

const { POST } = await import('./route')
const post = (body: unknown) => POST(new NextRequest('https://app.test/api/strikk/garnlager', { method: 'POST', body: JSON.stringify(body) }))
const stashRows = () => sim.inserted.filter(i => i.table === 'strikk_yarn_stash').map(i => i.row)
const yarnRows = () => sim.inserted.filter(i => i.table === 'strikk_yarn').map(i => i.row)

beforeEach(() => {
  sim.catalogue = [{ id: 'sunday', brand: 'Sandnes Garn', name: 'Sunday', aliases: [{ brand: 'Sandnes', name: 'Sunday', certain: true, reason: null }] }]
  sim.inserted = []
  sim.noLotColumn = false
})

describe('POST /api/strikk/garnlager', () => {
  it('adds a catalogue yarn in skeins, approved at once', async () => {
    const res = await post({ yarn_id: 'sunday', color_name: 'Lys grå', color_number: '1042', dye_lot: '4471', amount: 3, unit: 'skeins' })
    expect(res.status).toBe(200)
    expect(stashRows()).toEqual([expect.objectContaining({ yarn_id: 'sunday', color_name: 'Lys grå', color_number: '1042', dye_lot: '4471', skein_count: 3, leftover_g: null, status: 'godkjent' })])
    expect(yarnRows()).toEqual([])
  })

  it('puts grams in leftover_g', async () => {
    await post({ yarn_id: 'sunday', amount: '35,5', unit: 'grams' })
    expect(stashRows()[0]).toMatchObject({ skein_count: 0, leftover_g: 35.5 })
  })

  it('creates a new yarn as «Ikke slått opp» (draft)', async () => {
    const body = await (await post({ brand: 'Isager', name: 'Spinni', amount: 2, unit: 'skeins' })).json()
    expect(yarnRows()).toEqual([{ brand: 'Isager', name: 'Spinni', status: 'draft' }])
    expect(stashRows()[0]).toMatchObject({ yarn_id: 'strikk_yarn-new' })
    expect(body.yarn).toMatchObject({ status: 'draft' })
  })

  it('uses the catalogue yarn when the name is a known spelling, instead of a duplicate', async () => {
    await post({ brand: 'Sandnes', name: 'sunday', amount: 1, unit: 'skeins' })
    expect(yarnRows()).toEqual([])
    expect(stashRows()[0]).toMatchObject({ yarn_id: 'sunday' })
  })

  it('keeps the parti in the note before migration 028, and says so', async () => {
    sim.noLotColumn = true
    const body = await (await post({ yarn_id: 'sunday', dye_lot: '4471', amount: 1, unit: 'skeins' })).json()
    expect(stashRows()).toEqual([expect.objectContaining({ note: 'Parti: 4471' })])
    expect(stashRows()[0]).not.toHaveProperty('dye_lot')
    expect(body.warning).toMatch(/migrasjon 028/)
  })

  it('refuses a missing yarn, amount or unit, and an unknown catalogue id', async () => {
    expect((await post({ amount: 1, unit: 'skeins' })).status).toBe(400)
    expect((await post({ yarn_id: 'sunday', amount: 0, unit: 'skeins' })).status).toBe(400)
    expect((await post({ yarn_id: 'sunday', amount: 1, unit: 'meter' })).status).toBe(400)
    expect((await post({ yarn_id: 'finnes-ikke', amount: 1, unit: 'skeins' })).status).toBe(404)
    expect(sim.inserted).toEqual([])
  })
})
