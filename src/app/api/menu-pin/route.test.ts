import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Simulated Supabase: projects that exist, the pin table, and what was written.
const sim = vi.hoisted(() => ({
  existing: new Set<string>(),
  pins: new Map<string, string>(),
  upsertError: null as { code: string; message: string } | null,
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      let id = ''
      const q = {
        select: () => q,
        eq: (col: string, v: string) => { if (col === 'id') id = v; return q },
        maybeSingle: async () => ({ data: sim.existing.has(`${table}:${id}`) ? { id } : null, error: null }),
        upsert: async (row: { kind: string; project_id: string }) => {
          if (sim.upsertError) return { error: sim.upsertError }
          sim.pins.set(row.kind, row.project_id)
          return { error: null }
        },
        delete: () => ({ eq: async (_c: string, v: string) => { sim.pins.delete(v); return { error: null } } }),
      }
      return q
    },
  }),
}))

const { POST } = await import('./route')
const post = (body: unknown) => POST(new NextRequest('https://app.test/api/menu-pin', { method: 'POST', body: JSON.stringify(body) }))

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const S = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  sim.existing = new Set([`strikk_project:${A}`, `strikk_project:${B}`, `projects:${S}`])
  sim.pins = new Map()
  sim.upsertError = null
})

describe('POST /api/menu-pin', () => {
  it('pins one project per kind, and a new pin replaces the old one of the same kind', async () => {
    expect((await post({ kind: 'strikk', project_id: A })).status).toBe(200)
    expect((await post({ kind: 'sy', project_id: S })).status).toBe(200)
    expect((await post({ kind: 'strikk', project_id: B })).status).toBe(200)
    expect(Object.fromEntries(sim.pins)).toEqual({ strikk: B, sy: S })
  })

  it('unpins with project_id null', async () => {
    await post({ kind: 'strikk', project_id: A })
    expect((await post({ kind: 'strikk', project_id: null })).status).toBe(200)
    expect(sim.pins.has('strikk')).toBe(false)
  })

  it('refuses a project of the other kind or one that does not exist', async () => {
    expect((await post({ kind: 'sy', project_id: A })).status).toBe(404)
    expect((await post({ kind: 'strikk', project_id: '44444444-4444-4444-8444-444444444444' })).status).toBe(404)
    expect(sim.pins.size).toBe(0)
  })

  it('validates kind and id', async () => {
    expect((await post({ kind: 'hekling', project_id: A })).status).toBe(400)
    expect((await post({ kind: 'strikk', project_id: 'abc' })).status).toBe(400)
    expect((await post(null)).status).toBe(400)
  })

  it('says which migration to run when the table is missing', async () => {
    sim.upsertError = { code: 'PGRST205', message: 'Could not find the table' }
    const res = await post({ kind: 'strikk', project_id: A })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/migrasjon 027/)
  })
})
