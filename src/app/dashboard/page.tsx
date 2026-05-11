'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode, type ChangeEvent } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Status    = 'Aktiv' | 'Planlagt' | 'Fullført'
type Category  = 'Klær' | 'Interiør' | 'Tilbehør' | 'Reparasjoner'
type PdfType   = 'Oppskrift' | 'Mønster' | 'Annet'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface ImageItem { id: string; url: string }
interface PdfItem   { id: string; name: string; url: string; type: PdfType; source: 'upload' | 'link' }

interface FabricCalcState { pdfId: string; size: string; result: string }
interface CareState       { sourceUrl: string; details: string; loading: boolean }

interface ProjectData {
  name: string; status: Status; category: Category; date: string; notes: string
  images: ImageItem[]; pdfs: PdfItem[]
  fabricCalc: FabricCalcState; care: CareState
  focalX: number; focalY: number
}

interface Project { id: string; created_at: string; data: ProjectData }

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUSES:   Status[]   = ['Aktiv', 'Planlagt', 'Fullført']
const CATEGORIES: Category[] = ['Klær', 'Interiør', 'Tilbehør', 'Reparasjoner']
const PDF_TYPES:  PdfType[]  = ['Oppskrift', 'Mønster', 'Annet']

const STATUS_STYLE: Record<Status, string> = {
  Aktiv:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  Planlagt: 'bg-amber-50 text-amber-700 border-amber-200',
  Fullført: 'bg-sky-50 text-sky-700 border-sky-200',
}
const CATEGORY_STYLE: Record<Category, string> = {
  Klær:         'bg-rose-50 text-rose-700 border-rose-200',
  Interiør:     'bg-sky-50 text-sky-700 border-sky-200',
  Tilbehør:     'bg-teal-50 text-teal-700 border-teal-200',
  Reparasjoner: 'bg-orange-50 text-orange-700 border-orange-200',
}
const PDF_TYPE_STYLE: Record<PdfType, string> = {
  Oppskrift: 'bg-rose-50 text-rose-700 border-rose-200',
  Mønster:   'bg-teal-50 text-teal-700 border-teal-200',
  Annet:     'bg-stone-50 text-stone-500 border-stone-200',
}

