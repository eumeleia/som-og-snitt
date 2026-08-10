'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { describeError, type ErrorDetails } from '@/lib/error-details'
import { ErrorDetailsView } from '@/components/ErrorDetailsView'
import { roterLokalePunkter, plassertBbox, kombinerBbox } from './geometri'
import {
  type Embroidery, type EmbroiderySize, type BroderiMotivData, type BroderiBbox,
  type BroderiKomposisjon, type PlassertMotiv, getCoverImage,
} from './types'

const RAMME_MM = 100
const ADVARSEL_GRENSE_MM = 98

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function motivKey(embroideryId: string, sizeId: string): string {
  return `${embroideryId}:${sizeId}`
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function KomposisjonEditor({ komposisjon, biblioteket, onBack }: {
  komposisjon: BroderiKomposisjon | null
  biblioteket: Embroidery[]
  onBack: () => void
}) {
  const [id, setId] = useState<string | null>(komposisjon?.id ?? null)
  const [navn, setNavn] = useState(komposisjon?.data.navn ?? 'Ny komposisjon')
  const [motiver, setMotiver] = useState<PlassertMotiv[]>(komposisjon?.data.motiver ?? [])
  const [valgtId, setValgtId] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveErrorDetails, setSaveErrorDetails] = useState<ErrorDetails | null>(null)

  const [resolved, setResolved] = useState<Record<string, BroderiMotivData>>({})
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({})
  const fetchingRef = useRef<Set<string>>(new Set())

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{
    id: string
    startClientX: number
    startClientY: number
    startPosX: number
    startPosY: number
  } | null>(null)

  const sikreMotivData = useCallback(async (embroideryId: string, sizeId: string) => {
    const key = motivKey(embroideryId, sizeId)
    if (resolved[key] || fetchingRef.current.has(key)) return
    fetchingRef.current.add(key)
    try {
      const { data: cached, error: cacheErr } = await supabase
        .from('broderi_motiv')
        .select('data')
        .eq('embroidery_id', embroideryId)
        .eq('size_id', sizeId)
        .maybeSingle()
      if (cacheErr) console.error('[KomposisjonEditor] Oppslag i broderi_motiv-cache feilet', cacheErr)

      let data: BroderiMotivData
      if (cached && Array.isArray(cached.data?.stingblokker)) {
        data = cached.data as BroderiMotivData
      } else {
        const res = await fetch('/api/broderi-motiv/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embroideryId, sizeId }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Klarte ikke tolke PES-filen')
        data = body.data as BroderiMotivData
      }
      setResolved(r => ({ ...r, [key]: data }))
    } catch (err) {
      setFetchErrors(e => ({ ...e, [key]: describeError(err).message }))
    } finally {
      fetchingRef.current.delete(key)
    }
  }, [resolved])

  useEffect(() => {
    for (const pm of motiver) {
      const key = motivKey(pm.embroideryId, pm.sizeId)
      if (!resolved[key] && !fetchErrors[key]) sikreMotivData(pm.embroideryId, pm.sizeId)
    }
  }, [motiver, resolved, fetchErrors, sikreMotivData])

  function leggTilMotiv(motiv: Embroidery, size: EmbroiderySize) {
    const nyId = uid()
    const kaskade = motiver.length * 50 // 5 mm forskyvning per nytt motiv, så de ikke stables eksakt
    const ny: PlassertMotiv = {
      id: nyId,
      embroideryId: motiv.id,
      sizeId: size.id,
      navn: `${motiv.data.navn} – ${size.sizeLabel}`,
      posisjonXTiendedelMm: kaskade,
      posisjonYTiendedelMm: kaskade,
      rotasjonGrader: 0,
    }
    setMotiver(m => [...m, ny])
    setValgtId(nyId)
    setShowPicker(false)
    sikreMotivData(motiv.id, size.id)
  }

  function oppdaterValgt(patch: Partial<PlassertMotiv>) {
    if (!valgtId) return
    setMotiver(m => m.map(pm => pm.id === valgtId ? { ...pm, ...patch } : pm))
  }

  function slett(id: string) {
    setMotiver(m => m.filter(pm => pm.id !== id))
    if (valgtId === id) setValgtId(null)
  }

  // Slett med Delete/Backspace, men ikke mens man skriver i et tekstfelt.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!valgtId) return
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        setMotiver(m => m.filter(pm => pm.id !== valgtId))
        setValgtId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [valgtId])

  // ── Bbox for hele komposisjonen, etter rotasjon ────────────────────────────────

  const combinedBbox = useMemo(() => {
    const bokser: BroderiBbox[] = []
    for (const pm of motiver) {
      const data = resolved[motivKey(pm.embroideryId, pm.sizeId)]
      if (!data?.bbox) continue
      bokser.push(plassertBbox(data.bbox, pm.rotasjonGrader, pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm))
    }
    return kombinerBbox(bokser)
  }, [motiver, resolved])

  const widthMm = combinedBbox ? (combinedBbox.max_x - combinedBbox.min_x) / 10 : 0
  const heightMm = combinedBbox ? (combinedBbox.max_y - combinedBbox.min_y) / 10 : 0
  const overGrense = widthMm > ADVARSEL_GRENSE_MM || heightMm > ADVARSEL_GRENSE_MM

  const halvRamme = RAMME_MM / 2
  const halv = useMemo(() => {
    const motivHalvExtent = combinedBbox
      ? Math.max(
          Math.abs(combinedBbox.min_x), Math.abs(combinedBbox.max_x),
          Math.abs(combinedBbox.min_y), Math.abs(combinedBbox.max_y),
        ) / 10
      : 0
    return Math.max(halvRamme, motivHalvExtent) + 10
  }, [combinedBbox, halvRamme])
  const viewBox = `${-halv} ${-halv} ${halv * 2} ${halv * 2}`

  // ── Dra-for-å-flytte ────────────────────────────────────────────────────────────

  function onPointerDownMotiv(e: ReactPointerEvent, pm: PlassertMotiv) {
    e.stopPropagation()
    setValgtId(pm.id)
    dragRef.current = {
      id: pm.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPosX: pm.posisjonXTiendedelMm,
      startPosY: pm.posisjonYTiendedelMm,
    }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function onPointerMoveSvg(e: ReactPointerEvent) {
    const drag = dragRef.current
    const svg = svgRef.current
    if (!drag || !svg) return
    const rect = svg.getBoundingClientRect()
    const mmPerPx = (halv * 2) / rect.width
    const dxMm = (e.clientX - drag.startClientX) * mmPerPx
    const dyMm = (e.clientY - drag.startClientY) * mmPerPx
    const posisjonXTiendedelMm = Math.round(drag.startPosX + dxMm * 10)
    const posisjonYTiendedelMm = Math.round(drag.startPosY + dyMm * 10)
    setMotiver(m => m.map(pm => pm.id === drag.id ? { ...pm, posisjonXTiendedelMm, posisjonYTiendedelMm } : pm))
  }

  function onPointerUpSvg() {
    dragRef.current = null
  }

  // ── Lagre ────────────────────────────────────────────────────────────────────

  async function lagre() {
    setSaveStatus('saving')
    setSaveErrorDetails(null)
    try {
      const body = { data: { navn, motiver } }
      const res = id
        ? await fetch(`/api/broderi-komposisjon/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await fetch('/api/broderi-komposisjon', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
      const responseBody = await res.json()
      if (!res.ok) throw new Error(responseBody.error ?? 'Klarte ikke lagre')
      if (!id) setId(responseBody.id)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1500)
    } catch (err) {
      setSaveErrorDetails(describeError(err))
      setSaveStatus('error')
    }
  }

  const valgtMotiv = motiver.find(pm => pm.id === valgtId) ?? null

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-3 pb-24">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-stone-100 text-stone-500 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <input
          value={navn}
          onChange={e => setNavn(e.target.value)}
          className="font-serif text-xl text-stone-700 flex-1 min-w-0 bg-transparent border-b border-transparent hover:border-stone-200 focus:border-stone-300 focus:outline-none transition-colors"
        />
        <button
          onClick={lagre}
          disabled={saveStatus === 'saving'}
          className="h-9 px-4 rounded-xl bg-stone-800 text-white text-sm hover:bg-stone-700 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {saveStatus === 'saving' ? 'Lagrer…' : saveStatus === 'saved' ? 'Lagret ✓' : 'Lagre'}
        </button>
      </div>

      {saveStatus === 'error' && saveErrorDetails && (
        <div className="mb-4">
          <ErrorDetailsView details={saveErrorDetails} context="Lagre komposisjon" />
        </div>
      )}

      {overGrense && (
        <div className="px-4 py-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          Komposisjonen er {widthMm.toFixed(1)} × {heightMm.toFixed(1)} mm etter rotasjon — det er over{' '}
          {ADVARSEL_GRENSE_MM} mm i én retning og har lite margin igjen til 100×100 mm-rammen.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 mb-4">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="w-full aspect-square touch-none"
          onPointerMove={onPointerMoveSvg}
          onPointerUp={onPointerUpSvg}
          onPointerDown={() => setValgtId(null)}
        >
          <rect
            x={-halvRamme} y={-halvRamme} width={RAMME_MM} height={RAMME_MM}
            fill="none" stroke="#C9A57A" strokeWidth={0.5} strokeDasharray="2 2"
          />
          {motiver.map(pm => {
            const data = resolved[motivKey(pm.embroideryId, pm.sizeId)]
            if (!data?.bbox) return null
            return (
              <PlassertMotivGruppe
                key={pm.id}
                pm={pm}
                data={data}
                bbox={data.bbox}
                valgt={pm.id === valgtId}
                onPointerDown={e => onPointerDownMotiv(e, pm)}
              />
            )
          })}
        </svg>
      </div>

      <button
        onClick={() => setShowPicker(true)}
        className="w-full mb-4 py-2.5 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors"
      >
        + Legg til motiv
      </button>

      {valgtMotiv && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-stone-700 truncate">{valgtMotiv.navn}</p>
            <button
              onClick={() => slett(valgtMotiv.id)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors flex-shrink-0"
              aria-label="Slett motiv"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[10px] text-stone-400 mb-1">X (mm)</span>
              <input
                type="number" step={0.1} value={valgtMotiv.posisjonXTiendedelMm / 10}
                onChange={e => oppdaterValgt({ posisjonXTiendedelMm: Math.round(Number(e.target.value) * 10) })}
                className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] text-stone-400 mb-1">Y (mm)</span>
              <input
                type="number" step={0.1} value={valgtMotiv.posisjonYTiendedelMm / 10}
                onChange={e => oppdaterValgt({ posisjonYTiendedelMm: Math.round(Number(e.target.value) * 10) })}
                className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] text-stone-400 mb-1">Rotasjon (°)</span>
              <input
                type="number" step={1} value={valgtMotiv.rotasjonGrader}
                onChange={e => oppdaterValgt({ rotasjonGrader: Number(e.target.value) })}
                className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            </label>
          </div>
        </div>
      )}

      {motiver.length > 0 && (
        <ul className="divide-y divide-stone-100 bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          {motiver.map(pm => {
            const key = motivKey(pm.embroideryId, pm.sizeId)
            const feil = fetchErrors[key]
            const lastet = !!resolved[key]
            return (
              <li key={pm.id}>
                <button
                  onClick={() => setValgtId(pm.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    pm.id === valgtId ? 'bg-stone-50' : 'hover:bg-stone-50'
                  }`}
                >
                  <span className="flex-1 min-w-0 text-sm text-stone-700 truncate">{pm.navn}</span>
                  {feil ? (
                    <span className="text-xs text-red-500 flex-shrink-0">Feil</span>
                  ) : !lastet ? (
                    <span className="w-3.5 h-3.5 border-2 border-stone-200 border-t-stone-500 rounded-full animate-spin flex-shrink-0" />
                  ) : null}
                </button>
                {feil && (
                  <p className="px-4 pb-2 text-xs text-red-500">{feil}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {showPicker && (
        <MotivPicker
          biblioteket={biblioteket}
          onVelg={leggTilMotiv}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

// ── Ett plassert motiv, rendret som roterte + forskjøvede stingbaner ──────────────

function PlassertMotivGruppe({ pm, data, bbox, valgt, onPointerDown }: {
  pm: PlassertMotiv
  data: BroderiMotivData
  bbox: BroderiBbox
  valgt: boolean
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const roterteBlokker = useMemo(
    () => data.stingblokker.map(b => ({
      farge_hex: b.farge_hex,
      punkter: roterLokalePunkter(b.sting, bbox, pm.rotasjonGrader),
    })),
    [data.stingblokker, bbox, pm.rotasjonGrader],
  )
  const halvW = (bbox.max_x - bbox.min_x) / 20
  const halvH = (bbox.max_y - bbox.min_y) / 20

  return (
    <g
      transform={`translate(${pm.posisjonXTiendedelMm / 10} ${pm.posisjonYTiendedelMm / 10})`}
      onPointerDown={onPointerDown}
      style={{ cursor: 'grab' }}
    >
      {roterteBlokker.map((b, i) => (
        <polyline
          key={i}
          points={b.punkter.map(([x, y]) => `${x / 10},${y / 10}`).join(' ')}
          fill="none"
          stroke={b.farge_hex}
          strokeWidth={0.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* Usynlig, bred hit-boks slik at det er lett å treffe motivet for å velge/dra det */}
      <rect
        x={-halvW} y={-halvH} width={halvW * 2} height={halvH * 2}
        fill="transparent" stroke="none" transform={`rotate(${pm.rotasjonGrader})`}
      />
      {valgt && (
        <rect
          x={-halvW} y={-halvH} width={halvW * 2} height={halvH * 2}
          fill="none" stroke="#C9A57A" strokeWidth={0.6} strokeDasharray="1.5 1.5"
          transform={`rotate(${pm.rotasjonGrader})`}
        />
      )}
    </g>
  )
}

// ── Velg motiv + størrelse ──────────────────────────────────────────────────────

function MotivPicker({ biblioteket, onVelg, onClose }: {
  biblioteket: Embroidery[]
  onVelg: (motiv: Embroidery, size: EmbroiderySize) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [valgtMotiv, setValgtMotiv] = useState<Embroidery | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return biblioteket
    const q = search.toLowerCase()
    return biblioteket.filter(m => m.data.navn?.toLowerCase().includes(q))
  }, [biblioteket, search])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-stone-800 mb-3">
            {valgtMotiv ? 'Velg størrelse' : 'Velg motiv'}
          </h3>
          {!valgtMotiv && (
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="search" value={search} onChange={e => setSearch(e.target.value)} autoFocus
                placeholder="Søk i biblioteket…"
                className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            </div>
          )}
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {!valgtMotiv ? (
            filtered.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-12">Ingen treff</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {filtered.map(m => {
                  const cover = getCoverImage(m.data)
                  const sizes = m.data.sizes ?? []
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => sizes.length === 1 ? onVelg(m, sizes[0]) : setValgtMotiv(m)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-stone-50 transition-colors text-left"
                      >
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
                          {cover && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={cover} alt={m.data.navn} className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-stone-800 truncate">{m.data.navn || 'Uten navn'}</p>
                          <p className="text-xs text-stone-400">{sizes.length} størrelse{sizes.length === 1 ? '' : 'r'}</p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )
          ) : (
            <div className="p-3 flex flex-wrap gap-2">
              {(valgtMotiv.data.sizes ?? []).map(s => (
                <button
                  key={s.id}
                  onClick={() => onVelg(valgtMotiv, s)}
                  className="h-9 px-3 rounded-lg border border-stone-200 text-sm text-stone-600 hover:border-stone-400 transition-colors"
                >
                  {s.sizeLabel}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0">
          <button
            onClick={() => valgtMotiv ? setValgtMotiv(null) : onClose()}
            className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors"
          >
            {valgtMotiv ? 'Tilbake' : 'Avbryt'}
          </button>
        </div>
      </div>
    </div>
  )
}
