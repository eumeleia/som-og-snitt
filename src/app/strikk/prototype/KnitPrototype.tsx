'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { supabase } from '@/lib/supabase'
import { applyOps, type Counter, type DocState, type Op, type Stroke, type Tool } from './ops'
import { enqueue, pendingOps, subscribe, subscribeServerCounters, type QueueStatus } from './saveQueue'
import { downloadPdf, uploadPdf, DriveAuthExpiredError, DriveFileMissingError } from './drive'
import PdfPages, { MARKER_OPACITY, type PageSize } from './PdfPages'
import Counters from './Counters'

const COLORS = [
  { name: 'Gul', hex: '#FFD84D' },
  { name: 'Bringebær', hex: '#C8326B' },
  { name: 'Blå', hex: '#3D7DD8' },
  { name: 'Fersken', hex: '#F9B98C' },
  { name: 'Kamel', hex: '#C19A6B' },
  { name: 'Lys salviegrønn', hex: '#B9CBB0' },
  { name: 'Mørk grønn', hex: '#2E5339' },
]

// Stroke widths are fractions of the page width.
const WIDTH_RANGE = {
  marker: { min: 0.01, max: 0.06, step: 0.002 },
  pen: { min: 0.0015, max: 0.012, step: 0.0005 },
}

type DrawTool = 'marker' | 'pen'
type ToolSettings = Record<DrawTool, { color: string; width: number }>

const DEFAULT_SETTINGS: ToolSettings = {
  marker: { color: '#FFD84D', width: 0.025 },
  pen: { color: '#2E5339', width: 0.003 },
}

const UI_KEY = 'strikk-prototype-ui'
const DEFAULT_UI = { countersVisible: false, jsTwoFinger: false }

interface Row {
  id: string
  drive_file_id: string
  file_name: string
  strokes: Stroke[]
  counters: Counter[]
}

type Status =
  | { kind: 'loading'; text: string }
  | { kind: 'empty' }
  | { kind: 'ready' }
  | { kind: 'error'; text: string }
  | { kind: 'auth-expired' }
  | { kind: 'missing'; text: string }

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* convenience only */ }
}

async function openPdf(data: Uint8Array): Promise<{ doc: PDFDocumentProxy; sizes: PageSize[] }> {
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

// Keeps fixed UI at the same on-screen size and position while Safari is pinch-zoomed:
// the overlay is sized to the visual viewport and scaled by 1/zoom.
function useVisualViewportBox() {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0, scale: 1 })
  useEffect(() => {
    const vv = window.visualViewport
    let raf = 0
    function update() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setBox(vv
          ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height, scale: vv.scale }
          : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, scale: 1 })
      })
    }
    update()
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return box
}

function useWakeLock() {
  const [active, setActive] = useState<boolean | null>(null)
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    async function request() {
      if (cancelled || document.visibilityState !== 'visible' || (lock && !lock.released)) return
      if (!('wakeLock' in navigator)) { setActive(false); return }
      try {
        lock = await navigator.wakeLock.request('screen')
        setActive(true)
        lock.addEventListener('release', () => setActive(false))
      } catch {
        setActive(false)
      }
    }
    void request()
    // The lock is dropped whenever the page is hidden; a tap is a fallback in case
    // Safari wants a user gesture before granting it.
    document.addEventListener('visibilitychange', request)
    document.addEventListener('pointerdown', request)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', request)
      document.removeEventListener('pointerdown', request)
      void lock?.release()
    }
  }, [])
  return active
}

