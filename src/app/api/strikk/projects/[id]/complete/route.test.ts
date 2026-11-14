import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Simulated Supabase: the project, the stash rows set aside for it, and what was written.
const sim = vi.hoisted(() => ({
  stash: [] as { id: string; skein_count: number; project_skeins: number | null; project_id: string }[],
  updates: [] as { table: string; patch: Record<string, unknown>; id: string }[],
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      let patch: Record<string, unknown> | null = null
      let projectId = ''
      const q = {
        select: () => q,
        not: () => Promise.resolve({ data: sim.stash.filter(r => r.project_id === projectId && r.project_skeins !== null), error: null }),
        update: (p: Record<string, unknown>) => { patch = p; return q },
        insert: async () => ({ error: null }),
        eq: (_c: string, v: string) => {
          if (patch) { sim.updates.push({ table, patch, id: v }); return Promise.resolve({ error: null }) }
          projectId = v
          return q
        },
        maybeSingle: async () => ({ data: table === 'strikk_project' ? { id: 'p1', name: 'Genser' } : null, error: null }),
      }
      return q
    },
  }),
}))

const { POST } = await import('./route')
const complete = () => POST(
  new NextRequest('https://app.test/api/strikk/projects/p1/complete', { method: 'POST', body: JSON.stringify({ leftovers: [] }) }),
  { params: Promise.resolve({ id: 'p1' }) } as never,
)

beforeEach(() => {
  sim.stash = [
    { id: 'partly', skein_count: 5, project_skeins: 3, project_id: 'p1' },
    { id: 'whole', skein_count: 4, project_skeins: null, project_id: 'p1' },
  ]
  sim.updates = []
})

describe('POST /api/strikk/projects/[id]/complete', () => {
  it('keeps the free skeins of a partly set-aside row in the stash, and leaves a whole row used', async () => {
    expect((await complete()).status).toBe(200)
    const stashUpdates = sim.updates.filter(u => u.table === 'strikk_yarn_stash')
    expect(stashUpdates).toEqual([{ table: 'strikk_yarn_stash', id: 'partly', patch: expect.objectContaining({ skein_count: 2, project_id: null, project_skeins: null }) }])
    expect(sim.updates.find(u => u.table === 'strikk_project')?.patch).toMatchObject({ status: 'done' })
  })
})
