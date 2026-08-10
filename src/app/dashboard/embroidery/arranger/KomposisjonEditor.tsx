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
  type Embroidery, type EmbroiderySize, type EmbroideryData, type BroderiMotivData, type BroderiBbox,
  type BroderiKomposisjon, type PlassertMotiv, type SekvensElement, type EmbroideryBundle,
  type VirtuelMotiv, type VirtuelStorrelse,
  getCoverImage, getBundleCoverImage, getKatsMedArv,
} from './types'
import { utledTomme, trekktUtKarakter } from './tomme'
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

  function leggTilMotiv(embroideryId: string, sizeId: string, navn: string) {
    const nyId = uid()
    const kaskade = motiver.length * 50 // 5 mm forskyvning per nytt motiv, så de ikke stables eksakt
    const ny: PlassertMotiv = {
      id: nyId,
      embroideryId,
      sizeId,
      navn,
      posisjonXTiendedelMm: kaskade,
      posisjonYTiendedelMm: kaskade,
      rotasjonGrader: 0,
    }
    setMotiver(m => [...m, ny])
    setValgtId(nyId)
    setShowPicker(false)
    sikreMotivData(embroideryId, sizeId)
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

// ── Motiv-velger ─────────────────────────────────────────────────────────────

const RAMME_GRENSE_MM = 98

type BboxMm = { widthMm: number; heightMm: number }
type ParseFremgang = { done: number; total: number; errors: number }

type PickerView =
  | { type: 'liste' }
  | { type: 'bundle-innhold'; bundleId: string }
  | { type: 'tegn'; bundleId: string }
  | { type: 'storrelse'; vm: VirtuelMotiv; prevView: PickerView }

function vmSizeLabel(s: VirtuelStorrelse): string {
  return s.tommeLabel ? `${s.tommeLabel}"` : s.sizeLabel
}

function vmStatus(vm: VirtuelMotiv, bboxCache: Map<string, BboxMm | null>): 'passer' | 'passerIkke' | 'ikkeMalt' {
  let noenMalt = false
  for (const s of vm.sizes) {
    const key = `${s.embroideryId}:${s.sizeId}`
    if (!bboxCache.has(key)) continue
    const b = bboxCache.get(key)
    if (b == null) continue
    noenMalt = true
    if (b.widthMm < RAMME_GRENSE_MM && b.heightMm < RAMME_GRENSE_MM) return 'passer'
  }
  const noenUforsøkt = vm.sizes.some(s => !bboxCache.has(`${s.embroideryId}:${s.sizeId}`))
  if (!noenMalt || noenUforsøkt) return 'ikkeMalt'
  return 'passerIkke'
}


function MotivPicker({ biblioteket, onVelg, onClose }: {
  biblioteket: Embroidery[]
  onVelg: (embroideryId: string, sizeId: string, navn: string) => void
  onClose: () => void
}) {
  const [view, setView] = useState<PickerView>({ type: 'liste' })
  const [search, setSearch] = useState('')
  const [filterPaaRamme, setFilterPaaRamme] = useState(true)
  const [bboxCache, setBboxCache] = useState<Map<string, BboxMm | null>>(new Map())
  const [cacheLastet, setCacheLastet] = useState(false)
  const [bundlerMap, setBundlerMap] = useState<Map<string, EmbroideryBundle>>(new Map())
  const [kategoriOverstyringer, setKategoriOverstyringer] = useState<Map<string, string>>(new Map())
  const [parserAlle, setParserAlle] = useState(false)
  const [parseFremgang, setParseFremgang] = useState<ParseFremgang | null>(null)
  const avbrytRef = useRef(false)

  useEffect(() => { return () => { avbrytRef.current = true } }, [])

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
      setBundlerMap(map)
    })
  }, [])

  // Virtuelle motiver: tomme-regelen brukt på biblioteket + bundle-kart.
  const virtuelleMotiver = useMemo((): VirtuelMotiv[] => {
    const res: VirtuelMotiv[] = []
    const bundleGroups = new Map<string, Embroidery[]>()
    const standalone: Embroidery[] = []

    for (const m of biblioteket) {
      const bid = m.data.bundleId
      if (bid && bundlerMap.has(bid)) {
        const g = bundleGroups.get(bid) ?? []
        g.push(m)
        bundleGroups.set(bid, g)
      } else {
        standalone.push(m)
      }
    }

    for (const [bundleId, motiver] of bundleGroups) {
      const bundle = bundlerMap.get(bundleId)!
      const identitetGrupper = new Map<string, Array<{ m: Embroidery; s: EmbroiderySize; tomme: string | null }>>()

      for (const m of motiver) {
        for (const s of m.data.sizes ?? []) {
          const res2 = utledTomme(s.pesFilename)
          const identitet = res2?.identitet
            ?? s.pesFilename.replace(/\.pes$/i, '').split(/[\\/]/).pop()
            ?? s.pesFilename
          const g = identitetGrupper.get(identitet) ?? []
          g.push({ m, s, tomme: res2?.tomme ?? null })
          identitetGrupper.set(identitet, g)
        }
      }

      for (const [identitet, items] of identitetGrupper) {
        const firstM = items[0].m
        const overstyring = kategoriOverstyringer.get(firstM.id)
        const motivData = overstyring !== undefined
          ? { ...firstM.data, kategori: overstyring, kategorier: overstyring ? [overstyring] : [] }
          : firstM.data
        const { kats, arvet } = getKatsMedArv(motivData, bundle.data)
        const karakter = trekktUtKarakter(identitet)
        res.push({
          key: `${bundleId}:${identitet}`,
          bundleId,
          identitet,
          navn: karakter ? karakter.tegn : (firstM.data.navn || identitet),
          coverImage: getCoverImage(firstM.data),
          kats, katArvet: arvet,
          karakter: karakter ?? undefined,
          sizes: items.map(({ m, s, tomme }) => ({
            embroideryId: m.id,
            sizeId: s.id,
            tommeLabel: tomme,
            sizeLabel: s.sizeLabel,
          })),
        })
      }
    }

    for (const m of standalone) {
      const overstyring = kategoriOverstyringer.get(m.id)
      const motivData = overstyring !== undefined
        ? { ...m.data, kategori: overstyring, kategorier: overstyring ? [overstyring] : [] }
        : m.data
      const { kats, arvet } = getKatsMedArv(motivData)
      res.push({
        key: m.id,
        bundleId: null,
        identitet: m.id,
        navn: m.data.navn || 'Uten navn',
        coverImage: getCoverImage(m.data),
        kats, katArvet: arvet,
        sizes: (m.data.sizes ?? []).map(s => ({
          embroideryId: m.id,
          sizeId: s.id,
          tommeLabel: null,
          sizeLabel: s.sizeLabel,
        })),
      })
    }

    return res
  }, [biblioteket, bundlerMap, kategoriOverstyringer])

  const alfabetBundles = useMemo(() => {
    const bundleVMsLocal = new Map<string, VirtuelMotiv[]>()
    for (const vm of virtuelleMotiver) {
      if (!vm.bundleId) continue
      const g = bundleVMsLocal.get(vm.bundleId) ?? []
      g.push(vm)
      bundleVMsLocal.set(vm.bundleId, g)
    }
    const result = new Set<string>()
    for (const [bid, vms] of bundleVMsLocal) {
      const medTegn = vms.filter(vm => vm.karakter).length
      if (vms.length > 0 && medTegn / vms.length >= 0.5) result.add(bid)
    }
    return result
  }, [virtuelleMotiver])

  const bundleVMs = useMemo(() => {
    const map = new Map<string, VirtuelMotiv[]>()
    for (const vm of virtuelleMotiver) {
      if (!vm.bundleId) continue
      const g = map.get(vm.bundleId) ?? []
      g.push(vm)
      map.set(vm.bundleId, g)
    }
    return map
  }, [virtuelleMotiver])

  const standaloneVMs = useMemo(() =>
    virtuelleMotiver.filter(vm => !vm.bundleId),
    [virtuelleMotiver])

  const alleStoerr = useMemo(() =>
    biblioteket.flatMap(m => (m.data.sizes ?? []).map(s => ({
      embroideryId: m.id, sizeId: s.id,
      key: `${m.id}:${s.id}`,
    }))),
    [biblioteket])

  const ikkeForsokt = useMemo(() =>
    alleStoerr.filter(({ key }) => !bboxCache.has(key)),
    [alleStoerr, bboxCache])

  const { antallPasserGlobalt, antallPasserIkkeGlobalt, antallIkkeMåltGlobalt } = useMemo(() => {
    let passer = 0, passerIkke = 0, ikkeMalt = 0
    for (const vm of virtuelleMotiver) {
      const s = vmStatus(vm, bboxCache)
      if (s === 'passer') passer++
      else if (s === 'passerIkke') passerIkke++
      else ikkeMalt++
    }
    return { antallPasserGlobalt: passer, antallPasserIkkeGlobalt: passerIkke, antallIkkeMåltGlobalt: ikkeMalt }
  }, [virtuelleMotiver, bboxCache])

  const alleBundleIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of biblioteket) {
      if (m.data.bundleId && bundlerMap.has(m.data.bundleId)) ids.add(m.data.bundleId)
    }
    return Array.from(ids)
  }, [biblioteket, bundlerMap])

  function settKategoriOverstyring(embroideryId: string, motivData: EmbroideryData, ny: string) {
    setKategoriOverstyringer(prev => new Map(prev).set(embroideryId, ny))
    supabase.from('embroidery')
      .update({ data: { ...motivData, kategori: ny, kategorier: ny ? [ny] : [] } })
      .eq('id', embroideryId)
      .then(({ error }) => { if (error) console.error('[MotivPicker] Klarte ikke lagre kategori', error) })
  }

  function velgStorrelse(vm: VirtuelMotiv, s: VirtuelStorrelse) {
    const displaySize = vmSizeLabel(s)
    const bundleNavn = vm.bundleId ? bundlerMap.get(vm.bundleId)?.data.navn : null
    const navn = vm.karakter
      ? `${vm.karakter.tegn}${bundleNavn ? ' (' + bundleNavn + ')' : ''} – ${displaySize}`
      : `${vm.navn} – ${displaySize}`
    onVelg(s.embroideryId, s.sizeId, navn)
  }

  function velgVM(vm: VirtuelMotiv, prevView: PickerView) {
    const passende = vm.sizes.filter(s => {
      const b = bboxCache.get(`${s.embroideryId}:${s.sizeId}`)
      return b !== undefined && b !== null && b.widthMm < RAMME_GRENSE_MM && b.heightMm < RAMME_GRENSE_MM
    })
    if (passende.length === 1) { velgStorrelse(vm, passende[0]); return }
    setView({ type: 'storrelse', vm, prevView })
  }

  async function parseAlle() {
    if (!ikkeForsokt.length) return
    avbrytRef.current = false
    setParserAlle(true)
    setParseFremgang({ done: 0, total: ikkeForsokt.length, errors: 0 })
    for (let i = 0; i < ikkeForsokt.length; i += 3) {
      if (avbrytRef.current) break
      await Promise.all(ikkeForsokt.slice(i, i + 3).map(async ({ embroideryId, sizeId, key }) => {
        let ok = false
        try {
          const res = await fetch('/api/broderi-motiv/parse', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embroideryId, sizeId }),
          })
          const body = await res.json()
          if (res.ok && body.data?.bbox) {
            const bbox = body.data.bbox as BroderiBbox
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
        if (!avbrytRef.current)
          setParseFremgang(p => p ? { done: p.done + 1, total: p.total, errors: p.errors + (ok ? 0 : 1) } : null)
      }))
    }
    setParserAlle(false)
  }

  const searchQ = search.toLowerCase().trim()

  function bundleMatcherSok(bid: string): boolean {
    if (!searchQ) return true
    if (bundlerMap.get(bid)?.data.navn.toLowerCase().includes(searchQ)) return true
    return (bundleVMs.get(bid) ?? []).some(vm => vm.navn.toLowerCase().includes(searchQ))
  }

  function bundleStat(bid: string): 'passer' | 'passerIkke' | 'ikkeMalt' {
    const vms = bundleVMs.get(bid) ?? []
    let noenIkkeMalt = false
    for (const vm of vms) {
      const s = vmStatus(vm, bboxCache)
      if (s === 'passer') return 'passer'
      if (s === 'ikkeMalt') noenIkkeMalt = true
    }
    return noenIkkeMalt ? 'ikkeMalt' : 'passerIkke'
  }

  const synligeBundles = useMemo(() => {
    const filtered = alleBundleIds.filter(bundleMatcherSok)
    if (!filterPaaRamme) return { passerListe: filtered, ikkeMåltListe: [] as string[], antallSkjult: 0 }
    const passer: string[] = [], ikkeMalt: string[] = []
    let skjult = 0
    for (const bid of filtered) {
      const s = bundleStat(bid)
      if (s === 'passer') passer.push(bid)
      else if (s === 'ikkeMalt') ikkeMalt.push(bid)
      else skjult++
    }
    return { passerListe: passer, ikkeMåltListe: ikkeMalt, antallSkjult: skjult }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alleBundleIds, bboxCache, filterPaaRamme, searchQ, virtuelleMotiver])

  const synligeStandalone = useMemo(() => {
    const filtered = standaloneVMs.filter(vm => !searchQ || vm.navn.toLowerCase().includes(searchQ))
    if (!filterPaaRamme) return { passerListe: filtered, ikkeMåltListe: [] as VirtuelMotiv[], antallSkjult: 0 }
    const passer: VirtuelMotiv[] = [], ikkeMalt: VirtuelMotiv[] = []
    let skjult = 0
    for (const vm of filtered) {
      const s = vmStatus(vm, bboxCache)
      if (s === 'passer') passer.push(vm)
      else if (s === 'ikkeMalt') ikkeMalt.push(vm)
      else skjult++
    }
    return { passerListe: passer, ikkeMåltListe: ikkeMalt, antallSkjult: skjult }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standaloneVMs, bboxCache, filterPaaRamme, searchQ])

  const antallSkjultTotalt = synligeBundles.antallSkjult + synligeStandalone.antallSkjult

  // ── UI-deler ──────────────────────────────────────────────────────────────

  function Topptekst({ tittel, onTilbake }: { tittel: string; onTilbake?: () => void }) {
    return (
      <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0 flex items-center gap-3">
        {onTilbake && (
          <button onClick={onTilbake} className="p-1 -ml-1 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h3 className="font-serif text-xl text-stone-800 truncate">{tittel}</h3>
      </div>
    )
  }

  function ParseBunnlinje() {
    return (
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
              <div className="h-full bg-[#C9A57A] transition-all duration-300"
                style={{ width: `${(parseFremgang.done / parseFremgang.total) * 100}%` }} />
            </div>
          </div>
        )}
        <div className="flex gap-2">
          {parserAlle ? (
            <button onClick={() => { avbrytRef.current = true; setParserAlle(false) }}
              className="flex-1 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:border-red-400 transition-colors">
              Avbryt parsing
            </button>
          ) : ikkeForsokt.length > 0 ? (
            <button onClick={parseAlle}
              className="flex-1 py-2 text-xs text-stone-500 border border-stone-200 rounded-lg hover:border-stone-400 transition-colors">
              {`Parse ${ikkeForsokt.length} ${ikkeForsokt.length === 1 ? 'størrelse' : 'størrelser'}`}
            </button>
          ) : null}
          <button onClick={onClose} className="flex-1 py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
            Avbryt
          </button>
        </div>
      </div>
    )
  }

  function KategoriBrikke({ kats, arvet, onEndret }: {
    kats: string[]
    arvet: boolean
    onEndret: (ny: string) => void
  }) {
    const [redigerer, setRedigerer] = useState(false)
    if (redigerer) {
      return (
        <select autoFocus defaultValue={kats[0] ?? ''}
          onClick={e => e.stopPropagation()}
          onChange={e => { onEndret(e.target.value); setRedigerer(false) }}
          onBlur={() => setRedigerer(false)}
          className="text-xs border border-stone-300 rounded-lg px-1.5 py-1 bg-white flex-shrink-0">
          <option value="">Uten kategori</option>
          {KATEGORIER.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      )
    }
    return (
      <button
        onClick={e => { e.stopPropagation(); setRedigerer(true) }}
        title={kats.length === 0 ? 'Sett kategori' : arvet ? 'Arvet fra bundle' : 'Klikk for å endre'}
        className={`text-xs px-2 py-1 rounded-lg border flex-shrink-0 whitespace-nowrap transition-colors ${
          kats.length === 0 ? 'text-stone-300 border-stone-200 hover:border-stone-400'
          : arvet ? 'text-stone-500 border-dashed border-stone-300 hover:border-stone-400'
          : 'text-stone-600 border-stone-200 hover:border-stone-400'
        }`}>
        {kats[0] ?? 'Uten kategori'}{arvet && kats.length > 0 ? ' (arvet)' : ''}
      </button>
    )
  }

  function StatusBadge({ vm }: { vm: VirtuelMotiv }) {
    const s = vmStatus(vm, bboxCache)
    const antallPasser = vm.sizes.filter(sz => {
      const b = bboxCache.get(`${sz.embroideryId}:${sz.sizeId}`)
      return b !== undefined && b !== null && b.widthMm < RAMME_GRENSE_MM && b.heightMm < RAMME_GRENSE_MM
    }).length
    if (s === 'passer') return <span className="text-xs text-stone-500 flex-shrink-0">{antallPasser}/{vm.sizes.length} passer</span>
    if (s === 'passerIkke') return <span className="text-xs text-red-400 flex-shrink-0">For stor</span>
    return <span className="text-xs text-amber-600 flex-shrink-0">Ikke målt</span>
  }

  function BundleRad({ bundleId }: { bundleId: string }) {
    const bundle = bundlerMap.get(bundleId)!
    const cover = getBundleCoverImage(bundle.data)
    const vms = bundleVMs.get(bundleId) ?? []
    const erAlf = alfabetBundles.has(bundleId)
    const { kats, arvet } = getKatsMedArv({ kategori: undefined }, bundle.data)
    const antallPasser = vms.filter(vm => vmStatus(vm, bboxCache) === 'passer').length
    const stat = bundleStat(bundleId)
    return (
      <li>
        <div className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50 transition-colors">
          <button
            onClick={() => setView(erAlf ? { type: 'tegn', bundleId } : { type: 'bundle-innhold', bundleId })}
            className="flex items-center gap-3 flex-1 min-w-0 text-left">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {cover && <img src={cover} alt={bundle.data.navn} className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-stone-800 truncate">{bundle.data.navn}</p>
              <p className="text-xs text-stone-400 truncate">
                {erAlf ? `${vms.length} tegn` : `${vms.length} motiver`}
                {' · '}
                {stat === 'passer'
                  ? <span className="text-stone-500">{antallPasser}/{vms.length} passer</span>
                  : stat === 'ikkeMalt'
                    ? <span className="text-amber-600">Ikke målt</span>
                    : <span className="text-red-400">For stor</span>}
              </p>
            </div>
          </button>
          <KategoriBrikke kats={kats} arvet={arvet} onEndret={() => {}} />
        </div>
      </li>
    )
  }

  function VirtuelMotivRad({ vm, onClick }: { vm: VirtuelMotiv; onClick: () => void }) {
    const firstM = biblioteket.find(m => m.id === vm.sizes[0]?.embroideryId)
    return (
      <li>
        <div className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50 transition-colors">
          <button onClick={onClick} className="flex items-center gap-3 flex-1 min-w-0 text-left">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {vm.coverImage && <img src={vm.coverImage} alt={vm.navn} className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-stone-800 truncate">{vm.navn}</p>
              <p className="text-xs text-stone-400 truncate">
                {vm.sizes.length} {vm.sizes.length === 1 ? 'størrelse' : 'størrelser'}
              </p>
            </div>
          </button>
          <StatusBadge vm={vm} />
          {!vm.bundleId && firstM && (
            <KategoriBrikke kats={vm.kats} arvet={vm.katArvet}
              onEndret={ny => settKategoriOverstyring(vm.sizes[0].embroideryId, firstM.data, ny)} />
          )}
        </div>
      </li>
    )
  }

  function ListeSeksjon({ tittel, bundleIds, vms }: {
    tittel?: string
    bundleIds: string[]
    vms: VirtuelMotiv[]
  }) {
    if (bundleIds.length === 0 && vms.length === 0) return null
    return (
      <>
        {tittel && (
          <div className="px-5 py-2 bg-stone-50 sticky top-0 z-10 border-y border-stone-100">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{tittel}</span>
          </div>
        )}
        <ul className="divide-y divide-stone-100">
          {bundleIds.map(bid => <BundleRad key={bid} bundleId={bid} />)}
          {vms.map(vm => (
            <VirtuelMotivRad key={vm.key} vm={vm}
              onClick={() => velgVM(vm, { type: 'liste' })} />
          ))}
        </ul>
      </>
    )
  }

  // ── Tegnrutenett ──────────────────────────────────────────────────────────

  function TegnGruppe({ label, tegns, bundleId }: { label: string; tegns: VirtuelMotiv[]; bundleId: string }) {
    if (tegns.length === 0) return null
    const currentView: PickerView = { type: 'tegn', bundleId }
    return (
      <div className="mb-5">
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide px-5 mb-2">
          {label} ({tegns.length})
        </p>
        <div className="flex flex-wrap gap-2 px-5">
          {tegns.map(vm => {
            const s = vmStatus(vm, bboxCache)
            return (
              <button key={vm.key} onClick={() => velgVM(vm, currentView)}
                title={vm.karakter ? undefined : vm.navn}
                className={`w-10 h-10 rounded-lg border text-lg font-serif flex items-center justify-center transition-colors ${
                  s === 'passer'
                    ? 'border-stone-200 text-stone-700 hover:border-[#C9A57A] hover:bg-stone-50'
                    : s === 'ikkeMalt'
                      ? 'border-stone-200 text-stone-400 hover:border-amber-300 hover:bg-amber-50'
                      : 'border-stone-100 text-stone-300 hover:border-red-200'
                }`}>
                {vm.karakter?.tegn ?? vm.navn.charAt(0)}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>

        {view.type === 'storrelse' && (() => {
          const { vm, prevView } = view
          const passende = vm.sizes.filter(s => {
            const b = bboxCache.get(`${s.embroideryId}:${s.sizeId}`)
            return b !== undefined && b !== null && b.widthMm < RAMME_GRENSE_MM && b.heightMm < RAMME_GRENSE_MM
          })
          const ingenPasser = cacheLastet && passende.length === 0
            && vm.sizes.every(s => bboxCache.has(`${s.embroideryId}:${s.sizeId}`))
          return (
            <>
              <Topptekst tittel={vm.navn} onTilbake={() => setView(prevView)} />
              <div className="overflow-y-auto flex-1 min-h-0 p-4">
                {ingenPasser && (
                  <p className="text-sm text-red-500 mb-3 px-1">
                    Ingen størrelser passer i 100×100 mm-rammen. Du kan fortsatt legge dem til.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {vm.sizes.map((s, i) => {
                    const b = bboxCache.get(`${s.embroideryId}:${s.sizeId}`)
                    const overGrense = b !== undefined && b !== null
                      && (b.widthMm >= RAMME_GRENSE_MM || b.heightMm >= RAMME_GRENSE_MM)
                    const dims = b !== undefined && b !== null
                      ? `${b.widthMm.toFixed(1)} × ${b.heightMm.toFixed(1)} mm`
                      : 'Ikke målt'
                    return (
                      <button key={i} onClick={() => velgStorrelse(vm, s)}
                        className="flex flex-col items-start px-3 py-2 rounded-lg border border-stone-200 text-left hover:border-stone-400 transition-colors">
                        <span className="text-sm text-stone-700">{vmSizeLabel(s)}</span>
                        <span className={`text-xs ${overGrense ? 'text-red-500' : b !== undefined && b !== null ? 'text-stone-500' : 'text-stone-300 italic'}`}>
                          {dims}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0">
                <button onClick={() => setView(prevView)}
                  className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
                  Tilbake
                </button>
              </div>
            </>
          )
        })()}

        {view.type === 'tegn' && (() => {
          const vms = bundleVMs.get(view.bundleId) ?? []
          const stor = vms.filter(vm => vm.karakter?.type === 'stor').sort((a, b) => a.karakter!.tegn.localeCompare(b.karakter!.tegn))
          const liten = vms.filter(vm => vm.karakter?.type === 'liten').sort((a, b) => a.karakter!.tegn.localeCompare(b.karakter!.tegn))
          const tall = vms.filter(vm => vm.karakter?.type === 'tall').sort((a, b) => a.karakter!.tegn.localeCompare(b.karakter!.tegn))
          const symbol = vms.filter(vm => vm.karakter?.type === 'symbol').sort((a, b) => a.karakter!.tegn.localeCompare(b.karakter!.tegn))
          return (
            <>
              <Topptekst tittel={bundlerMap.get(view.bundleId)?.data.navn ?? ''}
                onTilbake={() => setView({ type: 'liste' })} />
              <div className="overflow-y-auto flex-1 min-h-0 pt-4 pb-2">
                <TegnGruppe label="Stor" tegns={stor} bundleId={view.bundleId} />
                <TegnGruppe label="Liten" tegns={liten} bundleId={view.bundleId} />
                <TegnGruppe label="Tall" tegns={tall} bundleId={view.bundleId} />
                <TegnGruppe label="Symbol" tegns={symbol} bundleId={view.bundleId} />
              </div>
              <ParseBunnlinje />
            </>
          )
        })()}

        {view.type === 'bundle-innhold' && (() => {
          const alleVMs = bundleVMs.get(view.bundleId) ?? []
          const filtered = alleVMs.filter(vm => !searchQ || vm.navn.toLowerCase().includes(searchQ))
          const { passerListe, ikkeMåltListe, antallSkjult } = (() => {
            if (!filterPaaRamme) return { passerListe: filtered, ikkeMåltListe: [] as VirtuelMotiv[], antallSkjult: 0 }
            const p: VirtuelMotiv[] = [], im: VirtuelMotiv[] = []
            let sk = 0
            for (const vm of filtered) {
              const s = vmStatus(vm, bboxCache)
              if (s === 'passer') p.push(vm)
              else if (s === 'ikkeMalt') im.push(vm)
              else sk++
            }
            return { passerListe: p, ikkeMåltListe: im, antallSkjult: sk }
          })()
          return (
            <>
              <Topptekst tittel={bundlerMap.get(view.bundleId)?.data.navn ?? ''}
                onTilbake={() => setView({ type: 'liste' })} />
              <div className="overflow-y-auto flex-1 min-h-0">
                {filtered.length === 0 ? (
                  <p className="text-sm text-stone-400 text-center py-12">Ingen motiver.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-stone-100">
                      {passerListe.map(vm => (
                        <VirtuelMotivRad key={vm.key} vm={vm}
                          onClick={() => velgVM(vm, view)} />
                      ))}
                    </ul>
                    {ikkeMåltListe.length > 0 && (
                      <>
                        <div className="px-5 py-2 bg-stone-50 sticky top-0 z-10 border-y border-stone-100">
                          <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Ikke målt ennå</span>
                        </div>
                        <ul className="divide-y divide-stone-100">
                          {ikkeMåltListe.map(vm => (
                            <VirtuelMotivRad key={vm.key} vm={vm}
                              onClick={() => velgVM(vm, view)} />
                          ))}
                        </ul>
                      </>
                    )}
                    {antallSkjult > 0 && (
                      <p className="text-xs text-stone-400 text-center py-3">
                        {antallSkjult} motiv{antallSkjult === 1 ? '' : 'er'} skjult — alle størrelser bekreftet for store
                      </p>
                    )}
                  </>
                )}
              </div>
              <ParseBunnlinje />
            </>
          )
        })()}

        {view.type === 'liste' && (
          <>
            <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
              <h3 className="font-serif text-xl text-stone-800 mb-3">Velg motiv</h3>
              <div className="relative mb-3">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="search" value={search} onChange={e => setSearch(e.target.value)} autoFocus
                  placeholder="Søk på navn eller bundle…"
                  className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input type="checkbox" checked={filterPaaRamme}
                  onChange={e => setFilterPaaRamme(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#C9A57A]" />
                <span className="text-sm text-stone-600">Bare motiver som passer i rammen (&lt;{RAMME_GRENSE_MM} mm)</span>
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
              ) : synligeBundles.passerListe.length === 0 && synligeBundles.ikkeMåltListe.length === 0 &&
                 synligeStandalone.passerListe.length === 0 && synligeStandalone.ikkeMåltListe.length === 0 ? (
                <p className="text-sm text-stone-400 text-center py-12">
                  {biblioteket.length === 0 ? 'Ingen motiver i biblioteket.' : 'Ingen treff.'}
                </p>
              ) : (
                <>
                  <ListeSeksjon
                    bundleIds={synligeBundles.passerListe}
                    vms={synligeStandalone.passerListe} />
                  {(synligeBundles.ikkeMåltListe.length > 0 || synligeStandalone.ikkeMåltListe.length > 0) && (
                    <ListeSeksjon
                      tittel="Ikke målt ennå — kan passe"
                      bundleIds={synligeBundles.ikkeMåltListe}
                      vms={synligeStandalone.ikkeMåltListe} />
                  )}
                  {filterPaaRamme && antallSkjultTotalt > 0 && (
                    <p className="text-xs text-stone-400 text-center py-3">
                      {antallSkjultTotalt} {antallSkjultTotalt === 1 ? 'bundle/motiv' : 'bundles/motiver'} skjult — alle størrelser bekreftet for store
                    </p>
                  )}
                </>
              )}
            </div>

            <ParseBunnlinje />
          </>
        )}
      </div>
    </div>
  )
}
