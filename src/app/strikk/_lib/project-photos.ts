// Photos of a finished project (strikk_project_photo, migration 030). The photo with the
// lowest position is the cover. Files are in the strikk-covers bucket, compressed in the
// browser to under 200 kB with compressCover.
import { COVER_BUCKET } from './projects'

export interface ProjectPhoto {
  id: string
  project_id: string
  path: string
  position: number
  created_at: string
}

export const PHOTO_SELECT = 'id, project_id, path, position, created_at'
export const MIGRATION_030 = 'Bilder krever migrasjon 030 (strikk_project_photo). Kjør den i Supabase først.'

// Postgres «relation does not exist», or PostgREST not finding the table in its schema cache.
export function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  return err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|does not exist/i.test(err.message ?? '')
}

export function photoUrl(path: string, base = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!base) return null
  return `${base}/storage/v1/object/public/${COVER_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export function sortPhotos<T extends Pick<ProjectPhoto, 'position' | 'created_at'>>(photos: T[]): T[] {
  return [...photos].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
}

export function coverPhoto<T extends Pick<ProjectPhoto, 'position' | 'created_at'>>(photos: T[]): T | null {
  return sortPhotos(photos)[0] ?? null
}

// A new photo goes last; «Gjør til forsidebilde» puts a photo before all the others.
export const nextPosition = (photos: Pick<ProjectPhoto, 'position'>[]) =>
  photos.length ? Math.max(...photos.map(p => p.position)) + 1 : 0
export const frontPosition = (photos: Pick<ProjectPhoto, 'position'>[]) =>
  photos.length ? Math.min(...photos.map(p => p.position)) - 1 : 0

async function call<T>(url: string, init: RequestInit, fail: string): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `${fail} (${res.status})`)
  return body as T
}

export const uploadPhoto = (projectId: string, blob: Blob) =>
  call<ProjectPhoto>(`/api/strikk/projects/${projectId}/photos`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }, 'Bildet ble ikke lagret')

export const deletePhoto = (projectId: string, photoId: string) =>
  call<{ ok: true }>(`/api/strikk/projects/${projectId}/photos/${photoId}`, { method: 'DELETE' }, 'Bildet ble ikke slettet')

export const makeCoverPhoto = (projectId: string, photoId: string) =>
  call<ProjectPhoto>(`/api/strikk/projects/${projectId}/photos/${photoId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cover: true }),
  }, 'Forsidebildet ble ikke lagret')
