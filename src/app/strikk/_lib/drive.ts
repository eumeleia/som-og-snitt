// Browser-side Drive access for Strikk, copied from the prototype so that can be deleted
// on its own. Bytes never pass through a Vercel function
// in either direction: upload PUTs straight to a resumable session URL, download fetches
// files/{id}?alt=media with a short-lived token from /api/strikk/token.

import { KNIT_FOLDER_NAME } from '@/lib/knit-folder'

export class DriveAuthExpiredError extends Error {
  constructor() {
    super('Disk-tilgangen har utløpt')
  }
}

export async function getAccessToken(): Promise<string> {
  const res = await fetch('/api/strikk/token', { cache: 'no-store' })
  const body = await res.json().catch(() => ({})) as { accessToken?: string; error?: string; code?: string }
  if (body.code === 'DRIVE_AUTH_EXPIRED') throw new DriveAuthExpiredError()
  if (!res.ok || !body.accessToken) throw new Error(body.error ?? `Token feilet (${res.status})`)
  return body.accessToken
}

export async function downloadPdf(fileId: string, fileName: string): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken()
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    )
    if (res.status === 401 && attempt === 0) continue
    if (res.status === 404) {
      throw new Error(`Fant ikke «${fileName}» på Disk (404). Filen kan være slettet eller ligge i papirkurven.`)
    }
    if (!res.ok) throw new Error(`Henting fra Disk feilet (${res.status})`)
    return new Uint8Array(await res.arrayBuffer())
  }
  throw new Error('Henting fra Disk feilet (401)')
}

let migration: Promise<void> | null = null

// Moves PDFs from the old «Søm og Snitt/Strikk» folder, once per page load. Failures are
// ignored: the next visit tries again, and opening a recipe works wherever the file is.
export function migrateLegacyFolder(): Promise<void> {
  migration ??= fetch('/api/strikk/migrate-folder', { method: 'POST', cache: 'no-store' })
    .then(() => undefined, () => undefined)
  return migration
}

// Same flow as the recipe upload in dashboard/recipes/page.tsx: the PUT response may be
// unreadable (CORS), so file-by-name is the backstop.
export async function uploadPdf(file: File): Promise<string> {
  // Fails fast with DriveAuthExpiredError before anything is created in Drive.
  await getAccessToken()
  // Otherwise an upload right after opening the page could create the new folder at the
  // same moment as the migration does.
  await migrateLegacyFolder()

  const ensureRes = await fetch('/api/drive/ensure-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderName: KNIT_FOLDER_NAME, topLevel: true }),
  })
  if (!ensureRes.ok) throw new Error(`Fant ikke strikkemappen på Disk (${ensureRes.status})`)
  const { folderId } = await ensureRes.json() as { folderId: string }

  const sessionRes = await fetch('/api/drive/upload-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, mimeType: 'application/pdf', folderId }),
  })
  if (!sessionRes.ok) throw new Error(`Kunne ikke starte opplasting (${sessionRes.status})`)
  const { uploadUrl, sessionStartetVed } = await sessionRes.json() as {
    uploadUrl: string
    sessionStartetVed: number
  }

  try {
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    })
    if (!putRes.ok) throw new Error(`Opplasting feilet (${putRes.status})`)
    const body = await putRes.json() as { id?: string }
    if (body.id) return body.id
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Opplasting feilet')) throw err
    // Opaque TypeError: CORS or network, indistinguishable here. Fall through to the lookup.
  }

  const lookupRes = await fetch('/api/drive/file-by-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, folderId, sessionStartetVed }),
  })
  if (!lookupRes.ok) throw new Error('Fant ikke den opplastede filen på Disk')
  const { fileId } = await lookupRes.json() as { fileId?: string }
  if (!fileId) throw new Error('Fant ikke den opplastede filen på Disk')
  return fileId
}
