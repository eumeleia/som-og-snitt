'use client'

export const dynamic = 'force-dynamic'

import { Suspense, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useHistoryVisning } from '../_shared/useHistoryVisning'
import { RecipePicker, type PickerRecipe } from '../_shared/RecipePicker'
import { ProjectPicker, type PickerProject } from '../_shared/ProjectPicker'
import { supabase } from '@/lib/supabase'
import { deepClone } from '@/lib/deep-clone'

// ── Types ─────────────────────────────────────────────────────────────────────

type Kategori   = 'Stoff' | 'Tilbehør' | 'Utstyr'
type StoffType  = 'Hovedstoff' | 'Fôr' | 'Mellomlegg' | 'Annet'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SortOrder  = 'newest' | 'oldest' | 'name'

interface InventoryItemData {
  kategori:      Kategori
  navn:          string
  bilde:         string
  // Galleri — flere bilder ENN hovedbildet, samme mønster som ProjectData.images i
  // projects/page.tsx. Bevisst et EGET felt, ikke images[0]===hovedbilde slik prosjekter
  // gjør det: bilde er allerede en etablert streng brukt i hele appen (kortvisning,
  // søk osv.), og å bytte den ut med en avledet verdi ville krevd å migrere/lese
  // annerledes overalt. bilder er derfor rene TILLEGGSBILDER, uavhengig av hovedbildet.
  bilder?:       string[]
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
  forbrukStoff?: string
  // Fritekst — beholdt som fallback for rader lagret FØR koblingen under fantes, og for
  // et prosjekt/en oppskrift som ikke (ennå) finnes i biblioteket. Når en ekte kobling er
  // satt, vises DEN i UI-en; fritekstfeltet vises bare når ingen av id-feltene er satt.
  tiltenktProsjekt?: string
  tiltenktProsjektId?: string
  tiltenktProsjektNavn?: string
  tiltenktOppskriftId?: string
  tiltenktOppskriftNavn?: string
  // Tilbehør
  underkategori?: string
  antall?:        string
  farge?:         string
  lengde?:        string   // for Glidelås
  forbruksniva?:  'ubrukt' | 'lite-brukt' | 'mye-brukt' | 'oppbrukt'
  // Broderitråd/Broderigarn — trådpalett brukt av broderi-arrangøren (KomposisjonEditor)
  // for å vise EKTE trådfarge i stedet for Brothers generiske PEC-farge, se
  // arranger/minTraadpalett.ts. hex er brukerens egen, redigerbare visningsfarge — IKKE
  // hentet fra en fasit noe sted, siden ekte tråd varierer fra skjerm/lys uansett.
  hex?:           string
  merke?:         string
  tradkode?:      string
  iBroderipalett?: boolean
  // Utstyr
  utstyrstype?:  string
  detaljer?:     string
  brukesTil?:    string   // hva utstyret kan brukes til
  arkivert?:     boolean
}

