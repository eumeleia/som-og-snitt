'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Status   = 'Aktiv' | 'Planlagt' | 'Fullført'
type Category = 'Klær' | 'Interiør' | 'Tilbehør' | 'Reparasjoner'
type ModalTab = 'info' | 'notater' | 'bilder' | 'pdfs' | 'stoff' | 'pleie'

interface ImageItem { id: string; url: string }
interface PdfItem   { id: string; name: string; url: string }

interface FabricCalcState { pdfId: string; size: string; result: string; loading: boolean }
interface CareState       { sourceUrl: string; details: string; loading: boolean }

interface ProjectData {
  name: string; status: Status; category: Category; date: string; notes: string
  images: ImageItem[]; pdfs: PdfItem[]
  fabricCalc: FabricCalcState; care: CareState
}

interface Project { id: string; created_at: string; data: ProjectData }

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUSES:   Status[]   = ['Aktiv', 'Planlagt', 'Fullført']
const CATEGORIES: Category[] = ['Klær', 'Interiør', 'Tilbehør', 'Reparasjoner']

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

const MODAL_TABS: { id: ModalTab; label: string }[] = [
  { id: 'info',    label: 'Info' },
  { id: 'notater', label: 'Notater' },
  { id: 'bilder',  label: 'Bilder' },
  { id: 'pdfs',    label: 'PDF-arkiv' },
  { id: 'stoff',   label: 'Stoffberegner' },
  { id: 'pleie',   label: 'Pleie & Vedlikehold' },
]

