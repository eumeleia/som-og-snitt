'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

interface TechniqueData {
  navn:            string
  kategori?:       string
  stingtype?:      string
  stinglengde?:    string
  stingbredde?:    string
  naal?:           string
  traad?:          string
  trykkfot?:       string
  hastighet?:      string
  fremgangsmaat?:  string
  videoUrl?:       string
  notater?:        string
}

interface Technique {
  id:         string
  created_at: string
  data:       TechniqueData
}

type SortOrder = 'newest' | 'oldest' | 'name'

const KATEGORIER = ['Søm', 'Finishing', 'Konstruksjon', 'Trykk & Dekor', 'Annet']

// ── Helpers ──────────────────────────────────────────────────────────────────

function SaveIndicator({ status }: { status: 'saved' | 'saving' | 'idle' }) {
  if (status === 'idle') return null
  return (
    <span className={`text-xs transition-opacity ${status === 'saving' ? 'text-stone-400' : 'text-green-600'}`}>
      {status === 'saving' ? 'Lagrer…' : 'Lagret'}
    </span>
  )
}

// ── New Technique Modal ───────────────────────────────────────────────────────

function NewTechniqueModal({ onCreate, onClose }: {
  onCreate: (data: TechniqueData) => Promise<void>
  onClose:  () => void
}) {
  const [navn,     setNavn]     = useState('')
  const [kategori, setKategori] = useState(KATEGORIER[0])
  const [saving,   setSaving]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!navn.trim()) return
    setSaving(true)
    try {
      await onCreate({ navn: navn.trim(), kategori })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="font-serif text-2xl text-stone-700 mb-5">Ny teknikk</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-stone-500 mb-1">Navn *</label>
            <input
              autoFocus
              value={navn}
              onChange={e => setNavn(e.target.value)}
              placeholder="f.eks. «Franskt innlegg», «Blind-søm»"
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-300"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Kategori</label>
            <div className="flex flex-wrap gap-2">
              {KATEGORIER.map(k => (
                <button type="button" key={k}
                  onClick={() => setKategori(k)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    kategori === k
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                  }`}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors">
              Avbryt
            </button>
            <button type="submit" disabled={!navn.trim() || saving}
              className="flex-1 py-2.5 bg-stone-800 text-white rounded-xl text-sm font-medium hover:bg-stone-700 transition-colors disabled:opacity-50">
              {saving ? 'Oppretter…' : 'Opprett'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Delete Dialog ─────────────────────────────────────────────────────────────

function DeleteDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <p className="text-stone-700 font-medium mb-1">Slett teknikk?</p>
        <p className="text-stone-400 text-sm mb-6">Dette kan ikke angres.</p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors">
            Avbryt
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors">
            Slett
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Technique Card ────────────────────────────────────────────────────────────

function TechniqueCard({ technique, onEdit, onDelete }: {
  technique: Technique
  onEdit:    () => void
  onDelete:  () => void
}) {
  const d = technique.data
  return (
    <article
      onClick={onEdit}
      className="group bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col h-full relative min-w-0"
    >
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-serif text-base font-semibold text-stone-800 truncate">
          {d.navn || <span className="text-stone-300 italic font-light">Uten navn</span>}
        </h3>
        <p className="text-xs text-stone-500 truncate mt-0">{d.kategori || ' '}</p>
        {(d.stingtype || d.trykkfot || d.naal) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {d.stingtype && (
              <span className="px-2 py-0.5 bg-[#F5EFE6] text-[#8B6340] text-xs rounded-lg border border-[#D4A574]">{d.stingtype}</span>
            )}
            {d.trykkfot && (
              <span className="px-2 py-0.5 bg-stone-50 text-stone-500 text-xs rounded-lg border border-stone-100">{d.trykkfot}</span>
            )}
            {d.naal && (
              <span className="px-2 py-0.5 bg-stone-50 text-stone-500 text-xs rounded-lg border border-stone-100">Nål: {d.naal}</span>
            )}
          </div>
        )}
        {d.fremgangsmaat && (
          <p className="mt-2 text-xs text-stone-400 line-clamp-2 leading-relaxed flex-1">{d.fremgangsmaat}</p>
        )}
        {d.videoUrl && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-[#C9A57A]">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Video
          </div>
        )}
      </div>

      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute bottom-1 right-1.5 z-10 p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </article>
  )
}

// ── Field Input ───────────────────────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, hint }: {
  label:       string
  value:       string
  onChange:    (v: string) => void
  placeholder?: string
  hint?:        string
}) {
  return (
    <div>
      <label className="block text-xs text-stone-500 mb-1">
        {label}
        {hint && <span className="ml-1 text-stone-300">({hint})</span>}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200"
      />
    </div>
  )
}

// ── Technique Detail ──────────────────────────────────────────────────────────

function TechniqueDetail({ technique, onBack, onSaved, onDelete }: {
  technique: Technique
  onBack:    () => void
  onSaved:   () => void
  onDelete:  () => void
}) {
  const [form, setForm]         = useState<TechniqueData>(technique.data)
  const [saveStatus, setSave]   = useState<'saved' | 'saving' | 'idle'>('idle')
  const pendingRef              = useRef<TechniqueData>(technique.data)
  const timerRef                = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef                   = useRef(technique.id)

  function update(patch: Partial<TechniqueData>) {
    setForm(f => {
      const next = { ...f, ...patch }
      pendingRef.current = next
      return next
    })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 1500)
  }

  async function flush() {
    setSave('saving')
    await supabase.from('techniques').update({ data: pendingRef.current }).eq('id', idRef.current)
    setSave('saved')
    onSaved()
    setTimeout(() => setSave('idle'), 2000)
  }

  useEffect(() => () => { if (timerRef.current) { clearTimeout(timerRef.current); flush() } }, [])

  const d = form

  return (
    <>
      {/* Sub-header */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => { if (timerRef.current) { clearTimeout(timerRef.current); flush() } onBack() }}
          className="p-2 rounded-xl hover:bg-stone-100 text-stone-500 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-xl text-stone-700 truncate">{d.navn || 'Uten navn'}</h2>
        </div>
        <SaveIndicator status={saveStatus} />
        <button onClick={onDelete}
          className="p-2 rounded-xl text-stone-300 hover:text-red-400 hover:bg-red-50 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-20 space-y-8">

        {/* Grunninfo */}
        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-4">
          <h3 className="font-serif text-lg text-stone-700">Grunninfo</h3>
          <Field label="Navn" value={d.navn ?? ''} onChange={v => update({ navn: v })} placeholder="Navn på teknikken" />
          <div>
            <label className="block text-xs text-stone-500 mb-2">Kategori</label>
            <div className="flex flex-wrap gap-2">
              {KATEGORIER.map(k => (
                <button type="button" key={k}
                  onClick={() => update({ kategori: k })}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    d.kategori === k
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                  }`}>
                  {k}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Symaskin-innstillinger */}
        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-4">
          <h3 className="font-serif text-lg text-stone-700">Symaskin-innstillinger</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Stingtype" value={d.stingtype ?? ''} onChange={v => update({ stingtype: v })}
              placeholder="f.eks. Rett stingtype, Sikksakk" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stinglengde" value={d.stinglengde ?? ''} onChange={v => update({ stinglengde: v })}
                placeholder="2,5 mm" />
              <Field label="Stingbredde" value={d.stingbredde ?? ''} onChange={v => update({ stingbredde: v })}
                placeholder="3 mm" />
            </div>
            <Field label="Nål" value={d.naal ?? ''} onChange={v => update({ naal: v })}
              placeholder="f.eks. Universal 80/12, Stretch 75" />
            <Field label="Tråd" value={d.traad ?? ''} onChange={v => update({ traad: v })}
              placeholder="f.eks. Gutermann polyester 100m" />
            <Field label="Trykk­fot" value={d.trykkfot ?? ''} onChange={v => update({ trykkfot: v })}
              placeholder="f.eks. Standard, Sipper­fot, Blindsøm" />
            <Field label="Hastighet / andre innstillinger" value={d.hastighet ?? ''} onChange={v => update({ hastighet: v })}
              placeholder="f.eks. Lav hastighet, speil" />
          </div>
        </section>

        {/* Fremgangsmåte */}
        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-3">
          <h3 className="font-serif text-lg text-stone-700">Fremgangsmåte</h3>
          <p className="text-xs text-stone-400">Skriv steg for steg. Du kan bruke linjeskift mellom steg.</p>
          <textarea
            value={d.fremgangsmaat ?? ''}
            onChange={e => update({ fremgangsmaat: e.target.value })}
            placeholder="1. Fest med tøyesterft…&#10;2. Sy med 1 cm søm­tillæg…"
            rows={8}
            className="w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200 resize-y leading-relaxed"
          />
        </section>

        {/* Video & notater */}
        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-4">
          <h3 className="font-serif text-lg text-stone-700">Video & notater</h3>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Video-URL</label>
            <div className="flex gap-2 items-center">
              <input
                value={d.videoUrl ?? ''}
                onChange={e => update({ videoUrl: e.target.value })}
                placeholder="https://youtube.com/…"
                className="flex-1 px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200"
              />
              {d.videoUrl && (
                <a href={d.videoUrl} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-2 bg-[#C9A57A] text-white text-xs rounded-xl hover:bg-[#b8925f] transition-colors whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Åpne
                </a>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Notater</label>
            <textarea
              value={d.notater ?? ''}
              onChange={e => update({ notater: e.target.value })}
              placeholder="Egne observasjoner, tips, fallgruver…"
              rows={4}
              className="w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200 resize-y"
            />
          </div>
        </section>

      </div>
    </>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TechniquesPage() {
  const [items,        setItems]        = useState<Technique[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [katFilter,    setKatFilter]    = useState('Alle')
  const [sort,         setSort]         = useState<SortOrder>('newest')
  const [showNew,      setShowNew]      = useState(false)
  const [currentItem,  setCurrentItem]  = useState<Technique | null>(null)
  const [showDetail,   setShowDetail]   = useState(false)
  const [deleteId,     setDeleteId]     = useState<string | null>(null)
  const [katDropdownOpen,  setKatDropdownOpen]  = useState(false)
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const katDropdownRef  = useRef<HTMLDivElement>(null)
  const sortDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!katDropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (katDropdownRef.current && !katDropdownRef.current.contains(e.target as Node)) {
        setKatDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [katDropdownOpen])

  useEffect(() => {
    if (!sortDropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [sortDropdownOpen])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('techniques').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setItems((data as Technique[]) || [])
    } catch (err) {
      console.error('techniques load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function createItem(data: TechniqueData) {
    const { data: rows, error } = await supabase.from('techniques').insert({ data }).select()
    if (error) throw error
    const item = (rows as Technique[])?.[0]
    if (item) {
      setItems(prev => [item, ...prev])
      setCurrentItem(item)
      setShowNew(false)
      setShowDetail(true)
    }
  }

  async function deleteItem(id: string) {
    await supabase.from('techniques').delete().eq('id', id)
    await load()
    setDeleteId(null)
    setShowDetail(false)
    setCurrentItem(null)
  }

  const filtered = items
    .filter(i => {
      if (katFilter !== 'Alle' && i.data.kategori !== katFilter) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      const d = i.data
      return (
        d.navn.toLowerCase().includes(q) ||
        (d.kategori     ?? '').toLowerCase().includes(q) ||
        (d.stingtype    ?? '').toLowerCase().includes(q) ||
        (d.trykkfot     ?? '').toLowerCase().includes(q) ||
        (d.fremgangsmaat ?? '').toLowerCase().includes(q) ||
        (d.notater      ?? '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      if (sort === 'name')   return a.data.navn.localeCompare(b.data.navn, 'nb')
      if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  if (showDetail && currentItem) {
    return (
      <>
        <TechniqueDetail
          technique={currentItem}
          onBack={() => { setShowDetail(false); setCurrentItem(null); load() }}
          onSaved={load}
          onDelete={() => setDeleteId(currentItem.id)}
        />
        {deleteId && (
          <DeleteDialog
            onConfirm={() => deleteItem(deleteId)}
            onCancel={() => setDeleteId(null)}
          />
        )}
      </>
    )
  }

  return (
    <>
      {/* Search + filters */}
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 mb-0 space-y-3 overflow-hidden">
        <div className="relative w-full min-w-0">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Søk i teknikker…"
            className="w-full min-w-0 pl-9 pr-4 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Category filter icon */}
          <div className="relative" ref={katDropdownRef}>
            <button
              onClick={() => setKatDropdownOpen(o => !o)}
              className={`relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors ${
                katFilter !== 'Alle'
                  ? 'bg-stone-100 text-stone-800 border-stone-300'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
              title="Filter"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {katFilter !== 'Alle' && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#C9A57A] rounded-full" />
              )}
            </button>
            {katDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-20 min-w-[160px] py-1">
                <button
                  onClick={() => { setKatFilter('Alle'); setKatDropdownOpen(false) }}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${katFilter === 'Alle' ? 'text-stone-800 font-medium' : 'text-stone-600'}`}
                >
                  Alle
                </button>
                {KATEGORIER.map(k => (
                  <button
                    key={k}
                    onClick={() => { setKatFilter(k); setKatDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${katFilter === k ? 'text-stone-800 font-medium bg-stone-50' : 'text-stone-600'}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort icon */}
          <div className="relative" ref={sortDropdownRef}>
            <button
              onClick={() => setSortDropdownOpen(o => !o)}
              className={`relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors ${
                sort !== 'newest'
                  ? 'bg-stone-100 text-stone-800 border-stone-300'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
              title="Sortering"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 7h18M6 12h12M9 17h6" />
              </svg>
              {sort !== 'newest' && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-stone-600 rounded-full" />
              )}
            </button>
            {sortDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-20 min-w-[160px] py-1">
                {([['newest', 'Nyeste'], ['oldest', 'Eldste'], ['name', 'Navn A-Å']] as [SortOrder, string][]).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => { setSort(v); setSortDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${sort === v ? 'text-stone-800 font-medium bg-stone-50' : 'text-stone-600'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 pb-24 overflow-x-hidden">
        {loading ? (
          <div className="flex justify-center py-32">
            <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-28">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-stone-100 mb-6">
              <svg className="w-7 h-7 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
            <p className="font-serif text-2xl text-stone-400 font-light">
              {items.length === 0 ? 'Ingen teknikker ennå.' : 'Ingen treff'}
            </p>
            {items.length === 0 && (
              <button onClick={() => setShowNew(true)}
                className="mt-5 px-6 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium">
                Legg til første teknikk
              </button>
            )}
          </div>
        ) : (
          <div className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-5 overflow-hidden">
            {filtered.map(item => (
              <TechniqueCard key={item.id} technique={item}
                onEdit={() => { setCurrentItem(item); setShowDetail(true) }}
                onDelete={() => setDeleteId(item.id)} />
            ))}
          </div>
        )}
      </main>

      {showNew && (
        <NewTechniqueModal onCreate={createItem} onClose={() => setShowNew(false)} />
      )}

      {deleteId && !showDetail && (
        <DeleteDialog
          onConfirm={() => deleteItem(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {/* FAB */}
      <button
        onClick={() => setShowNew(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-[#C9A57A] text-white rounded-full shadow-lg hover:bg-[#b8925f] transition-all flex items-center justify-center cursor-pointer z-30"
        aria-label="Ny teknikk"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </>
  )
}
