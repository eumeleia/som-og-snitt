import { describe, it, expect, vi } from 'vitest'
import { runUploadBatch, type KnownFiles, type UploadDeps } from './upload'
import { parseRecipeFileName } from './recipes'

interface Row { id: string; title: string; designer: string | null; drive_file_id: string }

// Simulated Drive + recipe table. Content is the file's text, hashed as `h:<text>`.
function fakeBackend(opts: { failUpload?: Set<string>; failRow?: Set<string> } = {}) {
  let nextId = 1
  const drive = new Map<string, string>() // fileId → content
  const rows: Row[] = []
  const deps: UploadDeps<Row> = {
    hash: vi.fn(async (f: File) => `h:${await f.text()}`),
    upload: vi.fn(async (f: File) => {
      if (opts.failUpload?.has(f.name)) throw new Error(`Opplasting feilet (500) for ${f.name}`)
      const id = `drive-${nextId++}`
      drive.set(id, await f.text())
      return id
    }),
    createRow: vi.fn(async (driveFileId: string, fileName: string) => {
      if (opts.failRow?.has(fileName)) throw new Error('Klarte ikke lagre oppskriften')
      const { title, designer } = parseRecipeFileName(fileName)
      const row = { id: `row-${rows.length + 1}`, title, designer, drive_file_id: driveFileId }
      rows.push(row)
      return row
    }),
  }
  return { deps, drive, rows }
}

const pdf = (name: string, content = name) => new File([content], name, { type: 'application/pdf' })
const empty = (): KnownFiles => ({ byHash: new Map(), withRow: new Set() })

describe('parseRecipeFileName', () => {
  it('splits «Navn - Designer.pdf» into title and designer', () => {
    expect(parseRecipeFileName('Friday Sweater Mini - PetiteKnit.pdf'))
      .toEqual({ title: 'Friday Sweater Mini', designer: 'PetiteKnit' })
  })
  it('keeps a name without designer as title only', () => {
    expect(parseRecipeFileName('Tusseladd genser.pdf')).toEqual({ title: 'Tusseladd genser', designer: null })
  })
  it('splits on the last dash', () => {
    expect(parseRecipeFileName('Puf - Pandababy - PifPaf.pdf'))
      .toEqual({ title: 'Puf - Pandababy', designer: 'PifPaf' })
  })
  it('does not split on a dash without spaces', () => {
    expect(parseRecipeFileName('Mette-Marit kofte.PDF')).toEqual({ title: 'Mette-Marit kofte', designer: null })
  })
})

describe('runUploadBatch', () => {
  it('uploads 20 files chosen at once, one at a time, with title and designer from the name', async () => {
    const { deps, rows, drive } = fakeBackend()
    const files = Array.from({ length: 20 }, (_, i) => pdf(`Oppskrift ${i + 1} - Designer ${i + 1}.pdf`))
    const progress: number[] = []
    let inFlight = 0
    let maxInFlight = 0
    const upload = deps.upload
    deps.upload = async f => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      try { return await upload(f) } finally { inFlight-- }
    }

    const results = await runUploadBatch(files, empty(), deps, p => progress.push(p.done))

    expect(results.map(r => r.status)).toEqual(Array(20).fill('uploaded'))
    expect(rows).toHaveLength(20)
    expect(drive.size).toBe(20)
    expect(rows[6]).toMatchObject({ title: 'Oppskrift 7', designer: 'Designer 7' })
    expect(maxInFlight).toBe(1)
    expect(progress.at(-1)).toBe(20)
  })

  it('a file uploaded twice ends up once in the list', async () => {
    const { deps, rows, drive } = fakeBackend()
    const known = empty()
    await runUploadBatch([pdf('Iris - Camilla Pihl.pdf', 'X')], known, deps)
    const again = await runUploadBatch([pdf('Iris - Camilla Pihl.pdf', 'X')], known, deps)
    expect(again[0].status).toBe('skipped')
    expect(rows).toHaveLength(1)
    expect(drive.size).toBe(1)
  })

  it('skips the same content twice within one batch, even under another name', async () => {
    const { deps, rows } = fakeBackend()
    const results = await runUploadBatch([pdf('a.pdf', 'same'), pdf('b.pdf', 'same')], empty(), deps)
    expect(results.map(r => r.status)).toEqual(['uploaded', 'skipped'])
    expect(rows).toHaveLength(1)
  })

  it('skips content already in Drive with a row, from an earlier visit', async () => {
    const { deps, rows } = fakeBackend()
    const known: KnownFiles = { byHash: new Map([['h:old', 'drive-old']]), withRow: new Set(['drive-old']) }
    const results = await runUploadBatch([pdf('Gammel.pdf', 'old')], known, deps)
    expect(results[0].status).toBe('skipped')
    expect(deps.upload).not.toHaveBeenCalled()
    expect(rows).toHaveLength(0)
  })

  it('resumes an interrupted run: a file in Drive without a row gets its row, not a second upload', async () => {
    const { deps, rows } = fakeBackend()
    const known: KnownFiles = { byHash: new Map([['h:half', 'drive-half']]), withRow: new Set() }
    const results = await runUploadBatch([pdf('Halvveis - Noen.pdf', 'half')], known, deps)
    expect(results[0].status).toBe('linked')
    expect(deps.upload).not.toHaveBeenCalled()
    expect(rows[0]).toMatchObject({ drive_file_id: 'drive-half', title: 'Halvveis', designer: 'Noen' })
  })

  it('when one file fails the rest are uploaded, and the failed one can be retried', async () => {
    const failUpload = new Set(['3.pdf'])
    const { deps, rows } = fakeBackend({ failUpload })
    const known = empty()
    const files = ['1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf'].map(n => pdf(n))

    const first = await runUploadBatch(files, known, deps)
    expect(first.map(r => r.status)).toEqual(['uploaded', 'uploaded', 'failed', 'uploaded', 'uploaded'])
    expect(first[2].error).toContain('500')
    expect(rows).toHaveLength(4)

    failUpload.clear()
    const retry = await runUploadBatch(first.filter(r => r.status === 'failed').map(r => r.file), known, deps)
    expect(retry.map(r => r.status)).toEqual(['uploaded'])
    expect(rows).toHaveLength(5)
  })

  it('a row that failed after the upload is retried without uploading again', async () => {
    const failRow = new Set(['x.pdf'])
    const { deps, rows, drive } = fakeBackend({ failRow })
    const known = empty()
    const first = await runUploadBatch([pdf('x.pdf')], known, deps)
    expect(first[0].status).toBe('failed')
    expect(drive.size).toBe(1)

    failRow.clear()
    const retry = await runUploadBatch([first[0].file], known, deps)
    expect(retry[0].status).toBe('linked')
    expect(drive.size).toBe(1)
    expect(rows).toHaveLength(1)
  })

  it('stops on a fatal error and marks the rest failed', async () => {
    const { deps } = fakeBackend()
    class Expired extends Error {}
    deps.upload = vi.fn(async () => { throw new Expired('Disk-tilgangen har utløpt') })
    deps.isFatal = err => err instanceof Expired
    const results = await runUploadBatch([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')], empty(), deps)
    expect(results.map(r => r.status)).toEqual(['failed', 'failed', 'failed'])
    expect(deps.upload).toHaveBeenCalledTimes(1)
  })
})
