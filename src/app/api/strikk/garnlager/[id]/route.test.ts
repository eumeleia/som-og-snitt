import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Simulated Supabase: the row, what was written, and whether migration 029 is run.
const sim = vi.hoisted(() => ({
  row: { id: 's1', skein_count: 5 } as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  has029: true,
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      let patch: Record<string, unknown> | null = null
      let select = ''
      const q = {
        update: (p: Record<string, unknown>) => { patch = { ...p }; return q },
        select: (s: string) => { select = s; return q },
        eq: () => q,
        maybeSingle: async () => {
          if (!patch) return { data: sim.row, error: null }
          if (!sim.has029 && ('project_skeins' in patch || select.includes('project_skeins'))) {
            return { data: null, error: { code: '42703', message: 'column strikk_yarn_stash.project_skeins does not exist' } }
          }
          sim.updates.push(patch)
          return { data: { ...sim.row, ...patch }, error: null }
        },
      }
      return q
    },
  }),
}))

const { PATCH } = await import('./route')
const patch = (body: unknown) => PATCH(
  new NextRequest('https://app.test/api/strikk/garnlager/s1', { method: 'PATCH', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: 's1' }) } as never,
)
const last = () => sim.updates[sim.updates.length - 1]

beforeEach(() => {
  sim.row = { id: 's1', skein_count: 5 }
  sim.updates = []
  sim.has029 = true
})

describe('PATCH /api/strikk/garnlager/[id] with skeins for the project', () => {
  it('sets some of the skeins aside for a project', async () => {
    expect((await patch({ project_id: 'p1', project_skeins: 3 })).status).toBe(200)
    expect(last()).toMatchObject({ project_id: 'p1', project_skeins: 3 })
  })

  it('treats all of them as the whole row, and clears the count with the project', async () => {
    await patch({ project_id: 'p1', project_skeins: 5 })
    expect(last()).toMatchObject({ project_skeins: null })
    await patch({ project_id: null })
    expect(last()).toMatchObject({ project_id: null, project_skeins: null })
  })

  it('refuses more skeins than the row has, or none', async () => {
    expect((await patch({ project_id: 'p1', project_skeins: 6 })).status).toBe(400)
    expect((await patch({ project_id: 'p1', project_skeins: 0 })).status).toBe(400)
    expect((await patch({ skein_count: 2, project_skeins: 3 })).status).toBe(400)
    expect(sim.updates).toHaveLength(0)
  })

  it('before migration 029: a whole row still works, part of a row says which migration to run', async () => {
    sim.has029 = false
    expect((await patch({ project_id: null })).status).toBe(200)
    expect(last()).toEqual(expect.not.objectContaining({ project_skeins: expect.anything() }))
    const res = await patch({ project_id: 'p1', project_skeins: 2 })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/029/)
  })
})
