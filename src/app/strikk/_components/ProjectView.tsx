'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { supabase } from '@/lib/supabase'
import { EXTRACTION_SELECT, storedToExtraction, type ExtractionData, type StoredRecipe } from '../_lib/extraction'
import { PROJECT_SELECT, STATUSES, STATUS_LABEL, sortedYarn, startPosition, type Project, type ProjectStatus } from '../_lib/projects'
import { amountForLine, formatAmountForLine } from '../_lib/project-amounts'
import { COMBO_SELECT, SWATCH_SELECT, comboFromRow, swatchFromRow, type ComboRow, type SwatchRow } from '../_lib/combos'
import { rankAlternatives, mainFibre, type Alternative, type RawCombo, type RawSwatch } from '../_lib/yarn-alternatives'
import { applyOps, undoOps, type Counter, type DocState, type Op, type Stroke, type Tool } from '../_lib/markup-ops'
import { popStep, pushStep, readStack, writeStack, type UndoStep } from '../_lib/undo-stack'
import { enqueue, pendingOps, subscribe, subscribeServerCounters, type QueueStatus } from '../_lib/project-save-queue'
import { DriveAuthExpiredError, DriveFileMissingError, downloadPdf } from '../_lib/drive'
import type { YarnRow } from '../_lib/yarns'
import { findSizeMarks, type Measure, type PageText, type SizeMarks } from '../_lib/size-marks'
import PdfPages, { MARKER_OPACITY, SIZE_MARK_COLOR, type PageSize } from './PdfPages'
import { placeAt, readPosition, useSavePosition } from './readingPosition'
import { openPdf } from './PdfViewer'
import { compressCover, coverUrl, removeCover, uploadCover } from '../_lib/cover'
import Counters from './Counters'
import YarnPicker from './YarnPicker'
import DriveExpired from './DriveExpired'

const COLORS = [
  { name: 'Gul', hex: '#FFD84D' },
  { name: 'Bringebær', hex: '#C8326B' },
  { name: 'Blå', hex: '#3D7DD8' },
  { name: 'Fersken', hex: '#F9B98C' },
  { name: 'Kamel', hex: '#C19A6B' },
  { name: 'Lys salviegrønn', hex: '#B9CBB0' },
  { name: 'Mørk grønn', hex: '#2E5339' },
]

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

const UI_KEY = 'strikk-project-ui'
const DEFAULT_UI = { jsTwoFinger: false, sizeMarks: true }
const SIZE_MESSAGE_MS = 5000

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

function useWakeLock(active: boolean) {
  const [got, setGot] = useState<boolean | null>(null)
  useEffect(() => {
    if (!active) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    async function request() {
      if (cancelled || document.visibilityState !== 'visible' || (lock && !lock.released)) return
      if (!('wakeLock' in navigator)) { setGot(false); return }
      try {
        lock = await navigator.wakeLock.request('screen')
        setGot(true)
        lock.addEventListener('release', () => setGot(false))
      } catch {
        setGot(false)
      }
    }
    void request()
    document.addEventListener('visibilitychange', request)
    document.addEventListener('pointerdown', request)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', request)
      document.removeEventListener('pointerdown', request)
      void lock?.release()
    }
  }, [active])
  return got
}