export default function KnitPrototype() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'loading', text: 'Laster …' })
  const [row, setRow] = useState<Row | null>(null)
  const [state, setState] = useState<DocState>({ strokes: [], counters: [] })
  const [pdf, setPdf] = useState<{ doc: PDFDocumentProxy; sizes: PageSize[] } | null>(null)
  // Bumped by «Prøv igjen» to re-run the load: the most recent row is fetched again too,
  // since the failure may have come from which row was newest.
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [tool, setTool] = useState<Tool | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  // Lazy initialisers are safe here: nothing renders before the session check, so the
  // server's fallback values never reach hydration.
  const [settings, setSettings] = useState<ToolSettings>(() => readLocal('strikk-prototype-settings', DEFAULT_SETTINGS))
  const [countersVisible, setCountersVisible] = useState(() => readLocal(UI_KEY, DEFAULT_UI).countersVisible)
  const [counterHeight, setCounterHeight] = useState(0)
  const [jsTwoFinger, setJsTwoFinger] = useState(() => readLocal(UI_KEY, DEFAULT_UI).jsTwoFinger)
  const [queue, setQueue] = useState<QueueStatus>({ pending: 0, failed: false })

  const fileInput = useRef<HTMLInputElement>(null)
  const box = useVisualViewportBox()
  const wakeLock = useWakeLock()

  useEffect(() => subscribe(setQueue), [])

  // After each save the server sends back its merged counters, which include the other
  // device's taps. Own ops not yet sent are applied on top, so nothing jumps back.
  useEffect(() => subscribeServerCounters((docId, counters) => {
    if (docId !== row?.id) return
    setState(s => ({ ...s, counters: applyOps({ strokes: [], counters }, pendingOps(docId)).counters }))
  }), [row?.id])

  useEffect(() => { writeLocal('strikk-prototype-settings', settings) }, [settings])
  useEffect(() => { writeLocal(UI_KEY, { countersVisible, jsTwoFinger }) }, [countersVisible, jsTwoFinger])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setAuthed(true)
      else router.replace('/login')
    })
  }, [router])

  const showPdf = useCallback(async (data: Uint8Array) => {
    setStatus({ kind: 'loading', text: 'Åpner PDF …' })
    const opened = await openPdf(data)
    setPdf(prev => { void prev?.doc.destroy(); return opened })
    setStatus({ kind: 'ready' })
  }, [])

  const handleError = useCallback((err: unknown) => {
    if (err instanceof DriveAuthExpiredError) setStatus({ kind: 'auth-expired' })
    else if (err instanceof DriveFileMissingError) setStatus({ kind: 'missing', text: err.message })
    else setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
  }, [])

  useEffect(() => {
    if (!authed) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('strikk_prototype')
          .select('id, drive_file_id, file_name, strokes, counters')
          .order('last_opened', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (cancelled) return
        if (!data) { setStatus({ kind: 'empty' }); return }
        const r = data as Row
        setRow(r)
        // Ops still waiting in the queue are not on the server yet; apply them on top.
        setState(applyOps({ strokes: r.strokes, counters: r.counters }, pendingOps(r.id)))
        setStatus({ kind: 'loading', text: 'Henter PDF fra Disk …' })
        const bytes = await downloadPdf(r.drive_file_id, r.file_name)
        if (cancelled) return
        await showPdf(bytes)
      } catch (err) {
        if (!cancelled) handleError(err)
      }
    })()
    return () => { cancelled = true }
  }, [authed, showPdf, handleError, loadAttempt])

  async function onFileChosen(file: File | undefined) {
    if (!file) return
    try {
      setStatus({ kind: 'loading', text: `Laster opp ${file.name} …` })
      const driveFileId = await uploadPdf(file)
      const res = await fetch('/api/strikk-prototype', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveFileId, fileName: file.name }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Lagring feilet (${res.status})`)
      const r = body as Row
      setRow(r)
      setState({ strokes: r.strokes, counters: r.counters })
      setTool(null)
      // Render from the bytes already in memory instead of downloading them again.
      await showPdf(new Uint8Array(await file.arrayBuffer()))
    } catch (err) {
      handleError(err)
    }
  }

  // Removes the row only; the file in the private Drive is left alone. The next most
  // recently opened row loads after.
  async function removeRow() {
    if (!row) return
    setStatus({ kind: 'loading', text: 'Fjerner …' })
    const res = await fetch(`/api/strikk-prototype/${row.id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setStatus({ kind: 'error', text: body.error ?? `Fjerning feilet (${res.status})` }); return }
    setRow(null)
    setLoadAttempt(n => n + 1)
  }

  function commit(op: Op) {
    if (!row) return
    setState(s => applyOps(s, [op]))
    enqueue(row.id, op)
  }

  function toggleTool(t: Tool) {
    if (tool === t) {
      setTool(null)
      setSheetOpen(false)
    } else {
      setTool(t)
      setSheetOpen(t !== 'eraser')
    }
  }

  const onCounterHeight = useCallback((h: number) => setCounterHeight(h), [])

  const drawTool: DrawTool | null = tool === 'marker' || tool === 'pen' ? tool : null
  const active = drawTool ? settings[drawTool] : settings.pen
  const unsaved = queue.pending > 0 && (queue.failed || (typeof navigator !== 'undefined' && !navigator.onLine))

  if (!authed) return null

  return (
    <div className="min-h-screen bg-stone-300">
      {pdf && status.kind === 'ready' && (
        <PdfPages
          doc={pdf.doc}
          sizes={pdf.sizes}
          strokes={state.strokes}
          tool={tool}
          color={active.color}
          width={active.width}
          jsTwoFingerScroll={jsTwoFinger}
          bottomPadding={countersVisible ? counterHeight : 0}
          onStrokeAdd={s => commit({ type: 'stroke_add', stroke: s })}
          onStrokeSplit={(id, parts) => commit({ type: 'stroke_split', id, parts })}
          onDrawStart={() => { setSheetOpen(false); setMenuOpen(false) }}
        />
      )}

      {status.kind !== 'ready' && (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#FAF7F4]">
          <div className="max-w-sm w-full text-center flex flex-col gap-4">
            {status.kind === 'loading' && <p className="text-stone-600">{status.text}</p>}
            {status.kind === 'empty' && <p className="text-stone-600">Ingen PDF ennå.</p>}
            {status.kind === 'error' && <p className="text-red-700 text-sm break-words">{status.text}</p>}
            {status.kind === 'auth-expired' && (
              <>
                <p className="text-stone-700">Strikk er ikke koblet til Disk, eller tilgangen har utløpt.</p>
                <a href="/api/strikk/drive/auth" className="h-11 rounded-xl bg-[#2E5339] text-white flex items-center justify-center">
                  Koble til Disk for Strikk
                </a>
              </>
            )}
            {status.kind === 'missing' && (
              <>
                <p className="text-stone-700 text-sm break-words">{status.text}</p>
                <button onClick={() => void removeRow()}
                  className="h-11 rounded-xl border border-stone-300 bg-white text-stone-800">
                  Fjern fra appen
                </button>
              </>
            )}
            {status.kind === 'error' && (
              <button
                onClick={() => {
                  setStatus({ kind: 'loading', text: 'Prøver igjen …' })
                  setLoadAttempt(n => n + 1)
                }}
                className="h-11 rounded-xl border border-stone-300 bg-white text-stone-800"
              >
                Prøv igjen
              </button>
            )}
            {(status.kind === 'empty' || status.kind === 'error' || status.kind === 'missing') && (
              <button onClick={() => fileInput.current?.click()}
                className="h-11 rounded-xl bg-[#2E5339] text-white">
                Last opp PDF
              </button>
            )}
          </div>
        </div>
      )}

      <input ref={fileInput} type="file" accept="application/pdf" className="hidden"
        onChange={e => { void onFileChosen(e.target.files?.[0]); e.target.value = '' }} />

      {/* Overlay that follows the visual viewport, see useVisualViewportBox. */}
      <div
        className="fixed left-0 top-0 z-40 pointer-events-none"
        style={{
          width: box.width * box.scale,
          height: box.height * box.scale,
          transform: `translate(${box.left}px, ${box.top}px) scale(${1 / box.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <div className="absolute left-3 flex flex-col gap-1 items-start"
          style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}>
          {unsaved && (
            <span className="pointer-events-auto px-2.5 py-1 rounded-full bg-red-700 text-white text-xs">
              ikke lagret ({queue.pending})
            </span>
          )}
          {wakeLock === false && (
            <span className="px-2.5 py-1 rounded-full bg-stone-700 text-white text-xs">skjermlås av</span>
          )}
        </div>

        {status.kind === 'ready' && (
          <div className="absolute right-3 flex flex-col gap-2 items-center"
            style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}>
            <div className="flex gap-2">
              <RoundButton label="Tellere" on={countersVisible} onClick={() => setCountersVisible(v => !v)}>
                <IconCounter />
              </RoundButton>
              <RoundButton label="Verktøy" on={!menuOpen && tool !== null} onClick={() => setMenuOpen(o => !o)}>
                {!menuOpen && tool ? <ToolIcon tool={tool} /> : <IconMenu />}
              </RoundButton>
            </div>
            {menuOpen && (
              <div className="self-end flex flex-col gap-2 items-end">
                <RoundButton label="Markeringstusj" on={tool === 'marker'} onClick={() => toggleTool('marker')}>
                  <ToolIcon tool="marker" />
                </RoundButton>
                <RoundButton label="Penn" on={tool === 'pen'} onClick={() => toggleTool('pen')}>
                  <ToolIcon tool="pen" />
                </RoundButton>
                <RoundButton label="Viskelær" on={tool === 'eraser'} onClick={() => toggleTool('eraser')}>
                  <ToolIcon tool="eraser" />
                </RoundButton>
                <div className="h-px w-8 bg-stone-400 my-1 mr-1.5" />
                <button
                  aria-pressed={jsTwoFinger}
                  onClick={() => setJsTwoFinger(v => !v)}
                  className="pointer-events-auto w-52 rounded-2xl px-3 py-2 text-left shadow-md border bg-white/95 border-stone-300"
                >
                  <span className="block text-sm font-medium text-stone-800">
                    {jsTwoFinger ? 'To fingre: app' : 'To fingre: Safari'}
                  </span>
                  <span className="block text-[11px] leading-snug text-stone-500">
                    Gjelder bare blaing med to fingre på mobil mens et verktøy er på.
                  </span>
                </button>
                <RoundButton label="Ny PDF" on={false} onClick={() => { setMenuOpen(false); fileInput.current?.click() }}>
                  <IconUpload />
                </RoundButton>
              </div>
            )}
          </div>
        )}

        {status.kind === 'ready' && countersVisible && (
          <Counters
            counters={state.counters}
            onHeight={onCounterHeight}
            onAdd={(name, total) => commit({
              type: 'counter_add',
              counter: { id: crypto.randomUUID(), name, total, value: 0 },
            })}
            onSet={(id, value) => commit({ type: 'counter_set', id, value })}
            onStep={(id, delta) => commit({ type: 'counter_step', id, delta, opId: crypto.randomUUID() })}
            onDelete={id => commit({ type: 'counter_delete', id })}
          />
        )}

        {sheetOpen && drawTool && (
          <ToolSheet
            tool={drawTool}
            color={active.color}
            width={active.width}
            onColor={c => setSettings(s => ({ ...s, [drawTool]: { ...s[drawTool], color: c } }))}
            onWidth={w => setSettings(s => ({ ...s, [drawTool]: { ...s[drawTool], width: w } }))}
            onClose={() => setSheetOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

function ToolSheet({ tool, color, width, onColor, onWidth, onClose }: {
  tool: DrawTool
  color: string
  width: number
  onColor: (c: string) => void
  onWidth: (w: number) => void
  onClose: () => void
}) {
  const range = WIDTH_RANGE[tool]
  const isPreset = COLORS.some(c => c.hex.toLowerCase() === color.toLowerCase())
  // Preview at the width a phone-wide page would draw it.
  const previewPx = Math.max(1, width * 390)
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 pointer-events-auto bg-[#FAF7F4] rounded-t-2xl border-t border-stone-300 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] px-4 pt-3 flex flex-col gap-3"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-stone-700">{tool === 'marker' ? 'Markeringstusj' : 'Penn'}</span>
        <button onClick={onClose} className="text-sm text-stone-600 px-2 py-1">Ferdig</button>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {COLORS.map(c => (
          <button
            key={c.hex}
            aria-label={c.name}
            onClick={() => onColor(c.hex)}
            className="w-10 h-10 rounded-full border border-stone-300"
            style={{
              backgroundColor: c.hex,
              boxShadow: color.toLowerCase() === c.hex.toLowerCase() ? '0 0 0 3px #FAF7F4, 0 0 0 5px #44403c' : undefined,
            }}
          />
        ))}
        <label
          aria-label="Egen farge"
          className="relative w-10 h-10 rounded-full border border-stone-300 overflow-hidden"
          style={{
            background: isPreset ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : color,
            boxShadow: !isPreset ? '0 0 0 3px #FAF7F4, 0 0 0 5px #44403c' : undefined,
          }}
        >
          <input type="color" value={color} onChange={e => onColor(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={width}
          onChange={e => onWidth(Number(e.target.value))}
          className="flex-1"
          aria-label="Tykkelse"
        />
        <svg width="56" height="32" className="shrink-0">
          <line x1="8" y1="16" x2="48" y2="16" stroke={color} strokeLinecap="round"
            strokeWidth={Math.min(previewPx, 28)}
            strokeOpacity={tool === 'marker' ? MARKER_OPACITY : 1} />
        </svg>
      </div>
    </div>
  )
}

function RoundButton({ label, on, onClick, children }: {
  label: string
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={`pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center shadow-md border transition-colors ${
        on ? 'bg-[#2E5339] border-[#2E5339] text-white' : 'bg-white/95 border-stone-300 text-stone-700'
      }`}
    >
      {children}
    </button>
  )
}

const iconProps = {
  viewBox: '0 0 24 24',
  className: 'w-5 h-5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === 'marker') {
    return (
      <svg {...iconProps}>
        <path d="M14.5 4.5l5 5L10 19H5v-5z" /><path d="M12 7l5 5" /><path d="M4 21h8" />
      </svg>
    )
  }
  if (tool === 'pen') {
    return (
      <svg {...iconProps}>
        <path d="M16.5 3.5l4 4L8 20l-5 1 1-5z" /><path d="M14 6l4 4" />
      </svg>
    )
  }
  return (
    <svg {...iconProps}>
      <path d="M8.5 20H20" /><path d="M5 15.5l9.5-9.5a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19.5H8.5z" />
      <path d="M9.5 11l4.5 4.5" />
    </svg>
  )
}

function IconCounter() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 12h4" /><path d="M14.5 12h3" /><path d="M16 10.5v3" />
    </svg>
  )
}

function IconMenu() {
  return (
    <svg {...iconProps}>
      <path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg {...iconProps}>
      <path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20h14" />
    </svg>
  )
}
