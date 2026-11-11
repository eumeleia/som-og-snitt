'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Stroke, Tool } from '../_lib/markup-ops'
import { eraseCircle } from '../_lib/erase'
import type { Rect } from '../_lib/size-marks'
import { placeAt } from './readingPosition'

const DPR_CAP = 2
// iOS Safari refuses canvases above 16 777 216 pixels; stay well under, since two
// zoomed pages can be on screen at once.
const MAX_CANVAS_PIXELS = 12_000_000
// Pages are rendered once they come within one screen height, and released once they
// are more than three away. The gap stops pages from flickering in and out at the edge.
const NEAR_MARGIN = '100% 0px'
const FAR_MARGIN = '300% 0px'
const SETTLE_MS = 200
// Eraser radius on screen, in CSS px at 100 % zoom; converted to page units per event so
// the eraser is the same size on screen at any zoom or page width.
const ERASER_PX = 20
const MIN_POINT_DIST = 0.0015
const VB = 1000

export interface PageSize {
  width: number
  height: number
}

export const MARKER_OPACITY = 0.55
// The chosen size, marked from the text layer. Violet, which no marker colour is.
export const SIZE_MARK_COLOR = '#7C3AED'

interface Props {
  doc: PDFDocumentProxy
  sizes: PageSize[]
  strokes: Stroke[]
  sizeMarks: Map<number, Rect[]> | null
  // The page marked «Gjeldende side», shown with a small label.
  currentPage: number | null
  // Where to start, placed once when the document opens.
  initialPage?: number
  initialOffset?: number
  onPlaced?: () => void
  tool: Tool | null
  color: string
  width: number
  jsTwoFingerScroll: boolean
  bottomPadding: number
  onStrokeAdd: (stroke: Stroke) => void
  // One eraser drag, which may cut several strokes: one call, so it is one undo step.
  onStrokeSplits: (splits: { id: string; parts: Stroke[] }[]) => void
  onDrawStart: () => void
}

