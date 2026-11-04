import { describe, it, expect, vi, beforeEach } from 'vitest'

// Simulated Supabase and Drive. Nothing reaches the network or the shared table.
const sim = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  drive: new Map<string, string>(),
  failOn: new Set<string>(),
  rowUpdates: [] as { values: Record<string, unknown>; id: string }[],
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: async () => ({ data: sim.rows, error: null }),
      update: (values: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => { sim.rowUpdates.push({ values, id }); return { error: null } } }),
    }),
  }),
}))
vi.mock('@/lib/strikk-drive', () => ({ getStrikkOAuth2Client: async () => ({}) }))
vi.mock('googleapis', () => ({
  google: {
    drive: () => ({
      files: {
        list: async () => ({ data: { files: [...sim.drive].map(([id, name]) => ({ id, name })), nextPageToken: null } }),
        update: async ({ fileId, requestBody }: { fileId: string; requestBody: { name: string } }) => {
          if (sim.failOn.has(fileId)) throw new Error('simulated Drive 500')
          sim.drive.set(fileId, requestBody.name)
          return { data: {} }
        },
      },
    }),
  },
}))

const { POST } = await import('./route')

beforeEach(() => {
  sim.rows = [
    { id: 'e', title: 'Ellinor - Flere plagg - Katalog', designer: 'Viking Garn', file_name: 'Alpaca Silk katalog - Viking Garn.pdf', drive_file_id: 'f-e' },
    { id: 'a', title: 'Ankers bluse', designer: 'PetiteKnit', file_name: 'Ankers bluse - PetiteKnit.pdf', drive_file_id: 'f-a' },
    { id: 'p', title: 'I den private Disken', designer: null, file_name: 'x.pdf', drive_file_id: 'f-private' },
  ]
  sim.drive = new Map([['f-e', 'Alpaca Silk katalog - Viking Garn.pdf'], ['f-a', 'Ankers bluse - PetiteKnit.pdf']])
  sim.failOn = new Set()
  sim.rowUpdates = []
})

describe('POST /api/strikk/drive/sync-names', () => {
  it('renames the mismatched file in Drive and on the row, and nothing else', async () => {
    const body = await (await POST()).json()
    expect(sim.drive.get('f-e')).toBe('Ellinor - Flere plagg - Katalog - Viking Garn.pdf')
    expect(sim.drive.get('f-a')).toBe('Ankers bluse - PetiteKnit.pdf')
    expect(sim.rowUpdates).toEqual([{ values: { file_name: 'Ellinor - Flere plagg - Katalog - Viking Garn.pdf' }, id: 'e' }])
    expect(body).toEqual({ renamed: [{ id: 'e', file_name: 'Ellinor - Flere plagg - Katalog - Viking Garn.pdf' }], failed: 0 })
  })

  it('does nothing on the second run', async () => {
    await POST()
    sim.rows[0].file_name = 'Ellinor - Flere plagg - Katalog - Viking Garn.pdf'
    sim.rowUpdates = []
    expect(await (await POST()).json()).toEqual({ renamed: [], failed: 0 })
    expect(sim.rowUpdates).toEqual([])
  })

  it('keeps going when one rename fails, and leaves that row as it was', async () => {
    sim.rows.push({ id: 't', title: 'Tusseladd genser', designer: null, file_name: 'T.pdf', drive_file_id: 'f-t' })
    sim.drive.set('f-t', 'T.pdf')
    sim.failOn.add('f-e')
    const body = await (await POST()).json()
    expect(body).toEqual({ renamed: [{ id: 't', file_name: 'Tusseladd genser.pdf' }], failed: 1 })
    expect(sim.rowUpdates.map(u => u.id)).toEqual(['t'])
  })
})
