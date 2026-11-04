import { describe, it, expect } from 'vitest'
import { KNIT_FOLDER_NAME, folderQuery, getOrCreateTopLevelFolder, type DriveFilesApi } from './knit-folder'

const FOLDER = 'application/vnd.google-apps.folder'

interface FakeFolder { id: string; name: string; created: number }

// In-memory Drive that answers folderQuery's shape, oldest first.
function fakeDrive(initial: { id: string; name: string }[] = []) {
  let clock = 0
  let nextId = 1
  const folders: FakeFolder[] = initial.map(f => ({ ...f, created: clock++ }))
  const calls = { list: 0, create: 0 }
  const api: DriveFilesApi = {
    async list({ q }) {
      calls.list++
      const m = q.match(/^name = '((?:[^'\\]|\\.)*)' and mimeType = '([^']+)' and trashed = false$/)
      if (!m || m[2] !== FOLDER) throw new Error(`fake drive: unexpected q ${q}`)
      const name = m[1].replace(/\\(.)/g, '$1')
      const hits = folders.filter(f => f.name === name).sort((a, b) => a.created - b.created)
      return { data: { files: hits.map(f => ({ id: f.id })) } }
    },
    async create({ requestBody }) {
      calls.create++
      const id = `new-${nextId++}`
      folders.push({ id, name: requestBody.name, created: clock++ })
      return { data: { id } }
    },
  }
  return { api, folders, calls }
}

describe('folderQuery', () => {
  it('escapes apostrophes and backslashes in folder names', () => {
    expect(folderQuery("O'Brien\\x")).toBe(
      `name = 'O\\'Brien\\\\x' and mimeType = '${FOLDER}' and trashed = false`,
    )
  })
})

describe('getOrCreateTopLevelFolder', () => {
  it('creates the folder when it is missing', async () => {
    const d = fakeDrive()
    const id = await getOrCreateTopLevelFolder(d.api, KNIT_FOLDER_NAME)
    expect(d.folders.find(f => f.id === id)?.name).toBe(KNIT_FOLDER_NAME)
    expect(d.calls.create).toBe(1)
  })

  it('reuses the oldest existing folder and creates nothing', async () => {
    const d = fakeDrive([{ id: 'a', name: KNIT_FOLDER_NAME }, { id: 'b', name: KNIT_FOLDER_NAME }])
    expect(await getOrCreateTopLevelFolder(d.api, KNIT_FOLDER_NAME)).toBe('a')
    expect(d.calls.create).toBe(0)
  })

  it('two overlapping calls end on the same folder', async () => {
    const d = fakeDrive()
    const [a, b] = await Promise.all([
      getOrCreateTopLevelFolder(d.api, KNIT_FOLDER_NAME),
      getOrCreateTopLevelFolder(d.api, KNIT_FOLDER_NAME),
    ])
    expect(a).toBe(b)
  })
})
