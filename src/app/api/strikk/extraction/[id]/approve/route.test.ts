import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { SIMULATED_ANSWER } from '@/app/strikk/_lib/extraction.fixture'
import { normalizeExtraction } from '@/app/strikk/_lib/extraction'

const sim = vi.hoisted(() => ({ result: 'approved' as string, calls: [] as Record<string, unknown>[] }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: async (_fn: string, args: Record<string, unknown>) => { sim.calls.push(args); return { data: sim.result, error: null } } }),
}))

const { POST } = await import('./route')
const approve = (data: unknown) => POST(
  new NextRequest('https://app.test/api/strikk/extraction/r1/approve', { method: 'POST', body: JSON.stringify({ data }) }),
  { params: Promise.resolve({ id: 'r1' }) } as never,
)

beforeEach(() => { sim.result = 'approved'; sim.calls = [] })

describe('POST /api/strikk/extraction/[id]/approve', () => {
  it('saves the corrected data as approved, with the uncertain marks cleared and the open choice kept', async () => {
    const edited = { ...normalizeExtraction(SIMULATED_ANSWER), title: 'Rein genser (rettet)' }
    const res = await approve(edited)
    expect(res.status).toBe(200)
    expect(sim.calls[0]).toMatchObject({ p_id: 'r1', p_approve: true })
    const saved = sim.calls[0].p_data as ReturnType<typeof normalizeExtraction>
    expect(saved.title).toBe('Rein genser (rettet)')
    expect(saved.uncertain_fields).toEqual([])
    expect(saved.sizes.some(s => s.uncertain)).toBe(false)
    expect(saved.amounts.filter(a => a.needs_choice)).toHaveLength(1)
  })

  it('answers 409 for a recipe that is already approved', async () => {
    sim.result = 'locked'
    expect((await approve(normalizeExtraction(SIMULATED_ANSWER))).status).toBe(409)
  })

  it('refuses an empty title', async () => {
    expect((await approve({ ...SIMULATED_ANSWER, title: '  ' })).status).toBe(400)
    expect(sim.calls).toEqual([])
  })
})