// keepalive lets a position saved as the page is left still arrive.
async function patchProject(id: string, body: Record<string, unknown>, keepalive = false) {
  const res = await fetch(`/api/strikk/projects/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive,
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `Lagring feilet (${res.status})`)
  return j as Project
}

interface YarnLine { position: number; yarn_id: string | null; color_label: string | null }

interface RecipeInfo {
  title: string | null
  drive_file_id: string
  file_name: string
  thumbnail_path: string | null
  thumbnail_at: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; text: string }

type PdfState =
  | { kind: 'idle' }
  | { kind: 'loading'; text: string }
  | { kind: 'ready'; doc: PDFDocumentProxy; sizes: PageSize[] }
  | { kind: 'error'; text: string }
  | { kind: 'auth-expired' }
  | { kind: 'missing'; text: string }

export default function ProjectView({ id }: { id: string }) {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [project, setProject] = useState<Project | null>(null)
  const [recipe, setRecipe] = useState<RecipeInfo | null>(null)
  const [extraction, setExtraction] = useState<ExtractionData | null>(null)
  const [yarns, setYarns] = useState<YarnRow[]>([])
  const [combos, setCombos] = useState<RawCombo[]>([])
  const [swatches, setSwatches] = useState<RawSwatch[]>([])
  const [yarnLines, setYarnLines] = useState<YarnLine[]>([])
  const [view, setView] = useState<'info' | 'pdf'>('info')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setAuthed(true)
      else router.replace('/login')
    })
  }, [router])

  useEffect(() => {
    if (!authed) return
    let cancelled = false
    ;(async () => {
      setLoad({ kind: 'loading' })
      const { data: p, error: pErr } = await supabase.from('strikk_project').select(PROJECT_SELECT).eq('id', id).maybeSingle()
      if (cancelled) return
      if (pErr) { setLoad({ kind: 'error', text: pErr.message }); return }
      if (!p) { setLoad({ kind: 'error', text: 'Fant ikke prosjektet. Det kan være slettet.' }); return }
      const proj = p as unknown as Project
      setProject(proj)
      setYarnLines(sortedYarn(proj).map(l => ({ position: l.position, yarn_id: l.yarn_id, color_label: l.color_label })))

      if (proj.oppskrift_id) {
        const [{ data: r, error: rErr }, { data: thumb }] = await Promise.all([
          supabase.from('strikk_oppskrift').select(EXTRACTION_SELECT).eq('id', proj.oppskrift_id).maybeSingle(),
          supabase.from('strikk_oppskrift').select('thumbnail_path, thumbnail_at').eq('id', proj.oppskrift_id).maybeSingle(),
        ])
        if (cancelled) return
        if (rErr) { setLoad({ kind: 'error', text: rErr.message }); return }
        if (r) {
          const stored = r as unknown as StoredRecipe
          setRecipe({
            title: stored.title, drive_file_id: stored.drive_file_id, file_name: stored.file_name,
            thumbnail_path: thumb?.thumbnail_path ?? null, thumbnail_at: thumb?.thumbnail_at ?? null,
          })
          setExtraction(storedToExtraction(stored))
        }
      }

      const [yRes, comboRes, swatchRes] = await Promise.all([
        supabase.from('strikk_yarn').select('*'),
        supabase.from('strikk_yarn_combo').select(COMBO_SELECT),
        supabase.from('strikk_swatch').select(SWATCH_SELECT),
      ])
      if (cancelled) return
      if (yRes.error) { setLoad({ kind: 'error', text: yRes.error.message }); return }
      setYarns((yRes.data ?? []) as YarnRow[])
      if (!comboRes.error) setCombos((comboRes.data as unknown as ComboRow[] ?? []).map(comboFromRow))
      if (!swatchRes.error) setSwatches((swatchRes.data as unknown as SwatchRow[] ?? []).map(swatchFromRow))
      setLoad({ kind: 'ready' })
    })()
    return () => { cancelled = true }
  }, [authed, id])

  async function save(body: Record<string, unknown>, optimistic: Partial<Project>) {
    setProject(p => (p ? { ...p, ...optimistic } : p))
    try {
      await patchProject(id, body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lagring feilet')
    }
  }

  function saveYarnLines(next: YarnLine[]) {
    setYarnLines(next)
    void save({ yarnLines: next }, {})
  }

  async function deleteProject() {
    if (!window.confirm(`Slette «${project?.name}»? Dette kan ikke angres.`)) return
    const res = await fetch(`/api/strikk/projects/${id}`, { method: 'DELETE' })
    if (res.ok) router.replace('/strikk/prosjekter')
    else setError('Kunne ikke slette prosjektet')
  }

  if (!authed) return null

  if (load.kind === 'loading') {
    return <Centered><p className="text-stone-600">Henter prosjektet …</p></Centered>
  }
  if (load.kind === 'error' || !project) {
    return (
      <Centered>
        <p className="text-red-700 text-sm break-words">{load.kind === 'error' ? load.text : 'Fant ikke prosjektet'}</p>
        <Link href="/strikk/prosjekter" className="text-sm text-stone-600 underline">Til prosjektene</Link>
      </Centered>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF7F4]">
      {view === 'info' ? (
        <InfoView
          project={project} recipe={recipe} extraction={extraction} yarns={yarns} combos={combos} swatches={swatches}
          yarnLines={yarnLines}
          error={error}
          onSave={save}
          onSaved={patch => setProject(p => (p ? { ...p, ...patch } : p))}
          onSaveYarnLines={saveYarnLines}
          onYarnUpdated={(yarnId, patch) => setYarns(ys => ys.map(y => (y.id === yarnId ? { ...y, ...patch } : y)))}
          onOpenPdf={() => setView('pdf')}
          onDelete={deleteProject}
        />
      ) : (
        <PdfView
          projectId={id}
          project={project}
          recipe={recipe}
          sizeLabels={extraction?.sizes.map(s => s.label) ?? []}
          onSaved={patch => setProject(p => (p ? { ...p, ...patch } : p))}
          onBack={() => setView('info')}
        />
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#FAF7F4]">
      <div className="max-w-sm w-full text-center flex flex-col gap-4">{children}</div>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 border border-stone-200 rounded-lg text-base bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition'
const labelCls = 'block text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5'

// Egen lokal tekst-state, så hvert tastetrykk ikke trigger en lagring: bare når feltet
// mister fokus eller endrer seg fra utsiden (ny verdi lastet inn).
function ColorInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input className={inputCls} placeholder="Farge" value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => { if (text !== value) onCommit(text) }} />
  )
}

function InfoView({ project, recipe, extraction, yarns, combos, swatches, yarnLines, error, onSave, onSaved, onSaveYarnLines, onYarnUpdated, onOpenPdf, onDelete }: {
  project: Project
  recipe: RecipeInfo | null
  extraction: ExtractionData | null
  yarns: YarnRow[]
  combos: RawCombo[]
  swatches: RawSwatch[]
  yarnLines: YarnLine[]
  error: string
  onSave: (body: Record<string, unknown>, optimistic: Partial<Project>) => void
  // A change already saved elsewhere (the cover picture), shown without saving again.
  onSaved: (patch: Partial<Project>) => void
  onSaveYarnLines: (lines: YarnLine[]) => void
  onYarnUpdated: (yarnId: string, patch: { favorite?: boolean | null; price_per_skein?: number | null }) => void
  onOpenPdf: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(project.name)
  const [needles, setNeedles] = useState(project.needles ?? '')
  const [notes, setNotes] = useState(project.notes ?? '')
  const [sizeLabel, setSizeLabel] = useState(project.size_label ?? '')
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const byYarnId = useMemo(() => new Map(yarns.map(y => [y.id, y])), [yarns])

  useEffect(() => setName(project.name), [project.name])
  useEffect(() => setNeedles(project.needles ?? ''), [project.needles])
  useEffect(() => setNotes(project.notes ?? ''), [project.notes])
  useEffect(() => setSizeLabel(project.size_label ?? ''), [project.size_label])

  function setYarnId(position: number, yarnId: string | null) {
    onSaveYarnLines(yarnLines.map(l => (l.position === position ? { ...l, yarn_id: yarnId } : l)))
  }
  function setColorLabel(position: number, label: string) {
    onSaveYarnLines(yarnLines.map(l => (l.position === position ? { ...l, color_label: label } : l)))
  }
  function addLine() {
    onSaveYarnLines([...yarnLines, { position: yarnLines.length, yarn_id: null, color_label: '' }])
  }
  function removeLine(position: number) {
    onSaveYarnLines(yarnLines.filter(l => l.position !== position).map((l, i) => ({ ...l, position: i })))
  }

  const pickerAlternatives = useMemo<Alternative[]>(() => {
    if (pickerFor === null) return []
    const line = yarnLines.find(l => l.position === pickerFor)
    const recipeLine = extraction?.yarn_lines[pickerFor]
    const currentYarn = line?.yarn_id ? byYarnId.get(line.yarn_id) : undefined
    const suggestedYarn = recipeLine?.yarn_id ? byYarnId.get(recipeLine.yarn_id) : undefined
    const targetFibre = currentYarn ? mainFibre(currentYarn.fibers) : suggestedYarn ? mainFibre(suggestedYarn.fibers) : null
    const patternAlternativeYarnIds = extraction && recipeLine
      ? extraction.alternatives
        .filter(a => a.yarn_line === pickerFor || (a.yarn_line === null && a.color_group === recipeLine.color_group))
        .map(a => a.yarn_id).filter((v): v is string => v !== null)
      : []
    return rankAlternatives({
      targetGauge: extraction?.gauge_stitches_10cm ?? null,
      targetFibre,
      excludeYarnId: line?.yarn_id ?? null,
      catalogue: yarns, combos, swatches, patternAlternativeYarnIds,
    })
  }, [pickerFor, yarnLines, extraction, byYarnId, yarns, combos, swatches])

  return (
    <div className="max-w-xl mx-auto px-4 py-4 pb-24">
      <div className="flex items-center justify-between gap-2 mb-4">
        <Link href="/strikk/prosjekter" aria-label="Tilbake til prosjektene"
          className="w-10 h-10 flex items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        {recipe?.drive_file_id && (
          <button onClick={onOpenPdf} className="h-10 px-4 rounded-xl bg-[#2E5339] text-white text-sm font-medium">
            Åpne oppskrift
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      <div className="space-y-5">
        <div>
          <label className={labelCls}>Navn</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name !== project.name) onSave({ name }, { name }) }} />
        </div>

        {recipe?.title && <p className="text-sm text-stone-500">Fra oppskrift: {recipe.title}</p>}

        <CoverSection project={project} recipe={recipe} onChanged={onSaved} />

        <div>
          <label className={labelCls}>Status</label>
          <div className="flex gap-1.5">
            {STATUSES.map(s => (
              <button key={s} onClick={() => onSave({ status: s }, { status: s as ProjectStatus })}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors border ${
                  project.status === s ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200'
                }`}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Størrelse</label>
          {extraction && extraction.sizes.length > 0 ? (
            <select className={inputCls} value={project.size_index ?? ''}
              onChange={e => {
                const i = e.target.value === '' ? null : Number(e.target.value)
                const label = i === null ? null : extraction.sizes[i].label
                onSave({ size_index: i, size_label: label }, { size_index: i, size_label: label })
              }}>
              <option value="">Ikke valgt</option>
              {extraction.sizes.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
            </select>
          ) : (
            <input className={inputCls} value={sizeLabel} onChange={e => setSizeLabel(e.target.value)}
              onBlur={() => { if (sizeLabel !== (project.size_label ?? '')) onSave({ size_label: sizeLabel }, { size_label: sizeLabel || null }) }}
              placeholder="F.eks. M" />
          )}
        </div>

        {yarnLines.length > 0 && (
          <div>
            <label className={labelCls}>Garn</label>
            <div className="flex flex-col gap-3">
              {yarnLines.map(l => {
                const recipeLine = extraction?.yarn_lines[l.position]
                const chosen = l.yarn_id ? byYarnId.get(l.yarn_id) : undefined
                const amount = extraction && project.size_index !== null
                  ? formatAmountForLine(amountForLine(extraction, project.size_index, l.position))
                  : ''
                return (
                  <div key={l.position} className="rounded-xl border border-stone-200 bg-white p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-stone-500">
                        {recipeLine?.color_label || `Garnlinje ${l.position + 1}`}
                        {recipeLine && recipeLine.strands > 1 && ` · ${recipeLine.strands} tråder`}
                      </p>
                      {!extraction && (
                        <button onClick={() => removeLine(l.position)} className="text-xs text-red-700">Fjern</button>
                      )}
                    </div>
                    <button onClick={() => setPickerFor(l.position)}
                      className="w-full text-left px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 text-sm text-stone-800">
                      {chosen ? [chosen.brand, chosen.name].filter(Boolean).join(' ') : 'Velg garn'}
                    </button>
                    <ColorInput value={l.color_label ?? ''} onCommit={v => setColorLabel(l.position, v)} />
                    {amount && <p className="text-xs text-stone-500">{amount}</p>}
                  </div>
                )
              })}
              {!extraction && (
                <button onClick={addLine} className="self-start text-sm text-stone-600 underline">Legg til garnlinje</button>
              )}
            </div>
          </div>
        )}
        {yarnLines.length === 0 && !extraction && (
          <button onClick={addLine} className="self-start text-sm text-stone-600 underline">Legg til garnlinje</button>
        )}

        <div>
          <label className={labelCls}>Pinner</label>
          <input className={inputCls} value={needles} onChange={e => setNeedles(e.target.value)}
            onBlur={() => { if (needles !== (project.needles ?? '')) onSave({ needles }, { needles: needles || null }) }} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Startet</label>
            <input type="date" className={inputCls} value={project.start_date ?? ''}
              onChange={e => onSave({ start_date: e.target.value || null }, { start_date: e.target.value || null })} />
          </div>
          <div>
            <label className={labelCls}>Ferdig</label>
            <input type="date" className={inputCls} value={project.end_date ?? ''}
              onChange={e => onSave({ end_date: e.target.value || null }, { end_date: e.target.value || null })} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Notater</label>
          <textarea className={`${inputCls} min-h-[100px]`} value={notes} onChange={e => setNotes(e.target.value)}
            onBlur={() => { if (notes !== (project.notes ?? '')) onSave({ notes }, { notes: notes || null }) }} />
        </div>

        <button onClick={onDelete} className="text-sm text-red-700 underline">Slett prosjektet</button>
      </div>

      {pickerFor !== null && (
        <YarnPicker
          yarns={yarns}
          value={yarnLines.find(l => l.position === pickerFor)?.yarn_id ?? null}
          suggestedId={extraction?.yarn_lines[pickerFor]?.yarn_id ?? null}
          alternatives={pickerAlternatives}
          amount={pickerFor !== null && extraction && project.size_index !== null ? amountForLine(extraction, project.size_index, pickerFor) : null}
          onSelect={yarnId => setYarnId(pickerFor, yarnId)}
          onYarnUpdated={onYarnUpdated}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  )
}

// Reads the text layer page by page, so the PDF is on screen before this is done.
async function readSizeMarks(doc: PDFDocumentProxy, labels: string[], k: number, cancelled: () => boolean): Promise<SizeMarks | null> {
  const ctx = document.createElement('canvas').getContext('2d')
  const families = new Map<string, string>()
  const measure: Measure = (text, fontName) => {
    if (!ctx) return text.length
    ctx.font = `100px ${(fontName && families.get(fontName)) || 'sans-serif'}`
    return ctx.measureText(text).width
  }
  const pages: PageText[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    if (cancelled()) return null
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    for (const [name, style] of Object.entries(tc.styles)) families.set(name, style.fontFamily)
    pages.push({
      items: tc.items.filter(it => 'str' in it),
      viewport: { width: vp.width, height: vp.height, transform: vp.transform },
    })
  }
  return findSizeMarks(pages, labels, k, measure)
}

function PdfView({ projectId, project, recipe, sizeLabels, onSaved, onBack }: {
  projectId: string
  project: Project
  recipe: { title: string | null; drive_file_id: string; file_name: string } | null
  sizeLabels: string[]
  // What this view saved on its own (position, «Gjeldende side»), so reopening it starts right.
  onSaved: (patch: Partial<Project>) => void
  onBack: () => void
}) {
  const [pdf, setPdf] = useState<PdfState>(() => (
    recipe?.drive_file_id ? { kind: 'idle' } : { kind: 'error', text: 'Prosjektet har ingen oppskrift.' }
  ))
  const [state, setState] = useState<DocState>({ strokes: project.strokes as Stroke[], counters: project.counters as Counter[] })
  const stateRef = useRef(state)
  useLayoutEffect(() => { stateRef.current = state })
  const [undoStack, setUndoStack] = useState<UndoStep[]>(() => readStack(projectId))
  const [start] = useState(() => startPosition(project))
  const [placed, setPlaced] = useState(false)
  const onPlaced = useCallback(() => setPlaced(true), [])
  const [currentPage, setCurrentPage] = useState<number | null>(project.current_page)
  const [pageError, setPageError] = useState<string | null>(null)

  useSavePosition(placed, project.last_page ? { page: project.last_page, offset: project.last_offset ?? 0 } : null, (p, keepalive) => {
    onSaved({ last_page: p.page, last_offset: p.offset })
    patchProject(projectId, { last_page: p.page, last_offset: p.offset }, keepalive).catch(err => console.error('[strikk] position', err))
  })

  async function markCurrentPage(page: number | null) {
    const before = currentPage
    setCurrentPage(page)
    setPageError(null)
    try {
      await patchProject(projectId, { current_page: page })
      onSaved({ current_page: page })
    } catch (err) {
      setCurrentPage(before)
      setPageError(err instanceof Error ? err.message : 'Klarte ikke lagre')
    }
  }
  const pageNow = () => readPosition()?.page ?? 1
  const [tool, setTool] = useState<Tool | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [settings, setSettings] = useState<ToolSettings>(() => readLocal('strikk-project-settings', DEFAULT_SETTINGS))
  const [countersVisible, setCountersVisible] = useState(false)
  const [counterHeight, setCounterHeight] = useState(0)
  const [jsTwoFinger, setJsTwoFinger] = useState(() => readLocal(UI_KEY, DEFAULT_UI).jsTwoFinger)
  const [sizeMarksOn, setSizeMarksOn] = useState(() => readLocal(UI_KEY, DEFAULT_UI).sizeMarks)
  const [sizeResult, setSizeResult] = useState<{ doc: PDFDocumentProxy; key: string; marks: SizeMarks } | null>(null)
  const [sizeMessage, setSizeMessage] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueStatus>({ pending: 0, failed: false })
  const box = useVisualViewportBox()
  const wakeLock = useWakeLock(pdf.kind === 'ready')

  useEffect(() => subscribe(setQueue), [])
  useEffect(() => subscribeServerCounters((docId, counters) => {
    if (docId !== projectId) return
    setState(s => ({ ...s, counters: applyOps({ strokes: [], counters }, pendingOps(docId)).counters }))
  }), [projectId])
  useEffect(() => { writeLocal('strikk-project-settings', settings) }, [settings])
  useEffect(() => { writeLocal(UI_KEY, { jsTwoFinger, sizeMarks: sizeMarksOn }) }, [jsTwoFinger, sizeMarksOn])

  const sizeIndex = project.size_index
  const canMarkSize = sizeIndex !== null && sizeIndex >= 0 && sizeIndex < sizeLabels.length && sizeLabels.length > 1
  const sizeKey = canMarkSize ? `${sizeIndex}|${sizeLabels.join('|')}` : ''
  const doc = pdf.kind === 'ready' ? pdf.doc : null
  // A result for another PDF or size is never shown.
  const sizeMarks = sizeResult && sizeResult.doc === doc && sizeResult.key === sizeKey ? sizeResult.marks : null
  const sizeMarksOnRef = useRef(sizeMarksOn)
  useLayoutEffect(() => { sizeMarksOnRef.current = sizeMarksOn })

  function showSizeMessage(res: SizeMarks | null) {
    if (res?.status === 'no-text') setSizeMessage('PDF-en har ikke tekstlag, så størrelsen kan ikke markeres')
    else if (res?.status === 'none') setSizeMessage('Fant ingen tall for størrelsen i teksten')
    else setSizeMessage(null)
  }

  useEffect(() => {
    if (!doc || !sizeKey) return
    let cancelled = false
    const labels = sizeKey.split('|')
    const k = Number(labels.shift())
    readSizeMarks(doc, labels, k, () => cancelled)
      .then(res => {
        if (cancelled || !res) return
        setSizeResult({ doc, key: sizeKey, marks: res })
        if (sizeMarksOnRef.current) showSizeMessage(res)
      })
      .catch(err => console.error('[strikk] size marks', err))
    return () => { cancelled = true }
  }, [doc, sizeKey])

  useEffect(() => {
    if (!sizeMessage) return
    const t = setTimeout(() => setSizeMessage(null), SIZE_MESSAGE_MS)
    return () => clearTimeout(t)
  }, [sizeMessage])

  function toggleSizeMarks() {
    const on = !sizeMarksOn
    setSizeMarksOn(on)
    if (on) showSizeMessage(sizeMarks)
    else setSizeMessage(null)
  }

  useEffect(() => {
    if (!recipe?.drive_file_id) return
    let cancelled = false
    ;(async () => {
      try {
        setPdf({ kind: 'loading', text: 'Henter PDF fra Disk …' })
        const bytes = await downloadPdf(recipe.drive_file_id, recipe.file_name)
        if (cancelled) return
        setPdf({ kind: 'loading', text: 'Åpner PDF …' })
        const opened = await openPdf(bytes)
        if (cancelled) { void opened.doc.destroy(); return }
        setPdf({ kind: 'ready', doc: opened.doc, sizes: opened.sizes })
      } catch (err) {
        if (cancelled) return
        if (err instanceof DriveAuthExpiredError) setPdf({ kind: 'auth-expired' })
        else if (err instanceof DriveFileMissingError) setPdf({ kind: 'missing', text: err.message })
        else setPdf({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every change also goes to the loaded project, so going to the project page and back
  // to the PDF shows it without a reload.
  function change(ops: Op[]) {
    const next = applyOps(stateRef.current, ops)
    stateRef.current = next
    setState(next)
    onSaved({ strokes: next.strokes, counters: next.counters })
    for (const op of ops) enqueue(projectId, op)
  }

  function commit(op: Op) {
    change([op])
  }

  // A drawing or erasing action: saved like any op, and remembered so it can be undone.
  function commitAction(ops: Op[]) {
    const step = undoOps(stateRef.current, ops)
    change(ops)
    setUndoStack(st => { const next = pushStep(st, step); writeStack(projectId, next); return next })
  }

  // The undo ops go through the same queue, so undoing a saved change is saved too.
  function undo() {
    const { step, stack } = popStep(undoStack)
    setUndoStack(stack)
    writeStack(projectId, stack)
    if (step) change(step)
  }

  function toggleTool(t: Tool) {
    if (tool === t) { setTool(null); setSheetOpen(false) }
    else { setTool(t); setSheetOpen(t !== 'eraser') }
  }

  const onCounterHeight = useCallback((h: number) => setCounterHeight(h), [])
  const drawTool: DrawTool | null = tool === 'marker' || tool === 'pen' ? tool : null
  const active = drawTool ? settings[drawTool] : settings.pen
  const unsaved = queue.pending > 0 && (queue.failed || (typeof navigator !== 'undefined' && !navigator.onLine))

  return (
    <div className="min-h-screen bg-stone-300">
      {pdf.kind === 'ready' && (
        <PdfPages
          doc={pdf.doc}
          sizes={pdf.sizes}
          strokes={state.strokes}
          sizeMarks={sizeMarksOn && sizeMarks?.status === 'ok' ? sizeMarks.pages : null}
          currentPage={currentPage}
          initialPage={start?.page}
          initialOffset={start?.offset ?? 0}
          onPlaced={onPlaced}
          tool={tool}
          color={active.color}
          width={active.width}
          jsTwoFingerScroll={jsTwoFinger}
          bottomPadding={countersVisible ? counterHeight : 0}
          onStrokeAdd={s => commitAction([{ type: 'stroke_add', stroke: s }])}
          onStrokeSplits={splits => commitAction(splits.map(x => ({ type: 'stroke_split' as const, id: x.id, parts: x.parts })))}
          onDrawStart={() => { setSheetOpen(false); setMenuOpen(false) }}
        />
      )}

      {pdf.kind !== 'ready' && (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#FAF7F4]">
          <div className="max-w-sm w-full text-center flex flex-col gap-4">
            {pdf.kind === 'loading' && <p className="text-stone-600">{pdf.text}</p>}
            {pdf.kind === 'error' && <p className="text-red-700 text-sm break-words">{pdf.text}</p>}
            {pdf.kind === 'missing' && <p className="text-stone-700 text-sm break-words">{pdf.text}</p>}
            {pdf.kind === 'auth-expired' && <DriveExpired />}
            <button onClick={onBack} className="h-11 rounded-xl border border-stone-300 bg-white text-stone-800">Tilbake</button>
          </div>
        </div>
      )}

      <div
        className="fixed left-0 top-0 z-40 pointer-events-none"
        style={{
          width: box.width * box.scale,
          height: box.height * box.scale,
          transform: `translate(${box.left}px, ${box.top}px) scale(${1 / box.scale})`,
          transformOrigin: '0 0',
        }}
      >
        <div className="absolute left-3 flex flex-col gap-1 items-start" style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}>
          <button onClick={onBack} aria-label="Tilbake til prosjektet"
            className="pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center shadow-md border bg-white/95 border-stone-300 text-stone-700">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          {unsaved && (
            <span className="pointer-events-auto px-2.5 py-1 rounded-full bg-red-700 text-white text-xs">ikke lagret ({queue.pending})</span>
          )}
          {wakeLock === false && <span className="px-2.5 py-1 rounded-full bg-stone-700 text-white text-xs">skjermlås av</span>}
          {pageError && <span role="alert" className="pointer-events-auto px-2.5 py-1 rounded-full bg-red-700 text-white text-xs">{pageError}</span>}
          {sizeMessage && (
            <span role="status" className="max-w-[16rem] px-2.5 py-1 rounded-2xl bg-stone-700 text-white text-xs">{sizeMessage}</span>
          )}
        </div>

        {pdf.kind === 'ready' && (
          <div className="absolute right-3 flex flex-col gap-2 items-center" style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}>
            <div className="flex gap-2">
              {undoStack.length > 0 && (
                <RoundButton label={`Angre (${undoStack.length})`} on={false} onClick={undo}>
                  <IconUndo />
                </RoundButton>
              )}
              {canMarkSize && (
                <RoundButton label={`Min størrelse (${sizeLabels[sizeIndex!]})`} on={sizeMarksOn} onClick={toggleSizeMarks}>
                  <IconSizeMark />
                </RoundButton>
              )}
              <RoundButton label="Tellere" on={countersVisible} onClick={() => setCountersVisible(v => !v)}>
                <IconCounter />
              </RoundButton>
              <RoundButton label="Verktøy" on={!menuOpen && tool !== null} onClick={() => setMenuOpen(o => !o)}>
                {!menuOpen && tool ? <ToolIcon tool={tool} /> : <IconMenu />}
              </RoundButton>
            </div>
            {menuOpen && (
              <div className="self-end flex flex-col gap-2 items-end">
                <RoundButton label="Markeringstusj" on={tool === 'marker'} onClick={() => toggleTool('marker')}><ToolIcon tool="marker" /></RoundButton>
                <RoundButton label="Penn" on={tool === 'pen'} onClick={() => toggleTool('pen')}><ToolIcon tool="pen" /></RoundButton>
                <RoundButton label="Viskelær" on={tool === 'eraser'} onClick={() => toggleTool('eraser')}><ToolIcon tool="eraser" /></RoundButton>
                <div className="h-px w-8 bg-stone-400 my-1 mr-1.5" />
                <MenuButton onClick={() => { void markCurrentPage(pageNow()); setMenuOpen(false) }}
                  title="Merk som gjeldende side" note="Siden øverst på skjermen. Prosjektet åpnes der neste gang." />
                {currentPage !== null && (
                  <>
                    <MenuButton onClick={() => {
                      const el = document.querySelector<HTMLElement>(`[data-page="${currentPage}"]`)
                      if (el) placeAt(el, 0)
                      setMenuOpen(false)
                    }} title={`Gå til gjeldende side (side ${currentPage})`} />
                    <MenuButton onClick={() => { void markCurrentPage(null); setMenuOpen(false) }} title="Fjern gjeldende side" />
                  </>
                )}
                <div className="h-px w-8 bg-stone-400 my-1 mr-1.5" />
                <button aria-pressed={jsTwoFinger} onClick={() => setJsTwoFinger(v => !v)}
                  className="pointer-events-auto w-52 rounded-2xl px-3 py-2 text-left shadow-md border bg-white/95 border-stone-300">
                  <span className="block text-sm font-medium text-stone-800">{jsTwoFinger ? 'To fingre: app' : 'To fingre: Safari'}</span>
                  <span className="block text-[11px] leading-snug text-stone-500">Gjelder bare blaing med to fingre på mobil mens et verktøy er på.</span>
                </button>
              </div>
            )}
          </div>
        )}

        {pdf.kind === 'ready' && countersVisible && (
          <Counters
            counters={state.counters}
            onHeight={onCounterHeight}
            onAdd={(name, total) => commit({ type: 'counter_add', counter: { id: crypto.randomUUID(), name, total, value: 0 } })}
            onSet={(cid, value) => commit({ type: 'counter_set', id: cid, value })}
            onStep={(cid, delta) => commit({ type: 'counter_step', id: cid, delta, opId: crypto.randomUUID() })}
            onDelete={cid => commit({ type: 'counter_delete', id: cid })}
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
  tool: DrawTool; color: string; width: number
  onColor: (c: string) => void; onWidth: (w: number) => void; onClose: () => void
}) {
  const range = WIDTH_RANGE[tool]
  const isPreset = COLORS.some(c => c.hex.toLowerCase() === color.toLowerCase())
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
          <button key={c.hex} aria-label={c.name} onClick={() => onColor(c.hex)}
            className="w-10 h-10 rounded-full border border-stone-300"
            style={{ backgroundColor: c.hex, boxShadow: color.toLowerCase() === c.hex.toLowerCase() ? '0 0 0 3px #FAF7F4, 0 0 0 5px #44403c' : undefined }} />
        ))}
        <label aria-label="Egen farge" className="relative w-10 h-10 rounded-full border border-stone-300 overflow-hidden"
          style={{ background: isPreset ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : color, boxShadow: !isPreset ? '0 0 0 3px #FAF7F4, 0 0 0 5px #44403c' : undefined }}>
          <input type="color" value={color} onChange={e => onColor(e.target.value)} className="absolute inset-0 opacity-0 w-full h-full" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <input type="range" min={range.min} max={range.max} step={range.step} value={width}
          onChange={e => onWidth(Number(e.target.value))} className="flex-1" aria-label="Tykkelse" />
        <svg width="56" height="32" className="shrink-0">
          <line x1="8" y1="16" x2="48" y2="16" stroke={color} strokeLinecap="round"
            strokeWidth={Math.min(previewPx, 28)} strokeOpacity={tool === 'marker' ? MARKER_OPACITY : 1} />
        </svg>
      </div>
    </div>
  )
}

// The picture on the project's card: Maria's own photo, or the first page of the recipe.
function CoverSection({ project, recipe, onChanged }: {
  project: Project
  recipe: RecipeInfo | null
  onChanged: (c: Pick<Project, 'cover_path' | 'cover_at'>) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const url = coverUrl({ cover_path: project.cover_path, cover_at: project.cover_at, strikk_oppskrift: recipe ? { title: recipe.title ?? '', thumbnail_path: recipe.thumbnail_path, thumbnail_at: recipe.thumbnail_at } : null })

  async function upload(file: File) {
    setErr(null)
    setBusy('Gjør bildet mindre …')
    try {
      const blob = await compressCover(file)
      setBusy('Lagrer …')
      onChanged(await uploadCover(project.id, blob))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Klarte ikke lagre bildet')
    } finally {
      setBusy(null)
    }
  }

  async function backToRecipe() {
    setErr(null)
    setBusy('Fjerner …')
    try {
      await removeCover(project.id)
      onChanged({ cover_path: null, cover_at: null })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Klarte ikke fjerne bildet')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <label className={labelCls}>Forsidebilde</label>
      <div className="flex gap-3 items-start">
        <div className="w-20 h-28 shrink-0 rounded-lg border border-stone-200 bg-stone-100 overflow-hidden">
          {url && (
            // eslint-disable-next-line @next/next/no-img-element -- a small public file; next/image would only add a resize step
            <img src={url} alt="" className="w-full h-full object-cover object-top" />
          )}
        </div>
        <div className="flex flex-col gap-2 items-start min-w-0">
          <p className="text-xs text-stone-500">{project.cover_path ? 'Ditt eget bilde.' : recipe?.thumbnail_path ? 'Første side av oppskriften.' : 'Ingen bilde ennå.'}</p>
          <input ref={input} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
          <button onClick={() => input.current?.click()} disabled={busy !== null}
            className="h-10 px-3 rounded-xl border border-stone-300 bg-white text-sm text-stone-800 disabled:opacity-60">
            Last opp eget bilde
          </button>
          {project.cover_path && (
            <button onClick={() => void backToRecipe()} disabled={busy !== null}
              className="h-10 px-3 rounded-xl text-sm text-stone-600 underline disabled:opacity-60">
              {recipe ? 'Bruk oppskriftens bilde' : 'Fjern bildet'}
            </button>
          )}
          {busy && <p className="text-xs text-stone-500">{busy}</p>}
          {err && <p className="text-xs text-red-700 break-words">{err}</p>}
        </div>
      </div>
    </div>
  )
}

function MenuButton({ onClick, title, note }: { onClick: () => void; title: string; note?: string }) {
  return (
    <button onClick={onClick} className="pointer-events-auto w-52 rounded-2xl px-3 py-2 text-left shadow-md border bg-white/95 border-stone-300">
      <span className="block text-sm font-medium text-stone-800">{title}</span>
      {note && <span className="block text-[11px] leading-snug text-stone-500">{note}</span>}
    </button>
  )
}

function RoundButton({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} aria-pressed={on} title={label} onClick={onClick}
      className={`pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center shadow-md border transition-colors ${
        on ? 'bg-[#2E5339] border-[#2E5339] text-white' : 'bg-white/95 border-stone-300 text-stone-700'
      }`}>
      {children}
    </button>
  )
}

const iconProps = {
  viewBox: '0 0 24 24', className: 'w-5 h-5', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === 'marker') return <svg {...iconProps}><path d="M14.5 4.5l5 5L10 19H5v-5z" /><path d="M12 7l5 5" /><path d="M4 21h8" /></svg>
  if (tool === 'pen') return <svg {...iconProps}><path d="M16.5 3.5l4 4L8 20l-5 1 1-5z" /><path d="M14 6l4 4" /></svg>
  return <svg {...iconProps}><path d="M8.5 20H20" /><path d="M5 15.5l9.5-9.5a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19.5H8.5z" /><path d="M9.5 11l4.5 4.5" /></svg>
}
function IconCounter() {
  return <svg {...iconProps}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 12h4" /><path d="M14.5 12h3" /><path d="M16 10.5v3" /></svg>
}
function IconSizeMark() {
  return (
    <svg {...iconProps}>
      <rect x="3.5" y="7" width="17" height="10" rx="2.5" stroke={SIZE_MARK_COLOR} />
      <path d="M8 12h8" />
    </svg>
  )
}
function IconUndo() {
  return <svg {...iconProps}><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></svg>
}
function IconMenu() {
  return <svg {...iconProps}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></svg>
}
