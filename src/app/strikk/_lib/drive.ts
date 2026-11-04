// Browser-side Drive access for Strikk, on Strikk's own Drive connection. Bytes never
// pass through a Vercel function in either direction: upload PUTs straight to a
// resumable session URL, download fetches files/{id}?alt=media with a short-lived token
// from /api/strikk/token.

export class DriveAuthExpiredError extends Error {
  constructor() {
    super('Strikk er ikke koblet til Disk, eller tilgangen har utløpt')
  }
}

// The Strikk account cannot see the file: it is in the private Drive, deleted or binned.
export class DriveFileMissingError extends Error {
  constructor(fileName: string) {
    super(`Fant ikke «${fileName}» i Disken til Strikk. Filen kan ligge i den private Disken, være slettet eller ligge i papirkurven.`)
  }
}

export interface StrikkDriveFile {
  id: string
  sha256: string | null
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
    if (res.status === 404) throw new DriveFileMissingError(fileName)
    if (!res.ok) throw new Error(`Henting fra Disk feilet (${res.status})`)
    return new Uint8Array(await res.arrayBuffer())
  }
  throw new Error('Henting fra Disk feilet (401)')
}

export async function listDriveFiles(): Promise<StrikkDriveFile[]> {
  const res = await fetch('/api/strikk/drive/files', { cache: 'no-store' })
  const body = await res.json().catch(() => ({})) as { files?: StrikkDriveFile[]; error?: string; code?: string }
  if (body.code === 'DRIVE_AUTH_EXPIRED') throw new DriveAuthExpiredError()
  if (!res.ok || !body.files) throw new Error(body.error ?? `Henting av fil-listen feilet (${res.status})`)
  return body.files
}

let nameSync: Promise<{ id: string; file_name: string }[]> | null = null

// Renames Drive files whose name does not match their recipe, once per page load.
// Failures are left for the next visit.
export function syncDriveNames(): Promise<{ id: string; file_name: string }[]> {
  nameSync ??= fetch('/api/strikk/drive/sync-names', { method: 'POST', cache: 'no-store' })
    .then(r => (r.ok ? r.json() : { renamed: [] }))
    .then((b: { renamed?: { id: string; file_name: string }[] }) => b.renamed ?? [], () => [])
  return nameSync
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

async function postJson<T>(url: string, payload: unknown): Promise<{ res: Response; body: T & { error?: string; code?: string } }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({})) as T & { error?: string; code?: string }
  if (body.code === 'DRIVE_AUTH_EXPIRED') throw new DriveAuthExpiredError()
  return { res, body }
}

// Same flow as the recipe upload in dashboard/recipes/page.tsx: the PUT response may be
// unreadable (CORS), so file-by-name is the backstop.
export async function uploadPdf(file: File): Promise<string> {
  const session = await postJson<{ uploadUrl: string; folderId: string; sessionStartetVed: number }>(
    '/api/strikk/drive/upload-session',
    { fileName: file.name },
  )
  if (!session.res.ok) throw new Error(session.body.error ?? `Kunne ikke starte opplasting (${session.res.status})`)
  const { uploadUrl, folderId, sessionStartetVed } = session.body

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

  const lookup = await postJson<{ fileId?: string }>(
    '/api/strikk/drive/file-by-name',
    { fileName: file.name, folderId, sessionStartetVed },
  )
  if (!lookup.res.ok || !lookup.body.fileId) throw new Error('Fant ikke den opplastede filen på Disk')
  return lookup.body.fileId
}
