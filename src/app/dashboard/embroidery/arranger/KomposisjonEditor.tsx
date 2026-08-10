'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { describeError, type ErrorDetails } from '@/lib/error-details'
import { ErrorDetailsView } from '@/components/ErrorDetailsView'
import { roterLokalePunkter, plassertBbox, kombinerBbox } from './geometri'
import { synkroniserSekvens } from './sekvens'
import { SekvensPanel } from './SekvensPanel'
import { EksportPanel } from './EksportPanel'
import {
  type Embroidery, type EmbroiderySize, type BroderiMotivData, type BroderiBbox,
  type BroderiKomposisjon, type PlassertMotiv, type SekvensElement, type EmbroideryBundle,
  getCoverImage, getKatsMedArv,
} from './types'
import { KATEGORIER } from '../page'

const RAMME_MM = 100
const RAMME_HALV_TIENDEDEL_MM = (RAMME_MM / 2) * 10 // 500 — ±50 mm sentrert på origo

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function motivKey(embroideryId: string, sizeId: string): string {
  return `${embroideryId}:${sizeId}`
}

const ROTASJON_SNAPP_PUNKTER = [-180, -90, 0, 90, 180]
const ROTASJON_SNAPP_TERSKEL = 4

function snappRotasjon(v: number): number {
  for (const punkt of ROTASJON_SNAPP_PUNKTER) {
    if (Math.abs(v - punkt) <= ROTASJON_SNAPP_TERSKEL) return punkt === -180 ? 180 : punkt
  }
  return v
}

// Normaliserer en vinkel til (-180, 180] bare for å vise riktig håndtak-posisjon på
// glideren når den lagrede verdien kommer fra tallfeltet og ligger utenfor det området.
function normaliserForGlider(v: number): number {
  const m = ((v % 360) + 540) % 360 - 180
  return m
}

