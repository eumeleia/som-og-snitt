import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sim = vi.hoisted(() => ({ calls: [] as string[], failMembers: false }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      insert: (rows: unknown) => {
        sim.calls.push(`insert ${table} ${JSON.stringify(rows)}`)
        if (table === 'strikk_swatch') {
          return { select: () => ({ single: async () => ({ data: { id: 's1', ...(rows as object), created_at: '2026-11-16T10:00:00Z' }, error: null }) }) }
        }
        return Promise.resolve({ error: sim.failMembers ? { message: 'boom' } : null })
      },
      delete: () => ({ eq: async (c: string, v: string) => { sim.calls.push(`delete ${table} ${c}=${v}`); return { error: null } } }),
    }),
  }),
}))

const { POST } = await import('./route')
const post = (body: unknown) => POST(new NextRequest('https://app.test/api/strikk/swatches', { method: 'POST', body: JSON.stringify(body) }))
const lerke = 'ded7a4ef-fbb9-4bcf-adaf-2ea2453d9a65'

beforeEach(() => { sim.calls = []; sim.failMembers = false })

describe('POST /api/strikk/swatches', () => {
  it('saves the swatch and its yarns', async () => {
    const res = await post({ members: [{ yarn_id: lerke, strands: 2 }], needle_mm: 6, gauge_stitches_10cm: 15 })
    expect(res.status).toBe(200)
    expect((await res.json()).strikk_swatch_yarn).toEqual([{ position: 0, yarn_id: lerke, strands: 2 }])
    expect(sim.calls).toEqual([
      'insert strikk_swatch {"needle_mm":6,"gauge_stitches_10cm":15,"gauge_rows_10cm":null,"notes":null}',
      `insert strikk_swatch_yarn [{"swatch_id":"s1","position":0,"yarn_id":"${lerke}","strands":2}]`,
    ])
  })
  it('takes the swatch out again when its yarns cannot be saved', async () => {
    sim.failMembers = true
    expect((await post({ members: [{ yarn_id: lerke, strands: 2 }], needle_mm: 6, gauge_stitches_10cm: 15 })).status).toBe(500)
    expect(sim.calls.at(-1)).toBe('delete strikk_swatch id=s1')
  })
  it('refuses a swatch without a measured gauge', async () => {
    expect((await post({ members: [{ yarn_id: lerke, strands: 2 }], needle_mm: 6 })).status).toBe(400)
    expect(sim.calls).toEqual([])
  })
})
