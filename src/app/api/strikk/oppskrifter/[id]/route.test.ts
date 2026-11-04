import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sim = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, renamed: [] as Record<string, unknown>[], failRename: false }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q = { update: () => q, eq: () => q, select: () => q, maybeSingle: async () => ({ data: sim.row, error: null }) }
      return q
    },
  }),
}))
vi.mock('@/lib/strikk-drive', () => ({
  syncRecipeDriveName: async (row: Record<string, unknown>) => {
    if (sim.failRename) throw new Error('404')
    sim.renamed.push(row)
    return `${row.title}${row.designer ? ` - ${row.designer}` : ''}.pdf`
  },
}))

const { PATCH } = await import('./route')
const patch = (body: unknown) => PATCH(
  new NextRequest('https://app.test/api/strikk/oppskrifter/r1', { method: 'PATCH', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: 'r1' }) } as never,
)

beforeEach(() => {
  sim.row = { id: 'r1', title: 'Ellinor - Flere plagg - Katalog', designer: 'Viking Garn', file_name: 'Alpaca Silk katalog - Viking Garn.pdf', drive_file_id: 'f-e' }
  sim.renamed = []
  sim.failRename = false
})

describe('PATCH /api/strikk/oppskrifter/[id]', () => {
  it('renames the Drive file after a new title or designer and returns the new file name', async () => {
    const body = await (await patch({ title: 'Ellinor - Flere plagg - Katalog', designer: 'Viking Garn' })).json()
    expect(sim.renamed).toHaveLength(1)
    expect(body.file_name).toBe('Ellinor - Flere plagg - Katalog - Viking Garn.pdf')
  })

  it('saves the change even when the file cannot be renamed', async () => {
    sim.failRename = true
    const res = await patch({ designer: '' })
    expect(res.status).toBe(200)
    expect((await res.json()).file_name).toBe('Alpaca Silk katalog - Viking Garn.pdf')
  })
})
