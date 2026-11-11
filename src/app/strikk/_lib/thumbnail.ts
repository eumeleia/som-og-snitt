// First-page pictures for Strikk › Oppskrifter, made in the browser with pdf.js: at upload
// from the file, and the first time a recipe without one is opened.
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { THUMBNAIL_MAX_BYTES, type KnitRecipe } from './recipes'

export const THUMBNAIL_WIDTH = 240
const QUALITIES = [0.75, 0.65, 0.55, 0.45, 0.35, 0.25]

// The first encoding at or under max bytes, trying lower JPEG quality each time.
export async function encodeUnder(max: number, encode: (quality: number) => Promise<Blob | null>): Promise<Blob> {
  let last = 0
  for (const q of QUALITIES) {
    const blob = await encode(q)
    if (!blob) throw new Error('Klarte ikke lage bildet')
    if (blob.size <= max) return blob
    last = blob.size
  }
  throw new Error(`Bildet ble ${Math.round(last / 1024)} kB, over grensen på ${Math.round(max / 1024)} kB`)
}

export async function renderThumbnail(doc: PDFDocumentProxy): Promise<Blob> {
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  // JPEG has no transparency: a page without its own background would turn black.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  try {
    await page.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff' }).promise
    return await encodeUnder(THUMBNAIL_MAX_BYTES, q => new Promise(res => canvas.toBlob(res, 'image/jpeg', q)))
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export async function uploadThumbnail(id: string, blob: Blob): Promise<Pick<KnitRecipe, 'thumbnail_path' | 'thumbnail_at'>> {
  const res = await fetch(`/api/strikk/oppskrifter/${id}/thumbnail`, {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Bildet ble ikke lagret (${res.status})`)
  return body as Pick<KnitRecipe, 'thumbnail_path' | 'thumbnail_at'>
}

export async function thumbnailFromFile(id: string, file: File): Promise<Pick<KnitRecipe, 'thumbnail_path' | 'thumbnail_at'>> {
  const { openPdf } = await import('../_components/PdfViewer')
  const { doc } = await openPdf(new Uint8Array(await file.arrayBuffer()))
  try {
    return await uploadThumbnail(id, await renderThumbnail(doc))
  } finally {
    void doc.destroy()
  }
}
