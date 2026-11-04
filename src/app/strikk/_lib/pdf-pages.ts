// Browser-only: page text and page images from a PDF with pdf.js, so the extraction
// sends Claude a few pages instead of the whole file.
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { hentTekstFraSide } from '@/lib/pdf-text'
import type { PageText } from './extraction'

// Under Vercel's 4.5 MB request body, with room for the JSON around the images.
export const IMAGE_BUDGET_BYTES = 3_500_000
const IMAGE_EDGES = [1600, 1200, 900]

export async function openPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  await import('@/lib/readable-stream-async-iterator-polyfill')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
  // pdf.js transfers (detaches) the buffer it is given; a copy keeps the caller's bytes.
  return pdfjs.getDocument({ data: bytes.slice() }).promise
}

// Same clean-up as the sewing import: letter-spaced display fonts («H e i d i») come
// out of pdf.js one letter per item.
export function normalizePageText(text: string): string {
  return text
    .replace(
      /([^a-zA-ZÀ-ÿ]|^)([a-zA-ZÀ-ÿ](?:\s+[a-zA-ZÀ-ÿ]){3,})(?![a-zA-ZÀ-ÿ])/g,
      (_m, pre: string, letters: string) => pre + letters.replace(/\s+/g, ''),
    )
    .replace(/[^\S\n]+/g, ' ')
    .trim()
}

export async function readPageTexts(doc: PDFDocumentProxy): Promise<PageText[]> {
  const pages: PageText[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await hentTekstFraSide(page)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = content.items.map((it: any) => (typeof it.str === 'string' ? it.str : '') + (it.hasEOL ? '\n' : ' ')).join('')
    pages.push({ page: n, text: normalizePageText(raw) })
  }
  return pages
}

async function renderJpeg(doc: PDFDocumentProxy, n: number, maxEdge: number): Promise<string> {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const scale = maxEdge / Math.max(base.width, base.height)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  // White background: a transparent canvas turns black in a JPEG.
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, background: 'white' }).promise
  const url = canvas.toDataURL('image/jpeg', 0.78)
  canvas.width = canvas.height = 0
  return url.slice(url.indexOf(',') + 1)
}

// Smaller images until the set fits the budget; if even the smallest does not, the
// last pages are dropped.
export async function renderPagesForClaude(doc: PDFDocumentProxy, pages: number[]): Promise<{ page: number; data: string }[]> {
  for (const edge of IMAGE_EDGES) {
    const out: { page: number; data: string }[] = []
    for (const n of pages) out.push({ page: n, data: await renderJpeg(doc, n, edge) })
    const size = out.reduce((s, i) => s + i.data.length, 0)
    if (size <= IMAGE_BUDGET_BYTES) return out
    if (edge === IMAGE_EDGES[IMAGE_EDGES.length - 1]) {
      let total = 0
      return out.filter(i => (total += i.data.length) <= IMAGE_BUDGET_BYTES)
    }
  }
  return []
}
