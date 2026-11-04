import { describe, it, expect } from 'vitest'
import {
  KNIT_FOLDER_NAME,
  childrenQuery,
  folderQuery,
  getOrCreateTopLevelFolder,
  migrateLegacyKnitFolder,
  type DriveFilesApi,
} from './knit-folder'

const FOLDER = 'application/vnd.google-apps.folder'

interface FakeFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  trashed: boolean
  created: number
}

// In-memory Drive that answers the two query shapes knit-folder.ts builds, pages at
// pageSize, and applies addParents/removeParents/trashed like files.update does.
// Removing a parent the file no longer has is a no-op here; how real Drive answers that
// is not verified, it only matters when two runs overlap.
function fakeDrive(initial: Omit<FakeFile, 'created'>[] = []) {
  let clock = 0
  let nextId = 1
  const files: FakeFile[] = initial.map(f => ({ ...f, created: clock++ }))
  const calls = { list: 0, create: 0, update: 0 }
  let failUpdateAfter = Infinity
  let afterUpdate: (() => void) | null = null

  const api: DriveFilesApi = {
    async list({ q, pageSize = 100, pageToken }) {
      calls.list++
      const byName = q.match(/^name = '((?:[^'\\]|\\.)*)' and mimeType = '([^']+)' and trashed = false$/)
      const byParent = q.match(/^'([^']+)' in parents$/)
      let hits: FakeFile[]
      if (byName) {
        const name = byName[1].replace(/\\(.)/g, '$1')
        hits = files.filter(f => f.name === name && f.mimeType === byName[2] && !f.trashed)
      } else if (byParent) {
        hits = files.filter(f => f.parents.includes(byParent[1]))
      } else {
        throw new Error(`fake drive: unexpected q ${q}`)
      }
      hits.sort((a, b) => a.created - b.created)
      const start = pageToken ? Number(pageToken) : 0
      const page = hits.slice(start, start + pageSize)
      const more = start + pageSize < hits.length
      return { data: { files: page.map(f => ({ id: f.id, parents: [...f.parents] })), nextPageToken: more ? String(start + pageSize) : null } }
    },
    async create({ requestBody }) {
      calls.create++
      const id = `new-${nextId++}`
      files.push({ id, name: requestBody.name, mimeType: requestBody.mimeType, parents: ['root'], trashed: false, created: clock++ })
      return { data: { id } }
    },
    async update({ fileId, addParents, removeParents, requestBody }) {
      if (calls.update >= failUpdateAfter) throw new Error('simulated Drive 500')
      calls.update++
      const f = files.find(x => x.id === fileId)
      if (!f) throw new Error(`fake drive: 404 ${fileId}`)
      if (removeParents) f.parents = f.parents.filter(p => p !== removeParents)
      if (addParents && !f.parents.includes(addParents)) f.parents.push(addParents)
      if (requestBody) f.trashed = requestBody.trashed
      afterUpdate?.()
      return { data: { id: fileId } }
    },
  }
  return {
    api,
    files,
    calls,
    failUpdatesAfter(n: number) { failUpdateAfter = n },
    onUpdate(fn: (() => void) | null) { afterUpdate = fn },
    byId: (id: string) => files.find(f => f.id === id)!,
  }
}

const pdf = (id: string, parent: string, trashed = false) =>
  ({ id, name: `${id}.pdf`, mimeType: 'application/pdf', parents: [parent], trashed })
const folder = (id: string, name: string, parent = 'root') =>
  ({ id, name, mimeType: FOLDER, parents: [parent], trashed: false })

// The layout the deployed app has today: Søm og Snitt/Strikk with recipe and prototype
// PDFs, plus the sewing folders that must not be touched.
function currentLayout() {
  return fakeDrive([
    folder('sos', 'Søm og Snitt'),
    folder('strikk', 'Strikk', 'sos'),
    folder('kvitt', 'Kvitteringer', 'sos'),
    pdf('recipe-1', 'strikk'),
    pdf('recipe-2', 'strikk'),
    pdf('prototype-1', 'strikk'),
    pdf('old-bin', 'strikk', true),
    pdf('kvittering-1', 'kvitt'),
    pdf('sy-oppskrift', 'sos'),
  ])
}

