import { describe, it, expect, vi } from 'vitest'
import { APP_URL, downloadFromDrive, findLocalPdf, needsImage, nextRound, saveAnswer } from './lib.mjs'
import { SIMULATED_ANSWER } from '../../src/app/strikk/_lib/extraction.fixture'
import { normalizeExtraction } from '../../src/app/strikk/_lib/extraction'

describe('findLocalPdf', () => {
  const local = ['Vårpopgenser - Maria Mestad.pdf'.normalize('NFD'), 'Iris - Camilla Pihl.pdf', 'Tusseladd genser.pdf']
  it('finds a file whose æ/ø/å are stored decomposed, as macOS does', () => {
    expect(findLocalPdf({ title: 'Vårpopgenser', designer: 'Maria Mestad', file_name: 'Vårpopgenser - Maria Mestad.pdf' }, local))
      .toBe(local[0])
  })
  it('falls back to «Oppskrift - Designer.pdf» and then the title when the stored name differs', () => {
    expect(findLocalPdf({ title: 'Iris', designer: 'Camilla Pihl', file_name: 'CP_57.pdf' }, local)).toBe('Iris - Camilla Pihl.pdf')
    expect(findLocalPdf({ title: 'Tusseladd genser', designer: null, file_name: 'x.pdf' }, local)).toBe('Tusseladd genser.pdf')
  })
  it('gives null when the PDF is not there', () => {
    expect(findLocalPdf({ title: 'Mangler', designer: null, file_name: 'Mangler.pdf' }, local)).toBeNull()
  })
})

describe('nextRound', () => {
  const rows = [
    { id: 'a', extraction_status: 'approved', created_at: '2026-01-01' },
    { id: 'e', extraction_status: 'extracted', created_at: '2026-01-02' },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, extraction_status: i % 3 ? 'failed' : 'pending', created_at: `2026-02-${String(30 - i).padStart(2, '0')}` })),
  ]
  it('takes 20 not read or failed, oldest first, and never approved or already read ones', () => {
    const r = nextRound(rows)
    expect(r).toHaveLength(20)
    expect(r.every((x: { extraction_status: string }) => x.extraction_status === 'pending' || x.extraction_status === 'failed')).toBe(true)
    expect(r[0].id).toBe('t29')
  })
  it('leaves out recipes that already have an answer waiting to be saved', () => {
    const r = nextRound(rows, 20, new Set(['t29', 't28']))
    expect(r[0].id).toBe('t27')
    expect(r.some((x: { id: string }) => x.id === 't29' || x.id === 't28')).toBe(false)
  })
})

describe('needsImage', () => {
  it('is true for a page with almost no text layer', () => {
    expect(needsImage('52')).toBe(true)
    expect(needsImage('Garn: Sunday 50 g = 235 m. '.repeat(20))).toBe(false)
  })
})

describe('saveAnswer', () => {
  const db = (status: string) => ({ status: vi.fn(async () => status), save: vi.fn(async () => 'saved') })

  it('saves a valid answer for a recipe not read yet, normalised as in the app, with the answer kept as raw', async () => {
    const d = db('failed')
    expect(await saveAnswer({ id: 'r1', answer: SIMULATED_ANSWER, pages: [1, 2] }, d)).toEqual({ id: 'r1', result: 'saved' })
    expect(d.save).toHaveBeenCalledWith('r1', { ...normalizeExtraction(SIMULATED_ANSWER), pages: [1, 2], raw: { source: 'claude-code', answer: SIMULATED_ANSWER } })
  })

  it('never saves over an approved or already read recipe', async () => {
    for (const s of ['approved', 'extracted', 'missing']) {
      const d = db(s)
      expect(await saveAnswer({ id: 'r1', answer: SIMULATED_ANSWER, pages: [] }, d)).toEqual({ id: 'r1', result: 'skipped', status: s })
      expect(d.save).not.toHaveBeenCalled()
    }
  })

  it('keeps the audience Maria filled in at upload over the one read from the PDF', async () => {
    const d = { ...db('pending'), audience: vi.fn(async () => 'child') }
    await saveAnswer({ id: 'r1', answer: SIMULATED_ANSWER, pages: [] }, d)
    expect(SIMULATED_ANSWER.audience).toBe('woman')
    expect(d.save).toHaveBeenCalledWith('r1', expect.objectContaining({ audience: 'child' }))
    const none = { ...db('pending'), audience: vi.fn(async () => null) }
    await saveAnswer({ id: 'r1', answer: SIMULATED_ANSWER, pages: [] }, none)
    expect(none.save).toHaveBeenCalledWith('r1', expect.objectContaining({ audience: 'woman' }))
  })

  it('refuses an answer that does not follow the schema, before looking at the database', async () => {
    const d = db('pending')
    const r = await saveAnswer({ id: 'r1', answer: { ...SIMULATED_ANSWER, audience: 'baby', sizes: 'S' }, pages: [] }, d)
    expect(r.result).toBe('invalid')
    expect(r.errors).toEqual(expect.arrayContaining(['$.audience: "baby" not in enum', '$.sizes: not an array']))
    expect(d.status).not.toHaveBeenCalled()
    expect(d.save).not.toHaveBeenCalled()
  })
})

describe('downloadFromDrive', () => {
  it('fetches the PDF from Drive with the token the app hands out', async () => {
    const calls: string[] = []
    const fake = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(url)
      if (url.endsWith('/api/strikk/token')) return new Response(JSON.stringify({ accessToken: 'tok' }))
      expect(init?.headers?.Authorization).toBe('Bearer tok')
      return new Response(new Uint8Array([37, 80, 68, 70]))
    })
    const bytes = await downloadFromDrive('file 1', fake as unknown as typeof fetch)
    expect([...bytes]).toEqual([37, 80, 68, 70])
    expect(calls).toEqual([`${APP_URL}/api/strikk/token`, 'https://www.googleapis.com/drive/v3/files/file%201?alt=media'])
  })
  it('says why when Drive cannot be reached', async () => {
    const expired = vi.fn(async () => new Response(JSON.stringify({ error: 'Disk-tilgangen har utløpt' }), { status: 401 }))
    await expect(downloadFromDrive('f', expired as unknown as typeof fetch)).rejects.toThrow('Disk-tilgangen har utløpt')
    const gone = vi.fn(async (url: string) => (url.endsWith('/token') ? new Response(JSON.stringify({ accessToken: 't' })) : new Response('', { status: 404 })))
    await expect(downloadFromDrive('f', gone as unknown as typeof fetch)).rejects.toThrow('Henting fra Disk feilet (404)')
  })
})
