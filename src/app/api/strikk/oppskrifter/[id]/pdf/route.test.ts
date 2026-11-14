import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

// Simulated Supabase and Drive: the recipe row, and what was sent to Drive.
const sim = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as { fileId: string; keepRevisionForever: boolean; bytes: Buffer }[],
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: sim.row, error: null }) }
      return q
    },
  }),
}))
vi.mock('@/lib/strikk-drive', () => ({ getStrikkOAuth2Client: async () => ({}) }))
vi.mock('googleapis', () => ({
  google: {
    drive: () => ({
      files: {
        update: async (args: { fileId: string; keepRevisionForever: boolean; media: { body: AsyncIterable<Buffer> } }) => {
          const chunks: Buffer[] = []
          for await (const c of args.media.body) chunks.push(Buffer.from(c))
          const bytes = Buffer.concat(chunks)
          sim.updates.push({ fileId: args.fileId, keepRevisionForever: args.keepRevisionForever, bytes })
          return { data: { id: args.fileId, name: 'x.pdf', size: String(bytes.length), md5Checksum: createHash('md5').update(bytes).digest('hex') } }
        },
      },
    }),
  },
}))

const { POST } = await import('./route')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PDF = Buffer.from('%PDF-1.4\n% test\n')
const post = (body: Buffer, headers: Record<string, string> = {}) => POST(
  new NextRequest('https://app.test/api/strikk/oppskrifter/r1/pdf', {
    method: 'POST', body: new Uint8Array(body), headers: { 'content-type': 'application/pdf', authorization: `Bearer ${KEY}`, ...headers },
  }),
  { params: Promise.resolve({ id: 'r1' }) } as never,
)

beforeEach(() => {
  sim.row = { id: 'r1', drive_file_id: 'drive-1' }
  sim.updates = []
})

describe('POST /api/strikk/oppskrifter/[id]/pdf', () => {
  it('replaces the content of the same Drive file and keeps the earlier version', async () => {
    const res = await post(PDF)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(sim.updates).toHaveLength(1)
    expect(sim.updates[0]).toMatchObject({ fileId: 'drive-1', keepRevisionForever: true })
    expect(sim.updates[0].bytes.equals(PDF)).toBe(true)
  })

  it('refuses without the service key, and touches nothing', async () => {
    expect((await post(PDF, { authorization: 'Bearer feil' })).status).toBe(401)
    expect((await post(PDF, { authorization: '' })).status).toBe(401)
    expect(sim.updates).toHaveLength(0)
  })

  it('refuses what is not a PDF, and an unknown recipe', async () => {
    expect((await post(Buffer.from('hello'))).status).toBe(415)
    expect((await post(PDF, { 'content-type': 'text/plain' })).status).toBe(415)
    sim.row = null
    expect((await post(PDF)).status).toBe(404)
    expect(sim.updates).toHaveLength(0)
  })
})
