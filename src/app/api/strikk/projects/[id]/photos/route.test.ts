import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Simulated Supabase: one project, its photos, the storage bucket and what was written.
const sim = vi.hoisted(() => ({
  status: 'done' as string,
  photos: [] as { position: number }[],
  missingTable: false,
  uploads: [] as string[],
  inserts: [] as Record<string, unknown>[],
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: async (path: string) => { sim.uploads.push(path); return { error: null } }, remove: async () => ({ error: null }) }) },
    from: (table: string) => {
      let row: Record<string, unknown> | null = null
      const q = {
        select: () => q,
        insert: (r: Record<string, unknown>) => { row = r; sim.inserts.push(r); return q },
        single: async () => ({ data: row, error: null }),
        maybeSingle: async () => ({ data: table === 'strikk_project' ? { id: 'p1', status: sim.status } : null, error: null }),
        eq: () => (table === 'strikk_project_photo' && !row
          ? Promise.resolve(sim.missingTable
            ? { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.strikk_project_photo'" } }
            : { data: sim.photos, error: null })
          : q),
      }
      return q
    },
  }),
}))

const { POST } = await import('./route')
const jpeg = (size: number) => { const b = new Uint8Array(size); b.set([0xff, 0xd8, 0xff]); return b }
const post = (body: Uint8Array, type = 'image/jpeg') => POST(
  new NextRequest('https://app.test/api/strikk/projects/p1/photos', { method: 'POST', headers: { 'Content-Type': type }, body: body as BodyInit }),
  { params: Promise.resolve({ id: 'p1' }) } as never,
)

beforeEach(() => {
  sim.status = 'done'; sim.photos = []; sim.missingTable = false; sim.uploads = []; sim.inserts = []
})

describe('POST /api/strikk/projects/[id]/photos', () => {
  it('stores a photo of a finished project after the others, in a folder per project', async () => {
    sim.photos = [{ position: 0 }, { position: 2 }]
    const res = await post(jpeg(1000))
    expect(res.status).toBe(200)
    expect(sim.uploads[0]).toMatch(/^p1\/[0-9a-f-]+\.jpg$/)
    expect(sim.inserts[0]).toMatchObject({ project_id: 'p1', position: 3, path: sim.uploads[0] })
  })
  it('refuses a project that is not finished', async () => {
    sim.status = 'in_progress'
    expect((await post(jpeg(1000))).status).toBe(409)
    expect(sim.uploads).toEqual([])
  })
  it('refuses a photo of 200 kB or more, and anything that is not JPEG', async () => {
    expect((await post(jpeg(200 * 1024 + 1))).status).toBe(413)
    expect((await post(jpeg(1000), 'image/png')).status).toBe(415)
  })
  it('says migration 030 is missing instead of failing silently', async () => {
    sim.missingTable = true
    const res = await post(jpeg(1000))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/migrasjon 030/)
    expect(sim.uploads).toEqual([])
  })
})
