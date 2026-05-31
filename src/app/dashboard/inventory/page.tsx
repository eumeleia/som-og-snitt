'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type Kategori   = 'Stoff' | 'Tilbehør' | 'Utstyr'
type StoffType  = 'Hovedstoff' | 'Fôr' | 'Mellomlegg' | 'Annet'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SortOrder  = 'newest' | 'oldest' | 'name'

interface InventoryItemData {
  kategori:      Kategori
  navn:          string
  bilde:         string
  notater:       string
  tenktTil:      string
  plassering:    string
  kjopsdato:     string
  kilde:         string
  // Stoff
  materiale?:    string
  bredde?:       string
  vekt?:         string
  vask?:         string
  type?:         StoffType
  mengde?:       string
  // Tilbehør
  underkategori?: string
  antall?:        string
  farge?:         string
  // Utstyr
  utstyrstype?:  string
  detaljer?:     string
}

interface InventoryItem {
  id: string
  created_at: string
  data: InventoryItemData
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KATEGORIER: Kategori[]  = ['Stoff', 'Tilbehør', 'Utstyr']
const STOFF_TYPES: StoffType[] = ['Hovedstoff', 'Fôr', 'Mellomlegg', 'Annet']
const TILBEHOR_CHIPS = ['Sytråd', 'Glidelås', 'Vliselin', 'Knapper', 'Elastikk']
const UTSTYR_CHIPS   = ['Nål', 'Symaskinfot', 'Saks', 'Måleband', 'Annet']

function emptyData(kategori: Kategori): InventoryItemData {
  return { kategori, navn: '', bilde: '', notater: '', tenktTil: '', plassering: '', kjopsdato: '', kilde: '' }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiImportFabric(url: string) {
  const r = await fetch('/api/import-fabric', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const j = await r.json()
  if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j.fabric as {
    navn: string; materiale: string; bredde: string
    vekt: string; vask: string; bilde: string
  }
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition'
const labelCls = 'block text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5'

function chipCls(active: boolean) {
  return `px-2.5 py-1 rounded-full text-xs border transition-colors ${
    active
      ? 'bg-stone-800 text-white border-stone-800'
      : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
  }`
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

// ── InventoryCard ─────────────────────────────────────────────────────────────

function InventoryCard({ item, onEdit, onDelete }: {
  item: InventoryItem; onEdit: () => void; onDelete: () => void
}) {
  const d = item.data
  const subtitle = d.kategori === 'Stoff' ? d.materiale
    : d.kategori === 'Tilbehør' ? d.underkategori
    : d.utstyrstype
  const badge = d.kategori === 'Stoff' ? d.mengde
    : d.kategori === 'Tilbehør' ? d.antall
    : null

  return (
    <article
      onClick={onEdit}
      className="group bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col"
    >
      <div className="h-44 bg-stone-50 overflow-hidden flex-shrink-0">
        {d.bilde ? (
          <img src={d.bilde} alt={d.navn}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-serif text-xl font-semibold text-stone-800 mb-0.5 truncate leading-tight">
          {d.navn || <span className="text-stone-300 italic font-light">Uten navn</span>}
        </h3>
        {subtitle && <p className="text-xs text-stone-400 mb-2 truncate">{subtitle}</p>}

        <div className="flex items-center justify-between mt-auto pt-3 border-t border-stone-100">
          <div>
            {badge && (
              <span className="inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium bg-amber-50 text-amber-700 border-amber-200">
                {badge}
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

// ── NewInventoryModal ─────────────────────────────────────────────────────────

function NewInventoryModal({ onCreate, onClose }: {
  onCreate: (data: InventoryItemData) => Promise<void>
  onClose: () => void
}) {
  const [kategori, setKategori]       = useState<Kategori>('Stoff')
  const [mode, setMode]               = useState<'choose' | 'url-import' | 'form'>('choose')
  const [importing, setImporting]     = useState(false)
  const [importUrl, setImportUrl]     = useState('')
  const [navn, setNavn]               = useState('')
  const [underkategori, setUnderkategori] = useState('')
  const [utstyrstype, setUtstyrstype] = useState('')
  const [creating, setCreating]       = useState(false)
  const [error, setError]             = useState('')

  function selectKategori(k: Kategori) {
    setKategori(k); setMode('choose'); setError('')
  }

  async function handleImport() {
    if (!importUrl.trim()) return
    setImporting(true)
    setError('')
    try {
      const fabric = await apiImportFabric(importUrl.trim())
      const data: InventoryItemData = {
        ...emptyData('Stoff'),
        navn:      fabric.navn      || 'Nytt stoff',
        materiale: fabric.materiale || '',
        bredde:    fabric.bredde    || '',
        vekt:      fabric.vekt      || '',
        vask:      fabric.vask      || '',
        bilde:     fabric.bilde     || '',
        kilde:     importUrl.trim(),
      }
      await onCreate(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
      setImporting(false)
    }
  }

  async function handleCreate() {
    if (!navn.trim()) return
    setCreating(true)
    setError('')
    try {
      const data: InventoryItemData = {
        ...emptyData(kategori),
        navn: navn.trim(),
        ...(kategori === 'Tilbehør' && { underkategori: underkategori.trim() }),
        ...(kategori === 'Utstyr'   && { utstyrstype:   utstyrstype.trim() }),
      }
      await onCreate(data)
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
      setCreating(false)
    }
  }

  const showForm = kategori !== 'Stoff' || mode === 'form'
  const busy     = importing || creating

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={!busy ? onClose : undefined} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {importing ? (
          <div className="px-6 py-14 text-center">
            <div className="w-10 h-10 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin mx-auto mb-5" />
            <p className="font-serif text-lg text-stone-700">Importerer stoff…</p>
          </div>
        ) : (
          <>
            <div className="px-6 pt-6 pb-0">
              <h3 className="font-serif text-2xl text-stone-800 mb-4">Legg til i lager</h3>
              <div className="flex gap-1 p-1 bg-stone-100 rounded-xl mb-5">
                {KATEGORIER.map(k => (
                  <button key={k} onClick={() => selectKategori(k)}
                    className={`flex-1 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                      kategori === k ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
                    }`}>
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-6 pb-6 space-y-3">

              {/* Stoff – velg metode */}
              {kategori === 'Stoff' && mode === 'choose' && (
                <>
                  <button
                    onClick={() => setMode('url-import')}
                    className="w-full border-2 border-dashed border-stone-200 rounded-2xl p-6 text-center hover:border-[#C9A57A] hover:bg-amber-50/30 transition-colors cursor-pointer group">
                    <svg className="w-8 h-8 text-stone-300 group-hover:text-[#C9A57A] mx-auto mb-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <p className="font-medium text-stone-700 mb-0.5">Importer fra URL</p>
                    <p className="text-xs text-stone-400">Selfmade, Stoff &amp; Stil o.l. — Claude henter detaljer automatisk</p>
                  </button>
                  <button onClick={() => setMode('form')}
                    className="w-full py-2.5 text-sm text-stone-500 hover:text-stone-700 transition-colors">
                    Last opp manuelt
                  </button>
                </>
              )}

              {/* Stoff – URL import */}
              {kategori === 'Stoff' && mode === 'url-import' && (
                <>
                  <div>
                    <label className={labelCls}>URL</label>
                    <input className={inputCls} value={importUrl} autoFocus
                      onChange={e => setImportUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleImport()}
                      placeholder="https://selfmade.no/…" />
                  </div>
                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button onClick={handleImport} disabled={!importUrl.trim()}
                    className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    Importer
                  </button>
                  <button onClick={() => { setMode('choose'); setError('') }}
                    className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                    Tilbake
                  </button>
                </>
              )}

              {/* Felles skjema (manuelt stoff / tilbehør / utstyr) */}
              {showForm && (
                <>
                  <div>
                    <label className={labelCls}>Navn *</label>
                    <input className={inputCls} value={navn} autoFocus
                      onChange={e => setNavn(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreate()}
                      placeholder={
                        kategori === 'Stoff'    ? 'F.eks. Linjersey i marineblå'
                        : kategori === 'Tilbehør' ? 'F.eks. Hvit sytråd'
                        : 'F.eks. Universalnål str. 80'
                      } />
                  </div>

                  {kategori === 'Tilbehør' && (
                    <div>
                      <label className={labelCls}>Underkategori</label>
                      <input className={inputCls} value={underkategori}
                        onChange={e => setUnderkategori(e.target.value)}
                        placeholder="F.eks. Sytråd" />
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {TILBEHOR_CHIPS.map(c => (
                          <button key={c} onClick={() => setUnderkategori(c)} className={chipCls(underkategori === c)}>
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {kategori === 'Utstyr' && (
                    <div>
                      <label className={labelCls}>Utstyrstype</label>
                      <input className={inputCls} value={utstyrstype}
                        onChange={e => setUtstyrstype(e.target.value)}
                        placeholder="F.eks. Symaskinfot" />
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {UTSTYR_CHIPS.map(c => (
                          <button key={c} onClick={() => setUtstyrstype(c)} className={chipCls(utstyrstype === c)}>
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {error && <p className="text-xs text-red-500">{error}</p>}
                  <button onClick={handleCreate} disabled={!navn.trim() || creating}
                    className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {creating && <Spinner />}
                    {creating ? 'Oppretter…' : 'Legg til'}
                  </button>
                  {kategori === 'Stoff' && (
                    <button onClick={() => { setMode('choose'); setError('') }}
                      className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                      Tilbake
                    </button>
                  )}
                </>
              )}

              {mode !== 'url-import' && (
                <button onClick={onClose}
                  className="w-full py-1.5 text-sm text-stone-300 hover:text-stone-500 transition-colors">
                  Avbryt
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── ImageUploadModal ──────────────────────────────────────────────────────────

function ImageUploadModal({ onAdd, onClose }: {
  onAdd: (url: string) => void; onClose: () => void
}) {
  const [tab, setTab]           = useState<'file' | 'url'>('file')
  const [url, setUrl]           = useState('')
  const [file, setFile]         = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError]       = useState('')
  const fileInputRef            = useRef<HTMLInputElement>(null)

  async function handleUpload() {
    if (!file) return
    setUploading(true); setError('')
    try {
      const ext      = file.name.split('.').pop() ?? 'jpg'
      const filename = `inventory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('project-images').upload(filename, file, { contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('project-images').getPublicUrl(filename)
      onAdd(data.publicUrl); onClose()
    } catch {
      setError('Opplasting feilet. Prøv igjen.')
    } finally {
      setUploading(false)
    }
  }

  function handleUrl() {
    if (!url.trim()) return
    onAdd(url.trim()); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="flex border-b border-stone-100">
          {(['file', 'url'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-3.5 text-sm font-medium transition-colors border-b-2 ${
                tab === t ? 'text-stone-800 border-stone-800' : 'text-stone-400 border-transparent hover:text-stone-600'
              }`}>
              {t === 'file' ? 'Last opp fil' : 'Lim inn URL'}
            </button>
          ))}
        </div>
        <div className="p-5 space-y-4">
          {tab === 'file' ? (
            <>
              <div onClick={() => fileInputRef.current?.click()}
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
                className="hidden" onChange={e => { setFile(e.target.files?.[0] ?? null); setError('') }} />
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

// ── DeleteDialog ──────────────────────────────────────────────────────────────

function DeleteDialog({ label, onConfirm, onCancel }: {
  label: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl p-7 max-w-sm w-full shadow-2xl">
        <h3 className="font-serif text-2xl font-light text-stone-800 mb-2">Slett {label}?</h3>
        <p className="text-sm text-stone-500 mb-6">Dette slettes permanent og kan ikke gjenopprettes.</p>
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

// ── InventoryDetail ───────────────────────────────────────────────────────────

function InventoryDetail({ item, onBack, onSaved, onDelete }: {
  item: InventoryItem
  onBack: () => void
  onSaved: () => void
  onDelete?: () => void
}) {
  const [form, setForm]             = useState<InventoryItemData>(() => structuredClone(item.data))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [showImgModal, setShowImgModal] = useState(false)
  const [toast, setToast]           = useState('')

  const itemIdRef    = useRef<string>(item.id)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef   = useRef<InventoryItemData>(form)
  const isMounted    = useRef(false)

  function upd(patch: Partial<InventoryItemData>) {
    setForm(f => {
      const next = { ...f, ...patch }
      pendingRef.current = next
      return next
    })
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  async function doSave(data: InventoryItemData) {
    setSaveStatus('saving')
    try {
      const { error } = await supabase.from('inventory').update({ data }).eq('id', itemIdRef.current)
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
    saveTimerRef.current = setTimeout(() => doSave(pendingRef.current), 600)
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

  const d         = form
  const isStoff    = d.kategori === 'Stoff'
  const isTilbehor = d.kategori === 'Tilbehør'
  const isUtstyr   = d.kategori === 'Utstyr'

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
            {d.navn || <span className="text-stone-300 font-light italic">Uten navn</span>}
          </h1>
          <div className="flex items-center gap-3 flex-shrink-0 text-xs">
            {saveStatus === 'saving' && <span className="text-stone-400 flex items-center gap-1.5"><Spinner /> Lagrer…</span>}
            {saveStatus === 'saved'  && <span className="text-emerald-500 font-medium">Lagret ✓</span>}
            {saveStatus === 'error'  && <span className="text-red-400">Feil ved lagring</span>}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 pb-24">

        {/* 1. Bilde */}
        <SectionHeading first>Bilde</SectionHeading>
        {d.bilde ? (
          <div className="relative group rounded-2xl overflow-hidden bg-stone-100" style={{ height: '300px' }}>
            <img src={d.bilde} alt="" className="w-full h-full object-cover" />
            <button onClick={() => upd({ bilde: '' })}
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

        {/* 2. Grunninfo */}
        <SectionHeading>Grunninfo</SectionHeading>
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Navn</label>
            <input className={inputCls} value={d.navn}
              onChange={e => upd({ navn: e.target.value })}
              placeholder="Gi det et navn…" />
          </div>

          {isStoff && (
            <>
              <div>
                <label className={labelCls}>Materiale</label>
                <input className={inputCls} value={d.materiale ?? ''}
                  onChange={e => upd({ materiale: e.target.value })}
                  placeholder="F.eks. 100% lin" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Bredde</label>
                  <input className={inputCls} value={d.bredde ?? ''}
                    onChange={e => upd({ bredde: e.target.value })}
                    placeholder="F.eks. 140 cm" />
                </div>
                <div>
                  <label className={labelCls}>Vekt</label>
                  <input className={inputCls} value={d.vekt ?? ''}
                    onChange={e => upd({ vekt: e.target.value })}
                    placeholder="F.eks. 160 g/m²" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <div className="flex gap-2 flex-wrap">
                  {STOFF_TYPES.map(t => (
                    <button key={t} onClick={() => upd({ type: t })}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        d.type === t
                          ? 'bg-stone-800 text-white border-stone-800'
                          : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {isTilbehor && (
            <>
              <div>
                <label className={labelCls}>Underkategori</label>
                <input className={inputCls} value={d.underkategori ?? ''}
                  onChange={e => upd({ underkategori: e.target.value })}
                  placeholder="F.eks. Sytråd" />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {TILBEHOR_CHIPS.map(c => (
                    <button key={c} onClick={() => upd({ underkategori: c })} className={chipCls(d.underkategori === c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Farge</label>
                <input className={inputCls} value={d.farge ?? ''}
                  onChange={e => upd({ farge: e.target.value })}
                  placeholder="F.eks. Hvit" />
              </div>
            </>
          )}

          {isUtstyr && (
            <>
              <div>
                <label className={labelCls}>Utstyrstype</label>
                <input className={inputCls} value={d.utstyrstype ?? ''}
                  onChange={e => upd({ utstyrstype: e.target.value })}
                  placeholder="F.eks. Symaskinfot" />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {UTSTYR_CHIPS.map(c => (
                    <button key={c} onClick={() => upd({ utstyrstype: c })} className={chipCls(d.utstyrstype === c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelCls}>Detaljer</label>
                <input className={inputCls} value={d.detaljer ?? ''}
                  onChange={e => upd({ detaljer: e.target.value })}
                  placeholder="F.eks. Universalnål str. 80" />
              </div>
            </>
          )}
        </div>

        {/* 3. Mengde / antall (ikke Utstyr) */}
        {!isUtstyr && (
          <>
            <SectionHeading>{isStoff ? 'Mengde' : 'Antall'}</SectionHeading>
            <input className={inputCls}
              value={isStoff ? (d.mengde ?? '') : (d.antall ?? '')}
              onChange={e => upd(isStoff ? { mengde: e.target.value } : { antall: e.target.value })}
              placeholder={isStoff ? 'F.eks. 2,5 m' : 'F.eks. 3 stk eller 5 m'} />
          </>
        )}

        {/* 4. Plassering */}
        <SectionHeading>Plassering</SectionHeading>
        <input className={inputCls} value={d.plassering}
          onChange={e => upd({ plassering: e.target.value })}
          placeholder="F.eks. Blå kasse, hylle 2" />

        {/* 5. Kjøpsdato */}
        <SectionHeading>Kjøpsdato</SectionHeading>
        <div className="flex gap-2">
          <input type="date" className={`${inputCls} flex-1`} value={d.kjopsdato}
            onChange={e => upd({ kjopsdato: e.target.value })} />
          <button
            onClick={() => upd({ kjopsdato: new Date().toISOString().split('T')[0] })}
            className="px-4 py-2 text-sm text-stone-600 border border-stone-200 bg-white rounded-lg hover:bg-stone-50 transition-colors whitespace-nowrap">
            I dag
          </button>
        </div>

        {/* 6. Kilde */}
        <SectionHeading>Kilde</SectionHeading>
        <input className={inputCls} value={d.kilde}
          onChange={e => upd({ kilde: e.target.value })}
          placeholder="F.eks. selfmade.no eller butikknavn" />

        {/* 7. Tenkt til */}
        <SectionHeading>Tenkt til</SectionHeading>
        <textarea className={`${inputCls} resize-y`} style={{ minHeight: 80 }}
          value={d.tenktTil}
          onChange={e => upd({ tenktTil: e.target.value })}
          placeholder="F.eks. Sommerkjole til Oda, eller oppskrift #47…" />

        {/* 8. Vaskeinstruksjoner (kun Stoff) */}
        {isStoff && (
          <>
            <SectionHeading>Vaskeinstruksjoner</SectionHeading>
            <textarea className={`${inputCls} resize-y`} style={{ minHeight: 80 }}
              value={d.vask ?? ''}
              onChange={e => upd({ vask: e.target.value })}
              placeholder="F.eks. 40°C skånsom, ikke tørketrommel…" />
          </>
        )}

        {/* 9. Notater */}
        <SectionHeading>Notater</SectionHeading>
        <textarea className={`${inputCls} resize-y`} style={{ minHeight: 140 }}
          value={d.notater}
          onChange={e => upd({ notater: e.target.value })}
          placeholder="Notater, tips, erfaringer…" />

        {/* 10. Slett */}
        {onDelete && (
          <div className="mt-16 pt-8 border-t border-stone-200">
            <button onClick={onDelete}
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors border border-red-200 hover:border-red-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Slett {isStoff ? 'stoff' : isTilbehor ? 'tilbehør' : 'utstyr'}
            </button>
          </div>
        )}
      </div>

      {showImgModal && (
        <ImageUploadModal onAdd={url => upd({ bilde: url })} onClose={() => setShowImgModal(false)} />
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

export default function InventoryPage() {
  const [items, setItems]           = useState<InventoryItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTab]               = useState<Kategori>('Stoff')
  const [search, setSearch]         = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('Alle')
  const [sort, setSort]             = useState<SortOrder>('newest')
  const [showDetail, setShowDetail] = useState(false)
  const [currentItem, setCurrentItem] = useState<InventoryItem | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [deleteId, setDeleteId]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('inventory').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setItems((data as InventoryItem[]) || [])
    } catch (err) {
      console.error('inventory load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setTypeFilter('Alle') }, [tab])

  async function createItem(data: InventoryItemData) {
    const { data: rows, error } = await supabase.from('inventory').insert({ data }).select()
    if (error) throw error
    const item = (rows as InventoryItem[])?.[0]
    if (item) {
      setItems(prev => [item, ...prev])
      setCurrentItem(item)
      setShowNewModal(false)
      setShowDetail(true)
    }
  }

  async function deleteItem(id: string) {
    await supabase.from('inventory').delete().eq('id', id)
    await load()
    setDeleteId(null)
    setShowDetail(false)
    setCurrentItem(null)
  }

  function openEdit(item: InventoryItem) { setCurrentItem(item); setShowDetail(true) }
  function handleBack()                  { setShowDetail(false); setCurrentItem(null); load() }

  const tabItems = items.filter(i => i.data.kategori === tab)

  const filterValues = Array.from(new Set(
    tabItems.map(i =>
      tab === 'Stoff'    ? i.data.type
      : tab === 'Tilbehør' ? i.data.underkategori
      : i.data.utstyrstype
    ).filter((v): v is string => Boolean(v))
  )).sort()

  const filtered = tabItems
    .filter(i => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      const d = i.data
      return (
        d.navn.toLowerCase().includes(q) ||
        (d.materiale     ?? '').toLowerCase().includes(q) ||
        (d.underkategori ?? '').toLowerCase().includes(q) ||
        (d.utstyrstype   ?? '').toLowerCase().includes(q) ||
        (d.tenktTil      ?? '').toLowerCase().includes(q)
      )
    })
    .filter(i => {
      if (typeFilter === 'Alle') return true
      const d = i.data
      const v = tab === 'Stoff'    ? d.type
              : tab === 'Tilbehør' ? d.underkategori
              : d.utstyrstype
      return v === typeFilter
    })
    .sort((a, b) => {
      if (sort === 'name')   return a.data.navn.localeCompare(b.data.navn, 'nb')
      if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  const emptyLabel = tab === 'Stoff' ? 'stoff' : tab === 'Tilbehør' ? 'tilbehør' : 'utstyr'

  const deleteItem_ = items.find(i => i.id === deleteId)
  const deleteLabel = deleteItem_?.data.kategori === 'Stoff' ? 'stoff'
    : deleteItem_?.data.kategori === 'Tilbehør' ? 'tilbehør'
    : 'utstyr'

  if (showDetail && currentItem) {
    return (
      <>
        <InventoryDetail
          item={currentItem}
          onBack={handleBack}
          onSaved={load}
          onDelete={() => setDeleteId(currentItem.id)}
        />
        {deleteId && (
          <DeleteDialog
            label={currentItem.data.kategori === 'Stoff' ? 'stoff' : currentItem.data.kategori === 'Tilbehør' ? 'tilbehør' : 'utstyr'}
            onConfirm={() => deleteItem(deleteId)}
            onCancel={() => setDeleteId(null)}
          />
        )}
      </>
    )
  }

  return (
    <>
      {/* Header */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
        <h1 className="font-serif text-3xl text-stone-700 flex-1">Lager</h1>
        <button
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] bg-[#C9A57A] text-white text-sm rounded-xl hover:bg-[#b8925f] transition-colors font-medium whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Legg til
        </button>
      </div>

      {/* Tabs */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-3">
        <div className="flex gap-1 p-1 bg-stone-100 rounded-xl w-full sm:w-auto sm:inline-flex">
          {KATEGORIER.map(k => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 sm:flex-none sm:px-6 py-2 text-sm rounded-lg font-medium transition-colors ${
                tab === k ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
              }`}>
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Search + filters */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-4 space-y-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Søk i ${emptyLabel}…`}
            className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 shadow-sm"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
          <div className="flex gap-1.5 flex-shrink-0">
            {['Alle', ...filterValues].map(v => (
              <button key={v} onClick={() => setTypeFilter(v)}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border transition-colors ${
                  typeFilter === v
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                }`}>
                {v}
              </button>
            ))}
          </div>
          <div className="w-px bg-stone-200 flex-shrink-0 mx-0.5 self-stretch" />
          <div className="flex gap-1.5 flex-shrink-0">
            {([['newest', 'Nyeste'], ['oldest', 'Eldste'], ['name', 'Navn A-Å']] as [SortOrder, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setSort(v)}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap border transition-colors ${
                  sort === v
                    ? 'bg-stone-600 text-white border-stone-600'
                    : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        {loading ? (
          <div className="flex justify-center py-32">
            <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-28">
            <svg className="w-14 h-14 text-stone-200 mx-auto mb-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            <p className="font-serif text-2xl text-stone-400 font-light">
              {tabItems.length === 0 ? `Ingen ${emptyLabel} i lageret ennå.` : 'Ingen treff'}
            </p>
            {tabItems.length === 0 && (
              <button onClick={() => setShowNewModal(true)}
                className="mt-5 px-6 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium">
                Legg til {emptyLabel}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(item => (
              <InventoryCard key={item.id} item={item}
                onEdit={() => openEdit(item)}
                onDelete={() => setDeleteId(item.id)} />
            ))}
          </div>
        )}
      </main>

      {showNewModal && (
        <NewInventoryModal onCreate={createItem} onClose={() => setShowNewModal(false)} />
      )}

      {deleteId && !showDetail && (
        <DeleteDialog
          label={deleteLabel}
          onConfirm={() => deleteItem(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </>
  )
}
