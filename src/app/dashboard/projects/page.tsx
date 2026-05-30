'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef, type ReactNode, type ChangeEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { supabase } from '@/lib/supabase'
import { RecipePicker, type PickerRecipe } from '@/app/dashboard/_shared/RecipePicker'

// ── Types ─────────────────────────────────────────────────────────────────────

type Status    = 'Aktiv' | 'Planlagt' | 'Fullført'
type Category  = 'Klær' | 'Interiør' | 'Tilbehør' | 'Reparasjoner'
type PdfType   = 'Oppskrift' | 'Mønster' | 'Annet'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface ImageItem { id: string; url: string }
interface PdfItem   { id: string; name: string; url: string; type: PdfType; source: 'upload' | 'link' }
interface FabricCalcState { pdfId: string; size: string; result: string }
interface CareState       { details: string }
type FabricType = 'Hovedstoff' | 'Fôr' | 'Mellomlegg' | 'Annet'

interface PdfComment {
  id: string
  pdfId: string
  page: number
  text: string
  createdAt: string
}

interface FabricItem {
  id: string; sourceUrl: string
  navn: string; materiale: string; bredde: string; vekt: string
  vask: string; bilde: string; mengde: string; type: FabricType
}

interface ProjectData {
  name: string; status: Status; category: Category; date: string; notes: string
  images: ImageItem[]; pdfs: PdfItem[]
  fabricCalc: FabricCalcState; care: CareState
  stoffer: FabricItem[]
  focalX: number; focalY: number
  recipientName: string
  size: string
  recipeId: string
  recipeName: string
  equipmentList: string[]
  pdfComments: PdfComment[]
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
const FABRIC_TYPES: FabricType[] = ['Hovedstoff', 'Fôr', 'Mellomlegg', 'Annet']

const EMPTY: ProjectData = {
  name: '', status: 'Planlagt', category: 'Klær', date: '', notes: '',
  images: [], pdfs: [],
  fabricCalc: { pdfId: '', size: '', result: '' },
  care:        { details: '' },
  stoffer:     [],
  focalX: 50, focalY: 50,
  recipientName: '',
  size: '',
  recipeId: '',
  recipeName: '',
  equipmentList: [],
  pdfComments: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid()   { return Math.random().toString(36).slice(2, 10) }
function toDay() { return new Date().toISOString().split('T')[0] }
function fmtDate(d: string) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y}`
}

async function apiClaude(prompt: string, pdfText?: string): Promise<string> {
  const r = await fetch('/api/claude', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, pdfText }),
  })
  if (!r.ok) {
    const text = await r.text()
    let errMsg: string
    try { errMsg = (JSON.parse(text) as { error?: string }).error ?? `HTTP ${r.status}` }
    catch { errMsg = `HTTP ${r.status} – server svarte med: ${text.slice(0, 300)}` }
    throw new Error(errMsg)
  }
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  return j.result
}

async function apiFetchPdf(url: string): Promise<string> {
  const r = await fetch('/api/fetch-pdf', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  if (!r.ok) {
    const text = await r.text()
    let errMsg: string
    try { errMsg = (JSON.parse(text) as { error?: string }).error ?? `HTTP ${r.status} fra /api/fetch-pdf` }
    catch { errMsg = `HTTP ${r.status} fra /api/fetch-pdf – ugyldig JSON: ${text.slice(0, 200)}` }
    throw new Error(errMsg)
  }
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  return j.data as string
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

interface FabricImportResult {
  navn: string; materiale: string; bredde: string
  vekt: string; krymp: string; vask: string; sertifisering: string; bilde: string
}

async function apiImportFabric(url: string): Promise<FabricImportResult> {
  const r = await fetch('/api/import-fabric', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const j = await r.json()
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j.fabric as FabricImportResult
}

async function extractPdfText(
  data: Uint8Array,
  onProgress?: (page: number, total: number) => void
): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).href
  const pdf = await pdfjs.getDocument({ data }).promise
  const total = pdf.numPages
  const parts: string[] = []
  for (let i = 1; i <= total; i++) {
    onProgress?.(i, total)
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parts.push(content.items.map((item: any) => (typeof item.str === 'string' ? item.str : '')).join(' '))
  }
  return parts.join('\n')
}

function parseEquipmentList(otherEquipment: string): string[] {
  if (!otherEquipment.trim()) return []
  return otherEquipment.split(',').map(s => s.trim()).filter(Boolean)
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
        {(d.recipientName ?? '') && (
          <p className="text-xs text-stone-400 mb-2">Til {d.recipientName}</p>
        )}
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
            {(d.recipeId ?? '') && (
              <span className="flex items-center gap-1 text-rose-400">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
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

// ── NewProjectModal ───────────────────────────────────────────────────────────

type NewProjectMode = 'choose' | 'library-loading' | 'library' | 'processing' | 'save-to-library' | 'blank'

interface PendingRecipeData {
  name: string; designer: string; category: string; sizes: string[]
  recommendedFabrics: string; otherEquipment: string; notes: string
  pdfs: PdfItem[]; images: ImageItem[]; coverImageId: string
  focalX: number; focalY: number
}

function NewProjectModal({ onCreated, onClose }: {
  onCreated: (project: Project) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<NewProjectMode>('choose')
  const [recipes, setRecipes]   = useState<PickerRecipe[]>([])
  const [progress, setProgress] = useState('')
  const [error, setError]       = useState('')
  const [creating, setCreating] = useState(false)
  const [blankName, setBlankName]         = useState('')
  const [blankStatus, setBlankStatus]     = useState<Status>('Planlagt')
  const [blankCategory, setBlankCategory] = useState<Category>('Klær')
  const [pendingProject, setPendingProject] = useState<ProjectData | null>(null)
  const [pendingRecipe, setPendingRecipe]   = useState<PendingRecipeData | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadLibrary() {
    setMode('library-loading')
    setError('')
    try {
      const { data, error: e } = await supabase
        .from('recipes').select('*').order('created_at', { ascending: false })
      if (e) throw e
      setRecipes((data as PickerRecipe[]) || [])
      setMode('library')
    } catch {
      setError('Kunne ikke laste oppskrifter. Prøv igjen.')
      setMode('choose')
    }
  }

  async function handleRecipeSelect(recipe: PickerRecipe) {
    setCreating(true)
    setError('')
    try {
      const equipmentList = parseEquipmentList(recipe.data.otherEquipment ?? '')
      const projectData: ProjectData = {
        ...structuredClone(EMPTY),
        name:          recipe.data.name ?? '',
        pdfs:          (recipe.data.pdfs ?? []).map(p => ({ ...p as PdfItem, id: uid() })),
        images:        (recipe.data.images ?? []).map(i => ({ ...i, id: uid() })),
        focalX:        recipe.data.focalX ?? 50,
        focalY:        recipe.data.focalY ?? 50,
        recipeId:      recipe.id,
        recipeName:    recipe.data.name ?? '',
        equipmentList,
      }
      const { data: rows, error: e } = await supabase
        .from('projects').insert({ data: projectData }).select()
      if (e) throw e
      const project = (rows as Project[])?.[0]
      if (project) onCreated(project)
    } catch {
      setError('Kunne ikke opprette prosjekt. Prøv igjen.')
      setCreating(false)
      setMode('choose')
    }
  }

  async function handlePdfFile(file: File) {
    setMode('processing')
    setError('')

    const projectData: ProjectData   = { ...structuredClone(EMPTY) }
    const recipeData: PendingRecipeData = {
      name: '', designer: '', category: '', sizes: [],
      recommendedFabrics: '', otherEquipment: '', notes: '',
      pdfs: [], images: [], coverImageId: '', focalX: 50, focalY: 50,
    }

    try {
      setProgress('Laster opp PDF...')
      const pdfFilename = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
      const { error: pdfErr } = await supabase.storage
        .from('project-images')
        .upload(pdfFilename, file, { contentType: 'application/pdf' })
      if (pdfErr) throw new Error('PDF-opplasting feilet')
      const { data: pdfUrlData } = supabase.storage.from('project-images').getPublicUrl(pdfFilename)

      const pdfItem: PdfItem = {
        id: uid(), name: file.name,
        url: pdfUrlData.publicUrl, type: 'Oppskrift', source: 'upload',
      }
      projectData.pdfs = [pdfItem]
      recipeData.pdfs  = [{ ...pdfItem, id: uid() }]

      setProgress('Leser tekst...')
      const arrayBuffer = await file.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuffer)
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
      ).href
      const pdf = await pdfjs.getDocument({ data: uint8 }).promise
      const numPages = Math.min(pdf.numPages, 20)
      const parts: string[] = []
      for (let i = 1; i <= numPages; i++) {
        const pg = await pdf.getPage(i)
        const content = await pg.getTextContent()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parts.push(content.items.map((item: any) => (typeof item.str === 'string' ? item.str : '')).join(' '))
      }
      const text = parts.join('\n')

      setProgress('Analyserer...')
      const prompt =
        `Du får tekst fra en søm-oppskrift (PDF). Returner KUN gyldig JSON, ingen forklaring:\n\n` +
        `{\n  "name": "",\n  "designer": "",\n  "category": "",\n  "sizes": [],\n  "recommendedFabrics": "",\n  "otherEquipment": ""\n}\n\n` +
        `- name: oppskriftens navn\n- designer: designeren\n- category: klesplagg-type på norsk\n` +
        `- sizes: array av størrelser\n- recommendedFabrics: anbefalt stoff\n` +
        `- otherEquipment: tilbehør separert med komma\nHvis felt mangler, bruk tom streng / tomt array.`

      try {
        const raw = await apiClaude(prompt, text.slice(0, 50000))
        const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
        if (s !== -1 && e !== -1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed: any = JSON.parse(raw.slice(s, e + 1))
          const name = (typeof parsed.name === 'string' && parsed.name.trim()) ? parsed.name.trim() : 'Nytt prosjekt'
          projectData.name       = name
          recipeData.name        = name
          recipeData.designer    = typeof parsed.designer === 'string' ? parsed.designer.trim() : ''
          recipeData.category    = typeof parsed.category === 'string' ? parsed.category.trim() : ''
          recipeData.sizes       = Array.isArray(parsed.sizes) ? parsed.sizes.filter((v: unknown) => typeof v === 'string') : []
          recipeData.recommendedFabrics = typeof parsed.recommendedFabrics === 'string' ? parsed.recommendedFabrics.trim() : ''
          recipeData.otherEquipment = typeof parsed.otherEquipment === 'string' ? parsed.otherEquipment.trim() : ''
          projectData.equipmentList = parseEquipmentList(recipeData.otherEquipment)
        } else {
          projectData.name = 'Nytt prosjekt'
        }
      } catch {
        projectData.name = 'Nytt prosjekt'
      }

      setProgress('Lager bilde...')
      try {
        const page1   = await pdf.getPage(1)
        const viewport = page1.getViewport({ scale: 2 })
        const canvas  = document.createElement('canvas')
        canvas.width  = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page1.render({ canvas, canvasContext: ctx as any, viewport }).promise
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
          if (blob) {
            const imgFilename = `project-cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
            const { error: imgErr } = await supabase.storage
              .from('project-images').upload(imgFilename, blob, { contentType: 'image/jpeg' })
            if (!imgErr) {
              const { data: imgUrlData } = supabase.storage.from('project-images').getPublicUrl(imgFilename)
              const imgId = uid()
              projectData.images = [{ id: imgId, url: imgUrlData.publicUrl }]
              projectData.focalX = 50
              projectData.focalY = 50
              const recipeImgId = uid()
              recipeData.images      = [{ id: recipeImgId, url: imgUrlData.publicUrl }]
              recipeData.coverImageId = recipeImgId
            }
          }
        }
      } catch { /* no cover — user can add manually */ }

      setPendingProject(projectData)
      setPendingRecipe(recipeData)
      setProgress('')
      setMode('save-to-library')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen.')
      setProgress('')
      setMode('choose')
    }
  }

  async function handleSaveDecision(saveToLib: boolean) {
    if (!pendingProject) return
    setCreating(true)
    setError('')
    try {
      let projectData = { ...pendingProject }

      if (saveToLib && pendingRecipe) {
        const { data: recipeRows, error: re } = await supabase
          .from('recipes').insert({ data: pendingRecipe }).select()
        if (re) throw re
        const recipe = (recipeRows as { id: string; data: { name: string } }[])?.[0]
        if (recipe) {
          projectData = { ...projectData, recipeId: recipe.id, recipeName: recipe.data.name }
        }
      }

      const { data: rows, error: e } = await supabase
        .from('projects').insert({ data: projectData }).select()
      if (e) throw e
      const project = (rows as Project[])?.[0]
      if (project) onCreated(project)
    } catch {
      setError('Kunne ikke opprette prosjekt. Prøv igjen.')
      setCreating(false)
    }
  }

  async function handleBlank() {
    if (!blankName.trim()) return
    setCreating(true)
    setError('')
    try {
      const projectData: ProjectData = {
        ...structuredClone(EMPTY),
        name:     blankName.trim(),
        status:   blankStatus,
        category: blankCategory,
      }
      const { data: rows, error: e } = await supabase
        .from('projects').insert({ data: projectData }).select()
      if (e) throw e
      const project = (rows as Project[])?.[0]
      if (project) onCreated(project)
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
      setCreating(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') handlePdfFile(file)
  }

  // Library: delegate to RecipePicker component (full-screen)
  if (mode === 'library') {
    return (
      <RecipePicker
        recipes={recipes}
        onSelect={creating ? () => {} : handleRecipeSelect}
        onClose={() => setMode('choose')}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm"
        onClick={mode === 'choose' || mode === 'blank' ? onClose : undefined} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {/* Loading library */}
        {mode === 'library-loading' && (
          <div className="px-6 py-14 text-center">
            <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-stone-400">Laster oppskrifter…</p>
          </div>
        )}

        {/* Processing PDF */}
        {mode === 'processing' && (
          <div className="px-6 py-14 text-center">
            <div className="w-10 h-10 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin mx-auto mb-5" />
            <p className="font-serif text-lg text-stone-700 mb-1">Analyserer oppskrift…</p>
            <p className="text-sm text-stone-400">{progress}</p>
          </div>
        )}

        {/* Save to library? */}
        {mode === 'save-to-library' && (
          <>
            <div className="px-6 pt-6 pb-2">
              <h3 className="font-serif text-2xl text-stone-800 mb-1">Legg i biblioteket?</h3>
              <p className="text-sm text-stone-500">
                Vil du lagre{pendingProject?.name ? ` «${pendingProject.name}»` : ' denne oppskriften'} i oppskriftsbiblioteket også?
              </p>
            </div>
            <div className="p-6 space-y-3">
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={() => handleSaveDecision(true)}
                disabled={creating}
                className="w-full py-3 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-2 font-medium"
              >
                {creating && <Spinner />}
                Ja, legg til i biblioteket
              </button>
              <button
                onClick={() => handleSaveDecision(false)}
                disabled={creating}
                className="w-full py-3 border border-stone-200 text-stone-600 text-sm rounded-xl hover:bg-stone-50 transition-colors disabled:opacity-40"
              >
                Nei, bare som prosjekt
              </button>
            </div>
          </>
        )}

        {/* Choose method */}
        {mode === 'choose' && (
          <>
            <div className="px-6 pt-6 pb-2">
              <h3 className="font-serif text-2xl text-stone-800">Nytt prosjekt</h3>
            </div>
            <div className="p-6 space-y-3">
              <button
                onClick={loadLibrary}
                className="w-full border-2 border-stone-200 rounded-2xl p-5 text-left hover:border-[#C9A57A] hover:bg-amber-50/30 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0 group-hover:bg-rose-100 transition-colors">
                    <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-stone-800 text-sm">Velg oppskrift fra biblioteket</p>
                    <p className="text-xs text-stone-400 mt-0.5">Kobler til en eksisterende oppskrift</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                className="w-full border-2 border-dashed border-stone-200 rounded-2xl p-5 text-left hover:border-[#C9A57A] hover:bg-amber-50/30 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center flex-shrink-0 group-hover:bg-stone-100 transition-colors">
                    <svg className="w-5 h-5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-stone-800 text-sm">Last opp oppskrift (PDF)</p>
                    <p className="text-xs text-stone-400 mt-0.5">Analyser ny PDF og start prosjekt</p>
                  </div>
                </div>
              </button>
              <input
                ref={fileInputRef} type="file" accept="application/pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f) }}
              />

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                onClick={() => { setError(''); setMode('blank') }}
                className="w-full py-2.5 text-sm text-stone-400 hover:text-stone-700 transition-colors">
                Start uten oppskrift
              </button>
              <button onClick={onClose}
                className="w-full py-1.5 text-sm text-stone-300 hover:text-stone-500 transition-colors">
                Avbryt
              </button>
            </div>
          </>
        )}

        {/* Blank form */}
        {mode === 'blank' && (
          <>
            <div className="px-6 pt-6 pb-2">
              <h3 className="font-serif text-2xl text-stone-800 mb-0.5">Nytt prosjekt</h3>
              <p className="text-sm text-stone-400">Du kan legge til detaljer etterpå</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Navn *</label>
                <input className={inputCls} value={blankName} autoFocus
                  onChange={e => setBlankName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBlank()}
                  placeholder="F.eks. Sommerkjole til Emma" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Status</label>
                  <select className={inputCls} value={blankStatus}
                    onChange={e => setBlankStatus(e.target.value as Status)}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Kategori</label>
                  <select className={inputCls} value={blankCategory}
                    onChange={e => setBlankCategory(e.target.value as Category)}>
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={handleBlank}
                disabled={!blankName.trim() || creating}
                className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {creating && <Spinner />}
                {creating ? 'Oppretter…' : 'Opprett prosjekt'}
              </button>
              <button onClick={() => setMode('choose')}
                className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                Tilbake
              </button>
            </div>
          </>
        )}

      </div>
    </div>
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
  imageUrl: string; focalX: number; focalY: number
  onSave: (x: number, y: number) => void; onClose: () => void
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
            <img src={imageUrl} alt="" onPointerDown={pick}
              style={{ maxHeight: '75vh', maxWidth: '100%', display: 'block', cursor: 'crosshair', userSelect: 'none' }}
              draggable={false} />
            <div style={{
              position: 'absolute', left: `${pos.x}%`, top: `${pos.y}%`,
              transform: 'translate(-50%, -50%)', pointerEvents: 'none',
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
          <button onClick={() => { onSave(pos.x, pos.y); onClose() }}
            className="px-5 py-2 text-sm bg-stone-800 text-white rounded-lg hover:bg-stone-700 transition-colors font-medium">
            Lagre
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PdfViewerModal ────────────────────────────────────────────────────────────

function PdfViewerModal({ pdf, comments, onAddComment, onDeleteComment, onClose }: {
  pdf: PdfItem
  comments: PdfComment[]
  onAddComment: (comment: Omit<PdfComment, 'id' | 'createdAt'>) => void
  onDeleteComment: (id: string) => void
  onClose: () => void
}) {
  const [pages, setPages]   = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedCount, setLoadedCount] = useState(0)
  const [totalCount, setTotalCount]   = useState(0)
  const [error, setError]   = useState('')
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [addingPage, setAddingPage] = useState<number | null>(null)

  const myComments = comments.filter(c => c.pdfId === pdf.id)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(pdf.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = new Uint8Array(await res.arrayBuffer())
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
        ).href
        const doc = await pdfjs.getDocument({ data }).promise
        if (cancelled) return
        setTotalCount(doc.numPages)
        const imgs: string[] = []
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width  = viewport.width
          canvas.height = viewport.height
          const ctx = canvas.getContext('2d')!
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page.render({ canvas, canvasContext: ctx as any, viewport }).promise
          imgs.push(canvas.toDataURL('image/jpeg', 0.85))
          setLoadedCount(i)
          setPages([...imgs])
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Kunne ikke laste PDF')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [pdf.url])

  function submitComment(page: number) {
    const text = (drafts[page] ?? '').trim()
    if (!text) return
    onAddComment({ pdfId: pdf.id, page, text })
    setDrafts(d => ({ ...d, [page]: '' }))
    setAddingPage(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 border-b border-stone-700"
        style={{ backgroundColor: '#292524' }}>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-stone-300 hover:text-white hover:bg-stone-700 transition-colors flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Lukk
        </button>
        <h2 className="flex-1 font-serif text-lg text-stone-200 truncate">{pdf.name}</h2>
        {(loading && totalCount > 0) && (
          <span className="text-xs text-stone-400 flex-shrink-0">
            {loadedCount}/{totalCount} sider
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loading && pages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-8 h-8 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin" />
            <p className="text-sm text-stone-400">
              {totalCount > 0 ? `Laster side ${loadedCount} av ${totalCount}…` : 'Laster PDF…'}
            </p>
          </div>
        )}
        {error && (
          <div className="max-w-md mx-auto mt-16 p-4 bg-red-900/30 border border-red-700 rounded-xl text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="max-w-3xl mx-auto px-3 py-6 space-y-10">
          {pages.map((dataUrl, i) => {
            const pageNum = i + 1
            const pageComments = myComments.filter(c => c.page === pageNum).sort(
              (a, b) => a.createdAt.localeCompare(b.createdAt)
            )
            const isAdding = addingPage === pageNum
            const draft    = drafts[pageNum] ?? ''

            return (
              <div key={pageNum}>
                {/* Page label */}
                <p className="text-xs text-stone-500 mb-2 text-center tracking-wider uppercase">
                  Side {pageNum}
                  {totalCount > 0 && ` av ${totalCount}`}
                </p>

                {/* Page image */}
                <div className="rounded-xl overflow-hidden shadow-2xl">
                  <img
                    src={dataUrl}
                    alt={`Side ${pageNum}`}
                    className="w-full block"
                    style={{ touchAction: 'pan-y pinch-zoom' }}
                  />
                </div>

                {/* Comments section */}
                <div className="mt-3 space-y-2">
                  {pageComments.map(c => (
                    <div key={c.id}
                      className="flex items-start gap-2 px-3 py-2.5 rounded-xl"
                      style={{ backgroundColor: '#292524' }}>
                      <span className="text-sm">💬</span>
                      <p className="flex-1 text-sm text-stone-200 leading-relaxed whitespace-pre-wrap">{c.text}</p>
                      <button
                        onClick={() => onDeleteComment(c.id)}
                        className="flex-shrink-0 p-1 rounded-lg text-stone-500 hover:text-red-400 hover:bg-red-900/30 transition-colors mt-0.5"
                        title="Slett kommentar"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}

                  {isAdding ? (
                    <div className="rounded-xl overflow-hidden border border-stone-600" style={{ backgroundColor: '#292524' }}>
                      <textarea
                        autoFocus
                        value={draft}
                        onChange={e => setDrafts(d => ({ ...d, [pageNum]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment(pageNum)
                          if (e.key === 'Escape') setAddingPage(null)
                        }}
                        placeholder="Skriv kommentar…"
                        rows={3}
                        className="w-full px-3 py-2.5 text-sm text-stone-200 bg-transparent resize-none outline-none placeholder-stone-600"
                      />
                      <div className="flex justify-end gap-2 px-3 pb-2.5">
                        <button
                          onClick={() => setAddingPage(null)}
                          className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors rounded-lg">
                          Avbryt
                        </button>
                        <button
                          onClick={() => submitComment(pageNum)}
                          disabled={!draft.trim()}
                          className="px-4 py-1.5 text-xs font-medium text-stone-900 rounded-lg transition-colors disabled:opacity-40"
                          style={{ backgroundColor: '#C9A57A' }}>
                          Legg til
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingPage(pageNum)}
                      className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors px-1 py-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Legg til kommentar på side {pageNum}
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* Still loading more pages */}
          {loading && pages.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-4 text-stone-500 text-sm">
              <div className="w-4 h-4 border-2 border-stone-600 border-t-stone-400 rounded-full animate-spin" />
              Laster side {loadedCount + 1}…
            </div>
          )}
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
    project
      ? { ...structuredClone(EMPTY), ...structuredClone(project.data) }
      : structuredClone(EMPTY)
  )
  const [saveStatus, setSaveStatus]         = useState<SaveStatus>('idle')
  const [showImgModal, setShowImgModal]     = useState(false)
  const [showFocalModal, setShowFocalModal] = useState(false)
  const [showPdfViewer, setShowPdfViewer]   = useState<PdfItem | null>(null)
  const [toast, setToast]                   = useState('')
  const [showRecipePicker, setShowRecipePicker] = useState(false)
  const [pickerRecipes, setPickerRecipes]   = useState<PickerRecipe[]>([])
  const [sizeManual, setSizeManual]         = useState(false)

  // Linked recipe state
  const [linkedRecipe, setLinkedRecipe]     = useState<PickerRecipe | null>(null)
  const [linkedStatus, setLinkedStatus]     = useState<'none' | 'loading' | 'found' | 'deleted'>('none')

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
  const [calcProgress, setCalcProgress]             = useState('')
  const pdfTextCacheRef = useRef<Record<string, string>>({})

  // Stoff-import ephemeral state
  const [stoffImportUrl, setStoffImportUrl]     = useState('')
  const [stoffImporting, setStoffImporting]     = useState(false)
  const [stoffImportError, setStoffImportError] = useState('')
  const [stoffImportNote, setStoffImportNote]   = useState('')

  const projectIdRef = useRef<string | null>(project?.id ?? null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef   = useRef<ProjectData>(form)

  // Load linked recipe when recipeId changes
  useEffect(() => {
    const rid = form.recipeId ?? ''
    if (!rid) { setLinkedStatus('none'); setLinkedRecipe(null); return }
    setLinkedStatus('loading')
    supabase.from('recipes').select('*').eq('id', rid).maybeSingle()
      .then(({ data }) => {
        if (data) { setLinkedRecipe(data as PickerRecipe); setLinkedStatus('found') }
        else setLinkedStatus('deleted')
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.recipeId])

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
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
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

  // ── Recipe linking ──────────────────────────────────────────────────────────

  async function openRecipePicker() {
    const { data } = await supabase.from('recipes').select('*').order('created_at', { ascending: false })
    setPickerRecipes((data as PickerRecipe[]) || [])
    setShowRecipePicker(true)
  }

  function handleLinkRecipe(recipe: PickerRecipe) {
    setShowRecipePicker(false)
    const equipmentList = (form.equipmentList ?? []).length > 0
      ? form.equipmentList
      : parseEquipmentList(recipe.data.otherEquipment ?? '')
    upd({
      recipeId:      recipe.id,
      recipeName:    recipe.data.name,
      equipmentList,
    })
    setLinkedRecipe(recipe)
    setLinkedStatus('found')
  }

  // ── Image handlers ──────────────────────────────────────────────────────────

  function addImage(url: string) { upd({ images: [...form.images, { id: uid(), url }] }) }
  function removeImage(id: string) { upd({ images: form.images.filter(i => i.id !== id) }) }

  // ── PDF handlers ────────────────────────────────────────────────────────────

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
          id: uid(), name: pdfName.trim() || pdfFile.name,
          url: data.publicUrl, type: pdfType, source: 'upload',
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
        id: uid(), name: pdfName.trim() || 'PDF',
        url: pdfUrl.trim(), type: pdfType, source: 'link',
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

  function addPdfComment(comment: Omit<PdfComment, 'id' | 'createdAt'>) {
    const newComment: PdfComment = { ...comment, id: uid(), createdAt: new Date().toISOString() }
    upd({ pdfComments: [...(form.pdfComments ?? []), newComment] })
  }

  function deletePdfComment(id: string) {
    upd({ pdfComments: (form.pdfComments ?? []).filter(c => c.id !== id) })
  }

  // ── Stoffberegner helpers ───────────────────────────────────────────────────

  async function getPdfText(pdf: PdfItem, onProgress?: (p: number, t: number) => void): Promise<string> {
    if (pdfTextCacheRef.current[pdf.id]) return pdfTextCacheRef.current[pdf.id]
    const source = pdf.source ?? 'link'
    let data: Uint8Array
    if (source === 'upload') {
      const res = await fetch(pdf.url)
      if (!res.ok) throw new Error(`HTTP ${res.status} – kunne ikke hente PDF fra Supabase`)
      data = new Uint8Array(await res.arrayBuffer())
    } else {
      const base64 = await apiFetchPdf(pdf.url)
      const binary = atob(base64)
      data = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
    }
    let text: string
    try {
      text = await extractPdfText(data, onProgress)
    } catch (err) {
      throw new Error('Kunne ikke lese PDF-innhold: ' + (err instanceof Error ? err.message : String(err)))
    }
    if (!text.trim()) throw new Error('PDF-en inneholder ingen lesbar tekst (kanskje den er skannet?)')
    const truncated = text.slice(0, 50000)
    pdfTextCacheRef.current[pdf.id] = truncated
    return truncated
  }

  async function selectSizes(pdf: PdfItem) {
    setCalcAvailableSizes([])
    setCalcError('')
    setCalcLoadingStep('sizes')
    setCalcProgress('')
    upd({ fabricCalc: { pdfId: pdf.id, size: '', result: '' } })
    try {
      const text = await getPdfText(pdf, (page, total) =>
        setCalcProgress(`Leser PDF side ${page} av ${total}…`)
      )
      setCalcProgress('')
      const prompt =
        `Analyser dette symønsteret og finn alle tilgjengelige størrelser.\n` +
        `Svar BARE med en JSON-array av størrelser som strenger, f.eks: ["36","38","40","42"] eller ["XS","S","M","L","XL"].\n` +
        `Ingen annen tekst. Kun JSON-arrayen.`
      const raw = await apiClaude(prompt, text)
      const trimmed = raw.trim()
      const start = trimmed.indexOf('['), end = trimmed.lastIndexOf(']')
      if (start === -1 || end === -1) throw new Error(`Fant ingen størrelsesliste. Claude svarte: ${trimmed.slice(0, 300)}`)
      const sizes: string[] = JSON.parse(trimmed.slice(start, end + 1))
      if (!Array.isArray(sizes) || sizes.length === 0) throw new Error('Ingen størrelser funnet')
      setCalcAvailableSizes(sizes)
    } catch (err) {
      setCalcError(`Kunne ikke lese størrelser: ${err instanceof Error ? err.message : 'Ukjent feil'}`)
    } finally {
      setCalcLoadingStep('')
      setCalcProgress('')
    }
  }

  async function runFabricCalc() {
    const pdf = form.pdfs.find(p => p.id === form.fabricCalc.pdfId)
    if (!pdf || !form.fabricCalc.size) return
    setCalcError('')
    setCalcLoadingStep('calc')
    setCalcProgress('')
    try {
      const text = await getPdfText(pdf, (page, total) =>
        setCalcProgress(`Leser PDF side ${page} av ${total}…`)
      )
      setCalcProgress('')
      const prompt =
        `Analyser dette symønsteret. Finn stoffbehovet for størrelse ${form.fabricCalc.size}.\n` +
        `Svar på norsk med markdown-formatering: bruk ## for seksjoner, - for lister, **fet** for viktige mål.\n` +
        `Ikke bruk blockquotes (>), horisontale streker (---), emojier eller advarsler.\n` +
        `Struktur: én seksjon per stoff/materiale, og én seksjon for tilbehør om relevant.\n` +
        `Kort og presist med konkrete mål.`
      const result = await apiClaude(prompt, text)
      upd({ fabricCalc: { ...form.fabricCalc, result } })
    } catch (err) {
      setCalcError(`Beregning feilet: ${err instanceof Error ? err.message : 'Ukjent feil'}`)
    } finally {
      setCalcLoadingStep('')
      setCalcProgress('')
    }
  }

  async function importStoff() {
    const trimmedUrl = stoffImportUrl.trim()
    if (!trimmedUrl) return
    setStoffImporting(true)
    setStoffImportError('')
    setStoffImportNote('')
    try {
      const result = await apiImportFabric(trimmedUrl)
      const missingFields = (Object.entries(result) as [string, string][]).filter(([, v]) => !v).map(([k]) => k)
      const foundFields   = (Object.entries(result) as [string, string][]).filter(([, v]) => !!v).map(([k]) => k)
      const fullVask = [
        result.vask,
        result.krymp      && `Krymp: ${result.krymp}`,
        result.sertifisering,
      ].filter(Boolean).join(' · ')
      upd({
        stoffer: [...form.stoffer, {
          id: uid(), sourceUrl: trimmedUrl,
          navn: result.navn, materiale: result.materiale,
          bredde: result.bredde, vekt: result.vekt,
          vask: fullVask, bilde: result.bilde,
          mengde: '', type: 'Hovedstoff',
        }],
      })
      setStoffImportUrl('')
      if (missingFields.length > 0) {
        setStoffImportNote(`Lagt til. Fant: ${foundFields.join(', ') || 'ingen'} · Mangler: ${missingFields.join(', ')}`)
      }
    } catch (err) {
      setStoffImportError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setStoffImporting(false)
    }
  }

  function removeStoff(id: string) { upd({ stoffer: form.stoffer.filter(s => s.id !== id) }); setStoffImportNote('') }
  function updateStoff(id: string, patch: Partial<FabricItem>) {
    upd({ stoffer: form.stoffer.map(s => s.id === id ? { ...s, ...patch } : s) })
  }

  const cover = form.images[0]
  const oppskriftPdfs = form.pdfs.filter(p => (p.type ?? 'Annet') === 'Oppskrift')
  const linkedSizes = linkedStatus === 'found' ? (linkedRecipe?.data.sizes ?? []) : []

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAF7F4' }}>

      {/* Sticky sub-header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-sm sticky z-10" style={{ top: '88px' }}>
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

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-24">

        {/* ── 1. Forsidebilde ── */}
        <SectionHeading first>Forsidebilde</SectionHeading>
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
                className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors">
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

        {/* ── 2. Detaljer ── */}
        <SectionHeading>Detaljer</SectionHeading>
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Prosjektnavn</label>
            <input className={inputCls} value={form.name} autoFocus
              onChange={e => upd({ name: e.target.value })}
              placeholder="Gi prosjektet et navn…" />
          </div>
          <div>
            <label className={labelCls}>Til hvem</label>
            <input className={inputCls} value={form.recipientName ?? ''}
              onChange={e => upd({ recipientName: e.target.value })}
              placeholder="F.eks. Emma, meg selv…" />
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
        </div>

        {/* ── 3. Koblet oppskrift ── */}
        <SectionHeading>Koblet oppskrift</SectionHeading>
        <div>
          {linkedStatus === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-stone-400">
              <Spinner /> Laster oppskrift…
            </div>
          )}

          {linkedStatus === 'found' && linkedRecipe && (
            <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-stone-200">
              <div className="w-14 h-14 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
                {linkedRecipe.data.images[0]?.url ? (
                  <img src={linkedRecipe.data.images[0].url} alt={linkedRecipe.data.name}
                    className="w-full h-full object-cover"
                    style={{ objectPosition: `${linkedRecipe.data.focalX ?? 50}% ${linkedRecipe.data.focalY ?? 50}%` }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-stone-800 text-sm truncate">{linkedRecipe.data.name}</p>
                {linkedRecipe.data.designer && (
                  <p className="text-xs text-stone-400 truncate">{linkedRecipe.data.designer}</p>
                )}
                {linkedRecipe.data.category && (
                  <span className="inline-block mt-1 px-2 py-0.5 rounded border text-xs font-medium bg-rose-50 text-rose-700 border-rose-200">
                    {linkedRecipe.data.category}
                  </span>
                )}
              </div>
              <button
                onClick={() => upd({ recipeId: '', recipeName: '' })}
                className="p-1.5 text-stone-300 hover:text-red-400 transition-colors flex-shrink-0"
                title="Fjern kobling">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {linkedStatus === 'deleted' && (
            <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
              <p className="text-sm text-stone-400">
                Originaloppskrift slettet
                {(form.recipeName ?? '') && (
                  <> — <em>{form.recipeName}</em></>
                )}
              </p>
            </div>
          )}

          {(linkedStatus === 'none' || linkedStatus === 'deleted') && (
            <button
              onClick={openRecipePicker}
              className="mt-3 flex items-center gap-2 px-4 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 hover:border-stone-300 transition-colors">
              <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Koble til oppskrift
            </button>
          )}
        </div>

        {/* ── 4. Størrelse ── */}
        <SectionHeading>Størrelse</SectionHeading>
        <div className="space-y-3">
          {linkedSizes.length > 0 && !sizeManual ? (
            <div className="space-y-2">
              <select
                className={inputCls}
                value={form.size ?? ''}
                onChange={e => upd({ size: e.target.value })}>
                <option value="">Velg størrelse…</option>
                {linkedSizes.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={() => setSizeManual(true)}
                className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
                Skriv inn manuelt
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input className={inputCls} value={form.size ?? ''}
                onChange={e => upd({ size: e.target.value })}
                placeholder="F.eks. 38, M, L/XL…" />
              {linkedSizes.length > 0 && (
                <button onClick={() => setSizeManual(false)}
                  className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
                  ← Tilbake til størrelsesliste
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── 5. Utstyr ── */}
        <SectionHeading>Utstyr</SectionHeading>
        <div className="space-y-2">
          {(form.equipmentList ?? []).map((item, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <input
                className={`${inputCls} flex-1`}
                value={item}
                onChange={e => {
                  const next = [...(form.equipmentList ?? [])]
                  next[idx] = e.target.value
                  upd({ equipmentList: next })
                }}
                placeholder={`Utstyr ${idx + 1}`}
              />
              <button
                onClick={() => upd({ equipmentList: (form.equipmentList ?? []).filter((_, i) => i !== idx) })}
                className="p-2 text-stone-300 hover:text-red-400 transition-colors flex-shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            onClick={() => upd({ equipmentList: [...(form.equipmentList ?? []), ''] })}
            className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-600 transition-colors mt-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Legg til
          </button>
        </div>

        {/* ── 6. Stoffer ── */}
        <SectionHeading>Stoffer</SectionHeading>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Importer fra produktside (URL)</label>
            <div className="flex gap-2">
              <input className={`${inputCls} flex-1`}
                value={stoffImportUrl}
                onChange={e => { setStoffImportUrl(e.target.value); setStoffImportError(''); setStoffImportNote('') }}
                onKeyDown={e => e.key === 'Enter' && importStoff()}
                placeholder="https://www.selfmade.com/…" />
              <button onClick={importStoff}
                disabled={!stoffImportUrl.trim() || stoffImporting}
                className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                {stoffImporting && <Spinner />}
                {stoffImporting ? 'Henter…' : 'Importer'}
              </button>
            </div>
            <p className="text-xs text-stone-400 mt-1.5">
              Selfmade, Stoff &amp; Stil, o.l. – Claude henter navn, materiale, bredde, vekt og vaskeinfo.
            </p>
          </div>
          {stoffImportError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{stoffImportError}</div>
          )}
          {stoffImportNote && !stoffImportError && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">{stoffImportNote}</div>
          )}
          {form.stoffer.length > 0 && (
            <ul className="space-y-3">
              {form.stoffer.map(stoff => (
                <li key={stoff.id} className="bg-white rounded-xl border border-stone-200 overflow-hidden flex">
                  {stoff.bilde ? (
                    <div className="w-20 flex-shrink-0 bg-stone-100">
                      <img src={stoff.bilde} alt={stoff.navn} className="w-full h-full object-cover" style={{ minHeight: '96px' }} />
                    </div>
                  ) : (
                    <div className="w-20 flex-shrink-0 bg-stone-50 flex items-center justify-center" style={{ minHeight: '96px' }}>
                      <svg className="w-7 h-7 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                      </svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-stone-800 text-sm leading-tight">
                        {stoff.navn || <span className="text-stone-400 italic font-normal">Ukjent stoff</span>}
                      </p>
                      <button onClick={() => removeStoff(stoff.id)}
                        className="p-1 rounded hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors flex-shrink-0 -mt-0.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {FABRIC_TYPES.map(t => (
                        <button key={t} onClick={() => updateStoff(stoff.id, { type: t })}
                          className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                            stoff.type === t
                              ? 'bg-stone-800 text-white border-stone-800'
                              : 'bg-white text-stone-400 border-stone-200 hover:border-stone-400 hover:text-stone-600'
                          }`}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-stone-500 space-y-0.5">
                      {stoff.materiale && <p className="font-medium text-stone-700">{stoff.materiale}</p>}
                      {(stoff.bredde || stoff.vekt) && (
                        <p className="text-stone-400">
                          {[
                            stoff.bredde && (stoff.bredde.includes('cm') ? stoff.bredde : `${stoff.bredde} cm`),
                            stoff.vekt   && (stoff.vekt.includes('g')    ? stoff.vekt   : `${stoff.vekt} g/m²`),
                          ].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {stoff.vask && <p className="text-stone-400 leading-relaxed">{stoff.vask}</p>}
                    </div>
                    <input
                      value={stoff.mengde}
                      onChange={e => updateStoff(stoff.id, { mengde: e.target.value })}
                      placeholder="Mengde (f.eks. 2 m)"
                      className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-stone-300 bg-stone-50"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {form.stoffer.length === 0 && !stoffImportError && (
            <p className="text-center py-6 text-sm text-stone-300">Ingen stoffer ennå</p>
          )}
        </div>

        {/* ── 7. Notater ── */}
        <SectionHeading>Notater &amp; Justeringer</SectionHeading>
        <textarea className={`${inputCls} resize-y`} style={{ minHeight: 180 }}
          value={form.notes}
          onChange={e => upd({ notes: e.target.value })}
          placeholder="Stoff, teknikker, endringer, observasjoner…" />

        {/* ── 8. PDF-arkiv ── */}
        <SectionHeading>PDF-arkiv</SectionHeading>
        <div className="space-y-4">
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
          {form.pdfs.length > 0 ? (
            <ul className="divide-y divide-stone-100">
              {form.pdfs.map(pdf => {
                const typeVal     = pdf.type ?? 'Annet'
                const isUpload    = (pdf.source ?? 'link') === 'upload'
                const commentCount = (form.pdfComments ?? []).filter(c => c.pdfId === pdf.id).length
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
                          {isUpload ? (
                            <button
                              onClick={() => setShowPdfViewer(pdf)}
                              className="text-sm font-medium text-stone-700 hover:text-stone-900 hover:underline underline-offset-2 truncate text-left transition-colors"
                            >
                              {pdf.name}
                            </button>
                          ) : (
                            <p className="text-sm font-medium text-stone-700 truncate">{pdf.name}</p>
                          )}
                          <Badge label={typeVal} cls={PDF_TYPE_STYLE[typeVal]} />
                          {commentCount > 0 && (
                            <span className="text-xs text-stone-400 flex-shrink-0">
                              💬 {commentCount}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          {isUpload ? (
                            <button
                              onClick={() => setShowPdfViewer(pdf)}
                              className="text-xs text-sky-500 hover:underline">
                              Åpne i viewer
                            </button>
                          ) : (
                            <a href={pdf.url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-sky-500 hover:underline">Åpne ↗</a>
                          )}
                          <select value={typeVal}
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

        {/* ── 9. Stoffberegner ── */}
        <SectionHeading>Stoffberegner</SectionHeading>
        <div className="space-y-4">
          {oppskriftPdfs.length === 0 ? (
            <p className="text-sm text-stone-400 italic">
              Merk en PDF som «Oppskrift» i PDF-arkivet for å bruke stoffberegneren.
            </p>
          ) : (
            oppskriftPdfs.map(pdf => {
              const isActive    = form.fabricCalc.pdfId === pdf.id
              const showSizes   = isActive && calcAvailableSizes.length > 0
              const loadingSz   = calcLoadingStep === 'sizes' && isActive
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

                  {!showSizes && (
                    <div className="space-y-1.5">
                      <button onClick={() => selectSizes(pdf)} disabled={calcLoadingStep !== ''}
                        className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {loadingSz && <Spinner />}
                        {loadingSz ? 'Laster størrelser…' : 'Velg størrelse'}
                      </button>
                      {loadingSz && calcProgress && isActive && (
                        <p className="text-xs text-stone-400">{calcProgress}</p>
                      )}
                    </div>
                  )}

                  {showSizes && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold tracking-widest uppercase text-stone-400">Velg størrelse</p>
                      <div className="flex flex-wrap gap-2">
                        {calcAvailableSizes.map(sz => (
                          <button key={sz}
                            onClick={() => { if (form.fabricCalc.size !== sz) upd({ fabricCalc: { ...form.fabricCalc, size: sz, result: '' } }) }}
                            className={`px-4 py-2 rounded-lg text-sm border transition-colors font-medium ${
                              form.fabricCalc.size === sz
                                ? 'bg-stone-800 text-white border-stone-800'
                                : 'bg-white text-stone-700 border-stone-200 hover:border-stone-400 hover:bg-stone-50'
                            }`}>
                            {sz}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => selectSizes(pdf)} disabled={calcLoadingStep !== ''}
                        className="text-xs text-stone-400 hover:text-stone-600 transition-colors disabled:opacity-40">
                        ↺ Last inn størrelser på nytt
                      </button>
                    </div>
                  )}

                  {isActive && !showSizes && form.fabricCalc.size && !loadingSz && (
                    <p className="text-xs text-stone-500">
                      Valgt størrelse: <strong>{form.fabricCalc.size}</strong>{' '}
                      <button onClick={() => selectSizes(pdf)} disabled={calcLoadingStep !== ''}
                        className="text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors disabled:opacity-40">
                        Endre
                      </button>
                    </p>
                  )}

                  {isActive && form.fabricCalc.size && (
                    <div className="space-y-1.5">
                      <button onClick={runFabricCalc} disabled={calcLoadingStep !== ''}
                        className="flex items-center gap-2 px-4 py-2 text-white text-sm rounded-lg transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ backgroundColor: '#C9A57A' }}>
                        {loadingCalc && <Spinner />}
                        {loadingCalc ? 'Beregner…' : `Beregn stoffmengde – str. ${form.fabricCalc.size}`}
                      </button>
                      {loadingCalc && calcProgress && isActive && (
                        <p className="text-xs text-stone-400">{calcProgress}</p>
                      )}
                    </div>
                  )}

                  {isActive && form.fabricCalc.result && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                      <p className="text-xs tracking-widest uppercase text-amber-500 mb-3">
                        Stoffbehov — størrelse {form.fabricCalc.size}
                      </p>
                      <div className="text-sm text-stone-700 leading-relaxed [&>h2]:font-['Cormorant_Garamond',serif] [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:text-stone-800 [&>h2]:mt-4 [&>h2]:mb-1 [&>h2:first-child]:mt-0 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-0.5 [&>p]:my-1 [&_strong]:font-semibold">
                        <ReactMarkdown>{form.fabricCalc.result}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
          {calcError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{calcError}</div>
          )}
        </div>

        {/* ── 10. Vedlikehold & Pleie ── */}
        <SectionHeading>Vedlikehold &amp; Pleie</SectionHeading>
        <div>
          <label className={labelCls}>Pleie &amp; Vedlikehold</label>
          <textarea className={`${inputCls} resize-y`} style={{ minHeight: 180 }}
            value={form.care.details}
            onChange={e => upd({ care: { details: e.target.value } })}
            placeholder="Pleieinstruksjoner…" />
        </div>
      </div>

      {showImgModal && <ImageUploadModal onAdd={addImage} onClose={() => setShowImgModal(false)} />}

      {showFocalModal && cover && (
        <FocalPointModal
          imageUrl={cover.url}
          focalX={form.focalX ?? 50}
          focalY={form.focalY ?? 50}
          onSave={(x, y) => upd({ focalX: x, focalY: y })}
          onClose={() => setShowFocalModal(false)}
        />
      )}

      {showPdfViewer && (
        <PdfViewerModal
          pdf={showPdfViewer}
          comments={form.pdfComments ?? []}
          onAddComment={addPdfComment}
          onDeleteComment={deletePdfComment}
          onClose={() => setShowPdfViewer(null)}
        />
      )}

      {showRecipePicker && (
        <RecipePicker
          recipes={pickerRecipes}
          onSelect={handleLinkRecipe}
          onClose={() => setShowRecipePicker(false)}
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

export default function ProjectsPage() {
  const [projects, setProjects]             = useState<Project[]>([])
  const [loading, setLoading]               = useState(true)
  const [showDetail, setShowDetail]         = useState(false)
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [showNewModal, setShowNewModal]     = useState(false)
  const [deleteId, setDeleteId]             = useState<string | null>(null)
  const [statusFilter, setStatusFilter]     = useState<Status | 'Alle'>('Alle')
  const [catFilter, setCatFilter]           = useState<Category | 'Alle'>('Alle')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('projects').select('*').order('created_at', { ascending: false })
      if (error) throw error
      const list = (data as Project[]) || []
      setProjects(list)

      // Open project redirected from another page (e.g. "Start prosjekt" in recipes)
      const openId = typeof window !== 'undefined' ? sessionStorage.getItem('openProjectId') : null
      if (openId) {
        sessionStorage.removeItem('openProjectId')
        const p = list.find(x => x.id === openId)
        if (p) { setCurrentProject(p); setShowDetail(true) }
      }
    } catch (err) {
      console.error('Load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteProject(id: string) {
    await supabase.from('projects').delete().eq('id', id)
    await load()
    setDeleteId(null)
    setShowDetail(false)
    setCurrentProject(null)
  }

  function handleCreated(project: Project) {
    setShowNewModal(false)
    setCurrentProject(project)
    setShowDetail(true)
    load()
  }

  function openEdit(p: Project) { setCurrentProject(p); setShowDetail(true) }
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
    <>
      {/* Filter bar + new button */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-white rounded-xl p-1 border border-stone-200 shadow-sm">
            {(['Alle', ...STATUSES] as const).map(s => {
              const count = counts[s as keyof typeof counts]
              return (
                <button key={s} onClick={() => setStatusFilter(s as Status | 'Alle')}
                  className={`px-3 sm:px-4 py-1.5 rounded-lg text-sm transition-colors ${
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
              Nullstill ×
            </button>
          )}
        </div>

        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-[#C9A57A] text-white text-sm rounded-xl hover:bg-[#b8925f] transition-colors font-medium whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nytt prosjekt
        </button>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
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
              <button onClick={() => setShowNewModal(true)}
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

      {showNewModal && (
        <NewProjectModal
          onCreated={handleCreated}
          onClose={() => setShowNewModal(false)}
        />
      )}

      {deleteId && (
        <DeleteDialog
          onConfirm={() => deleteProject(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
