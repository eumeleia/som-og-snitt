import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { SIMULATED_ANSWER, storedFrom } from '@/app/strikk/_lib/extraction.fixture'
import { normalizeExtraction, type StoredRecipe } from '@/app/strikk/_lib/extraction'

// Simulated Supabase: the stored recipe, the save function and the corrections table.
const sim = vi.hoisted(() => ({
  stored: null as unknown,
  result: 'approved' as string,
  rpc: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  renamed: [] as Record<string, unknown>[],
}))
vi.mock('@/lib/strikk-drive', () => ({
  syncRecipeDriveName: async (row: Record<string, unknown>) => { sim.renamed.push(row); return 'x.pdf' },
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: sim.stored, error: null }),
        insert: async (rows: Record<string, unknown>[]) => { sim.inserted.push(...rows); return { error: null } },
      }
      return q
    },
    rpc: async (_fn: string, args: Record<string, unknown>) => { sim.rpc.push(args); return { data: sim.result, error: null } },
  }),
}))

const { POST } = await import('./route')
const approve = (data: unknown, edit?: boolean) => POST(
  new NextRequest('https://app.test/api/strikk/extraction/r1/approve', { method: 'POST', body: JSON.stringify({ data, edit }) }),
  { params: Promise.resolve({ id: 'r1' }) } as never,
)

const extracted = () => normalizeExtraction(SIMULATED_ANSWER)
const withStatus = (s: StoredRecipe['extraction_status']) => storedFrom(extracted(), { extraction_status: s })

beforeEach(() => { sim.stored = withStatus('extracted'); sim.result = 'approved'; sim.rpc = []; sim.inserted = []; sim.renamed = [] })

describe('POST /api/strikk/extraction/[id]/approve', () => {
  it('saves the corrected data as approved, uncertain marks cleared, open choice kept', async () => {
    const res = await approve({ ...extracted(), title: 'Rein genser (rettet)' })
    expect(res.status).toBe(200)
    expect(sim.rpc[0]).toMatchObject({ p_id: 'r1', p_approve: true, p_edit_approved: false })
    const saved = sim.rpc[0].p_data as ReturnType<typeof normalizeExtraction>
    expect(saved.title).toBe('Rein genser (rettet)')
    expect(saved.uncertain_fields).toEqual([])
    expect(saved.uncertain_reasons).toEqual({})
    expect(saved.sizes.some(s => s.uncertain)).toBe(false)
    expect(saved.amounts.filter(a => a.needs_choice)).toHaveLength(1)
  })

  it('stores what was corrected, for the next extractions', async () => {
    const d = extracted()
    const fixed = { ...d, audience: 'unisex' as const, amounts: d.amounts.map(a => (a.size === 3 && a.yarn_line === 0 ? { ...a, amount: 450, amount_max: 500 } : a)) }
    const body = await (await approve(fixed)).json()
    expect(body.corrections).toBe(2)
    expect(sim.inserted).toEqual([
      { oppskrift_id: 'r1', recipe_title: 'Rein genser', field: 'Målgruppe', extracted: 'kvinne', corrected: 'unisex' },
      { oppskrift_id: 'r1', recipe_title: 'Rein genser', field: 'Garnmengde XL / Sunday', extracted: '400–450 g', corrected: '450–500 g' },
    ])
  })

  it('stores nothing when nothing was corrected', async () => {
    await approve(extracted())
    expect(sim.inserted).toEqual([])
  })

  it('stores no corrections for a recipe that was never read in', async () => {
    sim.stored = withStatus('pending')
    await approve({ ...extracted(), audience: 'man' })
    expect(sim.inserted).toEqual([])
  })

  it('will not touch an approved recipe without an explicit edit', async () => {
    sim.stored = withStatus('approved')
    expect((await approve({ ...extracted(), audience: 'man' })).status).toBe(409)
    expect(sim.rpc).toEqual([])
  })

  it('an explicit edit of an approved recipe keeps it approved and stores the correction', async () => {
    sim.stored = withStatus('approved')
    const d = extracted()
    const res = await approve({ ...d, amounts: d.amounts.map(a => (a.size === 2 && a.yarn_line === 0 ? { ...a, amount: 200, amount_max: 250 } : a)) }, true)
    expect(res.status).toBe(200)
    expect(sim.rpc[0]).toMatchObject({ p_approve: true, p_edit_approved: true })
    expect(sim.inserted).toEqual([{ oppskrift_id: 'r1', recipe_title: 'Rein genser', field: 'Garnmengde L / Sunday', extracted: '350 g', corrected: '200–250 g' }])
  })

  it('answers 409 when the save function reports the recipe locked', async () => {
    sim.result = 'locked'
    expect((await approve(extracted())).status).toBe(409)
    expect(sim.inserted).toEqual([])
  })

  it('refuses an empty title', async () => {
    expect((await approve({ ...SIMULATED_ANSWER, title: '  ' })).status).toBe(400)
    expect(sim.rpc).toEqual([])
  })

  it('renames the Drive file when the title or designer changes, and not otherwise', async () => {
    await approve(extracted())
    expect(sim.renamed).toEqual([])
    await approve({ ...extracted(), title: 'Rein genser - kort', designer: 'Ber-Lin' })
    expect(sim.renamed).toEqual([expect.objectContaining({ id: 'r1', title: 'Rein genser - kort', designer: 'Ber-Lin', drive_file_id: 'f' })])
  })
})
