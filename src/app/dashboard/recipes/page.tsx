'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef, type ReactNode, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, rectSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ── Types ─────────────────────────────────────────────────────────────────────

type PdfType   = 'Oppskrift' | 'Mønster' | 'Annet'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface ImageItem { id: string; url: string }
interface PdfItem   { id: string; name: string; url: string; type: PdfType; source: 'upload' | 'link' }

interface RecipeData {
  name: string
  designer: string
  category: string
  recommendedFabrics: string
  otherEquipment: string
  notes: string
  sizes: string[]
  pdfs: PdfItem[]
  images: ImageItem[]
  coverImageId: string
  focalX: number
  focalY: number
  sortOrder?: number
}

interface Recipe { id: string; created_at: string; data: RecipeData }

// ── Constants ─────────────────────────────────────────────────────────────────

const PDF_TYPES: PdfType[] = ['Oppskrift', 'Mønster', 'Annet']

const CATEGORY_SUGGESTIONS = [
  'Bukse', 'Kjole', 'Skjorte', 'Jakke', 'Bluse', 'Leggings',
  'Topp', 'Shorts', 'Skjørt', 'Frakk', 'Kåpe', 'Cardigan',
  'Undertøy', 'Badedrakt', 'Barn', 'Interiør', 'Tilbehør',
]

const PDF_TYPE_STYLE: Record<PdfType, string> = {
  Oppskrift: 'bg-rose-50 text-rose-700 border-rose-200',
  Mønster:   'bg-teal-50 text-teal-700 border-teal-200',
  Annet:     'bg-stone-50 text-stone-500 border-stone-200',
}

const EMPTY: RecipeData = {
  name: '', designer: '', category: '',
  recommendedFabrics: '', otherEquipment: '', notes: '',
  sizes: [], pdfs: [], images: [],
  coverImageId: '', focalX: 50, focalY: 50,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10) }

// formatSizeRange(['6m','2y']) → '6m–2y' | ['XS','L'] → 'XS–L' | ['38','44'] → '38–44' | ['M'] → 'M' | [] → ''
const LETTER_SIZE_WEIGHT: Record<string, number> = {
  XS: 10000, S: 20000, M: 30000, L: 40000, XL: 50000, XXL: 60000, XXXL: 70000,
}
function sizeWeight(s: string): number {
  const u = s.toUpperCase()
  if (LETTER_SIZE_WEIGHT[u] !== undefined) return LETTER_SIZE_WEIGHT[u]
  const mM = s.match(/^(\d+(?:\.\d+)?)m$/i)
  if (mM) return parseFloat(mM[1])
  const yM = s.match(/^(\d+(?:\.\d+)?)y$/i)
  if (yM) return parseFloat(yM[1]) * 12
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 100
  return NaN
}
function formatSizeRange(sizes: string[]): string {
  if (sizes.length === 0) return ''
  if (sizes.length === 1) return sizes[0]
  const sorted = [...sizes].sort((a, b) => {
    const wa = sizeWeight(a), wb = sizeWeight(b)
    if (isNaN(wa) || isNaN(wb)) return 0
    return wa - wb
  })
  return `${sorted[0]}–${sorted[sorted.length - 1]}`
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
    catch { errMsg = `HTTP ${r.status} – ${text.slice(0, 300)}` }
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
    try { errMsg = (JSON.parse(text) as { error?: string }).error ?? `HTTP ${r.status}` }
    catch { errMsg = `HTTP ${r.status}: ${text.slice(0, 200)}` }
    throw new Error(errMsg)
  }
  const j = await r.json()
  if (j.error) throw new Error(j.error)
  return j.data as string
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

// ── Shared UI ─────────────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 border border-stone-200 rounded-lg text-base sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition'
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

// ── RecipeCard ────────────────────────────────────────────────────────────────