describe('queries', () => {
  it('escapes apostrophes and backslashes in folder names', () => {
    expect(folderQuery("O'Brien\\x")).toBe(
      `name = 'O\\'Brien\\\\x' and mimeType = '${FOLDER}' and trashed = false`,
    )
  })

  it('lists children without a trashed filter', () => {
    expect(childrenQuery('abc')).toBe("'abc' in parents")
  })
})

describe('getOrCreateTopLevelFolder', () => {
  it('creates the folder in My Drive when it is missing', async () => {
    const d = fakeDrive()
    const id = await getOrCreateTopLevelFolder(d.api, KNIT_FOLDER_NAME)
    expect(d.byId(id)).toMatchObject({ name: KNIT_FOLDER_NAME, parents: ['root'], mimeType: FOLDER })
    expect(d.calls.create).toBe(1)
  })

  it('reuses the oldest existing folder and creates nothing', async () => {
    const d = fakeDrive([folder('a', KNIT_FOLDER_NAME), folder('b', KNIT_FOLDER_NAME)])
    expect(await getOrCreateTopLevelFolder(d.api, KNIT_FOLDER_NAME)).toBe('a')
    expect(d.calls.create).toBe(0)
  })

  it('does not match a Strikk subfolder or the Søm og Snitt root', async () => {
    const d = currentLayout()
    const id = await getOrCreateTopLevelFolder(d.api, KNIT_FOLDER_NAME)
    expect(['sos', 'strikk']).not.toContain(id)
  })
})

