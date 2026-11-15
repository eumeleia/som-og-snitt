import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Simulated Supabase: what was inserted, and the error the database answers with.
const sim = vi.hoisted(() => ({ inserts: [] as Record<string, unknown>[], error: null as null | { code: string; message: string } }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      let row: Record<string, unknown> | null = null
      const q = {
        insert: (r: Record<string, unknown>) => { row = r; sim.inserts.push(r); return q },
        select: () => q,
        single: async () => (sim.error ? { data: null, error: sim.error } : { data: { id: 'w1', ...row }, error: null }),
      }
      return q
    },
  }),
}))

const { POST } = await import('./route')
const post = (body: unknown) => POST(new NextRequest('https://app.test/api/strikk/wishes', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { sim.inserts = []; sim.error = null })

describe('POST /api/strikk/wishes', () => {
  it('saves a recipe Maria does not have, with link and estimated price', async () => {
    const res = await post({ title: 'Fluffy Cable', url: 'petiteknit.com/x', price_nok: '249' })
    expect(res.status).toBe(200)
    expect(sim.inserts[0]).toEqual({ title: 'Fluffy Cable', url: 'https://petiteknit.com/x', price_nok: 249 })
  })
  it('refuses a wish without a name or a recipe, before the database', async () => {
    expect((await post({ note: 'x' })).status).toBe(400)
    expect(sim.inserts).toEqual([])
  })
  it('says the recipe is already on the list', async () => {
    sim.error = { code: '23505', message: 'duplicate key' }
    const res = await post({ oppskrift_id: '4bfc1ee0-e979-43c0-bded-e82335b1f019' })
    expect(res.status).toBe(409)
  })
  it('says migration 031 is missing', async () => {
    sim.error = { code: 'PGRST205', message: "Could not find the table 'public.strikk_wish'" }
    const res = await post({ title: 'A' })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/migrasjon 031/)
  })
})