function RecipeCard({ recipe, onEdit, onDelete, dragHandle }: {
  recipe: Recipe; onEdit: () => void; onDelete: () => void
  dragHandle?: React.ReactNode
}) {
  const d = recipe.data
  const cover = d.images[0]?.url

  return (
    <article
      onClick={onEdit}
      className="group bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col"
    >
      <div className="h-44 bg-stone-50 overflow-hidden flex-shrink-0 relative">
        {dragHandle && <div className="absolute top-2 left-2 z-10">{dragHandle}</div>}
        {cover
          ? <img src={cover} alt={d.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              style={{ objectPosition: `${d.focalX ?? 50}% ${d.focalY ?? 50}%` }} />
          : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-10 h-10 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          )
        }
      </div>

      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-serif text-xl font-semibold text-stone-800 mb-1 truncate leading-tight">
          {d.name || <span className="text-stone-300 italic font-light">Uten navn</span>}
        </h3>
        {d.designer && <p className="text-xs text-stone-400 mb-2">{d.designer}</p>}
        {d.category && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Badge label={d.category} cls="bg-rose-50 text-rose-700 border-rose-200" />
          </div>
        )}

        <div className="flex items-center justify-between mt-auto pt-3 border-t border-stone-100">
          <div className="flex gap-3 text-xs text-stone-400">
            {d.sizes.length > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
                </svg>
                {formatSizeRange(d.sizes)}
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

// ── SortableRecipeCard ────────────────────────────────────────────────────────

function SortableRecipeCard({ recipe, onEdit, onDelete, isDragMode }: {
  recipe: Recipe; onEdit: () => void; onDelete: () => void; isDragMode: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: recipe.id,
    disabled: !isDragMode,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
    >
      <RecipeCard
        recipe={recipe}
        onEdit={onEdit}
        onDelete={onDelete}
        dragHandle={isDragMode ? (
          <button
            {...listeners}
            className="p-1.5 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm touch-none cursor-grab active:cursor-grabbing"
            onClick={e => e.stopPropagation()}
            aria-label="Dra for å sortere"
          >
            <svg className="w-4 h-4 text-stone-400" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" />
              <circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" />
              <circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" />
            </svg>
          </button>
        ) : undefined}
      />
    </div>
  )
}

// ── NewRecipeModal ────────────────────────────────────────────────────────────

function NewRecipeModal({ onCreate, onClose }: {
  onCreate: (data: RecipeData) => Promise<void>
  onClose: () => void
}) {
  const [mode, setMode]         = useState<'choose' | 'pdf' | 'blank'>('choose')
  const [progress, setProgress] = useState('')
  const [error, setError]       = useState('')
  const [blankName, setBlankName] = useState('')
  const [creating, setCreating] = useState(false)
  const fileInputRef            = useRef<HTMLInputElement>(null)

  async function handlePdfFile(file: File) {
    setMode('pdf')
    setError('')
    setCreating(true)

    const recipeData: RecipeData = { ...structuredClone(EMPTY) }

    try {
      // 1. Upload PDF
      setProgress('Laster opp PDF...')
      const pdfFilename = `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
      const { error: pdfUploadErr } = await supabase.storage
        .from('project-images')
        .upload(pdfFilename, file, { contentType: 'application/pdf' })
      if (pdfUploadErr) throw new Error('PDF-opplasting feilet')
      const { data: pdfUrlData } = supabase.storage.from('project-images').getPublicUrl(pdfFilename)

      recipeData.pdfs = [{
        id: uid(), name: file.name,
        url: pdfUrlData.publicUrl, type: 'Oppskrift', source: 'upload',
      }]

      // 2. Extract text (first 20 pages)
      setProgress('Leser tekst...')
      const arrayBuffer = await file.arrayBuffer()
      const uint8 = new Uint8Array(arrayBuffer)

      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
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

      // 3. Claude analysis
      setProgress('Analyserer...')
      const prompt =
        `Du får tekst fra en søm-oppskrift (PDF). Returner KUN gyldig JSON, ingen forklaring:\n\n` +
        `{\n  "name": "",\n  "designer": "",\n  "category": "",\n  "sizes": [],\n  "recommendedFabrics": "",\n  "otherEquipment": ""\n}\n\n` +
        `Feltforklaring:\n` +
        `- name: oppskriftens navn (f.eks. 'Bébé Blossom Dress')\n` +
        `- designer: designeren eller mønstermerket (f.eks. 'Sew Liberated', 'Tilly and the Buttons')\n` +
        `- category: klesplagg-type på norsk (f.eks. 'kjole', 'skjorte', 'bukse', 'genser')\n` +
        `- sizes: array av størrelser, på originalspråk (f.eks. ['1Y', '2Y', '3-4Y'] eller ['XS', 'S', 'M', 'L'])\n` +
        `- recommendedFabrics: kort norsk beskrivelse av anbefalt stoff (f.eks. 'Lett til medium tung vevd stoff: bomullsvoile, lin, batiste')\n` +
        `- otherEquipment: liste over tilbehør på norsk, separert med komma (f.eks. 'Elastikk 1,2 cm, klisterinnlegg, sytråd')\n\n` +
        `Hvis et felt ikke finnes i oppskriften, bruk tom streng / tomt array. Ikke finn på.`

      try {
        const raw = await apiClaude(prompt, text.slice(0, 50000))
        const s = raw.indexOf('{')
        const e = raw.lastIndexOf('}')
        if (s !== -1 && e !== -1) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed: any = JSON.parse(raw.slice(s, e + 1))
          recipeData.name             = (typeof parsed.name === 'string' && parsed.name.trim()) ? parsed.name.trim() : 'Ny oppskrift'
          recipeData.designer         = typeof parsed.designer === 'string' ? parsed.designer.trim() : ''
          recipeData.category         = typeof parsed.category === 'string' ? parsed.category.trim() : ''
          recipeData.sizes            = Array.isArray(parsed.sizes) ? parsed.sizes.filter((v: unknown) => typeof v === 'string') : []
          recipeData.recommendedFabrics = typeof parsed.recommendedFabrics === 'string' ? parsed.recommendedFabrics.trim() : ''
          recipeData.otherEquipment   = typeof parsed.otherEquipment === 'string' ? parsed.otherEquipment.trim() : ''
        } else {
          recipeData.name = 'Ny oppskrift'
        }
      } catch {
        recipeData.name = 'Ny oppskrift'
      }

      // 4. Render cover image from first page
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
            const imgFilename = `recipe-cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
            const { error: imgErr } = await supabase.storage
              .from('project-images')
              .upload(imgFilename, blob, { contentType: 'image/jpeg' })
            if (!imgErr) {
              const { data: imgUrlData } = supabase.storage.from('project-images').getPublicUrl(imgFilename)
              const imgId = uid()
              recipeData.images      = [{ id: imgId, url: imgUrlData.publicUrl }]
              recipeData.coverImageId = imgId
              recipeData.focalX      = 50
              recipeData.focalY      = 50
            }
          }
        }
      } catch {
        // No cover — user can add manually
      }

      // 5. Create recipe
      setProgress('Oppretter oppskrift...')
      await onCreate(recipeData)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen.')
      setCreating(false)
      setProgress('')
      setMode('choose')
    }
  }

  async function handleBlank() {
    if (!blankName.trim()) return
    setCreating(true)
    setError('')
    try {
      await onCreate({ ...structuredClone(EMPTY), name: blankName.trim() })
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

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={mode !== 'pdf' ? onClose : undefined} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {mode === 'choose' && (
          <>
            <div className="px-6 pt-6 pb-2">
              <h3 className="font-serif text-2xl text-stone-800">Ny oppskrift</h3>
            </div>
            <div className="p-6 space-y-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={handleDrop}
                className="w-full border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center hover:border-[#C9A57A] hover:bg-amber-50/30 transition-colors cursor-pointer group">
                <svg className="w-10 h-10 text-stone-300 group-hover:text-[#C9A57A] mx-auto mb-3 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                </svg>
                <p className="font-medium text-stone-700 mb-1">Last opp PDF</p>
                <p className="text-xs text-stone-400">Anbefalt — navn, designer og størrelser fylles inn automatisk</p>
              </button>
              <input
                ref={fileInputRef} type="file" accept="application/pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f) }}
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={() => { setError(''); setMode('blank') }}
                className="w-full py-2.5 text-sm text-stone-500 hover:text-stone-700 transition-colors">
                Start tomt
              </button>
              <button onClick={onClose}
                className="w-full py-1.5 text-sm text-stone-300 hover:text-stone-500 transition-colors">
                Avbryt
              </button>
            </div>
          </>
        )}

        {mode === 'pdf' && (
          <div className="px-6 py-14 text-center">
            <div className="w-10 h-10 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin mx-auto mb-5" />
            <p className="font-serif text-lg text-stone-700 mb-1">Analyserer oppskrift…</p>
            <p className="text-sm text-stone-400">{progress}</p>
          </div>
        )}

        {mode === 'blank' && (
          <>
            <div className="px-6 pt-6 pb-2">
              <h3 className="font-serif text-2xl text-stone-800 mb-0.5">Ny oppskrift</h3>
              <p className="text-sm text-stone-400">Du kan legge til detaljer etterpå</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Navn *</label>
                <input className={inputCls} value={blankName} autoFocus
                  onChange={e => setBlankName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleBlank()}
                  placeholder="F.eks. Sommerkjole" />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={handleBlank}
                disabled={!blankName.trim() || creating}
                className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {creating && <Spinner />}
                {creating ? 'Oppretter…' : 'Opprett oppskrift'}
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
      const filename = `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
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

// ── GalleryPickerModal ────────────────────────────────────────────────────────

function GalleryPickerModal({ images, onSelect, onClose }: {
  images: ImageItem[]
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-stone-800">Velg forsidebilde</h3>
          <p className="text-xs text-stone-400 mt-0.5">Klikk på bildet du vil bruke som forsidebilde</p>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          <div className="grid grid-cols-3 gap-3">
            {images.map(img => (
              <button key={img.id} onClick={() => { onSelect(img.id); onClose() }}
                className="aspect-square rounded-xl overflow-hidden bg-stone-100 hover:ring-2 hover:ring-[#C9A57A] transition-all">
                <img src={img.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0">
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

// ── DeleteDialog ──────────────────────────────────────────────────────────────

function DeleteDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl p-7 max-w-sm w-full shadow-2xl">
        <h3 className="font-serif text-2xl font-light text-stone-800 mb-2">Slett oppskrift?</h3>
        <p className="text-sm text-stone-500 mb-6">Oppskriften slettes permanent og kan ikke gjenopprettes.</p>
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

// ── StartProjectButton ────────────────────────────────────────────────────────

function StartProjectButton({ recipe, router }: {
  recipe: Recipe
  router: ReturnType<typeof useRouter>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleClick() {
    setLoading(true)
    setError('')
    try {
      const d = recipe.data
      const equipmentList = d.otherEquipment
        ? d.otherEquipment.split(',').map((s: string) => s.trim()).filter(Boolean)
        : []

      const projectData = {
        name:          d.name,
        status:        'Planlagt' as const,
        category:      'Klær' as const,
        date:          '',
        notes:         '',
        images:        d.images.map(i => ({ id: uid(), url: i.url })),
        pdfs:          d.pdfs.map(p => ({ ...p, id: uid() })),
        fabricCalc:    { pdfId: '', size: '', result: '' },
        care:          { details: '' },
        stoffer:       [],
        focalX:        d.focalX ?? 50,
        focalY:        d.focalY ?? 50,
        recipientName: '',
        size:          '',
        recipeId:      recipe.id,
        recipeName:    d.name,
        equipmentList,
      }

      const { data: rows, error: e } = await supabase
        .from('projects').insert({ data: projectData }).select()
      if (e) throw e
      const project = (rows as { id: string }[])?.[0]
      if (project) {
        sessionStorage.setItem('openProjectId', project.id)
        router.push('/dashboard/projects')
      }
    } catch {
      setError('Kunne ikke opprette prosjekt. Prøv igjen.')
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[#C9A57A] text-white text-sm rounded-xl hover:bg-[#b8925f] transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-70" />
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        )}
        {loading ? 'Oppretter prosjekt…' : 'Start prosjekt'}
      </button>
      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
    </div>
  )
}

// ── RecipeDetail ──────────────────────────────────────────────────────────────

function RecipeDetail({ recipe, onBack, onSaved, onDelete }: {
  recipe: Recipe
  onBack: () => void
  onSaved: () => void
  onDelete?: () => void
}) {
  const router = useRouter()
  const [form, setForm] = useState<RecipeData>(() =>
    ({ ...structuredClone(EMPTY), ...structuredClone(recipe.data) })
  )
  const [saveStatus, setSaveStatus]         = useState<SaveStatus>('idle')
  const [showImgModal, setShowImgModal]           = useState(false)
  const [showFocalModal, setShowFocalModal]       = useState(false)
  const [showGalleryPicker, setShowGalleryPicker] = useState(false)
  const [toast, setToast]                   = useState('')

  // PDF form
  const [pdfTab, setPdfTab]         = useState<'file' | 'link'>('file')
  const [pdfFile, setPdfFile]       = useState<File | null>(null)
  const [pdfUrl, setPdfUrl]         = useState('')
  const [pdfName, setPdfName]       = useState('')
  const [pdfType, setPdfType]       = useState<PdfType>('Oppskrift')
  const [pdfUploading, setPdfUploading] = useState(false)
  const pdfFileInputRef             = useRef<HTMLInputElement>(null)

  // Sizes
  const [sizesLoading, setSizesLoading]   = useState(false)
  const [sizesError, setSizesError]       = useState('')
  const [sizesProgress, setSizesProgress] = useState('')
  const [manualSize, setManualSize]       = useState('')
  const pdfTextCacheRef = useRef<Record<string, string>>({})

  const recipeIdRef  = useRef<string>(recipe.id)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef   = useRef<RecipeData>(form)
  const isMounted    = useRef(false)

  function upd(patch: Partial<RecipeData>) {
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

  async function doSave(data: RecipeData) {
    setSaveStatus('saving')
    try {
      const { error } = await supabase.from('recipes').update({ data }).eq('id', recipeIdRef.current)
      if (error) throw error
      setSaveStatus('saved')
      onSaved()
      setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 2000)
    } catch {
      setSaveStatus('error')
      showToast('Kunne ikke lagre. Prøv igjen.')
    }
  }

  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveStatus('saving')
    saveTimerRef.current = setTimeout(() => {
      doSave(pendingRef.current)
    }, 600)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  async function handleBack() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      await doSave(pendingRef.current)
    }
    onBack()
  }

  // ── Images ─────────────────────────────────────────────────────────────────

  function addImage(url: string) { upd({ images: [...form.images, { id: uid(), url }] }) }
  function removeImage(id: string) { upd({ images: form.images.filter(i => i.id !== id) }) }
  function setCoverFromGallery(id: string) {
    const idx = form.images.findIndex(i => i.id === id)
    if (idx <= 0) return
    const reordered = [form.images[idx], ...form.images.filter((_, i) => i !== idx)]
    upd({ images: reordered })
  }

  // ── PDFs ───────────────────────────────────────────────────────────────────

  async function handlePdfUpload() {
    if (!pdfFile) return
    setPdfUploading(true)
    try {
      const ext = pdfFile.name.split('.').pop() ?? 'pdf'
      const filename = `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
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
    upd({ pdfs: form.pdfs.filter(p => p.id !== id) })
    delete pdfTextCacheRef.current[id]
  }

  function updatePdfType(id: string, type: PdfType) {
    upd({ pdfs: form.pdfs.map(p => p.id === id ? { ...p, type } : p) })
  }

  // ── Size reading ───────────────────────────────────────────────────────────

  async function readSizesFromPdf() {
    const oppskriftPdf = form.pdfs.find(p => p.type === 'Oppskrift')
    if (!oppskriftPdf) return
    setSizesLoading(true)
    setSizesError('')
    setSizesProgress('')
    try {
      if (!pdfTextCacheRef.current[oppskriftPdf.id]) {
        let data: Uint8Array
        if (oppskriftPdf.source === 'upload') {
          const res = await fetch(oppskriftPdf.url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          data = new Uint8Array(await res.arrayBuffer())
        } else {
          const base64 = await apiFetchPdf(oppskriftPdf.url)
          const binary = atob(base64)
          data = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
        }
        const text = await extractPdfText(data, (page, total) =>
          setSizesProgress(`Leser PDF side ${page} av ${total}…`)
        )
        if (!text.trim()) throw new Error('PDF-en inneholder ingen lesbar tekst (kanskje skannet?)')
        pdfTextCacheRef.current[oppskriftPdf.id] = text.slice(0, 50000)
      }
      setSizesProgress('Analyserer størrelser…')
      const text = pdfTextCacheRef.current[oppskriftPdf.id]
      const prompt =
        `Analyser dette symønsteret og finn alle tilgjengelige størrelser.\n` +
        `Svar BARE med en JSON-array av størrelser som strenger, f.eks: ["36","38","40","42"] eller ["XS","S","M","L","XL"].\n` +
        `Ingen annen tekst. Kun JSON-arrayen.`
      const raw = await apiClaude(prompt, text)
      const trimmed = raw.trim()
      const start = trimmed.indexOf('[')
      const end   = trimmed.lastIndexOf(']')
      if (start === -1 || end === -1) throw new Error(`Fant ingen størrelsesliste. Svar: ${trimmed.slice(0, 200)}`)
      const sizes: string[] = JSON.parse(trimmed.slice(start, end + 1))
      if (!Array.isArray(sizes) || sizes.length === 0) throw new Error('Ingen størrelser funnet')
      upd({ sizes })
    } catch (err) {
      setSizesError(`Kunne ikke lese størrelser: ${err instanceof Error ? err.message : 'Ukjent feil'}`)
    } finally {
      setSizesLoading(false)
      setSizesProgress('')
    }
  }

  function addManualSize() {
    const trimmed = manualSize.trim()
    if (!trimmed || form.sizes.includes(trimmed)) return
    upd({ sizes: [...form.sizes, trimmed] })
    setManualSize('')
  }

  function removeSize(sz: string) {
    upd({ sizes: form.sizes.filter(s => s !== sz) })
  }

  const cover = form.images[0]
  const hasOppskriftPdf = form.pdfs.some(p => p.type === 'Oppskrift')

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
            {form.name || <span className="text-stone-300 font-light italic">Ny oppskrift</span>}
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
              <div className="flex items-center gap-4 flex-wrap">
                <button onClick={() => setShowFocalModal(true)}
                  className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3M12 18v3M3 12h3M18 12h3" />
                  </svg>
                  Velg fokuspunkt
                </button>
                {form.images.length > 1 && (
                  <button onClick={() => setShowGalleryPicker(true)}
                    className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-600 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Velg fra galleri
                  </button>
                )}
              </div>
            </>
          ) : (
            <button onClick={() => setShowImgModal(true)}
              className="w-full rounded-2xl bg-stone-100 hover:bg-stone-50 transition-colors flex flex-col items-center justify-center gap-3 text-stone-300 hover:text-stone-400"
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

        {/* ── 2. Grunnfakta ── */}
        <SectionHeading>Grunnfakta</SectionHeading>
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Navn</label>
            <input className={inputCls} value={form.name}
              onChange={e => upd({ name: e.target.value })}
              placeholder="Gi oppskriften et navn…" />
          </div>
          <div>
            <label className={labelCls}>Designer</label>
            <input className={inputCls} value={form.designer}
              onChange={e => upd({ designer: e.target.value })}
              placeholder="F.eks. Bebe et Bisou" />
          </div>
          <div>
            <label className={labelCls}>Kategori</label>
            <input className={inputCls} value={form.category}
              onChange={e => upd({ category: e.target.value })}
              list="detail-category-suggestions"
              placeholder="F.eks. Kjole" />
            <datalist id="detail-category-suggestions">
              {CATEGORY_SUGGESTIONS.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>

        {/* ── 3. Størrelser ── */}
        <SectionHeading>Størrelser</SectionHeading>
        <div className="space-y-4">
          {form.sizes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.sizes.map(sz => (
                <span key={sz}
                  className="flex items-center gap-1.5 px-3 py-1 bg-stone-100 text-stone-700 text-sm rounded-full border border-stone-200">
                  {sz}
                  <button onClick={() => removeSize(sz)}
                    className="text-stone-400 hover:text-red-500 transition-colors leading-none">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          {hasOppskriftPdf && (
            <button
              onClick={readSizesFromPdf}
              disabled={sizesLoading}
              className="flex items-center gap-2 px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {sizesLoading && <Spinner />}
              {sizesLoading ? (sizesProgress || 'Leser…') : 'Les størrelser fra PDF'}
            </button>
          )}
          {!hasOppskriftPdf && (
            <p className="text-xs text-stone-400 italic">
              Last opp en PDF av type «Oppskrift» for å bruke størrelsesleseren.
            </p>
          )}

          <div className="flex gap-2">
            <input
              className={`${inputCls} flex-1`}
              value={manualSize}
              onChange={e => setManualSize(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addManualSize()}
              placeholder="Legg til manuelt (f.eks. 38)" />
            <button
              onClick={addManualSize}
              disabled={!manualSize.trim()}
              className="px-4 py-2 border border-stone-200 bg-white text-sm text-stone-600 rounded-lg hover:bg-stone-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
              Legg til
            </button>
          </div>

          {sizesError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              {sizesError}
            </div>
          )}
        </div>

        {/* ── 4. Anbefalt stoff ── */}
        <SectionHeading>Anbefalt stoff</SectionHeading>
        <textarea className={`${inputCls} resize-y`} style={{ minHeight: 100 }}
          value={form.recommendedFabrics}
          onChange={e => upd({ recommendedFabrics: e.target.value })}
          placeholder="Vevd bomull, jersey, lin…" />

        {/* ── 5. Annet utstyr ── */}
        <SectionHeading>Annet utstyr</SectionHeading>
        <textarea className={`${inputCls} resize-y`} style={{ minHeight: 100 }}
          value={form.otherEquipment}
          onChange={e => upd({ otherEquipment: e.target.value })}
          placeholder="Glidelås, knapper, strømpør…" />

        {/* ── 6. Notater ── */}
        <SectionHeading>Notater</SectionHeading>
        <textarea className={`${inputCls} resize-y`} style={{ minHeight: 140 }}
          value={form.notes}
          onChange={e => upd({ notes: e.target.value })}
          placeholder="Notater, erfaringer, tips…" />

        {/* ── 7. PDF-arkiv ── */}
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
                <div className="flex gap-2 flex-wrap">
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
                    <label className={labelCls}>URL</label>
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

        {/* ── 8. Start prosjekt + Slett ── */}
        <div className="mt-16 pt-8 border-t border-stone-200 space-y-3">
          <StartProjectButton recipe={recipe} router={router} />
          {onDelete && (
            <button onClick={onDelete}
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors border border-red-200 hover:border-red-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Slett oppskrift
            </button>
          )}
        </div>
      </div>

      {showImgModal && (
        <ImageUploadModal onAdd={addImage} onClose={() => setShowImgModal(false)} />
      )}
      {showGalleryPicker && form.images.length > 1 && (
        <GalleryPickerModal
          images={form.images.slice(1)}
          onSelect={setCoverFromGallery}
          onClose={() => setShowGalleryPicker(false)}
        />
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RecipesPage() {
  const [recipes, setRecipes]               = useState<Recipe[]>([])
  const [loading, setLoading]               = useState(true)
  const [showDetail, setShowDetail]         = useState(false)
  const [currentRecipe, setCurrentRecipe]   = useState<Recipe | null>(null)
  const [showNewModal, setShowNewModal]     = useState(false)
  const [deleteId, setDeleteId]             = useState<string | null>(null)
  const [search, setSearch]                 = useState('')
  const [sortBy, setSortBy]                 = useState<'Manuell' | 'Nyeste' | 'Eldste' | 'Navn'>('Manuell')
  const [orderSaving, setOrderSaving]       = useState(false)
  const [orderSaved, setOrderSaved]         = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('recipes').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setRecipes((data as Recipe[]) || [])
    } catch (err) {
      console.error('Load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createRecipe(data: RecipeData) {
    const { data: rows, error } = await supabase.from('recipes').insert({ data }).select()
    if (error) throw error
    const recipe = (rows as Recipe[])?.[0]
    if (recipe) {
      setRecipes(prev => [recipe, ...prev])
      setCurrentRecipe(recipe)
      setShowNewModal(false)
      setShowDetail(true)
    }
  }

  async function deleteRecipe(id: string) {
    await supabase.from('recipes').delete().eq('id', id)
    await load()
    setDeleteId(null)
    setShowDetail(false)
    setCurrentRecipe(null)
  }

  function openEdit(r: Recipe) { setCurrentRecipe(r); setShowDetail(true) }
  function handleBack()        { setShowDetail(false); setCurrentRecipe(null); load() }

  const filtered = recipes.filter(r => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      r.data.name.toLowerCase().includes(q) ||
      r.data.designer.toLowerCase().includes(q)
    )
  })

  const sortedFiltered = [...filtered].sort((a, b) => {
    if (sortBy === 'Nyeste') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (sortBy === 'Eldste') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    if (sortBy === 'Navn') return a.data.name.localeCompare(b.data.name, 'nb')
    const aO = a.data.sortOrder ?? Infinity
    const bO = b.data.sortOrder ?? Infinity
    if (aO !== bO) return aO - bO
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = sortedFiltered.findIndex(r => r.id === active.id)
    const newIdx = sortedFiltered.findIndex(r => r.id === over.id)
    const newOrder = arrayMove(sortedFiltered, oldIdx, newIdx)

    const updatedMap = new Map<string, number>()
    newOrder.forEach((r, i) => updatedMap.set(r.id, (i + 1) * 1000))

    const newRecipes = recipes.map(r => {
      const order = updatedMap.get(r.id)
      return order !== undefined ? { ...r, data: { ...r.data, sortOrder: order } } : r
    })

    setRecipes(newRecipes)
    setOrderSaving(true)
    try {
      await Promise.all(
        Array.from(updatedMap.keys()).map(id => {
          const r = newRecipes.find(x => x.id === id)!
          return supabase.from('recipes').update({ data: r.data }).eq('id', id)
        })
      )
      setOrderSaved(true)
      setTimeout(() => setOrderSaved(false), 2000)
    } catch { /* silent */ }
    finally { setOrderSaving(false) }
  }

  if (showDetail && currentRecipe) {
    return (
      <>
        <RecipeDetail
          recipe={currentRecipe}
          onBack={handleBack}
          onSaved={load}
          onDelete={() => setDeleteId(currentRecipe.id)}
        />
        {deleteId && (
          <DeleteDialog
            onConfirm={() => deleteRecipe(deleteId)}
            onCancel={() => setDeleteId(null)}
          />
        )}
      </>
    )
  }

  return (
    <>
      {/* Search + sort + new button */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Søk på navn eller designer…"
            className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="px-2.5 py-2 border border-stone-200 rounded-xl text-sm bg-white text-stone-600 focus:outline-none focus:ring-2 focus:ring-stone-300 shadow-sm"
          >
            <option value="Manuell">Manuell (min rekkefølge)</option>
            <option value="Nyeste">Nyeste først</option>
            <option value="Eldste">Eldste først</option>
            <option value="Navn">Navn A–Å</option>
          </select>
          {orderSaving && <span className="text-xs text-stone-400">Lagrer…</span>}
          {!orderSaving && orderSaved && <span className="text-xs text-emerald-500 font-medium">Lagret ✓</span>}
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-[#C9A57A] text-white text-sm rounded-xl hover:bg-[#b8925f] transition-colors font-medium whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Ny oppskrift
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
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
            </svg>
            <p className="font-serif text-2xl text-stone-400 font-light">
              {recipes.length === 0 ? 'Ingen oppskrifter ennå' : 'Ingen treff'}
            </p>
            {recipes.length === 0 && (
              <>
                <p className="text-sm text-stone-400 mt-2">Last opp din første!</p>
                <button onClick={() => setShowNewModal(true)}
                  className="mt-5 px-6 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium">
                  Legg til oppskrift
                </button>
              </>
            )}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedFiltered.map(r => r.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {sortedFiltered.map(r => (
                  <SortableRecipeCard key={r.id} recipe={r}
                    onEdit={() => openEdit(r)}
                    onDelete={() => setDeleteId(r.id)}
                    isDragMode={sortBy === 'Manuell'}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

      {showNewModal && (
        <NewRecipeModal
          onCreate={createRecipe}
          onClose={() => setShowNewModal(false)}
        />
      )}

      {deleteId && !showDetail && (
        <DeleteDialog
          onConfirm={() => deleteRecipe(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