function erUtenforRamme(bbox: BroderiBbox): boolean {
  return (
    bbox.min_x < -RAMME_HALV_TIENDEDEL_MM || bbox.max_x > RAMME_HALV_TIENDEDEL_MM ||
    bbox.min_y < -RAMME_HALV_TIENDEDEL_MM || bbox.max_y > RAMME_HALV_TIENDEDEL_MM
  )
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
  const [sekvens, setSekvens] = useState<SekvensElement[]>(komposisjon?.data.sekvens ?? [])
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

  // Legger fargekjøringene til nylig tilkomne (og nå tolkede) motiver til sekvensen,
  // og fjerner elementer for motiver som er slettet — se synkroniserSekvens.
  useEffect(() => {
    setSekvens(s => synkroniserSekvens(s, { motiver, resolved }))
  }, [motiver, resolved])

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

  // ── Bbox for hele komposisjonen og hvilke motiver som stikker utenfor rammen ────
  // Sjekker den FAKTISKE plasserte (rotert + forskjøvet) bboxen til hvert motiv mot
  // ±50 mm sentrert på origo — ikke bare størrelsen på den samlede bboxen, som ikke
  // sier noe om posisjonen (et lite motiv langt utenfor rammen har fortsatt en liten
  // bbox og ville aldri trigget en størrelsesbasert sjekk).

  const plasserteBbokser = useMemo(() => {
    const map = new Map<string, BroderiBbox>()
    for (const pm of motiver) {
      const data = resolved[motivKey(pm.embroideryId, pm.sizeId)]
      if (!data?.bbox) continue
      map.set(pm.id, plassertBbox(data.bbox, pm.rotasjonGrader, pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm))
    }
    return map
  }, [motiver, resolved])

  const utenforRammeIder = useMemo(
    () => motiver.filter(pm => {
      const bbox = plasserteBbokser.get(pm.id)
      return bbox && erUtenforRamme(bbox)
    }).map(pm => pm.id),
    [motiver, plasserteBbokser],
  )

  const combinedBbox = useMemo(
    () => kombinerBbox(Array.from(plasserteBbokser.values())),
    [plasserteBbokser],
  )

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
      const body = { data: { navn, motiver, sekvens } }
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

      {utenforRammeIder.length > 0 && (
        <div className="px-4 py-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          {utenforRammeIder.length} motiv{utenforRammeIder.length === 1 ? '' : 'er'} stikker utenfor
          100×100 mm-rammen (markert med rødt i lerretet):{' '}
          {utenforRammeIder.map(id => motiver.find(pm => pm.id === id)?.navn).filter(Boolean).join(', ')}
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
                utenforRamme={utenforRammeIder.includes(pm.id)}
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
          <div className="mt-3">
            <input
              type="range" min={-180} max={180} step={1}
              value={normaliserForGlider(valgtMotiv.rotasjonGrader)}
              onChange={e => oppdaterValgt({ rotasjonGrader: snappRotasjon(Number(e.target.value)) })}
              className="w-full accent-[#C9A57A]"
            />
            <div className="flex justify-between text-[10px] text-stone-400 px-0.5">
              <span>-180°</span><span>-90°</span><span>0°</span><span>90°</span><span>180°</span>
            </div>
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
                  {utenforRammeIder.includes(pm.id) && (
                    <span className="text-xs text-red-500 flex-shrink-0" title="Stikker utenfor rammen">⚠ Utenfor</span>
                  )}
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

      {sekvens.length > 0 && (
        <div className="mt-6">
          <h3 className="font-serif text-lg text-stone-700 mb-3">Sekvens</h3>
          <SekvensPanel sekvens={sekvens} onChange={setSekvens} motiver={motiver} resolved={resolved} />
        </div>
      )}

      {sekvens.length > 0 && (
        <div className="mt-6">
          <EksportPanel sekvens={sekvens} motiver={motiver} resolved={resolved} navn={navn} />
        </div>
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

function PlassertMotivGruppe({ pm, data, bbox, valgt, utenforRamme, onPointerDown }: {
  pm: PlassertMotiv
  data: BroderiMotivData
  bbox: BroderiBbox
  valgt: boolean
  utenforRamme: boolean
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
      {utenforRamme && (
        <rect
          x={-halvW} y={-halvH} width={halvW * 2} height={halvH * 2}
          fill="none" stroke="#ef4444" strokeWidth={0.8} strokeDasharray="3 1.5"
          transform={`rotate(${pm.rotasjonGrader})`}
        />
      )}
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

// ── Velg motiv, deretter størrelse ──────────────────────────────────────────────

const RAMME_GRENSE_MM = 98

type BboxMm = { widthMm: number; heightMm: number }
type ParseFremgang = { done: number; total: number; errors: number }

interface MotivRad {
  motiv: Embroidery
  bundleNavn: string | null
  kats: string[]
  katArvet: boolean
  antallStorrelser: number
  antallPasser: number
  antallIkkeMålt: number
}

function sorterNavn(a: MotivRad, b: MotivRad): number {
  return (a.motiv.data.navn || '').localeCompare(b.motiv.data.navn || '', 'nb')
}

function MotivPicker({ biblioteket, onVelg, onClose }: {
  biblioteket: Embroidery[]
  onVelg: (motiv: Embroidery, size: EmbroiderySize) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [filterPaaRamme, setFilterPaaRamme] = useState(true)
  const [bboxCache, setBboxCache] = useState<Map<string, BboxMm | null>>(new Map())
  const [cacheLastet, setCacheLastet] = useState(false)
  const [bundler, setBundler] = useState<Map<string, EmbroideryBundle>>(new Map())
  const [kategoriOverstyringer, setKategoriOverstyringer] = useState<Map<string, string>>(new Map())
  const [parserAlle, setParserAlle] = useState(false)
  const [parseFremgang, setParseFremgang] = useState<ParseFremgang | null>(null)
  const [valgtMotiv, setValgtMotiv] = useState<Embroidery | null>(null)
  const avbrytRef = useRef(false)

  useEffect(() => {
    return () => { avbrytRef.current = true }
  }, [])

  useEffect(() => {
    supabase.from('broderi_motiv').select('embroidery_id, size_id, data').then(({ data }) => {
      const map = new Map<string, BboxMm | null>()
      for (const row of (data ?? [])) {
        const r = row as { embroidery_id: string; size_id: string; data: { bbox?: BroderiBbox } }
        const bbox = r.data?.bbox
        map.set(`${r.embroidery_id}:${r.size_id}`, bbox
          ? { widthMm: (bbox.max_x - bbox.min_x) / 10, heightMm: (bbox.max_y - bbox.min_y) / 10 }
          : null)
      }
      setBboxCache(map)
      setCacheLastet(true)
    })
  }, [])

  useEffect(() => {
    supabase.from('embroidery_bundles').select('*').then(({ data }) => {
      const map = new Map<string, EmbroideryBundle>()
      for (const row of ((data ?? []) as EmbroideryBundle[])) map.set(row.id, row)
      setBundler(map)
    })
  }, [])

  const alleStoerr = useMemo(() =>
    biblioteket.flatMap(m => (m.data.sizes ?? []).map(s => ({ m, s, key: `${m.id}:${s.id}` }))),
    [biblioteket],
  )

  // Tre globale tall, uavhengig av søk/filter — et helsetall for hele biblioteket, ikke bare
  // det som vises nå. En størrelse telles "ikke målt" både når parsing aldri er forsøkt OG når
  // den er forsøkt og feilet (f.eks. den ødelagte Vintage Rose-nøkkelen) — begge betyr at vi
  // ikke vet om den passer, som er nettopp det "ikke målt" skal formidle. Aldri "?" — det leses
  // for lett som et mål.
  const { antallPasserGlobalt, antallPasserIkkeGlobalt, antallIkkeMåltGlobalt } = useMemo(() => {
    let passer = 0, passerIkke = 0, ikkeMålt = 0
    for (const { key } of alleStoerr) {
      const b = bboxCache.get(key)
      if (b === undefined || b === null) ikkeMålt++
      else if (b.widthMm < RAMME_GRENSE_MM && b.heightMm < RAMME_GRENSE_MM) passer++
      else passerIkke++
    }
    return { antallPasserGlobalt: passer, antallPasserIkkeGlobalt: passerIkke, antallIkkeMåltGlobalt: ikkeMålt }
  }, [alleStoerr, bboxCache])

  // Bare de som ALDRI er forsøkt — en permanent feilet parsing (som en backslash-ødelagt
  // storage-nøkkel) skal ikke kø-es opp igjen for hver gang "Parse"-knappen trykkes. Siden
  // bboxCache kommer fra broderi_motiv-tabellen (persistert), er dette naturlig gjenopptakbart
  // på nytt besøk også — bare det som faktisk mangler blir liggende i køen.
  const ikkeForsokt = useMemo(() => alleStoerr.filter(({ key }) => !bboxCache.has(key)), [alleStoerr, bboxCache])

  function settKategoriOverstyring(motiv: Embroidery, ny: string) {
    setKategoriOverstyringer(prev => new Map(prev).set(motiv.id, ny))
    supabase.from('embroidery')
      .update({ data: { ...motiv.data, kategori: ny, kategorier: ny ? [ny] : [] } })
      .eq('id', motiv.id)
      .then(({ error }) => {
        if (error) console.error('[MotivPicker] Klarte ikke lagre kategori', error)
      })
  }

  const motivRader: MotivRad[] = useMemo(() => biblioteket.map(motiv => {
    const sizes = motiv.data.sizes ?? []
    let antallPasser = 0
    let antallIkkeMålt = 0
    for (const s of sizes) {
      const b = bboxCache.get(`${motiv.id}:${s.id}`)
      if (b === undefined || b === null) antallIkkeMålt++
      else if (b.widthMm < RAMME_GRENSE_MM && b.heightMm < RAMME_GRENSE_MM) antallPasser++
    }
    const bundle = motiv.data.bundleId ? bundler.get(motiv.data.bundleId) : undefined
    const overstyring = kategoriOverstyringer.get(motiv.id)
    const egetData = overstyring !== undefined
      ? { ...motiv.data, kategori: overstyring, kategorier: overstyring ? [overstyring] : [] }
      : motiv.data
    const { kats, arvet } = getKatsMedArv(egetData, bundle?.data)
    return {
      motiv, bundleNavn: bundle?.data.navn ?? null, kats, katArvet: arvet,
      antallStorrelser: sizes.length, antallPasser, antallIkkeMålt,
    }
  }), [biblioteket, bboxCache, bundler, kategoriOverstyringer])

  const searchQ = search.toLowerCase().trim()
  const synlige = useMemo(() => motivRader.filter(r => {
    if (!searchQ) return true
    return !!r.motiv.data.navn?.toLowerCase().includes(searchQ) || !!r.bundleNavn?.toLowerCase().includes(searchQ)
  }), [motivRader, searchQ])

  // Med filteret på: motiver med minst én bekreftet passende størrelse først, deretter — i en
  // TYDELIG atskilt bolk — motiver der ingen er bekreftet men noen fortsatt er ikke målt (kan
  // fortsatt passe). Motiver der ALLE størrelser er bekreftet for store skjules helt.
  const { passerListe, ikkeMåltListe, antallSkjultHelt } = useMemo(() => {
    if (!filterPaaRamme) {
      return { passerListe: [...synlige].sort(sorterNavn), ikkeMåltListe: [] as MotivRad[], antallSkjultHelt: 0 }
    }
    const passer: MotivRad[] = []
    const ikkeMålt: MotivRad[] = []
    let skjult = 0
    for (const r of synlige) {
      if (r.antallPasser > 0) passer.push(r)
      else if (r.antallIkkeMålt > 0) ikkeMålt.push(r)
      else skjult++
    }
    passer.sort(sorterNavn)
    ikkeMålt.sort(sorterNavn)
    return { passerListe: passer, ikkeMåltListe: ikkeMålt, antallSkjultHelt: skjult }
  }, [synlige, filterPaaRamme])

  async function parseAlle() {
    if (!ikkeForsokt.length) return
    avbrytRef.current = false
    setParserAlle(true)
    setParseFremgang({ done: 0, total: ikkeForsokt.length, errors: 0 })
    for (let i = 0; i < ikkeForsokt.length; i += 3) {
      if (avbrytRef.current) break
      await Promise.all(ikkeForsokt.slice(i, i + 3).map(async ({ m, s, key }) => {
        let ok = false
        try {
          const res = await fetch('/api/broderi-motiv/parse', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embroideryId: m.id, sizeId: s.id }),
          })
          const body = await res.json()
          if (res.ok && body.data?.bbox) {
            const bbox = body.data.bbox
            setBboxCache(prev => new Map(prev).set(key, {
              widthMm: (bbox.max_x - bbox.min_x) / 10,
              heightMm: (bbox.max_y - bbox.min_y) / 10,
            }))
            ok = true
          } else {
            setBboxCache(prev => new Map(prev).set(key, null))
          }
        } catch {
          setBboxCache(prev => new Map(prev).set(key, null))
        }
        if (!avbrytRef.current) {
          setParseFremgang(p => p ? { done: p.done + 1, total: p.total, errors: p.errors + (ok ? 0 : 1) } : null)
        }
      }))
    }
    setParserAlle(false)
  }

  function avbrytParsing() {
    avbrytRef.current = true
    setParserAlle(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>

        {valgtMotiv ? (
          <StorrelseVelger
            motiv={valgtMotiv}
            bboxCache={bboxCache}
            onVelg={s => onVelg(valgtMotiv, s)}
            onTilbake={() => setValgtMotiv(null)}
          />
        ) : (
          <>
            <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
              <h3 className="font-serif text-xl text-stone-800 mb-3">Velg motiv</h3>
              <div className="relative mb-3">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="search" value={search} onChange={e => setSearch(e.target.value)} autoFocus
                  placeholder="Søk på navn eller bundle…"
                  className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox" checked={filterPaaRamme} onChange={e => setFilterPaaRamme(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#C9A57A]"
                />
                <span className="text-sm text-stone-600">Bare motiver med minst én størrelse som passer i rammen (&lt;{RAMME_GRENSE_MM} mm)</span>
              </label>
              {cacheLastet && (
                <p className="text-xs text-stone-400">
                  <span className="text-stone-500">{antallPasserGlobalt} passer</span>
                  {' · '}
                  <span className="text-stone-500">{antallPasserIkkeGlobalt} passer ikke</span>
                  {' · '}
                  <span className="text-amber-600">{antallIkkeMåltGlobalt} ikke målt</span>
                </p>
              )}
            </div>

            <div className="overflow-y-auto flex-1 min-h-0">
              {!cacheLastet ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin" />
                </div>
              ) : passerListe.length === 0 && ikkeMåltListe.length === 0 ? (
                <p className="text-sm text-stone-400 text-center py-12">
                  {motivRader.length === 0 ? 'Ingen motiver i biblioteket.' : 'Ingen treff.'}
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-stone-100">
                    {passerListe.map(r => (
                      <MotivRadVisning
                        key={r.motiv.id} rad={r}
                        onVelg={() => setValgtMotiv(r.motiv)}
                        onKategoriEndret={ny => settKategoriOverstyring(r.motiv, ny)}
                      />
                    ))}
                  </ul>
                  {ikkeMåltListe.length > 0 && (
                    <>
                      <div className="px-5 py-2 bg-stone-50 sticky top-0 z-10 border-y border-stone-100">
                        <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                          Ikke målt ennå — kan passe
                        </span>
                      </div>
                      <ul className="divide-y divide-stone-100">
                        {ikkeMåltListe.map(r => (
                          <MotivRadVisning
                            key={r.motiv.id} rad={r}
                            onVelg={() => setValgtMotiv(r.motiv)}
                            onKategoriEndret={ny => settKategoriOverstyring(r.motiv, ny)}
                          />
                        ))}
                      </ul>
                    </>
                  )}
                  {filterPaaRamme && antallSkjultHelt > 0 && (
                    <p className="text-xs text-stone-400 text-center py-3">
                      {antallSkjultHelt} motiv{antallSkjultHelt === 1 ? '' : 'er'} skjult — alle størrelser er bekreftet for store
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0">
              {parseFremgang && (
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-stone-400 mb-1">
                    <span>Parser størrelser…</span>
                    <span>
                      {parseFremgang.done}/{parseFremgang.total}
                      {parseFremgang.errors > 0 && <span className="text-red-400"> · {parseFremgang.errors} feil</span>}
                    </span>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#C9A57A] transition-all duration-300"
                      style={{ width: `${(parseFremgang.done / parseFremgang.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                {parserAlle ? (
                  <button
                    onClick={avbrytParsing}
                    className="flex-1 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:border-red-400 transition-colors"
                  >
                    Avbryt parsing
                  </button>
                ) : ikkeForsokt.length > 0 ? (
                  <button
                    onClick={parseAlle}
                    className="flex-1 py-2 text-xs text-stone-500 border border-stone-200 rounded-lg hover:border-stone-400 transition-colors"
                  >
                    {`Parse ${ikkeForsokt.length} ${ikkeForsokt.length === 1 ? 'størrelse' : 'størrelser'}`}
                  </button>
                ) : null}
                <button onClick={onClose} className="flex-1 py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                  Avbryt
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function MotivRadVisning({ rad, onVelg, onKategoriEndret }: {
  rad: MotivRad
  onVelg: () => void
  onKategoriEndret: (ny: string) => void
}) {
  const { motiv, bundleNavn, kats, katArvet, antallStorrelser, antallPasser } = rad
  const cover = getCoverImage(motiv.data)
  return (
    <li>
      <div className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50 transition-colors">
        <button onClick={onVelg} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
            {cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt={motiv.data.navn} className="w-full h-full object-cover" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-stone-800 truncate">{motiv.data.navn || 'Uten navn'}</p>
            <p className="text-xs text-stone-400 truncate">
              {bundleNavn ?? 'Løst motiv'} · {antallPasser}/{antallStorrelser} størrelser passer
            </p>
          </div>
        </button>
        <KategoriChip kats={kats} arvet={katArvet} onEndret={onKategoriEndret} />
      </div>
    </li>
  )
}

function KategoriChip({ kats, arvet, onEndret }: {
  kats: string[]
  arvet: boolean
  onEndret: (ny: string) => void
}) {
  const [redigerer, setRedigerer] = useState(false)

  if (redigerer) {
    return (
      <select
        autoFocus
        defaultValue={kats[0] ?? ''}
        onClick={e => e.stopPropagation()}
        onChange={e => { onEndret(e.target.value); setRedigerer(false) }}
        onBlur={() => setRedigerer(false)}
        className="text-xs border border-stone-300 rounded-lg px-1.5 py-1 bg-white flex-shrink-0"
      >
        <option value="">Uten kategori</option>
        {KATEGORIER.map(k => <option key={k} value={k}>{k}</option>)}
      </select>
    )
  }

  return (
    <button
      onClick={e => { e.stopPropagation(); setRedigerer(true) }}
      title={kats.length === 0 ? 'Sett kategori' : arvet ? 'Arvet fra bundle — klikk for å overstyre' : 'Klikk for å endre'}
      className={`text-xs px-2 py-1 rounded-lg border flex-shrink-0 whitespace-nowrap transition-colors ${
        kats.length === 0
          ? 'text-stone-300 border-stone-200 hover:border-stone-400'
          : arvet
            ? 'text-stone-500 border-dashed border-stone-300 hover:border-stone-400'
            : 'text-stone-600 border-stone-200 hover:border-stone-400'
      }`}
    >
      {kats[0] ?? 'Uten kategori'}{arvet && kats.length > 0 ? ' (arvet)' : ''}
    </button>
  )
}

function StorrelseVelger({ motiv, bboxCache, onVelg, onTilbake }: {
  motiv: Embroidery
  bboxCache: Map<string, BboxMm | null>
  onVelg: (size: EmbroiderySize) => void
  onTilbake: () => void
}) {
  const sizes = motiv.data.sizes ?? []
  return (
    <>
      <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0 flex items-center gap-3">
        <button onClick={onTilbake} className="p-1 -ml-1 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors flex-shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="font-serif text-xl text-stone-800 truncate">{motiv.data.navn || 'Uten navn'}</h3>
      </div>
      <div className="overflow-y-auto flex-1 min-h-0 p-3">
        {sizes.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-12">Motivet har ingen størrelser.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sizes.map(s => {
              const b = bboxCache.get(`${motiv.id}:${s.id}`)
              const overGrense = b ? (b.widthMm >= RAMME_GRENSE_MM || b.heightMm >= RAMME_GRENSE_MM) : false
              const dims = b ? `${b.widthMm.toFixed(1)} × ${b.heightMm.toFixed(1)} mm` : 'Ikke målt'
              return (
                <button
                  key={s.id}
                  onClick={() => onVelg(s)}
                  className="flex flex-col items-start px-3 py-2 rounded-lg border border-stone-200 text-left hover:border-stone-400 transition-colors"
                >
                  <span className="text-sm text-stone-700">{s.sizeLabel}</span>
                  <span className={`text-xs ${overGrense ? 'text-red-500' : b ? 'text-stone-500' : 'text-stone-300 italic'}`}>
                    {dims}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0">
        <button onClick={onTilbake} className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
          Tilbake
        </button>
      </div>
    </>
  )
}