interface InventoryItem {
  id: string
  created_at: string
  data: InventoryItemData
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KATEGORIER: Kategori[]  = ['Stoff', 'Tilbehør', 'Utstyr']
const STOFF_TYPES: StoffType[] = ['Hovedstoff', 'Fôr', 'Mellomlegg', 'Annet']
const TILBEHOR_CHIPS = ['Sytråd', 'Overlocktråd', 'Broderigarn', 'Broderitråd', 'Glidelås', 'Vliselin', 'Knapper', 'Elastikk', 'Skråbånd']
const UTSTYR_CHIPS   = ['Nål', 'Symaskinfot', 'Nålebord', 'Saks', 'Rull', 'Måleband', 'Annet']

const THREAD_UNDERKATEGORIER = new Set(['Sytråd', 'Overlocktråd', 'Broderigarn', 'Broderitråd'])

// Underkategoriene broderi-arrangørens trådpalett faktisk bruker — snevrere enn
// THREAD_UNDERKATEGORIER (som også dekker vanlig sy-/overlocktråd, uten mening for en
// broderimaskins fargevalg).
const BRODERITRAD_UNDERKATEGORIER = new Set(['Broderitråd', 'Broderigarn'])

const FORBRUKSNIVA_OPTIONS: { value: InventoryItemData['forbruksniva']; label: string; cls: string }[] = [
  { value: 'ubrukt',    label: 'Ubrukt',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'lite-brukt', label: 'Lite brukt', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'mye-brukt', label: 'Mye brukt', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  { value: 'oppbrukt',  label: 'Oppbrukt',  cls: 'bg-red-50 text-red-400 border-red-200' },
]

const KATEGORI_STYLE: Record<Kategori, string> = {
  Stoff:    'bg-[#F5EFE6] text-[#8B6340] border-[#D4A574]',
  Tilbehør: 'bg-teal-50 text-teal-700 border-teal-200',
  Utstyr:   'bg-sky-50 text-sky-700 border-sky-200',
}

function emptyData(kategori: Kategori): InventoryItemData {
  return {
    kategori, navn: '', bilde: '', notater: '', tenktTil: '', plassering: '', kjopsdato: '', kilde: '',
    ...(kategori === 'Stoff' ? { mengde: '1 m' } : {}),
  }
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

const inputCls = 'w-full px-3 py-2 border border-stone-200 rounded-lg text-base sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 transition'
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

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

// ── InventoryCard ─────────────────────────────────────────────────────────────

function InventoryCard({ item, onEdit, onDelete, onArchive, selectable, selected, onSelect }: {
  item: InventoryItem
  onEdit: () => void
  onDelete: () => void
  onArchive?: () => void
  selectable?: boolean
  selected?: boolean
  onSelect?: () => void
}) {
  const d = item.data
  const erArkivert = Boolean(d.arkivert)

  const subtitleBase = d.kategori === 'Stoff' ? (d.materiale ?? '')
    : d.kategori === 'Tilbehør' ? (d.underkategori ?? '')
    : (d.utstyrstype ?? '')

  const subtitle = d.kategori === 'Tilbehør' && d.farge && d.farge !== d.navn
    ? `${subtitleBase}${subtitleBase ? ' · ' : ''}${d.farge}`
    : subtitleBase

  const badge = d.kategori === 'Stoff' ? d.mengde
    : d.kategori === 'Tilbehør' ? d.antall
    : null

  const forbruksInfo = d.kategori === 'Tilbehør' && d.underkategori && THREAD_UNDERKATEGORIER.has(d.underkategori)
    ? FORBRUKSNIVA_OPTIONS.find(o => o.value === d.forbruksniva)
    : null

  function handleClick() {
    if (selectable && onSelect) { onSelect(); return }
    onEdit()
  }

  return (
    <article
      onClick={handleClick}
      className={`group bg-white rounded-xl border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col h-full relative min-w-0 ${
        selected ? 'border-stone-500 ring-2 ring-stone-400' : 'border-stone-200'
      } ${erArkivert ? 'opacity-60' : ''}`}
    >
      {selectable && (
        <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center ${
          selected ? 'bg-stone-800 border-stone-800' : 'bg-white/80 border-stone-300'
        }`}>
          {selected && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}
      <div className="w-full aspect-[5/4] bg-stone-50 overflow-hidden relative">
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
        <div
          className="absolute bottom-0 left-0 right-0 px-3 pt-2 pb-1.5 flex flex-col"
          style={{ backgroundColor: 'rgba(250,247,244,0.78)' }}
        >
          <h3 className="font-serif text-base font-semibold text-stone-800 line-clamp-3 mt-0">
            {d.navn || <span className="text-stone-300 italic font-light">Uten navn</span>}
          </h3>
          <p className="text-xs text-stone-500 truncate">{subtitle || ' '}</p>
        </div>
      </div>

      <div className="px-3 py-2 flex items-center justify-between border-t border-stone-100 min-w-0">
        <div className="text-xs text-stone-500 truncate min-w-0 mr-1 flex-1 flex items-center gap-1.5">
          {d.hex && (
            <span
              className="w-3.5 h-3.5 rounded-full border border-stone-300 flex-shrink-0"
              style={{ backgroundColor: d.hex }}
              title={d.hex}
            />
          )}
          {badge && <span className="font-medium">{badge}</span>}
          {forbruksInfo && (
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-medium ${forbruksInfo.cls}`}>
              {forbruksInfo.label}
            </span>
          )}
          {erArkivert && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-medium bg-stone-100 text-stone-500 border-stone-200">
              Arkivert
            </span>
          )}
        </div>
        <Badge label={d.kategori} cls={KATEGORI_STYLE[d.kategori]} />
      </div>

      {!selectable && (
        <>
          {onArchive && (
            <button
              onClick={e => { e.stopPropagation(); onArchive() }}
              className="absolute bottom-1 left-1.5 z-10 p-1.5 rounded-lg hover:bg-amber-50 text-stone-200 hover:text-amber-500 transition-colors"
              title={erArkivert ? 'Gjenopprett' : 'Arkiver'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="absolute bottom-1 right-1.5 z-10 p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </>
      )}
    </article>
  )
}

// ── NewInventoryModal ─────────────────────────────────────────────────────────

function NewInventoryModal({ onCreate, onClose, initialKategori = 'Stoff' }: {
  onCreate: (data: InventoryItemData) => Promise<void>
  onClose: () => void
  initialKategori?: Kategori
}) {
  const [kategori, setKategori]       = useState<Kategori>(initialKategori)
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
      const result = await apiImportFabric(importUrl.trim())
      let data: InventoryItemData
      if (kategori === 'Stoff') {
        data = {
          ...emptyData('Stoff'),
          type:      'Hovedstoff',
          navn:      result.navn      || 'Nytt stoff',
          materiale: result.materiale || '',
          bredde:    result.bredde    || '',
          vekt:      result.vekt      || '',
          vask:      result.vask      || '',
          bilde:     result.bilde     || '',
          kilde:     importUrl.trim(),
        }
      } else if (kategori === 'Tilbehør') {
        data = {
          ...emptyData('Tilbehør'),
          navn:          result.navn  || 'Nytt tilbehør',
          farge:         result.materiale || '',
          bilde:         result.bilde || '',
          underkategori: underkategori.trim(),
          kilde:         importUrl.trim(),
        }
      } else {
        data = {
          ...emptyData('Utstyr'),
          navn:       result.navn  || 'Nytt utstyr',
          detaljer:   result.materiale || '',
          bilde:      result.bilde || '',
          utstyrstype: utstyrstype.trim(),
          kilde:      importUrl.trim(),
        }
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
        ...(kategori === 'Stoff'    && { type: 'Hovedstoff' as StoffType }),
        ...(kategori === 'Tilbehør' && { underkategori: underkategori.trim() }),
        ...(kategori === 'Utstyr'   && { utstyrstype:   utstyrstype.trim() }),
      }
      await onCreate(data)
    } catch {
      setError('Noe gikk galt. Prøv igjen.')
      setCreating(false)
    }
  }

  const showForm = mode === 'form'
  const busy     = importing || creating

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={!busy ? onClose : undefined} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

        {importing ? (
          <div className="px-6 py-14 text-center">
            <div className="w-10 h-10 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin mx-auto mb-5" />
            <p className="font-serif text-lg text-stone-700">Importerer…</p>
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

              {/* Velg metode (alle kategorier) */}
              {mode === 'choose' && (
                <>
                  <button
                    onClick={() => setMode('url-import')}
                    className="w-full border-2 border-dashed border-stone-200 rounded-2xl p-6 text-center hover:border-[#C9A57A] hover:bg-amber-50/30 transition-colors cursor-pointer group">
                    <svg className="w-8 h-8 text-stone-300 group-hover:text-[#C9A57A] mx-auto mb-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <p className="font-medium text-stone-700 mb-0.5">Importer fra URL</p>
                    <p className="text-xs text-stone-400">
                      {kategori === 'Stoff' ? 'Selfmade, Stoff & Stil o.l. — Claude henter detaljer automatisk'
                       : 'Finn produktside — Claude henter navn og bilde'}
                    </p>
                  </button>
                  <button onClick={() => setMode('form')}
                    className="w-full py-2.5 text-sm text-stone-500 hover:text-stone-700 transition-colors">
                    Legg til manuelt
                  </button>
                </>
              )}

              {/* URL import */}
              {mode === 'url-import' && (
                <>
                  <div>
                    <label className={labelCls}>URL</label>
                    <input className={inputCls} value={importUrl} autoFocus
                      onChange={e => setImportUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleImport()}
                      placeholder="https://…" />
                  </div>
                  {kategori === 'Tilbehør' && (
                    <div>
                      <label className={labelCls}>Underkategori (valgfritt)</label>
                      <div className="flex flex-wrap gap-1.5">
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
                      <label className={labelCls}>Utstyrstype (valgfritt)</label>
                      <div className="flex flex-wrap gap-1.5">
                        {UTSTYR_CHIPS.map(c => (
                          <button key={c} onClick={() => setUtstyrstype(c)} className={chipCls(utstyrstype === c)}>
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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

              {/* Manuelt skjema */}
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
                  <button onClick={() => { setMode('choose'); setError('') }}
                    className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                    Tilbake
                  </button>
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
  const [form, setForm]             = useState<InventoryItemData>(() => deepClone(item.data))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [showImgModal, setShowImgModal] = useState(false)
  const [showGalleryModal, setShowGalleryModal] = useState(false)
  const [toast, setToast]           = useState('')
  const [importUrl, setImportUrl]   = useState(item.data.kilde ?? '')
  const [importing, setImporting]   = useState(false)
  const [importNote, setImportNote] = useState('')
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [showRecipePicker, setShowRecipePicker] = useState(false)
  const router = useRouter()

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

  const [prosjekter, setProsjekter] = useState<PickerProject[]>([])
  const [oppskrifter, setOppskrifter] = useState<PickerRecipe[]>([])

  async function apneProsjektvelger() {
    const { data } = await supabase.from('projects').select('id, data').order('created_at', { ascending: false })
    setProsjekter((data as PickerProject[]) ?? [])
    setShowProjectPicker(true)
  }

  async function apneOppskriftvelger() {
    const { data } = await supabase.from('recipes').select('id, data').order('created_at', { ascending: false })
    setOppskrifter((data as PickerRecipe[]) ?? [])
    setShowRecipePicker(true)
  }

  function gaTilProsjekt(id: string) {
    sessionStorage.setItem('openProjectId', id)
    router.push('/dashboard/projects')
  }

  function gaTilOppskrift(id: string) {
    sessionStorage.setItem('openRecipeId', id)
    router.push('/dashboard/recipes')
  }

  async function handleImportUrl() {
    const trimmed = importUrl.trim()
    if (!trimmed) return
    setImporting(true); setImportNote('')
    try {
      const result = await apiImportFabric(trimmed)
      const d = form
      if (d.kategori === 'Stoff') {
        upd({
          navn:      result.navn      || d.navn,
          materiale: result.materiale || d.materiale,
          bredde:    result.bredde    || d.bredde,
          vekt:      result.vekt      || d.vekt,
          vask:      result.vask      || d.vask,
          bilde:     result.bilde     || d.bilde,
          kilde:     trimmed,
        })
      } else if (d.kategori === 'Tilbehør') {
        upd({
          navn:  result.navn  || d.navn,
          farge: result.materiale || d.farge,
          bilde: result.bilde || d.bilde,
          kilde: trimmed,
        })
      } else {
        upd({
          navn:    result.navn  || d.navn,
          detaljer: result.materiale || d.detaljer,
          bilde:   result.bilde || d.bilde,
          kilde:   trimmed,
        })
      }
      setImportNote('Importert!')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import feilet.')
    } finally {
      setImporting(false)
    }
  }

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
  const isThreadItem = isTilbehor && d.underkategori ? THREAD_UNDERKATEGORIER.has(d.underkategori) : false
  const isBroderiTrad = isTilbehor && d.underkategori ? BRODERITRAD_UNDERKATEGORIER.has(d.underkategori) : false

  const skalForeslåArkivering = !d.arkivert && (
    (isStoff && (d.forbrukStoff === 'alt' || (!d.mengde?.trim() && d.mengde !== undefined))) ||
    (isTilbehor && isThreadItem && d.forbruksniva === 'oppbrukt')
  )

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

        {/* 1b. Galleri — flere bilder ENN hovedbildet, se InventoryItemData.bilder */}
        <SectionHeading>Galleri</SectionHeading>
        <div className="grid grid-cols-3 gap-3">
          {(d.bilder ?? []).map((url, i) => (
            <div key={i} className="relative group aspect-square rounded-xl overflow-hidden bg-stone-100">
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button onClick={() => upd({ bilde: url })}
                title="Sett som hovedbilde"
                className="absolute bottom-1.5 left-1.5 p-1.5 bg-white/90 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-stone-50">
                <svg className={`w-3.5 h-3.5 ${d.bilde === url ? 'text-amber-500' : 'text-stone-500'}`}
                  fill={d.bilde === url ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M11.048 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.951.69h4.914c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.539 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.784.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.63 9.101c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>
              <button onClick={() => upd({ bilder: (d.bilder ?? []).filter((_, j) => j !== i) })}
                title="Slett bilde"
                className="absolute top-1.5 right-1.5 p-1.5 bg-white/90 rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50">
                <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {d.bilde === url && (
                <span className="absolute bottom-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-white/90 text-stone-500">
                  Hovedbilde
                </span>
              )}
            </div>
          ))}
          <button onClick={() => setShowGalleryModal(true)}
            className="aspect-square rounded-xl border-2 border-dashed border-stone-200 hover:border-stone-300 hover:bg-stone-50 transition-colors flex flex-col items-center justify-center gap-1.5 text-stone-300 hover:text-stone-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-xs font-medium">Legg til</span>
          </button>
        </div>

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
              {(!d.underkategori || d.underkategori === 'Sytråd' || d.underkategori === 'Glidelås') && (
                <div>
                  <label className={labelCls}>Farge</label>
                  <input className={inputCls} value={d.farge ?? ''}
                    onChange={e => upd({ farge: e.target.value })}
                    placeholder="F.eks. Hvit" />
                </div>
              )}
              {d.underkategori === 'Glidelås' && (
                <div>
                  <label className={labelCls}>Lengde</label>
                  <input className={inputCls} value={d.lengde ?? ''}
                    onChange={e => upd({ lengde: e.target.value })}
                    placeholder="F.eks. 20 cm" />
                </div>
              )}
              {isThreadItem && (
                <div>
                  <label className={labelCls}>Forbruksnivå</label>
                  <div className="flex flex-wrap gap-1.5">
                    {FORBRUKSNIVA_OPTIONS.map(o => (
                      <button key={o.value} onClick={() => upd({ forbruksniva: o.value })}
                        className={chipCls(d.forbruksniva === o.value)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isBroderiTrad && (
                <div className="space-y-3 p-3 rounded-xl bg-stone-50 border border-stone-200">
                  <p className="text-xs font-medium text-stone-500">
                    Trådpalett — brukes i broderi-arrangøren for å vise denne ekte fargen
                    i stedet for Brothers generiske PEC-farge.
                  </p>
                  <div>
                    <label className={labelCls}>Farge</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(d.hex ?? '') ? d.hex! : '#cccccc'}
                        onChange={e => upd({ hex: e.target.value })}
                        className="w-10 h-10 rounded-lg border border-stone-200 cursor-pointer bg-white p-0.5"
                        aria-label="Velg farge"
                      />
                      <input className={`${inputCls} flex-1`} value={d.hex ?? ''}
                        onChange={e => upd({ hex: e.target.value })}
                        placeholder="#rrggbb" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Merke</label>
                      <input className={inputCls} value={d.merke ?? ''}
                        onChange={e => upd({ merke: e.target.value })}
                        placeholder="F.eks. Brother" />
                    </div>
                    <div>
                      <label className={labelCls}>Trådkode</label>
                      <input className={inputCls} value={d.tradkode ?? ''}
                        onChange={e => upd({ tradkode: e.target.value })}
                        placeholder="F.eks. CYT-122" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
                    <input type="checkbox" checked={d.iBroderipalett ?? true}
                      onChange={e => upd({ iBroderipalett: e.target.checked })}
                      className="rounded border-stone-300" />
                    Vis i trådpaletten i broderi-arrangøren
                  </label>
                </div>
              )}
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
              <div>
                <label className={labelCls}>Brukes til</label>
                <textarea className={`${inputCls} resize-y`} style={{ minHeight: 72 }}
                  value={d.brukesTil ?? ''}
                  onChange={e => upd({ brukesTil: e.target.value })}
                  placeholder="F.eks. Strikkstoff, jersey, interlock" />
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

        {/* 3b. Forbruk (Stoff only) */}
        {isStoff && (
          <>
            <SectionHeading>Forbruk</SectionHeading>
            <div className="space-y-3">
              <input className={inputCls}
                value={d.forbrukStoff ?? ''}
                onChange={e => upd({ forbrukStoff: e.target.value })}
                placeholder="f.eks. 0.5 m" />
              <div className="flex gap-1.5">
                {(['alt', 'noe', 'litt'] as const).map(v => (
                  <button key={v} onClick={() => upd({ forbrukStoff: v })}
                    className={chipCls(d.forbrukStoff === v)}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 3c. Tiltenkt prosjekt / oppskrift (Stoff only) */}
        {isStoff && (
          <>
            <SectionHeading>Tiltenkt prosjekt / oppskrift</SectionHeading>
            <div className="space-y-2">
              {d.tiltenktProsjektId ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => gaTilProsjekt(d.tiltenktProsjektId!)}
                    className="flex-1 flex items-center justify-between px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 transition-colors text-left min-w-0">
                    <span className="text-sm text-stone-700 truncate">{d.tiltenktProsjektNavn || 'Uten navn'}</span>
                    <span className="text-xs text-[#8B6340] flex-shrink-0 ml-2">Åpne prosjekt →</span>
                  </button>
                  <button onClick={() => upd({ tiltenktProsjektId: undefined, tiltenktProsjektNavn: undefined })}
                    className="p-2 text-stone-300 hover:text-red-400 flex-shrink-0" aria-label="Fjern kobling til prosjekt">✕</button>
                </div>
              ) : (
                <button onClick={apneProsjektvelger}
                  className="w-full py-2 text-sm border border-dashed border-stone-200 rounded-lg text-stone-500 hover:border-stone-400 transition-colors">
                  + Koble til et prosjekt
                </button>
              )}

              {d.tiltenktOppskriftId ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => gaTilOppskrift(d.tiltenktOppskriftId!)}
                    className="flex-1 flex items-center justify-between px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 transition-colors text-left min-w-0">
                    <span className="text-sm text-stone-700 truncate">{d.tiltenktOppskriftNavn || 'Uten navn'}</span>
                    <span className="text-xs text-[#8B6340] flex-shrink-0 ml-2">Åpne oppskrift →</span>
                  </button>
                  <button onClick={() => upd({ tiltenktOppskriftId: undefined, tiltenktOppskriftNavn: undefined })}
                    className="p-2 text-stone-300 hover:text-red-400 flex-shrink-0" aria-label="Fjern kobling til oppskrift">✕</button>
                </div>
              ) : (
                <button onClick={apneOppskriftvelger}
                  className="w-full py-2 text-sm border border-dashed border-stone-200 rounded-lg text-stone-500 hover:border-stone-400 transition-colors">
                  + Koble til en oppskrift
                </button>
              )}

              {/* Fritekst-fallback — bare synlig når INGEN ekte kobling er satt, se
                 InventoryItemData.tiltenktProsjekt-kommentaren. */}
              {!d.tiltenktProsjektId && !d.tiltenktOppskriftId && (
                <input className={inputCls}
                  value={d.tiltenktProsjekt ?? ''}
                  onChange={e => upd({ tiltenktProsjekt: e.target.value })}
                  placeholder="…eller skriv fritekst hvis det ikke finnes i biblioteket ennå" />
              )}
            </div>
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

        {/* 6. Kilde + URL-import */}
        <SectionHeading>Kilde</SectionHeading>
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={`${inputCls} flex-1`}
              value={importUrl}
              onChange={e => { setImportUrl(e.target.value); upd({ kilde: e.target.value }) }}
              onKeyDown={e => e.key === 'Enter' && handleImportUrl()}
              placeholder="URL eller butikknavn" />
            <button onClick={handleImportUrl} disabled={!importUrl.trim() || importing}
              className="flex items-center gap-1.5 px-3 py-2 bg-stone-800 text-white text-xs rounded-lg hover:bg-stone-700 transition-colors disabled:opacity-40 whitespace-nowrap">
              {importing ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Henter…</> : 'Importer'}
            </button>
          </div>
          {importNote && <p className="text-xs text-emerald-600">{importNote}</p>}
          <p className="text-xs text-stone-400">
            {isStoff ? 'Skriv inn URL for å hente stoff-detaljer automatisk' : 'Skriv inn URL for å hente navn og bilde automatisk'}
          </p>
        </div>

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

        {/* 10b. Arkiver */}
        {(isStoff || isTilbehor) && (
          <div className="mt-8 pt-6 border-t border-stone-100">
            {skalForeslåArkivering && !d.arkivert && (
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-sm text-amber-800 mb-3">
                  {isStoff
                    ? 'Ser ut som du er ferdig med dette stoffet. Arkiver det?'
                    : 'Tråden ser ut til å være oppbrukt. Arkiver den?'}
                  {' '}Det forsvinner fra oversikten, men dukker alltid opp i søk.
                </p>
                <button
                  onClick={() => upd({ arkivert: true })}
                  className="px-4 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Arkiver
                </button>
              </div>
            )}
            <button
              onClick={() => upd({ arkivert: !d.arkivert })}
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-stone-400 hover:text-stone-600 hover:bg-stone-50 rounded-xl transition-colors border border-stone-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              {d.arkivert ? 'Gjenopprett' : `Arkiver ${isStoff ? 'stoff' : 'tilbehør'}`}
            </button>
          </div>
        )}

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
      {showGalleryModal && (
        <ImageUploadModal
          onAdd={url => upd({ bilder: [...(d.bilder ?? []), url] })}
          onClose={() => setShowGalleryModal(false)}
        />
      )}
      {showProjectPicker && (
        <ProjectPicker
          projects={prosjekter}
          onSelect={p => { upd({ tiltenktProsjektId: p.id, tiltenktProsjektNavn: p.data.name }); setShowProjectPicker(false) }}
          onClose={() => setShowProjectPicker(false)}
        />
      )}
      {showRecipePicker && (
        <RecipePicker
          recipes={oppskrifter}
          onSelect={r => { upd({ tiltenktOppskriftId: r.id, tiltenktOppskriftNavn: r.data.name }); setShowRecipePicker(false) }}
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

// ── Main Page ─────────────────────────────────────────────────────────────────

type InvVisning = { v: 'liste' } | { v: 'item'; id: string } | { v: 'ny' }

function kategoriFraSok(value: string | null): Kategori | null {
  return value === 'Stoff' || value === 'Tilbehør' || value === 'Utstyr' ? value : null
}

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryPageInner />
    </Suspense>
  )
}

// useSearchParams() (kategori-fanen, se under) krever en Suspense-grense ved statisk
// prerendering, ellers feiler "npm run build" med "missing-suspense-with-csr-bailout" —
// `export const dynamic = 'force-dynamic'` over er IKKE nok i en 'use client'-side.
function InventoryPageInner() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [items, setItems]           = useState<InventoryItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [tab, setTabState]          = useState<Kategori>(() => kategoriFraSok(searchParams.get('kategori')) ?? 'Stoff')
  const [search, setSearch]                   = useState('')
  const [typeFilter, setTypeFilter]           = useState<string>('Alle')
  const [sort, setSort]                       = useState<SortOrder>('newest')
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false)
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const typeDropdownRef = useRef<HTMLDivElement>(null)
  const sortDropdownRef = useRef<HTMLDivElement>(null)
  const [showDetail, setShowDetail]           = useState(false)
  const [currentItem, setCurrentItem]         = useState<InventoryItem | null>(null)
  const [showNewModal, setShowNewModal]       = useState(false)
  const [deleteId, setDeleteId]               = useState<string | null>(null)
  const [utstyrSearch, setUtstyrSearch]       = useState('')
  const [tilbehorExpanded, setTilbehorExpanded] = useState<Record<string, boolean>>({})
  const [moveMode, setMoveMode]               = useState(false)
  const [selectedIds, setSelectedIds]         = useState<Set<string>>(new Set())
  const [moving, setMoving]                   = useState(false)
  const [visArkiverte, setVisArkiverte]       = useState(false)

  // Fanen speiles i URL-en (?kategori=) slik at sidemenyens Lager-undermeny treffer
  // riktig fane ved direkte oppslag — samme mønster som statusFilter i projects/page.tsx.
  useEffect(() => {
    const fraUrl = kategoriFraSok(searchParams.get('kategori'))
    if (fraUrl && fraUrl !== tab) setTabState(fraUrl)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function setTab(k: Kategori) {
    setTabState(k)
    router.replace(`${pathname}?kategori=${encodeURIComponent(k)}`)
  }

  useEffect(() => {
    if (!typeDropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [typeDropdownOpen])

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
        .from('inventory').select('*').order('created_at', { ascending: false })
      if (error) throw error
      setItems((data as InventoryItem[]) || [])
    } catch (err) {
      console.error('inventory load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const { push: pushVisning, replace: replaceVisning, closeToBase } = useHistoryVisning<InvVisning>(
    'inv', { v: 'liste' },
    visning => {
      if (visning.v === 'liste') { setShowDetail(false); setCurrentItem(null); setShowNewModal(false); load() }
      else if (visning.v === 'ny') { setShowNewModal(true); setShowDetail(false) }
      else {
        const funnet = items.find(i => i.id === visning.id)
        setCurrentItem(funnet ?? null)
        setShowDetail(!!funnet)
        setShowNewModal(false)
      }
    },
  )

  useEffect(() => { load() }, [load])
  useEffect(() => { setTypeFilter('Alle') }, [tab])
  useEffect(() => {
    if (!moveMode) setSelectedIds(new Set())
  }, [moveMode, tab])

  async function createItem(data: InventoryItemData) {
    const { data: rows, error } = await supabase.from('inventory').insert({ data }).select()
    if (error) throw error
    const item = (rows as InventoryItem[])?.[0]
    if (item) {
      setItems(prev => [item, ...prev])
      setCurrentItem(item)
      setShowNewModal(false)
      setShowDetail(true)
      replaceVisning({ v: 'item', id: item.id })
    }
  }

  async function deleteItem(id: string) {
    await supabase.from('inventory').delete().eq('id', id)
    await load()
    setDeleteId(null)
    setShowDetail(false)
    setCurrentItem(null)
    replaceVisning({ v: 'liste' })
  }

  function openEdit(item: InventoryItem) { setCurrentItem(item); setShowDetail(true); pushVisning({ v: 'item', id: item.id }) }
  function openNew()                     { setShowNewModal(true); pushVisning({ v: 'ny' }) }
  const handleBack = closeToBase

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleMove() {
    const destination: Kategori = tab === 'Tilbehør' ? 'Utstyr' : 'Tilbehør'
    setMoving(true)
    try {
      for (const id of selectedIds) {
        const item = items.find(i => i.id === id)
        if (!item) continue
        const updatedData = { ...item.data, kategori: destination }
        await supabase.from('inventory').update({ data: updatedData }).eq('id', id)
      }
      await load()
      setMoveMode(false)
      setSelectedIds(new Set())
    } catch (err) {
      console.error('move error:', err)
    } finally {
      setMoving(false)
    }
  }

  async function setArkivert(id: string, arkivert: boolean) {
    const item = items.find(i => i.id === id)
    if (!item) return
    const updatedData = { ...item.data, arkivert }
    const { error } = await supabase.from('inventory').update({ data: updatedData }).eq('id', id)
    if (!error) setItems(prev => prev.map(i => i.id === id ? { ...i, data: updatedData } : i))
  }

  const tabItems = items.filter(i => i.data.kategori === tab)

  const filterValues = Array.from(new Set(
    tabItems.map(i =>
      tab === 'Stoff'      ? (i.data.type ?? 'Hovedstoff')
      : tab === 'Tilbehør' ? i.data.underkategori
      : i.data.utstyrstype
    ).filter((v): v is string => Boolean(v))
  )).sort()

  const isSearching = Boolean(search.trim())

  const filtered = tabItems
    .filter(i => {
      if (i.data.arkivert && !isSearching && !visArkiverte) return false
      if (!isSearching) return true
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
      const v = tab === 'Stoff'      ? (d.type ?? 'Hovedstoff')
              : tab === 'Tilbehør'   ? d.underkategori
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

  const showMoveButton = tab === 'Tilbehør' || tab === 'Utstyr'
  const moveDestination: Kategori = tab === 'Tilbehør' ? 'Utstyr' : 'Tilbehør'
  const antallArkiverte = tabItems.filter(i => i.data.arkivert).length

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
      {/* Tabs */}
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 mb-3">
        <div className="flex gap-1 p-1 bg-stone-100 rounded-xl w-full">
          {KATEGORIER.map(k => (
            <button key={k} onClick={() => { setTab(k); setMoveMode(false) }}
              className={`flex-1 min-w-0 py-2 text-sm rounded-lg font-medium transition-colors truncate ${
                tab === k ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
              }`}>
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Search + filters */}
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 mb-4 space-y-3">
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
            placeholder={`Søk i ${emptyLabel}…`}
            className="w-full min-w-0 pl-9 pr-4 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 shadow-sm"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Type filter icon */}
          <div className="relative" ref={typeDropdownRef}>
            <button
              onClick={() => setTypeDropdownOpen(o => !o)}
              className={`relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors ${
                typeFilter !== 'Alle'
                  ? 'bg-stone-100 text-stone-800 border-stone-300'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
              title="Filter"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {typeFilter !== 'Alle' && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#C9A57A] rounded-full" />
              )}
            </button>
            {typeDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-50 min-w-[160px] py-1">
                <button
                  onClick={() => { setTypeFilter('Alle'); setTypeDropdownOpen(false) }}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${typeFilter === 'Alle' ? 'text-stone-800 font-medium' : 'text-stone-600'}`}
                >
                  Alle
                </button>
                {filterValues.map(v => (
                  <button
                    key={v}
                    onClick={() => { setTypeFilter(v); setTypeDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${typeFilter === v ? 'text-stone-800 font-medium bg-stone-50' : 'text-stone-600'}`}
                  >
                    {v}
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
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-50 min-w-[160px] py-1">
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

          {/* Flytt button (Tilbehør and Utstyr only) */}
          {showMoveButton && (
            <button
              onClick={() => setMoveMode(m => !m)}
              className={`px-3 h-9 text-sm rounded-xl border transition-colors ${
                moveMode
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
            >
              Flytt
            </button>
          )}
          {(tab === 'Stoff' || tab === 'Tilbehør') && antallArkiverte > 0 && (
            <button
              onClick={() => setVisArkiverte(v => !v)}
              className={`px-3 h-9 text-sm rounded-xl border transition-colors ${
                visArkiverte
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
            >
              {visArkiverte ? 'Skjul arkiverte' : `Vis arkiverte (${antallArkiverte})`}
            </button>
          )}
        </div>
      </div>

      {/* Utstyr smart search */}
      {tab === 'Utstyr' && (
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 mb-4">
          <div className="relative w-full min-w-0">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C9A57A] pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <input
              type="text"
              value={utstyrSearch}
              onChange={e => setUtstyrSearch(e.target.value)}
              placeholder="Anbefal utstyr for… (f.eks. «stretch», «overlokk»)"
              className="w-full min-w-0 pl-9 pr-4 py-2 border border-[#C9A57A]/40 rounded-xl text-sm bg-[#C9A57A]/5 focus:outline-none focus:ring-2 focus:ring-[#C9A57A]/40 shadow-sm"
            />
          </div>
        </div>
      )}

      {/* Grid */}
      <main className="w-full min-w-0 max-w-6xl mx-auto px-4 sm:px-6 pb-24">
        {loading ? (
          <div className="flex justify-center py-32">
            <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
          </div>
        ) : tab === 'Tilbehør' && !search.trim() && typeFilter === 'Alle' ? (
          /* Grouped Tilbehør sections */
          (() => {
            const groups = Array.from(
              filtered.reduce((map, item) => {
                const key = item.data.underkategori ?? 'Annet'
                if (!map.has(key)) map.set(key, [])
                map.get(key)!.push(item)
                return map
              }, new Map<string, InventoryItem[]>())
            )
            if (groups.length === 0) return (
              <div className="text-center py-28">
                <p className="font-serif text-2xl text-stone-400 font-light">Ingen tilbehør i lageret ennå.</p>
                <button onClick={() => openNew()}
                  className="mt-5 px-6 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium">
                  Legg til tilbehør
                </button>
              </div>
            )
            return (
              <div className="space-y-8">
                {groups.map(([groupName, groupItems]) => {
                  const expanded = tilbehorExpanded[groupName] ?? false
                  const visible = expanded ? groupItems : groupItems.slice(0, 5)
                  const hasMore = groupItems.length > 5
                  return (
                    <section key={groupName}>
                      <h3 className="font-medium text-stone-600 text-sm mb-3 flex items-center gap-2">
                        {groupName}
                        <span className="text-stone-400 font-normal">({groupItems.length})</span>
                      </h3>
                      <div className="w-full min-w-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-5 overflow-hidden">
                        {visible.map(item => (
                          <InventoryCard key={item.id} item={item}
                            onEdit={() => openEdit(item)}
                            onDelete={() => setDeleteId(item.id)}
                            onArchive={() => setArkivert(item.id, !item.data.arkivert)}
                            selectable={moveMode}
                            selected={selectedIds.has(item.id)}
                            onSelect={() => toggleSelect(item.id)} />
                        ))}
                      </div>
                      {hasMore && (
                        <button
                          onClick={() => setTilbehorExpanded(p => ({ ...p, [groupName]: !expanded }))}
                          className="mt-3 text-sm text-stone-500 hover:text-stone-700 underline underline-offset-2">
                          {expanded ? 'Vis færre' : `Se mer (${groupItems.length} totalt)`}
                        </button>
                      )}
                    </section>
                  )
                })}
              </div>
            )
          })()
        ) : tab === 'Utstyr' && !search.trim() && typeFilter === 'Alle' && !utstyrSearch.trim() ? (
          /* Grouped Utstyr sections */
          (() => {
            const groups = Array.from(
              filtered.reduce((map, item) => {
                const key = item.data.utstyrstype ?? 'Annet'
                if (!map.has(key)) map.set(key, [])
                map.get(key)!.push(item)
                return map
              }, new Map<string, InventoryItem[]>())
            )
            if (groups.length === 0) return (
              <div className="text-center py-28">
                <p className="font-serif text-2xl text-stone-400 font-light">Ingen utstyr i lageret ennå.</p>
                <button onClick={() => openNew()}
                  className="mt-5 px-6 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium">
                  Legg til utstyr
                </button>
              </div>
            )
            return (
              <div className="space-y-8">
                {groups.map(([groupName, groupItems]) => (
                  <section key={groupName}>
                    <h3 className="font-medium text-stone-600 text-sm mb-3 flex items-center gap-2">
                      {groupName}
                      <span className="text-stone-400 font-normal">({groupItems.length})</span>
                    </h3>
                    <div className="w-full min-w-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-5 overflow-hidden">
                      {groupItems.map(item => (
                        <InventoryCard key={item.id} item={item}
                          onEdit={() => openEdit(item)}
                          onDelete={() => setDeleteId(item.id)}
                          onArchive={() => setArkivert(item.id, !item.data.arkivert)}
                          selectable={moveMode}
                          selected={selectedIds.has(item.id)}
                          onSelect={() => toggleSelect(item.id)} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          })()
        ) : tab === 'Utstyr' && utstyrSearch.trim() ? (
          /* Smart Utstyr search results */
          (() => {
            const q = utstyrSearch.toLowerCase()
            const matches = filtered.filter(i => {
              const d = i.data
              return (
                d.navn.toLowerCase().includes(q) ||
                (d.utstyrstype  ?? '').toLowerCase().includes(q) ||
                (d.materiale    ?? '').toLowerCase().includes(q) ||
                (d.brukesTil    ?? '').toLowerCase().includes(q) ||
                (d.notater      ?? '').toLowerCase().includes(q)
              )
            })
            if (matches.length === 0) return (
              <div className="text-center py-20">
                <p className="font-serif text-2xl text-stone-400 font-light">Ingen treff for «{utstyrSearch}»</p>
              </div>
            )
            return (
              <div>
                {matches.length === 1 && (
                  <div className="mb-4 px-4 py-3 bg-[#C9A57A]/10 border border-[#C9A57A]/30 rounded-xl text-sm text-stone-600 flex items-center gap-2">
                    <svg className="w-4 h-4 text-[#C9A57A] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Anbefalt: <strong>{matches[0].data.navn}</strong>
                  </div>
                )}
                <div className="w-full min-w-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-5 overflow-hidden">
                  {matches.map(item => (
                    <InventoryCard key={item.id} item={item}
                      onEdit={() => openEdit(item)}
                      onDelete={() => setDeleteId(item.id)}
                      onArchive={() => setArkivert(item.id, !item.data.arkivert)} />
                  ))}
                </div>
              </div>
            )
          })()
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
              <button onClick={() => openNew()}
                className="mt-5 px-6 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors font-medium">
                Legg til {emptyLabel}
              </button>
            )}
          </div>
        ) : (
          <div className="w-full min-w-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-3 sm:gap-5 overflow-hidden">
            {filtered.map(item => (
              <InventoryCard key={item.id} item={item}
                onEdit={() => openEdit(item)}
                onDelete={() => setDeleteId(item.id)}
                onArchive={() => setArkivert(item.id, !item.data.arkivert)}
                selectable={moveMode}
                selected={selectedIds.has(item.id)}
                onSelect={() => toggleSelect(item.id)} />
            ))}
          </div>
        )}
      </main>

      {/* Move action bar */}
      {moveMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-stone-200 px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
          <span className="text-sm text-stone-600">
            {selectedIds.size} valgt
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setMoveMode(false); setSelectedIds(new Set()) }}
              className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700 transition-colors">
              Avbryt
            </button>
            <button
              onClick={handleMove}
              disabled={selectedIds.size === 0 || moving}
              className="px-5 py-2 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
              {moving && <Spinner />}
              Flytt til {moveDestination}
            </button>
          </div>
        </div>
      )}

      {showNewModal && (
        <NewInventoryModal onCreate={createItem} onClose={closeToBase} initialKategori={tab} />
      )}

      {deleteId && !showDetail && (
        <DeleteDialog
          label={deleteLabel}
          onConfirm={() => deleteItem(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {/* FAB */}
      <button
        onClick={() => openNew()}
        className={`fixed right-6 w-14 h-14 bg-[#C9A57A] text-white rounded-full shadow-lg hover:bg-[#b8925f] transition-all flex items-center justify-center cursor-pointer z-30 ${
          moveMode ? 'bottom-20' : 'bottom-6'
        }`}
        aria-label="Legg til"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </>
  )
}