const EMPTY: ProjectData = {
  name: '', status: 'Planlagt', category: 'Klær', date: '', notes: '',
  images: [], pdfs: [],
  fabricCalc: { pdfId: '', size: '', result: '' },
  care:        { sourceUrl: '', details: '', loading: false },
  focalX: 50, focalY: 50,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid()   { return Math.random().toString(36).slice(2, 10) }
function toDay() { return new Date().toISOString().split('T')[0] }
function fmtDate(d: string) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y}`
}

async function apiClaude(prompt: string, pdfBase64?: string): Promise<string> {
  const r = await fetch('/api/claude', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, pdfBase64 }),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  return j.result
}

async function apiFetchPdf(url: string): Promise<string> {
  const r = await fetch('/api/fetch-pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  return j.data
}

async function apiFetchUrl(url: string): Promise<string> {
  const r = await fetch('/api/fetch-url', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  return j.content
}

async function fetchPdfBase64Client(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition'
const labelCls = 'block text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5'

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-70" />
}

function SectionHeading({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <div className={`flex items-center gap-4 mb-5 ${first ? '' : 'mt-12'}`}>
      <h2 className="font-serif text-xl text-stone-600 whitespace-nowrap">{children}</h2>
      <div className="flex-1 border-t border-stone-200" />
    </div>
  )
}

// ── ProjectCard ───────────────────────────────────────────────────────────────

function ProjectCard({ project, onEdit, onDelete }: {
  project: Project; onEdit: () => void; onDelete: () => void
}) {
  const d = project.data
  const cover = d.images[0]?.url

  return (
    <article
      onClick={onEdit}
      className="group bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col"
    >
      <div className="h-44 bg-stone-50 overflow-hidden flex-shrink-0">
        {cover
          ? <img src={cover} alt={d.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              style={{ objectPosition: `${d.focalX ?? 50}% ${d.focalY ?? 50}%` }} />
          : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-10 h-10 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm0 0v6h6" />
              </svg>
            </div>
          )
        }
      </div>

      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-serif text-xl font-semibold text-stone-800 mb-2 truncate leading-tight">
          {d.name || <span className="text-stone-300 italic font-light">Uten navn</span>}
        </h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Badge label={d.status}   cls={STATUS_STYLE[d.status]} />
          <Badge label={d.category} cls={CATEGORY_STYLE[d.category]} />
        </div>
        {d.date  && <p className="text-xs text-stone-400 mb-2">{fmtDate(d.date)}</p>}
        {d.notes && <p className="text-sm text-stone-500 line-clamp-2 flex-1">{d.notes}</p>}

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100">
          <div className="flex gap-3 text-xs text-stone-400">
            {d.images.length > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {d.images.length}
              </span>
            )}
            {d.pdfs.length > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                </svg>
                {d.pdfs.length}
              </span>
            )}
          </div>
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  )
}

// ── ImageUploadModal ──────────────────────────────────────────────────────────

function ImageUploadModal({ onAdd, onClose }: {
  onAdd: (url: string) => void
  onClose: () => void
}) {
  const [tab, setTab]         = useState<'file' | 'url'>('file')
  const [url, setUrl]         = useState('')
  const [file, setFile]       = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError]     = useState('')
  const fileInputRef          = useRef<HTMLInputElement>(null)

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null)
    setError('')
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('project-images')
        .upload(filename, file, { contentType: file.type })
      if (uploadErr) throw uploadErr
      const { data } = supabase.storage.from('project-images').getPublicUrl(filename)
      onAdd(data.publicUrl)
      onClose()
    } catch {
      setError('Opplasting feilet. Prøv igjen.')
    } finally {
      setUploading(false)
    }
  }

  function handleUrl() {
    if (!url.trim()) return
    onAdd(url.trim())
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        <div className="flex border-b border-stone-100">
          {(['file', 'url'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3.5 text-sm font-medium transition-colors border-b-2 ${
                tab === t
                  ? 'text-stone-800 border-stone-800'
                  : 'text-stone-400 border-transparent hover:text-stone-600'
              }`}>
              {t === 'file' ? 'Last opp fil' : 'Lim inn URL'}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {tab === 'file' ? (
            <>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-stone-200 rounded-xl p-8 text-center cursor-pointer hover:border-stone-300 hover:bg-stone-50 transition-colors">
                {file ? (
                  <p className="text-sm text-stone-700 font-medium truncate">{file.name}</p>
                ) : (
                  <>
                    <svg className="w-10 h-10 text-stone-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm text-stone-400">Trykk for å velge bilde</p>
                    <p className="text-xs text-stone-300 mt-1">JPG, PNG, WEBP</p>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
                className="hidden" onChange={handleFileChange} />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button onClick={handleUpload} disabled={!file || uploading}
                className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {uploading && <Spinner />}
                {uploading ? 'Laster opp…' : 'Last opp'}
              </button>
            </>
          ) : (
            <>
              <div>
                <label className={labelCls}>Bilde-URL</label>
                <input className={inputCls} value={url} autoFocus
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleUrl()}
                  placeholder="https://…" />
              </div>
              <button onClick={handleUrl} disabled={!url.trim()}
                className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                Legg til
              </button>
            </>
          )}
          <button onClick={onClose}
            className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
            Avbryt
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FocalPointModal ───────────────────────────────────────────────────────────

function FocalPointModal({ imageUrl, focalX, focalY, onSave, onClose }: {
  imageUrl: string
  focalX: number
  focalY: number
  onSave: (x: number, y: number) => void
  onClose: () => void
}) {
  const [pos, setPos] = useState({ x: focalX, y: focalY })

  function pick(e: React.PointerEvent<HTMLImageElement>) {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)))
    const y = Math.round(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)))
    setPos({ x, y })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '95vh' }}>

        <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-stone-800">Velg fokuspunkt</h3>
          <p className="text-xs text-stone-400 mt-0.5">Klikk på bildet for å sette fokuspunktet</p>
        </div>

        <div className="flex-1 bg-stone-900 flex items-center justify-center overflow-hidden min-h-0 p-2">
          <div className="relative" style={{ touchAction: 'none' }}>
            <img
              src={imageUrl}
              alt=""
              onPointerDown={pick}
              style={{ maxHeight: '75vh', maxWidth: '100%', display: 'block', cursor: 'crosshair', userSelect: 'none' }}
              draggable={false}
            />
            <div style={{
              position: 'absolute',
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}>
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                <circle cx="18" cy="18" r="11" stroke="rgba(0,0,0,0.4)" strokeWidth="3" fill="none" />
                <circle cx="18" cy="18" r="11" stroke="white" strokeWidth="2" fill="rgba(255,255,255,0.15)" />
                <line x1="18" y1="4" x2="18" y2="13" stroke="rgba(0,0,0,0.4)" strokeWidth="3" strokeLinecap="round" />
                <line x1="18" y1="4" x2="18" y2="13" stroke="white" strokeWidth="2" strokeLinecap="round" />
                <line x1="18" y1="23" x2="18" y2="32" stroke="rgba(0,0,0,0.4)" strokeWidth="3" strokeLinecap="round" />
                <line x1="18" y1="23" x2="18" y2="32" stroke="white" strokeWidth="2" strokeLinecap="round" />
                <line x1="4" y1="18" x2="13" y2="18" stroke="rgba(0,0,0,0.4)" strokeWidth="3" strokeLinecap="round" />
                <line x1="4" y1="18" x2="13" y2="18" stroke="white" strokeWidth="2" strokeLinecap="round" />
                <line x1="23" y1="18" x2="32" y2="18" stroke="rgba(0,0,0,0.4)" strokeWidth="3" strokeLinecap="round" />
                <line x1="23" y1="18" x2="32" y2="18" stroke="white" strokeWidth="2" strokeLinecap="round" />
                <circle cx="18" cy="18" r="2.5" fill="rgba(0,0,0,0.4)" />
                <circle cx="18" cy="18" r="2" fill="white" />
              </svg>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end px-5 py-4 border-t border-stone-100 flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 rounded-lg transition-colors">
            Avbryt
          </button>
          <button
            onClick={() => { onSave(pos.x, pos.y); onClose() }}
            className="px-5 py-2 text-sm bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors font-medium">
            Lagre
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ProjectDetail ─────────────────────────────────────────────────────────────

function ProjectDetail({ project, onBack, onSaved, onDelete }: {
  project: Project | null
  onBack: () => void
  onSaved: () => void
  onDelete?: () => void
}) {
  const [form, setForm] = useState<ProjectData>(() =>
    project ? structuredClone(project.data) : structuredClone(EMPTY)
  )
  const [saveStatus, setSaveStatus]       = useState<SaveStatus>('idle')
  const [showImgModal, setShowImgModal]   = useState(false)
  const [showFocalModal, setShowFocalModal] = useState(false)
  const [toast, setToast]                 = useState('')

  // PDF form state
  const [pdfTab, setPdfTab]         = useState<'file' | 'link'>('file')
  const [pdfFile, setPdfFile]       = useState<File | null>(null)
  const [pdfUrl, setPdfUrl]         = useState('')
  const [pdfName, setPdfName]       = useState('')
  const [pdfType, setPdfType]       = useState<PdfType>('Oppskrift')
  const [pdfUploading, setPdfUploading] = useState(false)
  const pdfFileInputRef             = useRef<HTMLInputElement>(null)

  // Stoffberegner ephemeral state
  const [calcAvailableSizes, setCalcAvailableSizes] = useState<string[]>([])
  const [calcLoadingStep, setCalcLoadingStep]       = useState<'' | 'sizes' | 'calc'>('')
  const [calcError, setCalcError]                   = useState('')
  const pdfBase64CacheRef = useRef<Record<string, string>>({})

  const projectIdRef = useRef<string | null>(project?.id ?? null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef   = useRef<ProjectData>(form)

  function upd(patch: Partial<ProjectData>) {
    setForm(f => {
      const next = { ...f, ...patch }
      pendingRef.current = next
      return next
    })
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function doSave(data: ProjectData, id: string | null) {
    if (!data.name.trim()) { setSaveStatus('idle'); return }
    setSaveStatus('saving')
    try {
      if (id) {
        const { error } = await supabase.from('projects').update({ data }).eq('id', id)
        if (error) throw error
      } else {
        const { data: rows, error } = await supabase.from('projects').insert({ data }).select()
        if (error) throw error
        const newId = (rows as Project[])?.[0]?.id
        if (newId) projectIdRef.current = newId
      }
      setSaveStatus('saved')
      onSaved()
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000)
    } catch {
      setSaveStatus('error')
      showToast('Kunne ikke lagre. Prøv igjen.')
    }
  }

  useEffect(() => {
    if (!form.name.trim()) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(() => {
      doSave(pendingRef.current, projectIdRef.current)
    }, 1500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  async function handleBack() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      await doSave(pendingRef.current, projectIdRef.current)
    }
    onBack()
  }

  // ── Image handlers ─────────────────────────────────────────────────────────

  function addImage(url: string) { upd({ images: [...form.images, { id: uid(), url }] }) }
  function removeImage(id: string) { upd({ images: form.images.filter(i => i.id !== id) }) }

  // ── PDF handlers ───────────────────────────────────────────────────────────

  async function handlePdfUpload() {
    if (!pdfFile) return
    setPdfUploading(true)
    try {
      const ext = pdfFile.name.split('.').pop() ?? 'pdf'
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('project-images')
        .upload(filename, pdfFile, { contentType: 'application/pdf' })
      if (uploadErr) throw uploadErr
      const { data } = supabase.storage.from('project-images').getPublicUrl(filename)
      upd({
        pdfs: [...form.pdfs, {
          id: uid(),
          name: pdfName.trim() || pdfFile.name,
          url: data.publicUrl,
          type: pdfType,
          source: 'upload',
        }],
      })
      setPdfFile(null)
      setPdfName('')
    } catch {
      showToast('Opplasting feilet. Prøv igjen.')
    } finally {
      setPdfUploading(false)
    }
  }

  function addPdfLink() {
    if (!pdfUrl.trim()) return
    upd({
      pdfs: [...form.pdfs, {
        id: uid(),
        name: pdfName.trim() || 'PDF',
        url: pdfUrl.trim(),
        type: pdfType,
        source: 'link',
      }],
    })
    setPdfUrl('')
    setPdfName('')
  }

  function removePdf(id: string) {
    const patch: Partial<ProjectData> = { pdfs: form.pdfs.filter(p => p.id !== id) }
    if (form.fabricCalc.pdfId === id) {
      patch.fabricCalc = { pdfId: '', size: '', result: '' }
      setCalcAvailableSizes([])
      setCalcError('')
    }
    upd(patch)
  }

  function updatePdfType(id: string, type: PdfType) {
    upd({ pdfs: form.pdfs.map(p => p.id === id ? { ...p, type, source: p.source ?? 'link' } : p) })
  }

  // ── Stoffberegner helpers ──────────────────────────────────────────────────

  async function getPdfBase64(pdf: PdfItem): Promise<string> {
    if (pdfBase64CacheRef.current[pdf.id]) return pdfBase64CacheRef.current[pdf.id]
    const source = pdf.source ?? 'link'
    const base64 = source === 'upload'
      ? await fetchPdfBase64Client(pdf.url)
      : await apiFetchPdf(pdf.url)
    pdfBase64CacheRef.current[pdf.id] = base64
    return base64
  }

  async function selectSizes(pdf: PdfItem) {
    setCalcAvailableSizes([])
    setCalcError('')
    setCalcLoadingStep('sizes')
    upd({ fabricCalc: { pdfId: pdf.id, size: '', result: '' } })
    try {
      const base64 = await getPdfBase64(pdf)
      const prompt =
        `Analyser dette symønsteret og finn alle tilgjengelige størrelser.\n` +
        `Svar BARE med en JSON-array av størrelser som strenger, f.eks: ["36","38","40","42"] eller ["XS","S","M","L","XL"].\n` +
        `Ingen annen tekst. Kun JSON-arrayen.`
      const result = await apiClaude(prompt, base64)
      const trimmed = result.trim()
      const start = trimmed.indexOf('[')
      const end   = trimmed.lastIndexOf(']')
      if (start === -1 || end === -1) throw new Error('Fant ingen størrelsesliste i mønsteret')
      const sizes: string[] = JSON.parse(trimmed.slice(start, end + 1))
      if (!Array.isArray(sizes) || sizes.length === 0) throw new Error('Ingen størrelser funnet')
      setCalcAvailableSizes(sizes)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ukjent feil'
      setCalcError(`Kunne ikke lese størrelser: ${msg}`)
    } finally {
      setCalcLoadingStep('')
    }
  }

  async function runFabricCalc() {
    const pdf = form.pdfs.find(p => p.id === form.fabricCalc.pdfId)
    if (!pdf || !form.fabricCalc.size) return
    setCalcError('')
    setCalcLoadingStep('calc')
    try {
      const base64 = await getPdfBase64(pdf)
      const prompt =
        `Analyser dette symønsteret. Finn stoffbehovet for størrelse ${form.fabricCalc.size}.\n` +
        `Svar på norsk. List opp stoff type, bredde, lengde og evt. tilbehør som glidelås og knapper.\n` +
        `Bullet points, kort og presist med konkrete mål.`
      const result = await apiClaude(prompt, base64)
      upd({ fabricCalc: { ...form.fabricCalc, result } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ukjent feil'
      setCalcError(`Beregning feilet: ${msg}`)
    } finally {
      setCalcLoadingStep('')
    }
  }

  async function runCareImport() {
    if (!form.care.sourceUrl) return
    upd({ care: { ...form.care, loading: true } })
    try {
      const content = await apiFetchUrl(form.care.sourceUrl)
      const prompt =
        `Tekst fra en produktside om et stoff:\n\n${content}\n\n` +
        `Ekstraher vedlikeholds- og pleieinstruksjonene på norsk. ` +
        `Inkluder vasketemperatur, tørking, stryking, bleking og spesielle hensyn. ` +
        `Bullet points, kort og konkret.`
      const details = await apiClaude(prompt)
      upd({ care: { ...form.care, details, loading: false } })
    } catch {
      upd({ care: { ...form.care, loading: false } })
      showToast('Kunne ikke hente siden – sjekk URL og prøv igjen.')
    }
  }

  const cover = form.images[0]
  const oppskriftPdfs = form.pdfs.filter(p => (p.type ?? 'Annet') === 'Oppskrift')

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAF7F4' }}>

      {/* Sticky header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={handleBack}
            className="p-2 -ml-1 rounded-xl hover:bg-stone-100 transition-colors text-stone-500 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <h1 className="font-serif text-xl sm:text-2xl text-stone-800 flex-1 truncate">
            {form.name || <span className="text-stone-300 font-light italic">Nytt prosjekt</span>}
          </h1>

          <div className="flex items-center gap-3 flex-shrink-0">
            {saveStatus === 'saving' && (
              <span className="text-xs text-stone-400 flex items-center gap-1.5"><Spinner /> Lagrer…</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-emerald-500 font-medium">Lagret ✓</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-xs text-red-400">Feil ved lagring</span>
            )}
            {onDelete && (
              <button onClick={onDelete} className="text-sm text-stone-400 hover:text-red-500 transition-colors">
                Slett
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-24">

        {/* ── Detaljer ── */}
        <SectionHeading first>Detaljer</SectionHeading>
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Prosjektnavn</label>
            <input className={inputCls} value={form.name} autoFocus
              onChange={e => upd({ name: e.target.value })}
              placeholder="Gi prosjektet et navn…" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status}
                onChange={e => upd({ status: e.target.value as Status })}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Kategori</label>
              <select className={inputCls} value={form.category}
                onChange={e => upd({ category: e.target.value as Category })}>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Dato</label>
            <div className="flex gap-2">
              <input type="date" className={`${inputCls} flex-1`} value={form.date}
                onChange={e => upd({ date: e.target.value })} />
              <button onClick={() => upd({ date: toDay() })}
                className="px-4 py-2 text-sm border border-stone-200 rounded-lg bg-white hover:bg-stone-50 text-stone-600 transition-colors">
                I dag
              </button>
            </div>
          </div>
          {form.fabricCalc.size && (
            <div>
              <label className={labelCls}>Valgt størrelse</label>
              <input className={inputCls} value={form.fabricCalc.size}
                onChange={e => upd({ fabricCalc: { ...form.fabricCalc, size: e.target.value, result: '' } })}
                placeholder="F.eks. 38, M…" />
            </div>
          )}
        </div>

        {/* ── Forsidebilde ── */}
        <SectionHeading>Forsidebilde</SectionHeading>
        <div className="space-y-3">
          {cover ? (
            <>
              <div className="relative group rounded-2xl overflow-hidden bg-stone-100" style={{ height: '300px' }}>
                <img src={cover.url} alt="" className="w-full h-full object-cover"
                  style={{ objectPosition: `${form.focalX ?? 50}% ${form.focalY ?? 50}%` }} />
                <button onClick={() => removeImage(cover.id)}
                  className="absolute top-3 right-3 p-2 bg-white/90 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50">
                  <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <button onClick={() => setShowImgModal(true)}
                  className="absolute bottom-3 right-3 p-2 bg-white/90 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-stone-50">
                  <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              <button onClick={() => setShowFocalModal(true)}
                className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors self-start mt-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3M12 18v3M3 12h3M18 12h3" />
                </svg>
                Velg fokuspunkt
              </button>
            </>
          ) : (
            <button onClick={() => setShowImgModal(true)}
              className="w-full rounded-2xl bg-stone-100 hover:bg-stone-150 transition-colors flex flex-col items-center justify-center gap-3 text-stone-300 hover:text-stone-400"
              style={{ height: '300px' }}>
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium text-stone-400">Legg til bilde</span>
            </button>
          )}
          {form.images.length > 1 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {form.images.slice(1).map(img => (
                <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden bg-stone-100">
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => removeImage(img.id)}
                    className="absolute top-1.5 right-1.5 p-1.5 bg-white/90 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50">
                    <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button onClick={() => setShowImgModal(true)}
                className="aspect-square rounded-xl border-2 border-dashed border-stone-200 hover:border-stone-300 hover:bg-stone-50 transition-colors flex items-center justify-center text-stone-300 hover:text-stone-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* ── Notater & Justeringer ── */}
        <SectionHeading>Notater &amp; Justeringer</SectionHeading>
        <textarea className={`${inputCls} resize-y`} style={{ minHeight: 180 }}
          value={form.notes}
          onChange={e => upd({ notes: e.target.value })}
          placeholder="Stoff, teknikker, endringer, observasjoner…" />

        {/* ── PDF-arkiv ── */}
        <SectionHeading>PDF-arkiv</SectionHeading>
        <div className="space-y-4">

          {/* Add PDF form */}
          <div className="bg-stone-50 rounded-xl border border-stone-100 overflow-hidden">
            <div className="flex border-b border-stone-100">
              {(['file', 'link'] as const).map(t => (
                <button key={t} onClick={() => setPdfTab(t)}
                  className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 ${
                    pdfTab === t
                      ? 'text-stone-800 border-stone-800'
                      : 'text-stone-400 border-transparent hover:text-stone-600'
                  }`}>
                  {t === 'file' ? 'Last opp fil' : 'Lim inn lenke'}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className={labelCls}>Navn</label>
                <input className={inputCls} value={pdfName}
                  onChange={e => setPdfName(e.target.value)}
                  placeholder="Navn på fil…" />
              </div>

              <div>
                <label className={labelCls}>Type</label>
                <div className="flex gap-2">
                  {PDF_TYPES.map(t => (
                    <button key={t} onClick={() => setPdfType(t)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        pdfType === t
                          ? 'bg-stone-800 text-white border-stone-800'
                          : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {pdfTab === 'file' ? (
                <>
                  <div
                    onClick={() => pdfFileInputRef.current?.click()}
                    className="border-2 border-dashed border-stone-200 rounded-xl p-6 text-center cursor-pointer hover:border-stone-300 hover:bg-white transition-colors">
                    {pdfFile ? (
                      <p className="text-sm text-stone-700 font-medium truncate">{pdfFile.name}</p>
                    ) : (
                      <>
                        <svg className="w-8 h-8 text-stone-300 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-sm text-stone-400">Trykk for å velge PDF</p>
                      </>
                    )}
                  </div>
                  <input ref={pdfFileInputRef} type="file" accept="application/pdf"
                    className="hidden"
                    onChange={e => setPdfFile(e.target.files?.[0] ?? null)} />
                  <button onClick={handlePdfUpload} disabled={!pdfFile || pdfUploading}
                    className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {pdfUploading && <Spinner />}
                    {pdfUploading ? 'Laster opp…' : 'Last opp'}
                  </button>
                </>
              ) : (
                <>
                  <div>
                    <label className={labelCls}>URL (Google Drive, direkte lenke…)</label>
                    <input className={inputCls} value={pdfUrl}
                      onChange={e => setPdfUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addPdfLink()}
                      placeholder="https://…" />
                  </div>
                  <button onClick={addPdfLink} disabled={!pdfUrl.trim()}
                    className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    Legg til
                  </button>
                </>
              )}
            </div>
          </div>

          {/* PDF list */}
          {form.pdfs.length > 0 ? (
            <ul className="divide-y divide-stone-100">
              {form.pdfs.map(pdf => {
                const typeVal = pdf.type ?? 'Annet'
                return (
                  <li key={pdf.id} className="flex items-center justify-between py-3 gap-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <p className="text-sm font-medium text-stone-700 truncate">{pdf.name}</p>
                          <Badge label={typeVal} cls={PDF_TYPE_STYLE[typeVal]} />
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <a href={pdf.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-sky-500 hover:underline">
                            Åpne ↗
                          </a>
                          <select
                            value={typeVal}
                            onChange={e => updatePdfType(pdf.id, e.target.value as PdfType)}
                            className="text-xs text-stone-400 bg-transparent border-none outline-none cursor-pointer hover:text-stone-600 transition-colors">
                            {PDF_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => removePdf(pdf.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-center py-8 text-sm text-stone-300">Ingen PDF-er ennå</p>
          )}
        </div>

        {/* ── Stoffberegner ── */}
        <SectionHeading>Stoffberegner</SectionHeading>
        <div className="space-y-4">
          {oppskriftPdfs.length === 0 ? (
            <p className="text-sm text-stone-400 italic">
              Merk en PDF som «Oppskrift» i PDF-arkivet for å bruke stoffberegneren.
            </p>
          ) : (
            oppskriftPdfs.map(pdf => {
              const isActive   = form.fabricCalc.pdfId === pdf.id
              const showSizes  = isActive && calcAvailableSizes.length > 0
              const loadingSz  = calcLoadingStep === 'sizes' && isActive
              const loadingCalc = calcLoadingStep === 'calc' && isActive

              return (
                <div key={pdf.id} className="p-4 bg-white rounded-xl border border-stone-200 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="w-7 h-7 bg-red-50 rounded-md flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-stone-700">{pdf.name}</span>
                  </div>

                  {/* Velg størrelse */}
                  {!showSizes && (
                    <button
                      onClick={() => selectSizes(pdf)}
                      disabled={calcLoadingStep !== ''}
                      className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                      {loadingSz && <Spinner />}
                      {loadingSz ? 'Laster størrelser…' : 'Velg størrelse'}
                    </button>
                  )}

                  {/* Size buttons */}
                  {showSizes && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold tracking-widest uppercase text-stone-400">
                        Velg størrelse
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {calcAvailableSizes.map(sz => (
                          <button
                            key={sz}
                            onClick={() => {
                              if (form.fabricCalc.size !== sz) {
                                upd({ fabricCalc: { ...form.fabricCalc, size: sz, result: '' } })
                              }
                            }}
                            className={`px-4 py-2 rounded-lg text-sm border transition-colors font-medium ${
                              form.fabricCalc.size === sz
                                ? 'bg-stone-800 text-white border-stone-800'
                                : 'bg-white text-stone-700 border-stone-200 hover:border-stone-400 hover:bg-stone-50'
                            }`}>
                            {sz}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => selectSizes(pdf)}
                        disabled={calcLoadingStep !== ''}
                        className="text-xs text-stone-400 hover:text-stone-600 transition-colors disabled:opacity-40">
                        ↺ Last inn størrelser på nytt
                      </button>
                    </div>
                  )}

                  {/* Persisted size indicator (on project reopen) */}
                  {isActive && !showSizes && form.fabricCalc.size && !loadingSz && (
                    <p className="text-xs text-stone-500">
                      Valgt størrelse: <strong>{form.fabricCalc.size}</strong>
                      {' '}
                      <button onClick={() => selectSizes(pdf)} disabled={calcLoadingStep !== ''}
                        className="text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors disabled:opacity-40">
                        Endre
                      </button>
                    </p>
                  )}

                  {/* Beregn button */}
                  {isActive && form.fabricCalc.size && (
                    <button
                      onClick={runFabricCalc}
                      disabled={calcLoadingStep !== ''}
                      className="flex items-center gap-2 px-4 py-2 text-white text-sm rounded-lg transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: '#C9A57A' }}>
                      {loadingCalc && <Spinner />}
                      {loadingCalc
                        ? 'Beregner…'
                        : `Beregn stoffmengde – str. ${form.fabricCalc.size}`}
                    </button>
                  )}

                  {/* Result */}
                  {isActive && form.fabricCalc.result && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <p className="text-xs font-semibold tracking-widest uppercase text-amber-600 mb-2">
                        Stoffbehov — størrelse {form.fabricCalc.size}
                      </p>
                      <div className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                        {form.fabricCalc.result}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}

          {calcError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              {calcError}
            </div>
          )}
        </div>

        {/* ── Vedlikehold & Pleie ── */}
        <SectionHeading>Vedlikehold &amp; Pleie</SectionHeading>
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Importer fra produktside (URL)</label>
            <div className="flex gap-2">
              <input className={`${inputCls} flex-1`}
                value={form.care.sourceUrl}
                onChange={e => upd({ care: { ...form.care, sourceUrl: e.target.value } })}
                placeholder="URL til stoffets produktside…" />
              <button onClick={runCareImport}
                disabled={!form.care.sourceUrl || form.care.loading}
                className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                {form.care.loading && <Spinner />}
                {form.care.loading ? 'Henter…' : 'Importer'}
              </button>
            </div>
            <p className="text-xs text-stone-400 mt-1.5">
              F.eks. stoffbutikk, Ryer, Stoff &amp; Stil – Claude henter pleieinfo automatisk.
            </p>
          </div>
          <div>
            <label className={labelCls}>Pleie &amp; Vedlikehold</label>
            <textarea className={`${inputCls} resize-y`} style={{ minHeight: 180 }}
              value={form.care.details}
              onChange={e => upd({ care: { ...form.care, details: e.target.value } })}
              placeholder="Pleieinstruksjoner… (skriv manuelt eller importer fra URL)" />
          </div>
        </div>
      </div>

      {showImgModal && (
        <ImageUploadModal onAdd={addImage} onClose={() => setShowImgModal(false)} />
      )}

      {showFocalModal && cover && (
        <FocalPointModal
          imageUrl={cover.url}
          focalX={form.focalX ?? 50}
          focalY={form.focalY ?? 50}
          onSave={(x, y) => upd({ focalX: x, focalY: y })}
          onClose={() => setShowFocalModal(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg whitespace-nowrap z-50">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── DeleteDialog ──────────────────────────────────────────────────────────────

function DeleteDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl p-7 max-w-sm w-full shadow-2xl">
        <h3 className="font-serif text-2xl font-light text-stone-800 mb-2">Slett prosjekt?</h3>
        <p className="text-sm text-stone-500 mb-6">Prosjektet slettes permanent og kan ikke gjenopprettes.</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 rounded-lg transition-colors">
            Avbryt
          </button>
          <button onClick={onConfirm}
            className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium">
            Slett
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [projects, setProjects]             = useState<Project[]>([])
  const [loading, setLoading]               = useState(true)
  const [showDetail, setShowDetail]         = useState(false)
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [deleteId, setDeleteId]             = useState<string | null>(null)
  const [statusFilter, setStatusFilter]     = useState<Status | 'Alle'>('Alle')
  const [catFilter, setCatFilter]           = useState<Category | 'Alle'>('Alle')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('projects').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setProjects((data as Project[]) || [])
    } catch (err) {
      console.error('Load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteProject(id: string) {
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) throw error
    await load()
    setDeleteId(null)
    setShowDetail(false)
    setCurrentProject(null)
  }

  function openNew()            { setCurrentProject(null); setShowDetail(true) }
  function openEdit(p: Project) { setCurrentProject(p);    setShowDetail(true) }
  function handleBack()         { setShowDetail(false); setCurrentProject(null); load() }

  const filtered = projects.filter(p =>
    (statusFilter === 'Alle' || p.data.status   === statusFilter) &&
    (catFilter    === 'Alle' || p.data.category === catFilter)
  )

  const counts = {
    Alle:     projects.length,
    Aktiv:    projects.filter(p => p.data.status === 'Aktiv').length,
    Planlagt: projects.filter(p => p.data.status === 'Planlagt').length,
    Fullført: projects.filter(p => p.data.status === 'Fullført').length,
  }

  if (showDetail) {
    return (
      <>
        <ProjectDetail
          project={currentProject}
          onBack={handleBack}
          onSaved={load}
          onDelete={currentProject ? () => setDeleteId(currentProject.id) : undefined}
        />
        {deleteId && (
          <DeleteDialog
            onConfirm={() => deleteProject(deleteId)}
            onCancel={() => setDeleteId(null)}
          />
        )}
      </>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAF7F4' }}>

      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-4 pt-4 pb-3 sm:px-8 sm:pt-8 sm:pb-6 flex items-center sm:items-start justify-between">
          <div>
            <h1 className="font-serif text-3xl sm:text-6xl text-[#3E2E2A] leading-none">
              Søm &amp; Snitt
            </h1>
            <p className="italic text-[#C9A57A] text-base sm:text-2xl mt-1 sm:mt-3">
              Din sydagbok
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={openNew}
              className="w-12 h-12 rounded-2xl sm:w-24 sm:h-24 sm:rounded-[32px] bg-[#C9A57A] text-white flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button
              onClick={() => supabase.auth.signOut().then(() => window.location.href = '/login')}
              className="px-4 py-2.5 text-sm text-stone-500 hover:bg-stone-100 rounded-xl transition-colors">
              Logg ut
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-white rounded-xl p-1 border border-stone-200 shadow-sm">
          {(['Alle', ...STATUSES] as const).map(s => {
            const count = counts[s as keyof typeof counts]
            return (
              <button key={s} onClick={() => setStatusFilter(s as Status | 'Alle')}
                className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
                  statusFilter === s
                    ? 'bg-stone-800 text-white shadow-sm'
                    : 'text-stone-500 hover:text-stone-700'
                }`}>
                {s}
                <span className={`ml-1.5 text-xs ${statusFilter === s ? 'text-white/60' : 'text-stone-400'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <select value={catFilter} onChange={e => setCatFilter(e.target.value as Category | 'Alle')}
          className="px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white text-stone-600 focus:outline-none focus:ring-2 focus:ring-stone-300 shadow-sm">
          <option value="Alle">Alle kategorier</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>

        {(statusFilter !== 'Alle' || catFilter !== 'Alle') && (
          <button onClick={() => { setStatusFilter('Alle'); setCatFilter('Alle') }}
            className="text-sm text-stone-400 hover:text-stone-600 transition-colors">
            Nullstill filter ×
          </button>
        )}
      </div>

      <main className="max-w-6xl mx-auto px-6 pb-16">
        {loading ? (
          <div className="flex justify-center py-32">
            <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-28">
            <svg className="w-14 h-14 text-stone-200 mx-auto mb-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="font-serif text-2xl text-stone-400 font-light">
              {projects.length === 0 ? 'Ingen prosjekter ennå' : 'Ingen treff'}
            </p>
            {projects.length === 0 && (
              <button onClick={openNew}
                className="mt-5 px-6 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium">
                Opprett ditt første prosjekt
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(p => (
              <ProjectCard key={p.id} project={p}
                onEdit={() => openEdit(p)}
                onDelete={() => setDeleteId(p.id)} />
            ))}
          </div>
        )}
      </main>

      {deleteId && (
        <DeleteDialog
          onConfirm={() => deleteProject(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
