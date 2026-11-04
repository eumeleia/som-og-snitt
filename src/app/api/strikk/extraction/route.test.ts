import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { SIMULATED_ANSWER } from '@/app/strikk/_lib/extraction.fixture'

// Simulated Claude, Supabase and Drive. Nothing reaches the network or the shared table.
const sim = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  claude: { stop_reason: 'end_turn', content: [] as unknown[] },
  claudeCalls: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: 'saved' as string,
  updates: [] as { values: Record<string, unknown>; filters: string[] }[],
  driveUpdates: [] as Record<string, unknown>[],
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (params: Record<string, unknown>) => { sim.claudeCalls.push(params); return sim.claude },
    }
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: sim.row, error: null }),
        update: (values: Record<string, unknown>) => {
          const filters: string[] = []
          const u = {
            eq: (c: string, v: string) => { filters.push(`${c}=${v}`); return u },
            neq: (c: string, v: string) => { filters.push(`${c}!=${v}`); return u },
            then: (res: (v: unknown) => void) => { sim.updates.push({ values, filters }); res({ error: null }) },
          }
          return u
        },
      }
      return q
    },
    rpc: async (fn: string, args: Record<string, unknown>) => { sim.rpcCalls.push({ fn, args }); return { data: sim.rpcResult, error: null } },
  }),
}))

vi.mock('@/lib/strikk-drive', () => ({ getStrikkOAuth2Client: async () => ({}) }))
vi.mock('googleapis', () => ({
  google: { drive: () => ({ files: { update: async (p: Record<string, unknown>) => { sim.driveUpdates.push(p); return { data: {} } } } }) },
}))

const { POST } = await import('./route')

const post = (body: unknown) => POST(new NextRequest('https://app.test/api/strikk/extraction', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}))

beforeEach(() => {
  sim.row = { id: 'r1', title: 'IMG_0042', designer: null, file_name: 'IMG_0042.pdf', drive_file_id: 'drive-1', extraction_status: 'pending' }
  sim.claude = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(SIMULATED_ANSWER) }] }
  sim.claudeCalls = []
  sim.rpcCalls = []
  sim.rpcResult = 'saved'
  sim.updates = []
  sim.driveUpdates = []
})

const pages = [{ page: 1, text: 'Rein genser' }, { page: 2, text: 'Garn Sunday 50 g = 235 m' }]

describe('POST /api/strikk/extraction', () => {
  it('sends the chosen pages with the schema and saves every field through the save function', async () => {
    const res = await post({ recipeId: 'r1', pages })
    expect(res.status).toBe(200)

    const call = sim.claudeCalls[0]
    expect(call.model).toBe('claude-opus-5-5')
    expect((call.output_config as { format: { type: string } }).format.type).toBe('json_schema')
    const sent = JSON.stringify(call.messages)
    expect(sent).toContain('--- Side 2 ---')
    expect(sent).toContain('Sunday 50 g = 235 m')

    expect(sim.rpcCalls).toHaveLength(1)
    const { fn, args } = sim.rpcCalls[0]
    expect(fn).toBe('strikk_save_extraction')
    expect(args).toMatchObject({ p_id: 'r1', p_approve: false })
    const saved = args.p_data as Record<string, unknown> & { yarn_lines: { color_group: number; yarn_name: string }[] }
    expect(saved).toMatchObject({
      audience: 'woman', garment_type: 'genser', gauge_stitches_10cm: 22, gauge_rows_10cm: 30, pages: [1, 2],
    })
    expect((saved.sizes as unknown[]).length).toBe(4)
    expect((saved.amounts as unknown[]).length).toBe(9)
    expect((saved.accessories as unknown[]).length).toBe(2)
    expect((saved.alternatives as unknown[]).length).toBe(1)
    expect(saved.yarn_lines.filter(l => l.color_group === 0).map(l => l.yarn_name)).toEqual(['Sunday', 'Tynn Silk Mohair'])
    expect(saved.raw).toEqual(SIMULATED_ANSWER)
    expect(sim.driveUpdates).toEqual([])
  })

  it('sends page images for a scanned PDF', async () => {
    await post({ recipeId: 'r1', images: [{ page: 1, data: 'AAAA' }, { page: 2, data: 'BBBB' }] })
    const content = (sim.claudeCalls[0].messages as { content: { type: string; source?: { media_type: string } }[] }[])[0].content
    expect(content.filter(b => b.type === 'image').map(b => b.source!.media_type)).toEqual(['image/jpeg', 'image/jpeg'])
    expect(sim.rpcCalls[0].args.p_data).toMatchObject({ pages: [1, 2] })
  })

  it('does not call Claude or save for an approved recipe', async () => {
    sim.row = { ...sim.row!, extraction_status: 'approved' }
    const res = await post({ recipeId: 'r1', pages })
    expect(res.status).toBe(409)
    expect(sim.claudeCalls).toEqual([])
    expect(sim.rpcCalls).toEqual([])
  })

  it('answers 409 when the recipe was approved while Claude was reading', async () => {
    sim.rpcResult = 'locked'
    const res = await post({ recipeId: 'r1', pages, rename: true })
    expect(res.status).toBe(409)
    expect(sim.driveUpdates).toEqual([])
  })

  it('renames a new upload to «Oppskrift - Designer.pdf» in Drive and on the row', async () => {
    const res = await post({ recipeId: 'r1', pages, rename: true })
    const body = await res.json()
    expect(sim.driveUpdates).toEqual([{ fileId: 'drive-1', requestBody: { name: 'Rein genser - Ber-Lin Design.pdf' }, fields: 'id' }])
    expect(sim.updates).toEqual([{ values: { file_name: 'Rein genser - Ber-Lin Design.pdf', title: 'Rein genser', designer: 'Ber-Lin Design' }, filters: ['id=r1'] }])
    expect(body.renamed.file_name).toBe('Rein genser - Ber-Lin Design.pdf')
  })

  it('marks the recipe failed, but never an approved one, when Claude stops short', async () => {
    sim.claude = { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"title":' }] }
    const res = await post({ recipeId: 'r1', pages })
    expect(res.status).toBe(500)
    expect(sim.rpcCalls).toEqual([])
    expect(sim.updates[0].values).toMatchObject({ extraction_status: 'failed' })
    expect(sim.updates[0].filters).toEqual(['id=r1', 'extraction_status!=approved'])
  })

  it('refuses a request without pages', async () => {
    expect((await post({ recipeId: 'r1' })).status).toBe(400)
    expect(sim.claudeCalls).toEqual([])
  })
})
