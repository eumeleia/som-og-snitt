'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { supabase } from '@/lib/supabase'
import { storedToExtraction, type ExtractionData } from '../_lib/extraction'
import { STATUSES, STATUS_LABEL, sortedYarn, startPosition, type Project, type ProjectStatus } from '../_lib/projects'
import { amountForLine, formatAmountForLine } from '../_lib/project-amounts'
import { comboFromRow, swatchFromRow } from '../_lib/combos'
import { rankAlternatives, mainFibre, type Alternative, type RawCombo, type RawSwatch } from '../_lib/yarn-alternatives'
import { applyOps, undoOps, type Counter, type DocState, type Op, type Stroke, type Tool } from '../_lib/markup-ops'
import { popStep, pushStep, readStack, writeStack, type UndoStep } from '../_lib/undo-stack'
import { enqueue, pendingOps, subscribe, subscribeServerCounters, type QueueStatus } from '../_lib/project-save-queue'
import { DriveAuthExpiredError, DriveFileMissingError, downloadPdf } from '../_lib/drive'
import type { YarnRow } from '../_lib/yarns'
import { findSizeMarks, type Measure, type PageText, type SizeMarks } from '../_lib/size-marks'
import PdfPages, { MARKER_OPACITY, SIZE_MARK_COLOR, type PageSize } from './PdfPages'
import { pageAtCenter, placeAt, useSavePosition } from './readingPosition'
import { openPdf } from './PdfViewer'
import { compressCover, coverUrl, removeCover, uploadCover } from '../_lib/cover'
import { MIGRATION_030, PHOTO_SELECT, deletePhoto, isMissingTable, makeCoverPhoto, photoUrl, sortPhotos, uploadPhoto, type ProjectPhoto } from '../_lib/project-photos'
import Counters from './Counters'
import { StitchCalculatorSheet } from './StitchCalculator'
import YarnPicker from './YarnPicker'
import DriveExpired from './DriveExpired'
import AssignedYarnStash from './AssignedYarnStash'
import CompleteProjectModal from './CompleteProjectModal'
import { PinToMenuButton, usePinState } from '@/components/PinToMenuButton'
import { signedInOrOffline } from '@/lib/offline-auth'
import { idbStore, hasIndexedDb, type ProjectBundle } from '../_lib/offline'
import { fetchProjectBundle, OFFLINE_EVENT, ProjectMissingError } from '../_lib/project-bundle'
import { formatPair, type PairMember } from '../_lib/yarn-recipes'

// Colours knitted with a carry-along yarn whose yarns are all in the catalogue, as pairs
// «Finn alternativt garn» can look up.
function heldTogetherPairs(extraction: ExtractionData): { group: number; label: string | null; members: PairMember[] }[] {
  const groups = [...new Set(extraction.yarn_lines.map(l => l.color_group))]
  return groups.flatMap(group => {
    const lines = extraction.yarn_lines.filter(l => l.color_group === group)
    if (lines.length < 2 || lines.some(l => !l.yarn_id)) return []
    return [{ group, label: lines[0].color_label, members: lines.map(l => ({ yarnId: l.yarn_id!, strands: l.strands })) }]
  })
}

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
// With a network the PDF always comes from Disk (and replaces the stored copy of a
// project in progress); without one, the copy stored on this device.
async function pdfOnlineOrStored(fileId: string, fileName: string, inProgress: boolean): Promise<Uint8Array> {
  try {
    const bytes = await downloadPdf(fileId, fileName)
    if (inProgress && hasIndexedDb()) {
      idbStore.putPdf({ fileId, bytes: bytes.slice().buffer as ArrayBuffer, savedAt: new Date().toISOString() })
        .catch(err => console.error('[offline] pdf', err))
    }
    return bytes
  } catch (err) {
    if (err instanceof DriveFileMissingError || !hasIndexedDb()) throw err
    const stored = await idbStore.getPdf(fileId).catch(() => null)
    if (!stored) throw err
    return new Uint8Array(stored.bytes)
  }
}

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