function pathFor(points: number[], aspect: number): string {
  const n = points.length / 2
  if (n === 0) return ''
  const x = (i: number) => points[2 * i] * VB
  const y = (i: number) => points[2 * i + 1] * VB * aspect
  const f = (v: number) => v.toFixed(1)
  // A zero-length segment with a round cap draws the dot for a single tap.
  if (n === 1) return `M${f(x(0))} ${f(y(0))}l0.01 0`
  let d = `M${f(x(0))} ${f(y(0))}`
  for (let i = 1; i < n - 1; i++) {
    d += `Q${f(x(i))} ${f(y(i))} ${f((x(i) + x(i + 1)) / 2)} ${f((y(i) + y(i + 1)) / 2)}`
  }
  return d + `L${f(x(n - 1))} ${f(y(n - 1))}`
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

// Strokes are regrouped on every change, so compare element-wise: a stroke on one page
// must not re-render every other page.
function samePageProps(a: PageProps, b: PageProps) {
  return a.num === b.num && a.size === b.size && a.register === b.register && a.marks === b.marks && a.current === b.current &&
    a.strokes.length === b.strokes.length && a.strokes.every((s, i) => s === b.strokes[i])
}

interface PageProps {
  num: number
  size: PageSize
  strokes: Stroke[]
  marks: Rect[] | undefined
  current: boolean
  register: (num: number, el: HTMLDivElement | null) => void
}

const Page = memo(function Page({
  num, size, strokes, marks, current, register,
}: PageProps) {
  const aspect = size.height / size.width
  const viewBox = `0 0 ${VB} ${VB * aspect}`
  const markers = strokes.filter(s => s.tool === 'marker')
  const pens = strokes.filter(s => s.tool === 'pen')
  return (
    <div
      ref={el => register(num, el)}
      data-page={num}
      className="relative w-full bg-white"
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      <div data-canvas-slot className="absolute inset-0" />
      <svg viewBox={viewBox} className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ mixBlendMode: 'multiply' }}>
        {markers.map(s => (
          <path key={s.id} d={pathFor(s.points, aspect)} fill="none" stroke={s.color}
            strokeWidth={s.width * VB} strokeOpacity={MARKER_OPACITY}
            strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {marks && (
        <svg data-size-marks viewBox={viewBox} className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ mixBlendMode: 'multiply' }}>
          {marks.map((r, i) => (
            <rect key={i} x={r.x * VB} y={r.y * VB * aspect} width={r.w * VB} height={r.h * VB * aspect}
              rx={2} fill={SIZE_MARK_COLOR} fillOpacity={0.16} stroke={SIZE_MARK_COLOR} strokeWidth={2} />
          ))}
        </svg>
      )}
      <svg viewBox={viewBox} className="absolute inset-0 w-full h-full pointer-events-none">
        {pens.map(s => (
          <path key={s.id} d={pathFor(s.points, aspect)} fill="none" stroke={s.color}
            strokeWidth={s.width * VB} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      <svg data-live-svg viewBox={viewBox} className="absolute inset-0 w-full h-full pointer-events-none">
        <path data-live-path fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {current && (
        <span data-current-page className="absolute left-2 top-2 px-2 py-0.5 rounded-full bg-[#2E5339] text-white text-xs shadow pointer-events-none">
          Gjeldende side
        </span>
      )}
    </div>
  )
}, samePageProps)

interface Drawing {
  pointerId: number
  page: number
  el: HTMLElement
  points: number[]
  // Eraser only: original stroke id -> what is left of it so far in this drag, and which
  // original each new part came from. Committed as one stroke_split per original on release.
  work: Map<string, Stroke[]>
  origin: Map<string, string>
  last: { x: number; y: number } | null
}

export default function PdfPages({
  doc, sizes, strokes, sizeMarks, currentPage, initialPage, initialOffset = 0, onPlaced, tool, color, width, jsTwoFingerScroll, bottomPadding,
  onStrokeAdd, onStrokeSplits, onDrawStart,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drawing = useRef<Drawing | null>(null)
  // What the eraser has removed during the current drag, shown before it is committed.
  const [erasePreview, setErasePreview] = useState<Map<string, Stroke[]> | null>(null)
  const shown = useMemo(
    () => (erasePreview ? strokes.flatMap(s => erasePreview.get(s.id) ?? [s]) : strokes),
    [strokes, erasePreview],
  )
  const byPage = useMemo(() => groupByPage(shown), [shown])

  // Pointer handlers read the latest props through this ref instead of re-binding.
  const latest = useRef({ strokes, tool, color, width, jsTwoFingerScroll, onStrokeAdd, onStrokeSplits, onDrawStart })
  useLayoutEffect(() => {
    latest.current = { strokes, tool, color, width, jsTwoFingerScroll, onStrokeAdd, onStrokeSplits, onDrawStart }
  })

  const register = useCallback((num: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(num, el)
    else pageEls.current.delete(num)
  }, [])

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = initialPage ? pageEls.current.get(Math.min(initialPage, sizes.length)) : null
      if (el && (initialPage! > 1 || initialOffset > 0)) placeAt(el, initialOffset)
      onPlaced?.()
    })
    return () => cancelAnimationFrame(raf)
    // Placed once per document; a later change of the props must not jump the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  // ---- Rendering: lazy, one page at a time, sharp re-render after zoom settles ----
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
            console.error('[strikk-markup] render', num, err)
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

  // ---- Drawing ----
  function livePath(d: Drawing) {
    return d.el.querySelector('[data-live-path]') as SVGPathElement | null
  }

  function clearLive(d: Drawing) {
    const path = livePath(d)
    if (path) path.setAttribute('d', '')
  }

  function abortStroke() {
    const d = drawing.current
    if (d) clearLive(d)
    drawing.current = null
    setErasePreview(null)
  }

  function addPoint(d: Drawing, clientX: number, clientY: number) {
    const r = d.el.getBoundingClientRect()
    const x = (clientX - r.left) / r.width
    const y = (clientY - r.top) / r.height
    if (latest.current.tool === 'eraser') {
      const size = sizes[d.page - 1]
      const scale = window.visualViewport?.scale ?? 1
      erase(d, x, y * (size.height / size.width), ERASER_PX / (r.width * scale), size.height / size.width)
      return
    }
    const n = d.points.length
    const aspect = r.height / r.width
    if (n >= 2 && Math.hypot(x - d.points[n - 2], (y - d.points[n - 1]) * aspect) < MIN_POINT_DIST) return
    d.points.push(Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5)
  }

  // x/y in page-width units. A fast drag is stepped at half the radius so the eraser
  // sweeps a continuous band instead of punching separate holes.
  function erase(d: Drawing, x: number, y: number, radius: number, aspect: number) {
    const from = d.last ?? { x, y }
    const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / (radius / 2)))
    d.last = { x, y }
    let changed = false
    for (let k = 1; k <= steps; k++) {
      const cx = from.x + ((x - from.x) * k) / steps
      const cy = from.y + ((y - from.y) * k) / steps
      const current = latest.current.strokes
        .flatMap(s => d.work.get(s.id) ?? [s])
        .filter(s => s.page === d.page)
      for (const s of current) {
        const parts = eraseCircle(s, cx, cy, radius, aspect)
        if (!parts) continue
        const orig = d.origin.get(s.id) ?? s.id
        const list = d.work.get(orig) ?? [s]
        d.work.set(orig, list.flatMap(p => (p.id === s.id ? parts : [p])))
        for (const p of parts) d.origin.set(p.id, orig)
        changed = true
      }
    }
    if (changed) setErasePreview(new Map(d.work))
  }

  function drawLive(d: Drawing) {
    const { tool: t, color: c, width: w } = latest.current
    if (t === 'eraser') return
    const path = livePath(d)
    if (!path) return
    const size = sizes[d.page - 1]
    const svg = path.ownerSVGElement!
    svg.style.mixBlendMode = t === 'marker' ? 'multiply' : 'normal'
    path.setAttribute('stroke', c)
    path.setAttribute('stroke-width', String(w * VB))
    path.setAttribute('stroke-opacity', t === 'marker' ? String(MARKER_OPACITY) : '1')
    path.setAttribute('d', pathFor(d.points, size.height / size.width))
  }

  function centroid() {
    let x = 0, y = 0
    for (const p of pointers.current.values()) { x += p.x; y += p.y }
    const n = pointers.current.size
    return { x: x / n, y: y / n }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!latest.current.tool) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // A second finger means scroll/zoom: throw away whatever the first finger began.
    if (pointers.current.size > 1) {
      abortStroke()
      return
    }
    const pageEl = (e.target as Element).closest('[data-page]') as HTMLElement | null
    if (!pageEl) return
    latest.current.onDrawStart()
    // Capture keeps moves coming when the finger leaves the page; drawing works without it.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    const d: Drawing = {
      pointerId: e.pointerId,
      page: Number(pageEl.dataset.page),
      el: pageEl,
      points: [],
      work: new Map(),
      origin: new Map(),
      last: null,
    }
    drawing.current = d
    addPoint(d, e.clientX, e.clientY)
    drawLive(d)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    if (pointers.current.size >= 2) {
      // Reached only if Safari did not take the gesture itself (it would have sent
      // pointercancel). In JS mode the two-finger pan is then done here.
      const before = centroid()
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (latest.current.jsTwoFingerScroll) {
        const after = centroid()
        window.scrollBy(before.x - after.x, before.y - after.y)
      }
      return
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    const events = e.nativeEvent.getCoalescedEvents?.() ?? []
    if (events.length > 0) for (const ev of events) addPoint(d, ev.clientX, ev.clientY)
    else addPoint(d, e.clientX, e.clientY)
    drawLive(d)
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    drawing.current = null
    const { tool: t, color: c, width: w, onStrokeAdd: add, onStrokeSplits: splits } = latest.current
    if (t === 'marker' || t === 'pen') {
      add({ id: crypto.randomUUID(), page: d.page, tool: t, color: c, width: w, points: d.points })
    }
    if (t === 'eraser') {
      if (d.work.size) splits([...d.work].map(([id, parts]) => ({ id, parts })))
      // Same event, so React renders the committed strokes and the cleared preview together.
      setErasePreview(null)
    }
    // Clear after React has painted the committed stroke, so it does not blink.
    requestAnimationFrame(() => clearLive(d))
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId)
    if (drawing.current?.pointerId === e.pointerId) abortStroke()
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-1.5"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: bottomPadding,
        touchAction: tool ? 'pinch-zoom' : 'auto',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        cursor: tool ? 'crosshair' : 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={e => { if (tool) e.preventDefault() }}
    >
      {sizes.map((size, i) => (
        <Page
          key={i + 1}
          num={i + 1}
          size={size}
          strokes={byPage.get(i + 1) ?? EMPTY}
          marks={sizeMarks?.get(i + 1)}
          current={currentPage === i + 1}
          register={register}
        />
      ))}
    </div>
  )
}

function groupByPage(all: Stroke[]): Map<number, Stroke[]> {
  const byPage = new Map<number, Stroke[]>()
  for (const s of all) {
    const list = byPage.get(s.page)
    if (list) list.push(s)
    else byPage.set(s.page, [s])
  }
  return byPage
}
const EMPTY: Stroke[] = []
