'use client'

// PDF view for Strikk, copied from the prototype's PdfPages without the drawing layer so
// the prototype can be deleted on its own. All pages stacked at full width; pages are
// rendered only as they come near the screen, and re-rendered sharp when a pinch-zoom,
// scroll or rotation settles.

import { memo, useCallback, useEffect, useRef } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

const DPR_CAP = 2
// iOS Safari refuses canvases above 16 777 216 pixels; stay well under, since two
// zoomed pages can be on screen at once.
const MAX_CANVAS_PIXELS = 12_000_000
// Pages are rendered once they come within one screen height, and released once they
// are more than three away. The gap stops pages from flickering in and out at the edge.
const NEAR_MARGIN = '100% 0px'
const FAR_MARGIN = '300% 0px'
const SETTLE_MS = 200

export interface PageSize {
  width: number
  height: number
}

export async function openPdf(data: Uint8Array): Promise<{ doc: PDFDocumentProxy; sizes: PageSize[] }> {
  await import('@/lib/readable-stream-async-iterator-polyfill')
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
  ).href
  const doc = await pdfjs.getDocument({ data }).promise
  const sizes: PageSize[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 })
    sizes.push({ width: vp.width, height: vp.height })
  }
  return { doc, sizes }
}

function isInVisualViewport(el: Element): boolean {
  const r = el.getBoundingClientRect()
  const vv = window.visualViewport
  const top = vv?.offsetTop ?? 0
  const left = vv?.offsetLeft ?? 0
  const h = vv?.height ?? window.innerHeight
  const w = vv?.width ?? window.innerWidth
  return r.bottom > top && r.top < top + h && r.right > left && r.left < left + w
}

const Page = memo(function Page({ num, size, register }: {
  num: number
  size: PageSize
  register: (num: number, el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={el => register(num, el)}
      data-page={num}
      className="relative w-full bg-white"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      <div data-canvas-slot className="absolute inset-0" />
    </div>
  )
})

// initialOffset is how far down initialPage to start, 0–1. Pages are laid out at their
// full height before they are rendered, so the place is right before any page is drawn.
export default function PdfViewer({ doc, sizes, initialPage, initialOffset = 0, onPlaced }: {
  doc: PDFDocumentProxy
  sizes: PageSize[]
  initialPage?: number
  initialOffset?: number
  onPlaced?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())

  // Scrolls the nearest scroll container, so it works full screen and inside a panel.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = initialPage ? pageEls.current.get(Math.min(initialPage, sizes.length)) : null
      if (el && (initialPage! > 1 || initialOffset > 0)) {
        el.scrollIntoView({ block: 'start' })
        if (initialOffset > 0) window.scrollBy(0, el.getBoundingClientRect().height * initialOffset)
      }
      onPlaced?.()
    })
    return () => cancelAnimationFrame(raf)
    // Placed once per document; a later change of the props must not jump the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  const register = useCallback((num: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(num, el)
    else pageEls.current.delete(num)
  }, [])

  useEffect(() => {
    const els = pageEls.current
    const rendered = new Map<number, { canvas: HTMLCanvasElement; scale: number }>()
    const near = new Set<number>()
    let queue: number[] = []
    let running = false
    let disposed = false
    let task: RenderTask | null = null

    function freeCanvas(c: HTMLCanvasElement) {
      // Zeroing the size is what makes Safari give the backing memory back.
      c.width = 0
      c.height = 0
      c.remove()
    }

    function targetScale(num: number, el: HTMLElement) {
      const size = sizes[num - 1]
      let s = (el.clientWidth / size.width) * Math.min(window.devicePixelRatio || 1, DPR_CAP)
      if (isInVisualViewport(el)) s *= window.visualViewport?.scale ?? 1
      return Math.min(s, Math.sqrt(MAX_CANVAS_PIXELS / (size.width * size.height)))
    }

    async function pump() {
      if (running) return
      running = true
      while (!disposed && queue.length > 0) {
        const num = queue.shift()!
        const el = els.get(num)
        if (!near.has(num) || !el || el.clientWidth === 0) continue
        const scale = targetScale(num, el)
        const prev = rendered.get(num)
        if (prev && Math.abs(prev.scale / scale - 1) < 0.1) continue
        try {
          const page = await doc.getPage(num)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.className = 'absolute inset-0 w-full h-full block'
          task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport })
          await task.promise
          task = null
          if (disposed || !near.has(num)) {
            freeCanvas(canvas)
            continue
          }
          // Swap only when the new canvas is finished, so the page never goes blank.
          el.querySelector('[data-canvas-slot]')!.replaceChildren(canvas)
          if (prev) freeCanvas(prev.canvas)
          rendered.set(num, { canvas, scale })
        } catch (err) {
          task = null
          if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
            console.error('[strikk] render', num, err)
          }
        }
      }
      running = false
    }

    function enqueue(nums: number[]) {
      const visible = nums.filter(n => { const el = els.get(n); return el && isInVisualViewport(el) })
      const rest = nums.filter(n => !visible.includes(n))
      queue = [...new Set([...visible, ...queue, ...rest])]
      void pump()
    }

    const nearObserver = new IntersectionObserver(entries => {
      const added: number[] = []
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const num = Number((e.target as HTMLElement).dataset.page)
        near.add(num)
        added.push(num)
      }
      if (added.length) enqueue(added)
    }, { rootMargin: NEAR_MARGIN })

    const farObserver = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) continue
        const num = Number((e.target as HTMLElement).dataset.page)
        near.delete(num)
        const r = rendered.get(num)
        if (r) {
          freeCanvas(r.canvas)
          rendered.delete(num)
        }
      }
    }, { rootMargin: FAR_MARGIN })

    for (const el of els.values()) {
      nearObserver.observe(el)
      farObserver.observe(el)
    }

    // Pinch-zoom end, scroll end and rotation all land here: visible pages get the zoomed
    // resolution, pages that scrolled away drop back to base resolution.
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    function settle() {
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => enqueue([...near]), SETTLE_MS)
    }
    const vv = window.visualViewport
    vv?.addEventListener('resize', settle)
    vv?.addEventListener('scroll', settle)
    window.addEventListener('scroll', settle, { passive: true })
    const ro = new ResizeObserver(settle)
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      disposed = true
      task?.cancel()
      nearObserver.disconnect()
      farObserver.disconnect()
      ro.disconnect()
      vv?.removeEventListener('resize', settle)
      vv?.removeEventListener('scroll', settle)
      window.removeEventListener('scroll', settle)
      if (settleTimer) clearTimeout(settleTimer)
      for (const r of rendered.values()) freeCanvas(r.canvas)
    }
  }, [doc, sizes])

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-1.5"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {sizes.map((size, i) => (
        <Page key={i + 1} num={i + 1} size={size} register={register} />
      ))}
    </div>
  )
}