export default function ProjectView({ id, initialView }: { id: string; initialView?: 'info' | 'pdf' }) {
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
  const [view, setView] = useState<'info' | 'pdf'>(initialView ?? 'info')
  // Without a network the page comes from the service worker, stored without its query
  // string, so ?view=pdf is read from the address here as well.
  useEffect(() => {
    // The address can only be read after the first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get('view') === 'pdf') setView('pdf')
  }, [])
  const [error, setError] = useState('')
  // Shown from the copy on this device, because the network failed.
  const [offline, setOffline] = useState(false)

  // Keeps the stored copy up to date with what changes here (strokes, counters, name), so
  // a later visit without a network shows it. Only for a project that is stored.
  useEffect(() => {
    if (!project || project.status !== 'in_progress' || !hasIndexedDb()) return
    const t = setTimeout(() => {
      idbStore.getBundle(id).then(b => {
        if (b) return idbStore.putBundle({ ...b, project, savedAt: new Date().toISOString() })
      }).catch(err => console.error('[offline] update', err))
    }, 1000)
    return () => clearTimeout(t)
  }, [project, id])

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (signedInOrOffline(data.session, error)) setAuthed(true)
      else router.replace('/login')
    })
  }, [router])

  useEffect(() => {
    if (!authed) return
    let cancelled = false
    const show = (b: ProjectBundle) => {
      setProject(b.project)
      setYarnLines(sortedYarn(b.project).map(l => ({ position: l.position, yarn_id: l.yarn_id, color_label: l.color_label })))
      setRecipe(b.recipe)
      setExtraction(b.stored ? storedToExtraction(b.stored) : null)
      setYarns(b.yarns)
      setCombos(b.combos.map(comboFromRow))
      setSwatches(b.swatches.map(swatchFromRow))
      setLoad({ kind: 'ready' })
    }
    ;(async () => {
      setLoad({ kind: 'loading' })
      try {
        const b = await fetchProjectBundle(id)
        if (cancelled) return
        setOffline(false)
        show(b)
        // For «sist åpnet» on Hjem. Quiet: does not count as editing the project.
        patchProject(id, { opened: true }).catch(err => console.error('[strikk] opened', err))
        if (b.project.status === 'in_progress' && hasIndexedDb()) {
          idbStore.putBundle({ ...b, projectId: id, savedAt: new Date().toISOString() })
            .then(() => window.dispatchEvent(new Event(OFFLINE_EVENT)))
            .catch(err => console.error('[offline] save', err))
        }
      } catch (err) {
        if (cancelled) return
        // Without a network: the copy stored on this device, if the project is in progress.
        const stored = err instanceof ProjectMissingError || !hasIndexedDb() ? null : await idbStore.getBundle(id).catch(() => null)
        if (cancelled) return
        if (stored) { setOffline(true); show(stored); return }
        setLoad({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
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
      {offline && view === 'info' && (
        <p role="status" className="max-w-xl mx-auto px-4 pt-3 text-xs text-stone-600">
          Uten nett: viser prosjektet slik det er lagret på enheten. Endringer i tusj og tellere sendes når nettet er tilbake.
        </p>
      )}
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
  const [showComplete, setShowComplete] = useState(false)
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
      targetYarn: currentYarn ?? suggestedYarn ?? null,
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
        <div className="flex items-start gap-2">
          <PinToMenuButton kind="strikk" projectId={project.id}
            className="h-10 px-3 rounded-xl border border-stone-300 bg-white text-stone-700 text-sm font-medium disabled:opacity-50" />
          {recipe?.drive_file_id && (
            <button onClick={onOpenPdf} className="h-10 px-4 rounded-xl bg-[#2E5339] text-white text-sm font-medium">
              Åpne oppskrift
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-700 mb-3">{error}</p>}

      <div className="space-y-5">
        <div>
          <label className={labelCls}>Navn</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)}
            onBlur={() => { if (name.trim() && name !== project.name) onSave({ name }, { name }) }} />
        </div>

        {recipe?.title && <p className="text-sm text-stone-500">Fra oppskrift: {recipe.title}</p>}

        {project.status === 'done'
          ? <PhotosSection projectId={project.id} />
          : <CoverSection project={project} recipe={recipe} onChanged={onSaved} />}

        <div>
          <label className={labelCls}>Status</label>
          <div className="flex gap-1.5">
            {STATUSES.map(s => (
              <button key={s}
                onClick={() => {
                  if (s === 'done' && project.status !== 'done') setShowComplete(true)
                  else onSave({ status: s }, { status: s as ProjectStatus })
                }}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors border ${
                  project.status === s ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200'
                }`}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <AssignedYarnStash projectId={project.id} />

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
              {project.oppskrift_id && extraction && heldTogetherPairs(extraction).map(p => (
                <Link key={p.group} href={`/strikk/garnlager?tab=alternativ&pair=${formatPair(p.members)}&recipe=${project.oppskrift_id}&group=${p.group}`}
                  className="self-start text-sm text-[#8B6340] underline">
                  Finn alternativer til paret{p.label ? ` (${p.label})` : ''}
                </Link>
              ))}
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
      {showComplete && (
        <CompleteProjectModal
          projectId={project.id}
          onCancel={() => setShowComplete(false)}
          onDone={() => { setShowComplete(false); onSaved({ status: 'done' }) }}
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
  // Changes not yet sent (made without a network, or still on their way) on top of the
  // saved project, so they show again when the project is reopened.
  const [state, setState] = useState<DocState>(() => applyOps(
    { strokes: project.strokes as Stroke[], counters: project.counters as Counter[] }, pendingOps(projectId),
  ))
  const stateRef = useRef(state)
  useLayoutEffect(() => { stateRef.current = state })
  const [undoStack, setUndoStack] = useState<UndoStep[]>(() => readStack(projectId))
  const pin = usePinState('strikk', projectId)
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
  const pageNow = () => pageAtCenter() ?? 1
  const [tool, setTool] = useState<Tool | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [settings, setSettings] = useState<ToolSettings>(() => readLocal('strikk-project-settings', DEFAULT_SETTINGS))
  const [countersVisible, setCountersVisible] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)
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
        const bytes = await pdfOnlineOrStored(recipe.drive_file_id, recipe.file_name, project.status === 'in_progress')
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
              <RoundButton label="Øke/felle-kalkulator" on={calcOpen} onClick={() => setCalcOpen(true)}>
                <span className="text-lg leading-none">±</span>
              </RoundButton>
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
                  title="Merk som gjeldende side" note="Siden midt på skjermen. Prosjektet åpnes der neste gang." />
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
                <MenuButton onClick={() => { void pin.toggle() }} title={pin.label}
                  note={pin.error ?? 'Snarvei øverst i sidemenyen. Erstatter forrige festede strikkeprosjekt.'} />
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
            onEdit={(cid, name, total) => commit({ type: 'counter_edit', id: cid, name, total })}
          />
        )}

        {calcOpen && <StitchCalculatorSheet onClose={() => setCalcOpen(false)} />}

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

// Photos of a finished project. The first is the cover on the project's card.
function PhotosSection({ projectId }: { projectId: string }) {
  const [photos, setPhotos] = useState<ProjectPhoto[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    void supabase.from('strikk_project_photo').select(PHOTO_SELECT).eq('project_id', projectId).then(({ data, error }) => {
      if (!alive) return
      if (error) { if (isMissingTable(error)) setMissing(true); else setErr(error.message); setPhotos([]); return }
      setPhotos(sortPhotos((data ?? []) as ProjectPhoto[]))
    })
    return () => { alive = false }
  }, [projectId])

  async function add(files: File[]) {
    setErr(null)
    let added = 0
    try {
      for (const [i, file] of files.entries()) {
        setBusy(files.length > 1 ? `Bilde ${i + 1} av ${files.length}: gjør det mindre …` : 'Gjør bildet mindre …')
        const blob = await compressCover(file)
        setBusy(files.length > 1 ? `Bilde ${i + 1} av ${files.length}: lagrer …` : 'Lagrer …')
        const row = await uploadPhoto(projectId, blob)
        setPhotos(ps => sortPhotos([...(ps ?? []), row]))
        added++
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Klarte ikke lagre bildet'
      setErr(added ? `${added} av ${files.length} ble lagret. ${msg}` : msg)
    } finally {
      setBusy(null)
    }
  }

  async function act(kind: 'cover' | 'delete', id: string) {
    setErr(null)
    setBusy(kind === 'cover' ? 'Lagrer …' : 'Sletter …')
    try {
      if (kind === 'cover') {
        const row = await makeCoverPhoto(projectId, id)
        setPhotos(ps => sortPhotos((ps ?? []).map(p => (p.id === id ? row : p))))
      } else {
        await deletePhoto(projectId, id)
        setPhotos(ps => (ps ?? []).filter(p => p.id !== id))
        setSelected(null)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Klarte ikke lagre')
    } finally {
      setBusy(null)
      setConfirmDelete(false)
    }
  }

  const chosen = photos?.find(p => p.id === selected) ?? null
  return (
    <div data-project-photos>
      <label className={labelCls}>Bilder</label>
      {missing ? <p className="text-xs text-amber-800">{MIGRATION_030}</p> : (
        <>
          {photos && photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 mb-2">
              {photos.map((p, i) => {
                const url = photoUrl(p.path)
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => { setSelected(s => (s === p.id ? null : p.id)); setConfirmDelete(false) }}
                      aria-pressed={selected === p.id} aria-label={i === 0 ? 'Forsidebilde. Velg' : `Bilde ${i + 1}. Velg`}
                      className={`relative block w-full aspect-square rounded-lg overflow-hidden bg-stone-100 border-2 ${selected === p.id ? 'border-[#2E5339]' : 'border-transparent'}`}>
                      {url && (
                        // eslint-disable-next-line @next/next/no-img-element -- a small public file; next/image would only add a resize step
                        <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                      )}
                      {i === 0 && <span className="absolute left-1 bottom-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-stone-700">Forsidebilde</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {chosen && (
            <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
              {photos?.[0]?.id !== chosen.id && (
                <button onClick={() => void act('cover', chosen.id)} disabled={busy !== null}
                  className="h-9 px-3 rounded-xl border border-stone-300 bg-white text-stone-800 disabled:opacity-60">Gjør til forsidebilde</button>
              )}
              {confirmDelete ? (
                <>
                  <span className="text-stone-600">Slette bildet?</span>
                  <button onClick={() => void act('delete', chosen.id)} disabled={busy !== null} className="h-9 px-3 rounded-xl bg-red-700 text-white disabled:opacity-60">Slett</button>
                  <button onClick={() => setConfirmDelete(false)} className="h-9 px-2 text-stone-500">Avbryt</button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(true)} disabled={busy !== null} className="h-9 px-2 text-red-700 underline disabled:opacity-60">Slett</button>
              )}
            </div>
          )}
          <input ref={input} type="file" accept="image/*" multiple className="hidden"
            onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; if (fs.length) void add(fs) }} />
          <button onClick={() => input.current?.click()} disabled={busy !== null || photos === null}
            className="h-10 px-3 rounded-xl border border-stone-300 bg-white text-sm text-stone-800 disabled:opacity-60">
            {photos?.length ? 'Legg til flere bilder' : 'Legg til bilder'}
          </button>
          {photos?.length === 0 && !busy && <p className="text-xs text-stone-500 mt-1">Det første bildet blir forsidebilde.</p>}
        </>
      )}
      {busy && <p className="text-xs text-stone-500 mt-1">{busy}</p>}
      {err && <p className="text-xs text-red-700 mt-1 break-words">{err}</p>}
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
