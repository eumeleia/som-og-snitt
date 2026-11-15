import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sim = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q = {
        upsert: async (r: Record<string, unknown>) => { sim.calls.push(`upsert ${r.folder_id} ${r.oppskrift_id}`); return { error: null } },
        delete: () => q,
        eq: (c: string, v: string) => { sim.calls.push(`eq ${c}=${v}`); return c === 'oppskrift_id' ? Promise.resolve({ error: null }) : q },
      }
      return q
    },
  }),
}))

const { PUT } = await import('./route')
const put = (body: unknown) => PUT(new NextRequest('https://app.test/api/strikk/folders/f1/recipes', { method: 'PUT', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'f1' }) } as never)

beforeEach(() => { sim.calls = [] })

describe('PUT /api/strikk/folders/[id]/recipes', () => {
  it('puts a recipe in the folder and takes it out again', async () => {
    expect((await put({ oppskrift_id: 'r1', member: true })).status).toBe(200)
    expect((await put({ oppskrift_id: 'r1', member: false })).status).toBe(200)
    expect(sim.calls).toEqual(['upsert f1 r1', 'eq folder_id=f1', 'eq oppskrift_id=r1'])
  })
  it('refuses a body without a recipe or a yes/no', async () => {
    expect((await put({ oppskrift_id: 'r1' })).status).toBe(400)
    expect(sim.calls).toEqual([])
  })
})
