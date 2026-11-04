// Strikk PDFs live in their own folder at the top of My Drive on the Strikk account.
//
// No googleapis or Supabase import here: the client imports KNIT_FOLDER_NAME, and the
// tests pass a fake for DriveFilesApi.

export const KNIT_FOLDER_NAME = 'Strikkoppskrifter søm og snitt'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

interface DriveFile {
  id?: string | null
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
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function folderQuery(name: string): string {
  return `name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`
}

async function listIds(files: DriveFilesApi, q: string): Promise<string[]> {
  const res = await files.list({ q, fields: 'files(id)', orderBy: 'createdTime', pageSize: 10 })
  return (res.data.files ?? []).map(f => f.id).filter((id): id is string => !!id)
}

// Searched by name, not by 'root' in parents, so uploads still find the folder if it is
// moved inside Drive. drive.file only sees folders this app created, so a folder of the
// same name made by hand is never picked up.
export async function getOrCreateTopLevelFolder(files: DriveFilesApi, name: string): Promise<string> {
  const existing = await listIds(files, folderQuery(name))
  if (existing.length > 0) return existing[0]

  const created = await files.create({ requestBody: { name, mimeType: FOLDER_MIME }, fields: 'id' })
  // Two tabs can both find nothing and both create. Re-listing oldest-first makes both
  // continue with the same folder; the other one stays empty.
  const after = await listIds(files, folderQuery(name))
  return after[0] ?? created.data.id!
}
