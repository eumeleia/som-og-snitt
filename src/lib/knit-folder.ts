// Strikk PDFs live in their own folder at the top of My Drive. They used to go to
// «Søm og Snitt/Strikk»; migrateLegacyKnitFolder moves them over. Moving keeps the file
// ID, so drive_file_id in strikk_oppskrift and strikk_prototype stays valid.
//
// No googleapis or Supabase import here: the client imports KNIT_FOLDER_NAME, and the
// tests pass a fake for DriveFilesApi.

export const KNIT_FOLDER_NAME = 'Strikkoppskrifter søm og snitt'
const LEGACY_PARENT_NAME = 'Søm og Snitt'
const LEGACY_FOLDER_NAME = 'Strikk'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface DriveFile {
  id?: string | null
  parents?: string[] | null
}

// The subset of drive_v3.Resource$Files used here; google.drive(...).files satisfies it.
export interface DriveFilesApi {
  list(params: {
    q: string
    fields: string
    orderBy?: string
    pageSize?: number
    pageToken?: string
  }): Promise<{ data: { files?: DriveFile[] | null; nextPageToken?: string | null } }>
  create(params: {
    requestBody: { name: string; mimeType: string }
    fields: string
  }): Promise<{ data: { id?: string | null } }>
  update(params: {
    fileId: string
    addParents?: string
    removeParents?: string
    requestBody?: { trashed: boolean }
    fields: string
  }): Promise<unknown>
}

export interface MigrationResult {
  moved: number
  trashedFolders: number
  folderId: string | null
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function folderQuery(name: string): string {
  return `name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`
}

// No trashed filter on purpose: a PDF already in the bin still has the old folder as
// parent, and the folder only counts as empty once nothing at all points to it.
export function childrenQuery(folderId: string): string {
  return `${quote(folderId)} in parents`
}

async function listAll(files: DriveFilesApi, q: string, fields: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const res = await files.list({
      q,
      fields: `nextPageToken, files(${fields})`,
      orderBy: 'createdTime',
      pageSize: 1000,
      pageToken,
    })
    out.push(...(res.data.files ?? []))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out.filter(f => f.id)
}

// Searched by name, not by 'root' in parents, so uploads still find the folder if it is
// moved inside Drive. drive.file only sees folders this app created, so a folder of the
// same name made by hand is never picked up.
export async function getOrCreateTopLevelFolder(files: DriveFilesApi, name: string): Promise<string> {
  const existing = await listAll(files, folderQuery(name), 'id')
  if (existing.length > 0) return existing[0].id!

  const created = await files.create({ requestBody: { name, mimeType: FOLDER_MIME }, fields: 'id' })
  // Two tabs can both find nothing and both create. Re-listing oldest-first makes both
  // continue with the same folder; the other one stays empty.
  const after = await listAll(files, folderQuery(name), 'id')
  return after[0]?.id ?? created.data.id!
}

// Safe to run any number of times: once the old folders are in the bin it finds nothing
// and writes nothing. A run that stops half way is finished by the next one.
export async function migrateLegacyKnitFolder(files: DriveFilesApi): Promise<MigrationResult> {
  const legacy = await listAll(files, folderQuery(LEGACY_FOLDER_NAME), 'id, parents')
  if (legacy.length === 0) return { moved: 0, trashedFolders: 0, folderId: null }

  const roots = new Set((await listAll(files, folderQuery(LEGACY_PARENT_NAME), 'id')).map(f => f.id!))
  const targets = legacy.filter(f => f.parents?.some(p => roots.has(p)))
  if (targets.length === 0) return { moved: 0, trashedFolders: 0, folderId: null }

  const folderId = await getOrCreateTopLevelFolder(files, KNIT_FOLDER_NAME)
  let moved = 0
  let trashedFolders = 0

  for (const folder of targets) {
    for (const child of await listAll(files, childrenQuery(folder.id!), 'id')) {
      await files.update({ fileId: child.id!, addParents: folderId, removeParents: folder.id!, fields: 'id' })
      moved++
    }
    // Bin, not permanent delete: if a file slipped in after the listing above, deleting
    // the folder for good would take that file with it.
    const left = await listAll(files, childrenQuery(folder.id!), 'id')
    if (left.length === 0) {
      await files.update({ fileId: folder.id!, requestBody: { trashed: true }, fields: 'id' })
      trashedFolders++
    }
  }

  return { moved, trashedFolders, folderId }
}