const EMPTY: ProjectData = {
  name: '', status: 'Planlagt', category: 'Klær', date: '', notes: '',
  images: [], pdfs: [],
  fabricCalc: { pdfId: '', size: '', result: '', loading: false },
  care:        { sourceUrl: '', details: '', loading: false },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid()     { return Math.random().toString(36).slice(2, 10) }
function toDay()   { return new Date().toISOString().split('T')[0] }
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
          ? <img src={cover} alt={d.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
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

// ── ProjectModal ──────────────────────────────────────────────────────────────

function ProjectModal({ project, onSave, onClose, onDelete }: {
  project: Project | null
  onSave: (data: ProjectData) => Promise<void>
  onClose: () => void
  onDelete?: () => void
}) {
  const [form, setForm]       = useState<ProjectData>(() =>
    project ? structuredClone(project.data) : structuredClone(EMPTY)
  )
  const [tab, setTab]         = useState<ModalTab>('info')
  const [saving, setSaving]   = useState(false)
  const [imgUrl, setImgUrl]   = useState('')
  const [pdfUrl, setPdfUrl]   = useState('')
  const [pdfName, setPdfName] = useState('')
  const [toast, setToast]     = useState('')

  function upd(patch: Partial<ProjectData>) { setForm(f => ({ ...f, ...patch })) }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    try { await onSave(form) }
    catch { showToast('Kunne ikke lagre. Prøv igjen.') }
    finally { setSaving(false) }
  }

  // Images
  function addImage() {
    if (!imgUrl.trim()) return
    upd({ images: [...form.images, { id: uid(), url: imgUrl.trim() }] })
    setImgUrl('')
  }
  function removeImage(id: string) { upd({ images: form.images.filter(i => i.id !== id) }) }

  // PDFs
  function addPdf() {
    if (!pdfUrl.trim()) return
    upd({ pdfs: [...form.pdfs, { id: uid(), name: pdfName.trim() || 'PDF', url: pdfUrl.trim() }] })
    setPdfUrl(''); setPdfName('')
  }
  function removePdf(id: string) { upd({ pdfs: form.pdfs.filter(p => p.id !== id) }) }

  // Fabric calculator
  async function runFabricCalc() {
    const pdf = form.pdfs.find(p => p.id === form.fabricCalc.pdfId)
    if (!pdf || !form.fabricCalc.size) return
    upd({ fabricCalc: { ...form.fabricCalc, loading: true, result: '' } })
    try {
      const base64 = await apiFetchPdf(pdf.url)
      const prompt =
        `Analyser dette symønsteret. Finn stoffbehovet for størrelse ${form.fabricCalc.size}.\n` +
        `Svar på norsk. List opp: stoff type, bredde, lengde og evt. tilbehør som glidelås, knapper.\n` +
        `Bullet points, kort og presist med konkrete mål.`
      const result = await apiClaude(prompt, base64)
      upd({ fabricCalc: { ...form.fabricCalc, result, loading: false } })
    } catch {
      upd({ fabricCalc: { ...form.fabricCalc, loading: false } })
      showToast('Kunne ikke analysere PDF – sjekk at lenken er tilgjengelig.')
    }
  }

  // Care import
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

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '92vh' }}>

          {/* Header */}
          <div className="flex items-start justify-between px-7 pt-6 pb-4 border-b border-stone-100">
            <div>
              <h2 className="font-serif text-3xl font-light text-stone-800 leading-tight">
                {project ? (form.name || 'Prosjekt') : 'Nytt prosjekt'}
              </h2>
              {project && (
                <p className="text-xs text-stone-400 mt-0.5">
                  Opprettet {fmtDate(project.created_at.slice(0, 10))}
                </p>
              )}
            </div>
            <button onClick={onClose} className="mt-1 p-2 rounded-xl hover:bg-stone-100 transition-colors text-stone-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex overflow-x-auto border-b border-stone-100 px-7 gap-0.5 flex-shrink-0">
            {MODAL_TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-3 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  tab === t.id
                    ? 'border-stone-700 text-stone-800 font-medium'
                    : 'border-transparent text-stone-400 hover:text-stone-600'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-7 py-6 min-h-0">

            {/* ── Info ── */}
            {tab === 'info' && (
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
                {project && (
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    {[
                      { label: 'Bilder',    val: form.images.length || '–' },
                      { label: 'PDF-er',    val: form.pdfs.length   || '–' },
                      { label: 'Pleieinfo', val: form.care.details ? '✓' : '–' },
                    ].map(s => (
                      <div key={s.label} className="bg-stone-50 rounded-xl p-3 text-center border border-stone-100">
                        <p className="font-serif text-2xl text-stone-700">{s.val}</p>
                        <p className="text-xs text-stone-400 mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Notater ── */}
            {tab === 'notater' && (
              <div>
                <label className={labelCls}>Notater</label>
                <textarea className={`${inputCls} resize-y`} style={{ minHeight: 260 }}
                  value={form.notes}
                  onChange={e => upd({ notes: e.target.value })}
                  placeholder="Stoff, teknikker, endringer, observasjoner…" />
              </div>
            )}

            {/* ── Bilder ── */}
            {tab === 'bilder' && (
              <div className="space-y-4">
                <div>
                  <label className={labelCls}>Legg til bilde (URL)</label>
                  <div className="flex gap-2">
                    <input className={`${inputCls} flex-1`} value={imgUrl}
                      onChange={e => setImgUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addImage()}
                      placeholder="https://…" />
                    <button onClick={addImage}
                      className="px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors">
                      Legg til
                    </button>
                  </div>
                </div>
                {form.images.length > 0 ? (
                  <div className="grid grid-cols-2 gap-3">
                    {form.images.map(img => (
                      <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden bg-stone-100">
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => removeImage(img.id)}
                          className="absolute top-2 right-2 p-1.5 bg-white/90 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50">
                          <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16 text-stone-300">
                    <svg className="w-10 h-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-sm">Ingen bilder ennå</p>
                  </div>
                )}
              </div>
            )}

            {/* ── PDF-arkiv ── */}
            {tab === 'pdfs' && (
              <div className="space-y-4">
                <div className="space-y-3 p-4 bg-stone-50 rounded-xl border border-stone-100">
                  <div>
                    <label className={labelCls}>PDF-navn</label>
                    <input className={inputCls} value={pdfName}
                      onChange={e => setPdfName(e.target.value)}
                      placeholder="Navn på mønster eller fil…" />
                  </div>
                  <div>
                    <label className={labelCls}>URL (Google Drive, direkte lenke…)</label>
                    <div className="flex gap-2">
                      <input className={`${inputCls} flex-1`} value={pdfUrl}
                        onChange={e => setPdfUrl(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addPdf()}
                        placeholder="https://…" />
                      <button onClick={addPdf}
                        className="px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors">
                        Legg til
                      </button>
                    </div>
                  </div>
                </div>
                {form.pdfs.length > 0 ? (
                  <ul className="divide-y divide-stone-100">
                    {form.pdfs.map(pdf => (
                      <li key={pdf.id} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-stone-700 truncate">{pdf.name}</p>
                            <a href={pdf.url} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="text-xs text-sky-500 hover:underline">
                              Åpne PDF ↗
                            </a>
                          </div>
                        </div>
                        <button onClick={() => removePdf(pdf.id)}
                          className="ml-3 p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors flex-shrink-0">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-center py-10 text-sm text-stone-300">Ingen PDF-er ennå</p>
                )}
              </div>
            )}

            {/* ── Stoffberegner ── */}
            {tab === 'stoff' && (
              <div className="space-y-5">
                <p className="text-sm text-stone-500 leading-relaxed">
                  Velg et mønster fra PDF-arkivet og oppgi størrelse. Claude leser mønsteret og
                  beregner nødvendig stoff automatisk.
                </p>
                <div>
                  <label className={labelCls}>PDF-mønster</label>
                  {form.pdfs.length === 0 ? (
                    <p className="text-sm text-stone-400 italic">
                      Legg til PDF-er i «PDF-arkiv»-fanen først.
                    </p>
                  ) : (
                    <select className={inputCls} value={form.fabricCalc.pdfId}
                      onChange={e => upd({ fabricCalc: { ...form.fabricCalc, pdfId: e.target.value } })}>
                      <option value="">Velg mønster…</option>
                      {form.pdfs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Størrelse</label>
                  <div className="flex gap-2">
                    <input className={`${inputCls} flex-1`}
                      value={form.fabricCalc.size}
                      onChange={e => upd({ fabricCalc: { ...form.fabricCalc, size: e.target.value } })}
                      placeholder="F.eks. 38, M, 36/38…" />
                    <button onClick={runFabricCalc}
                      disabled={!form.fabricCalc.pdfId || !form.fabricCalc.size || form.fabricCalc.loading}
                      className="flex items-center gap-2 px-5 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                      {form.fabricCalc.loading && <Spinner />}
                      {form.fabricCalc.loading ? 'Analyserer…' : 'Beregn stoff'}
                    </button>
                  </div>
                </div>
                {form.fabricCalc.result && (
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
            )}

            {/* ── Pleie & Vedlikehold ── */}
            {tab === 'pleie' && (
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
                  <textarea className={`${inputCls} resize-y`} style={{ minHeight: 200 }}
                    value={form.care.details}
                    onChange={e => upd({ care: { ...form.care, details: e.target.value } })}
                    placeholder="Pleieinstruksjoner… (skriv manuelt eller importer fra URL)" />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-7 py-4 border-t border-stone-100 flex-shrink-0">
            <div>
              {project && onDelete && (
                <button onClick={onDelete} className="text-sm text-red-400 hover:text-red-600 transition-colors">
                  Slett prosjekt
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose}
                className="px-4 py-2 text-sm text-stone-500 hover:bg-stone-100 rounded-lg transition-colors">
                Avbryt
              </button>
              <button onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="flex items-center gap-2 px-6 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed font-medium">
                {saving && <Spinner />}
                {saving ? 'Lagrer…' : 'Lagre'}
              </button>
            </div>
          </div>

          {/* Toast notification */}
          {toast && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg whitespace-nowrap z-10">
              {toast}
            </div>
          )}
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
  const [projects, setProjects]         = useState<Project[]>([])
  const [loading, setLoading]           = useState(true)
  const [isModalOpen, setIsModalOpen]   = useState(false)
  const [editing, setEditing]           = useState<Project | null>(null)
  const [deleteId, setDeleteId]         = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<Status | 'Alle'>('Alle')
  const [catFilter, setCatFilter]       = useState<Category | 'Alle'>('Alle')

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

  async function saveProject(projectData: ProjectData) {
    if (editing) {
      const { error } = await supabase.from('projects').update({ data: projectData }).eq('id', editing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('projects').insert({ data: projectData })
      if (error) throw error
    }
    await load()
    closeModal()
  }

  async function deleteProject(id: string) {
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) throw error
    await load()
    closeModal()
    setDeleteId(null)
  }

  function openNew()            { setEditing(null); setIsModalOpen(true) }
  function openEdit(p: Project) { setEditing(p);    setIsModalOpen(true) }
  function closeModal()         { setIsModalOpen(false); setEditing(null) }

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

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAF7F4' }}>

      {/* Header */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-4xl font-light text-stone-800 tracking-wide leading-none">
              Søm &amp; Snitt
            </h1>
            <p className="text-xs tracking-widest text-stone-400 mt-1 uppercase font-sans">
              Din sydagbok
            </p>
          </div>
          <button onClick={openNew}
            className="flex items-center gap-2 px-5 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium shadow-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nytt prosjekt
          </button>
        </div>
      </header>

      {/* Filters */}
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

      {/* Grid */}
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

      {/* Modals */}
      {isModalOpen && (
        <ProjectModal
          project={editing}
          onSave={saveProject}
          onClose={closeModal}
          onDelete={editing ? () => setDeleteId(editing.id) : undefined}
        />
      )}

      {deleteId && (
        <DeleteDialog
          onConfirm={() => deleteProject(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