describe('migrateLegacyKnitFolder', () => {
  it('moves every file out of Søm og Snitt/Strikk and bins the empty folder', async () => {
    const d = currentLayout()
    const result = await migrateLegacyKnitFolder(d.api)

    expect(result.moved).toBe(4)
    expect(result.trashedFolders).toBe(1)
    const target = d.byId(result.folderId!)
    expect(target).toMatchObject({ name: KNIT_FOLDER_NAME, parents: ['root'], trashed: false })
    for (const id of ['recipe-1', 'recipe-2', 'prototype-1', 'old-bin']) {
      expect(d.byId(id).parents).toEqual([result.folderId])
    }
    // Same IDs as before, so drive_file_id rows still resolve.
    expect(d.files.filter(f => f.mimeType === 'application/pdf').map(f => f.id).sort())
      .toEqual(['kvittering-1', 'old-bin', 'prototype-1', 'recipe-1', 'recipe-2', 'sy-oppskrift'])
    expect(d.byId('old-bin').trashed).toBe(true)
    expect(d.byId('strikk').trashed).toBe(true)
  })

  it('leaves the sewing folders and files alone', async () => {
    const d = currentLayout()
    await migrateLegacyKnitFolder(d.api)
    expect(d.byId('sos')).toMatchObject({ parents: ['root'], trashed: false })
    expect(d.byId('kvitt')).toMatchObject({ parents: ['sos'], trashed: false })
    expect(d.byId('kvittering-1').parents).toEqual(['kvitt'])
    expect(d.byId('sy-oppskrift').parents).toEqual(['sos'])
  })

  it('does nothing on the second run', async () => {
    const d = currentLayout()
    const first = await migrateLegacyKnitFolder(d.api)
    const before = { ...d.calls }

    const second = await migrateLegacyKnitFolder(d.api)

    expect(second).toEqual({ moved: 0, trashedFolders: 0, folderId: null })
    expect(d.calls.create).toBe(before.create)
    expect(d.calls.update).toBe(before.update)
    expect(d.calls.list - before.list).toBe(1)
    expect(d.files.filter(f => f.name === KNIT_FOLDER_NAME)).toHaveLength(1)
    expect(d.byId('recipe-1').parents).toEqual([first.folderId])
  })

  it('creates no folder when there is nothing to move', async () => {
    const d = fakeDrive([folder('sos', 'Søm og Snitt'), pdf('sy-oppskrift', 'sos')])
    expect(await migrateLegacyKnitFolder(d.api)).toEqual({ moved: 0, trashedFolders: 0, folderId: null })
    expect(d.calls).toEqual({ list: 1, create: 0, update: 0 })
  })

  it('ignores a Strikk folder that is not under Søm og Snitt', async () => {
    const d = fakeDrive([folder('sos', 'Søm og Snitt'), folder('other', 'Strikk', 'root'), pdf('x', 'other')])
    expect(await migrateLegacyKnitFolder(d.api)).toEqual({ moved: 0, trashedFolders: 0, folderId: null })
    expect(d.byId('x').parents).toEqual(['other'])
    expect(d.calls.create).toBe(0)
  })

  it('reuses a folder that new uploads already created', async () => {
    const d = currentLayout()
    d.files.push({ ...folder('existing', KNIT_FOLDER_NAME), created: -1 })
    d.files.push({ ...pdf('fresh', 'existing'), created: 100 })
    const result = await migrateLegacyKnitFolder(d.api)
    expect(result.folderId).toBe('existing')
    expect(d.calls.create).toBe(0)
    expect(d.byId('recipe-1').parents).toEqual(['existing'])
    expect(d.byId('fresh').parents).toEqual(['existing'])
  })

  it('finishes on the next run after failing half way', async () => {
    const d = currentLayout()
    d.failUpdatesAfter(2)
    await expect(migrateLegacyKnitFolder(d.api)).rejects.toThrow('simulated Drive 500')
    expect(d.byId('strikk').trashed).toBe(false)
    expect(d.files.filter(f => f.parents.includes('strikk'))).toHaveLength(2)

    d.failUpdatesAfter(Infinity)
    const result = await migrateLegacyKnitFolder(d.api)

    expect(result.moved).toBe(2)
    expect(result.trashedFolders).toBe(1)
    expect(d.files.filter(f => f.parents.includes('strikk'))).toHaveLength(0)
    expect(d.files.filter(f => f.name === KNIT_FOLDER_NAME)).toHaveLength(1)
    for (const id of ['recipe-1', 'recipe-2', 'prototype-1', 'old-bin']) {
      expect(d.byId(id).parents).toEqual([result.folderId])
    }
  })

  it('keeps the old folder when a file lands in it during the run, and moves it next time', async () => {
    const d = currentLayout()
    d.onUpdate(() => {
      d.files.push({ ...pdf('late', 'strikk'), created: 99 })
      d.onUpdate(null)
    })
    const first = await migrateLegacyKnitFolder(d.api)
    expect(first.trashedFolders).toBe(0)
    expect(d.byId('strikk').trashed).toBe(false)
    expect(d.byId('late').parents).toEqual(['strikk'])

    const second = await migrateLegacyKnitFolder(d.api)
    expect(second).toMatchObject({ moved: 1, trashedFolders: 1, folderId: first.folderId })
    expect(d.byId('late').parents).toEqual([first.folderId])
  })

  it('handles more than one page of files', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => pdf(`p${i}`, 'strikk'))
    const d = fakeDrive([folder('sos', 'Søm og Snitt'), folder('strikk', 'Strikk', 'sos'), ...many])
    const result = await migrateLegacyKnitFolder(d.api)
    expect(result.moved).toBe(2500)
    expect(result.trashedFolders).toBe(1)
  })

  it('moves duplicate Strikk folders into the same new folder', async () => {
    const d = fakeDrive([
      folder('sos', 'Søm og Snitt'),
      folder('s1', 'Strikk', 'sos'),
      folder('s2', 'Strikk', 'sos'),
      pdf('a', 's1'),
      pdf('b', 's2'),
    ])
    const result = await migrateLegacyKnitFolder(d.api)
    expect(result).toMatchObject({ moved: 2, trashedFolders: 2 })
    expect(d.byId('a').parents).toEqual([result.folderId])
    expect(d.byId('b').parents).toEqual([result.folderId])
  })

  it('two overlapping runs end with every file in one folder', async () => {
    const d = currentLayout()
    const [a, b] = await Promise.all([migrateLegacyKnitFolder(d.api), migrateLegacyKnitFolder(d.api)])
    const live = d.files.filter(f => f.name === KNIT_FOLDER_NAME)
    expect(a.folderId).toBe(b.folderId)
    for (const id of ['recipe-1', 'recipe-2', 'prototype-1', 'old-bin']) {
      expect(d.byId(id).parents).toEqual([a.folderId])
    }
    expect(d.byId('strikk').trashed).toBe(true)
    // A second, empty folder can be left over when both runs create at the same time.
    expect(live.length).toBeLessThanOrEqual(2)
  })
})
