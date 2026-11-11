// Cover pictures for Strikk › Prosjekter: a photo from the phone, made smaller in the
// browser until it is under 200 kB, and the URL of whatever picture a project shows.
import { encodeUnder } from './thumbnail'
import { COVER_BUCKET, COVER_MAX_BYTES, type ProjectListRow } from './projects'
import { thumbnailUrl } from './recipes'

// Longest side tried in turn; a smaller picture needs less JPEG quality loss to fit.
export const COVER_SIDES = [1600, 1200, 900, 600]

export function fitInside(width: number, height: number, longest: number): { width: number; height: number } {
  const scale = Math.min(1, longest / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

// Tries each size from largest to smallest, and the qualities encodeUnder tries at each.
export async function shrinkUnder(max: number, encodeAt: (side: number, quality: number) => Promise<Blob | null>, sides = COVER_SIDES): Promise<Blob> {
  let last: unknown = null
  for (const side of sides) {
    try {
      return await encodeUnder(max, q => encodeAt(side, q))
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error('Klarte ikke gjøre bildet lite nok')
}

// A photo as a bitmap, the right way up. Falls back to an <img> for formats
// createImageBitmap does not read.
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const b = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: b, width: b.width, height: b.height, close: () => b.close() }
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
    } catch {
      URL.revokeObjectURL(url)
      throw new Error('Klarte ikke lese bildet. Velg et JPEG- eller PNG-bilde.')
    }
  }
}

export async function compressCover(file: File): Promise<Blob> {
  const img = await decode(file)
  const canvas = document.createElement('canvas')
  try {
    return await shrinkUnder(COVER_MAX_BYTES, (side, quality) => {
      const size = fitInside(img.width, img.height, side)
      canvas.width = size.width
      canvas.height = size.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size.width, size.height)
      ctx.drawImage(img.source, 0, 0, size.width, size.height)
      return new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
    })
  } finally {
    img.close()
    canvas.width = 0
    canvas.height = 0
  }
}

export async function uploadCover(projectId: string, blob: Blob): Promise<{ cover_path: string; cover_at: string }> {
  const res = await fetch(`/api/strikk/projects/${projectId}/cover`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Bildet ble ikke lagret (${res.status})`)
  return body
}

export async function removeCover(projectId: string): Promise<void> {
  const res = await fetch(`/api/strikk/projects/${projectId}/cover`, { method: 'DELETE' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Bildet ble ikke fjernet (${res.status})`)
}

// The project's own picture, or else the first page of its recipe; null for neither.
export function coverUrl(
  p: Pick<ProjectListRow, 'cover_path' | 'cover_at'> & { strikk_oppskrift?: ProjectListRow['strikk_oppskrift'] },
  base = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (p.cover_path && base) {
    const v = p.cover_at ? `?v=${Date.parse(p.cover_at)}` : ''
    return `${base}/storage/v1/object/public/${COVER_BUCKET}/${encodeURIComponent(p.cover_path)}${v}`
  }
  return p.strikk_oppskrift ? thumbnailUrl(p.strikk_oppskrift, base) : null
}
