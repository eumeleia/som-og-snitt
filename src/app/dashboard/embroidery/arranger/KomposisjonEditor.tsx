'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { hentAllePaginert } from '@/lib/supabasePaginering'
import { describeError, type ErrorDetails } from '@/lib/error-details'
import { ErrorDetailsView } from '@/components/ErrorDetailsView'
import { roterLokalePunkter, plassertBbox, kombinerBbox } from './geometri'
import { synkroniserSekvens, byggFargePerBlokk, type SekvensKontekst } from './sekvens'
import { byggMiniatyrSvg } from './miniatyr'
import { SekvensPanel } from './SekvensPanel'
import { EksportPanel } from './EksportPanel'
import { StingSimulator } from './StingSimulator'
import {
  type Embroidery, type BroderiMotivData, type BroderiBbox,
  type BroderiKomposisjon, type PlassertMotiv, type SekvensElement, type SekvensKjoring, type EmbroideryBundle,
  type VirtuelMotiv, type VirtuelStorrelse,
  getCoverImage, getBundleCoverImage, getKats, getKatsMedArv,
} from './types'
import { utledTomme, trekktUtKarakter } from './tomme'
import { buildFontData, layoutTekst, type FontData, type TextLayout } from './fontUtils'

// DEN ene rammegrensen — den fysiske 100×100 mm-rammen selv slik Python-eksporten (og
// selvsjekken der) forstår den. Eksportert slik at lerretet, tekstverktøyet og
// størrelsesvarselen alle regner mot nøyaktig samme tall, ikke tre uavhengige 100-tall
// som kunne drevet fra hverandre.
export const RAMME_MM = 100
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
  const [undoStack, setUndoStack] = useState<SekvensElement[][]>([])
  const [redoStack, setRedoStack] = useState<SekvensElement[][]>([])
  const [valgtId, setValgtId] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  // Satt av leggTilValgte (via onVelgFlere) når flervalgets rutenett IKKE kunne holde
  // alle nylig tilføyde motiver innenfor rammen uten overlapp — se beregnRutenettCelle.
  // Blokkerer aldri tilføyingen selv (motivene legges til uansett); bare et varsel om
  // at de bør flyttes eller byttes til en mindre størrelse.
  const [rutenettAdvarsel, setRutenettAdvarsel] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveErrorDetails, setSaveErrorDetails] = useState<ErrorDetails | null>(null)
  const [fokusKjoringId, setFokusKjoringId] = useState<string | null>(null)
  const [hoverKjoringId, setHoverKjoringId] = useState<string | null>(null)

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

  function handleSekvensChange(ny: SekvensElement[]) {
    setUndoStack(u => [...u.slice(-30), sekvens])
    setRedoStack([])
    setSekvens(ny)
  }

  function handleUndo() {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack(r => [sekvens, ...r.slice(0, 29)])
    setUndoStack(u => u.slice(0, -1))
    setSekvens(prev)
  }

  function handleRedo() {
    if (redoStack.length === 0) return
    const next = redoStack[0]
    setUndoStack(u => [...u.slice(-29), sekvens])
    setRedoStack(r => r.slice(1))
    setSekvens(next)
  }

  function handleTilbakestill() {
    handleSekvensChange(synkroniserSekvens([], { motiver, resolved }))
  }

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
    setRutenettAdvarsel(false)
    sikreMotivData(embroideryId, sizeId)
  }

  function leggTilMotiverBolk(
    items: Array<{ embroideryId: string; sizeId: string; navn: string; x: number; y: number }>,
    rutenettUmulig?: boolean,
  ) {
    if (items.length === 0) return
    const nye: PlassertMotiv[] = items.map(item => ({
      id: uid(),
      embroideryId: item.embroideryId,
      sizeId: item.sizeId,
      navn: item.navn,
      posisjonXTiendedelMm: item.x,
      posisjonYTiendedelMm: item.y,
      rotasjonGrader: 0,
    }))
    setMotiver(m => [...m, ...nye])
    setValgtId(null)
    setShowPicker(false)
    setRutenettAdvarsel(!!rutenettUmulig)
    for (const item of items) sikreMotivData(item.embroideryId, item.sizeId)
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

  const undoRedoRef = useRef<{ handleUndo: () => void; handleRedo: () => void }>({ handleUndo, handleRedo })
  undoRedoRef.current = { handleUndo, handleRedo }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoRedoRef.current.handleUndo() }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); undoRedoRef.current.handleRedo() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Bbox for hele komposisjonen, og hvilke motiver som stikker utenfor den TEGNEDE
  // rammen ─────────────────────────────────────────────────────────────────────────
  // VIKTIG, og noe jeg tidligere tok feil om: Python-eksporten kaller
  // move_center_to_origin() (index.py:157) og sentrerer HELE komposisjonen før fila
  // skrives. Posisjonen et motiv har på DETTE lerretet er derfor IKKE det som avgjør om
  // eksporten lykkes — et motiv kan ligge langt utenfor den tegnede ±50 mm-rammen og
  // fremdeles gi en helt gyldig fil, så lenge den SAMLEDE bboksen til alle motiver er
  // ≤100 mm i begge retninger (selvsjekkens faktiske grense, index.py:226-232).
  // utenforRammeIder under er derfor BARE en posisjonsbasert visningshjelp (et diskret
  // rødt omriss på lerretet) — den sier ingenting om eksportrisiko. Den ekte
  // størrelsessjekken er komposisjonForStor lenger ned, som måler combinedBbox mot
  // RAMME_MM og er det varselbanneret nå faktisk utløses av.

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

  // Den faktiske eksportrisikoen: er den SAMLEDE bboksen til alle plasserte motiver over
  // RAMME_MM i bredde eller høyde, feiler selvsjekken uansett hvor motivene ligger —
  // sentreringen ved eksport flytter gruppa, men krymper den aldri.
  const komposisjonBreddeMm = combinedBbox ? (combinedBbox.max_x - combinedBbox.min_x) / 10 : 0
  const komposisjonHoydeMm = combinedBbox ? (combinedBbox.max_y - combinedBbox.min_y) / 10 : 0
  const komposisjonForStor = komposisjonBreddeMm > RAMME_MM || komposisjonHoydeMm > RAMME_MM

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
  // lagretNavnRef holder navnet slik det sto ved siste vellykkede lagring — brukes av
  // navnefeltets onBlur til å avgjøre om det er noe å lagre. Uten denne var "Lagre" den
  // ENESTE veien til å lagre et nytt navn: skrev man et navn og navigerte bort (f.eks.
  // tilbake-knappen) uten å klikke "Lagre" selv, ble navnet aldri sendt til serveren —
  // ikke fordi lagre()/PUT-ruta var ødelagt, men fordi ingenting kalte lagre() i det
  // hele tatt for navnefeltet alene.
  const lagretNavnRef = useRef(navn)

  async function lagre() {
    setSaveStatus('saving')
    setSaveErrorDetails(null)
    try {
      // Miniatyren regnes ut HER, ved lagring — aldri når komposisjonslista bare vises. Bruker
      // resolved slik den står akkurat nå (motiver som ikke er tolket ferdig ennå mangler
      // rett og slett fra miniatyren, i stedet for å blokkere selve lagringen).
      const miniatyrSvg = byggMiniatyrSvg(motiver, resolved, sekvens)
      const body = { data: { navn, motiver, sekvens, miniatyrSvg } }
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
      lagretNavnRef.current = navn
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1500)
    } catch (err) {
      setSaveErrorDetails(describeError(err))
      setSaveStatus('error')
    }
  }

  // Lagrer automatisk når navnefeltet forlates, IKKE bare på trykk av "Lagre" — samme
  // lagre()-kall (motiver/sekvens følger med, siden data er én sammenhengende jsonb),
  // bare utløst av et annet event. Sjekker mot lagretNavnRef, ikke bare "har det endret
  // seg siden forrige tegn", for å unngå et unødvendig kall når feltet bare klikkes i og
  // ut av uten redigering.
  function onNavnBlur() {
    if (navn !== lagretNavnRef.current) lagre()
  }

  const valgtMotiv = motiver.find(pm => pm.id === valgtId) ?? null

  const aktivKjoringId = hoverKjoringId ?? fokusKjoringId
  const aktivKjoring = useMemo((): SekvensKjoring | null => {
    if (!aktivKjoringId) return null
    const el = sekvens.find(e => e.id === aktivKjoringId)
    return el?.type === 'kjoring' ? el : null
  }, [aktivKjoringId, sekvens])

  // Fargeoverstyringer fra sekvensen, per stingblokk per plassert motiv — den samme kilden
  // lerretet under og miniatyren (byggMiniatyrSvg, ved lagring) leser fra, så alle flater er
  // enige om fargen på en kjøring. Rein utledning fra (sekvens, ctx); rører ikke roterteBlokker
  // sin egen useMemo i PlassertMotivGruppe, som fortsatt bare regner geometri.
  const ctx: SekvensKontekst = useMemo(() => ({ motiver, resolved }), [motiver, resolved])
  const fargePerBlokk = useMemo(() => byggFargePerBlokk(sekvens, ctx), [sekvens, ctx])

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
          onBlur={onNavnBlur}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
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

      {komposisjonForStor && (
        <div className="px-4 py-3 mb-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          Komposisjonen er {komposisjonBreddeMm.toFixed(1)} × {komposisjonHoydeMm.toFixed(1)} mm — for stor for {RAMME_MM}×{RAMME_MM} mm-rammen. Eksporten vil bli avvist.
        </div>
      )}

      {rutenettAdvarsel && (
        <div className="px-4 py-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          De nylig tilføyde motivene fikk ikke plass side ved side i {RAMME_MM}×{RAMME_MM} mm-rammen — flytt dem, eller bytt til en mindre størrelse.
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
                aktivKjoring={aktivKjoring}
                fargePerBlokk={fargePerBlokk[pm.id] ?? []}
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
          <SekvensPanel
            sekvens={sekvens}
            onChange={handleSekvensChange}
            motiver={motiver}
            resolved={resolved}
            fokusKjoringId={fokusKjoringId}
            setFokusKjoringId={setFokusKjoringId}
            onHoverEndret={setHoverKjoringId}
            kanAngre={undoStack.length > 0}
            kanGjørOm={redoStack.length > 0}
            onAngre={handleUndo}
            onGjørOm={handleRedo}
            onTilbakestill={handleTilbakestill}
          />
        </div>
      )}

      {sekvens.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 mb-4 mt-4">
          <StingSimulator sekvens={sekvens} motiver={motiver} resolved={resolved} halv={halv} />
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
          onVelgFlere={leggTilMotiverBolk}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

// ── Ett plassert motiv, rendret som roterte + forskjøvede stingbaner ──────────────

function PlassertMotivGruppe({ pm, data, bbox, valgt, utenforRamme, aktivKjoring, fargePerBlokk, onPointerDown }: {
  pm: PlassertMotiv
  data: BroderiMotivData
  bbox: BroderiBbox
  valgt: boolean
  utenforRamme: boolean
  aktivKjoring: SekvensKjoring | null
  fargePerBlokk: string[]
  onPointerDown: (e: ReactPointerEvent) => void
}) {
  const roterteBlokker = useMemo(
    () => data.stingblokker.map(b => ({
      punkter: roterLokalePunkter(b.sting, bbox, pm.rotasjonGrader),
    })),
    [data.stingblokker, bbox, pm.rotasjonGrader],
  )
  const halvW = (bbox.max_x - bbox.min_x) / 20
  const halvH = (bbox.max_y - bbox.min_y) / 20

  // Determine per-block opacity/strokeWidth based on aktivKjoring
  const erAktivtMotiv = aktivKjoring ? aktivKjoring.plassertMotivId === pm.id : false
  const aktiveIndekser: { fra: number; til: number } | null = useMemo(() => {
    if (!aktivKjoring || aktivKjoring.plassertMotivId !== pm.id) return null
    const kjoring = data.fargekjoringer[aktivKjoring.fargekjoringIndex]
    if (!kjoring) return null
    return { fra: kjoring.fra_index, til: kjoring.til_index }
  }, [aktivKjoring, pm.id, data.fargekjoringer])

  return (
    <g
      transform={`translate(${pm.posisjonXTiendedelMm / 10} ${pm.posisjonYTiendedelMm / 10})`}
      onPointerDown={onPointerDown}
      style={{ cursor: 'grab' }}
    >
      {roterteBlokker.map((b, i) => {
        let opacity = 1
        let strokeWidth = 0.3
        if (aktivKjoring) {
          if (erAktivtMotiv && aktiveIndekser) {
            if (i >= aktiveIndekser.fra && i <= aktiveIndekser.til) {
              opacity = 1
              strokeWidth = 0.45
            } else {
              opacity = 0.08
            }
          } else {
            opacity = 0.08
          }
        }
        return (
          <polyline
            key={i}
            points={b.punkter.map(([x, y]) => `${x / 10},${y / 10}`).join(' ')}
            fill="none"
            stroke={fargePerBlokk[i]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={opacity}
          />
        )
      })}
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

// ── Tekstverktøy ─────────────────────────────────────────────────────────────

function TextVerktoy({ bundleNavn, vms, biblioteket, onLeggTil, onBack }: {
  bundleNavn: string
  vms: VirtuelMotiv[]
  biblioteket: Embroidery[]
  onLeggTil: (items: Array<{ embroideryId: string; sizeId: string; navn: string; x: number; y: number }>) => void
  onBack: () => void
}) {
  const tilgjengeligeTommes = useMemo(() => {
    const set = new Set<string>()
    for (const vm of vms) {
      for (const s of vm.sizes) {
        if (s.tommeLabel) set.add(s.tommeLabel)
      }
    }
    return Array.from(set).sort((a, b) => parseFloat(a) - parseFloat(b))
  }, [vms])

  const [tomme, setTomme] = useState<string>(tilgjengeligeTommes[0] ?? '')
  const [tekst, setTekst] = useState('')
  const [tracking, setTracking] = useState(0)
  const [mellomromFaktor, setMellomromFaktor] = useState(0.6)

  const fontData: FontData | null = useMemo(
    () => tomme ? buildFontData(vms, tomme, biblioteket) : null,
    [vms, tomme, biblioteket],
  )

  const layout: TextLayout | null = useMemo(
    () => (fontData && tekst.trim()) ? layoutTekst(tekst, fontData, { tracking, mellomromFaktor }) : null,
    [fontData, tekst, tracking, mellomromFaktor],
  )

  const alternativStørrelse: string | null = useMemo(() => {
    if (!layout || (layout.totalBreddeMm <= RAMME_MM && layout.totalHøydeMm <= RAMME_MM)) return null
    const rene = tekst.replace(/\s/g, '')
    for (const t of [...tilgjengeligeTommes].reverse()) {
      if (t === tomme) continue
      const fd = buildFontData(vms, t, biblioteket)
      const lay = layoutTekst(rene, fd, { tracking, mellomromFaktor })
      if (lay.totalBreddeMm <= RAMME_MM && lay.totalHøydeMm <= RAMME_MM) return t
    }
    return null
  }, [layout, tilgjengeligeTommes, tomme, tekst, vms, biblioteket, tracking, mellomromFaktor])

  const passerBredde = !layout || layout.totalBreddeMm <= RAMME_MM
  const passerHøyde = !layout || layout.totalHøydeMm <= RAMME_MM
  const passerIRamme = passerBredde && passerHøyde

  function leggTil() {
    if (!layout || !fontData || !tekst.trim() || layout.bokstaver.length === 0) return
    onLeggTil(layout.bokstaver.map(b => ({
      embroideryId: b.info.embroideryId,
      sizeId: b.info.sizeId,
      navn: `${b.tegn} – ${tomme}" (${bundleNavn})`,
      x: b.posXTiendedelMm,
      y: b.posYTiendedelMm,
    })))
  }

  return (
    <div className="flex flex-col" style={{ maxHeight: '85vh' }}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0 flex items-center gap-3">
        <button onClick={onBack} className="p-1 -ml-1 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors flex-shrink-0">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0">
          <h3 className="font-serif text-xl text-stone-800 truncate">{bundleNavn}</h3>
          <p className="text-xs text-stone-400">Legg til tekst</p>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0 p-5 space-y-5">

        {/* Size selector */}
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2">Størrelse</p>
          <div className="flex flex-wrap gap-2">
            {tilgjengeligeTommes.map(t => (
              <button key={t} onClick={() => setTomme(t)}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                  t === tomme
                    ? 'bg-stone-800 text-white border-stone-800'
                    : 'border-stone-200 text-stone-600 hover:border-stone-400'
                }`}>
                {t}&quot;
              </button>
            ))}
          </div>
        </div>

        {/* Text input */}
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2">Tekst</p>
          <input
            type="text"
            value={tekst}
            onChange={e => setTekst(e.target.value)}
            placeholder="Skriv tekst…"
            autoFocus
            className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-300"
          />
        </div>

        {/* Sliders */}
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs text-stone-500 mb-1.5">
              <span>Sporing</span>
              <span>{tracking >= 0 ? '+' : ''}{tracking.toFixed(1)} mm</span>
            </div>
            <input type="range" min={-3} max={5} step={0.1} value={tracking}
              onChange={e => setTracking(parseFloat(e.target.value))}
              className="w-full accent-[#C9A57A]" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-stone-500 mb-1.5">
              <span>Mellomrom (space)</span>
              <span>{mellomromFaktor.toFixed(1)}× x-høyde</span>
            </div>
            <input type="range" min={0.3} max={1.2} step={0.05} value={mellomromFaktor}
              onChange={e => setMellomromFaktor(parseFloat(e.target.value))}
              className="w-full accent-[#C9A57A]" />
          </div>
        </div>

        {/* Character preview */}
        {tekst && (
          <div>
            <p className="text-xs font-medium text-stone-500 mb-2">
              {layout ? `${layout.bokstaver.length} tegn plassert` : 'Ingen data'}
              {layout?.mangler.length ? (
                <span className="text-amber-600 ml-2">
                  Mangler: {layout.mangler.map(ch => `«${ch}»`).join(', ')}
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-1">
              {Array.from(tekst).map((ch, i) => {
                const isSpace = ch === ' '
                const mangler = !isSpace && fontData && !fontData.tegn[ch]
                return (
                  <span key={i}
                    className={`inline-block rounded px-1.5 py-0.5 text-sm font-mono ${
                      isSpace ? 'text-stone-300' :
                      mangler ? 'bg-amber-50 text-amber-600 border border-amber-200' :
                      'bg-stone-100 text-stone-700'
                    }`}>
                    {isSpace ? '·' : ch}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Frame fit indicator */}
        {layout && layout.bokstaver.length > 0 && (
          <div className={`p-3 rounded-lg text-sm ${passerIRamme ? 'bg-stone-50 text-stone-600' : 'bg-red-50 text-red-600'}`}>
            <p>
              {layout.totalBreddeMm.toFixed(1)} mm bred
              {!passerBredde && <span className="font-medium"> — for bred</span>}
              {' · '}
              {layout.totalHøydeMm.toFixed(1)} mm høy
              {!passerHøyde && <span className="font-medium"> — for høy</span>}
            </p>
            {!passerIRamme && (
              <p className="mt-1 text-xs">
                {alternativStørrelse
                  ? `Prøv ${alternativStørrelse}" — passer i ${RAMME_MM}×${RAMME_MM} mm`
                  : `Ingen størrelse passer i ${RAMME_MM}×${RAMME_MM} mm med denne teksten`}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0 flex gap-2">
        <button
          onClick={leggTil}
          disabled={!layout || layout.bokstaver.length === 0}
          className="flex-1 py-2 text-sm bg-stone-800 text-white rounded-lg hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {layout?.bokstaver.length
            ? `Legg til ${layout.bokstaver.length} bokstaver`
            : 'Skriv tekst'}
        </button>
        <button onClick={onBack}
          className="px-4 py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
          Avbryt
        </button>
      </div>
    </div>
  )
}

// ── Motiv-velger ─────────────────────────────────────────────────────────────

// Bevisst 2 mm STRENGERE enn selve rammen (RAMME_MM) — en sikkerhetsmargin i velgerens
// "passer i rammen"-filter, ikke en egen, uavhengig grense. Uendret verdi (98), bare
// nå uttrykt i forhold til RAMME_MM slik at de to aldri kan drive fra hverandre ved en
// senere endring et av stedene.
const RAMME_GRENSE_MM = RAMME_MM - 2

type BboxMm = { widthMm: number; heightMm: number; miniatyrSvg: string | null }
type ParseFremgang = { done: number; total: number; errors: number }

type PickerView =
  | { type: 'kategorier' }
  | { type: 'kategori'; kat: string | null }
  | { type: 'bundle-innhold'; bundleId: string; fraKat?: string | null }
  | { type: 'tegn'; bundleId: string; fraKat?: string | null }
  | { type: 'tekst'; bundleId: string; fraKat?: string | null }
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

function fmtMm(b: BboxMm): string {
  return `${b.widthMm.toFixed(1)} × ${b.heightMm.toFixed(1)} mm`
}

// Målteksten som vises i motivraden — direkte mål for et enkelt-størrelses-motiv, minste og
// største (etter areal, w×h hver for seg — aldri en blandet min-bredde/maks-høyde) for et
// motiv med flere størrelser. Returnerer null hvis ingen av størrelsene er målt ennå.
function vmMaalTekst(vm: VirtuelMotiv, bboxCache: Map<string, BboxMm | null>): string | null {
  const malt = vm.sizes
    .map(s => bboxCache.get(`${s.embroideryId}:${s.sizeId}`))
    .filter((b): b is BboxMm => b != null)
  if (malt.length === 0) return null
  if (vm.sizes.length === 1) return fmtMm(malt[0])
  const sortert = [...malt].sort((a, b) => a.widthMm * a.heightMm - b.widthMm * b.heightMm)
  const minst = sortert[0]
  const størst = sortert[sortert.length - 1]
  if (minst === størst) return fmtMm(minst)
  return `${fmtMm(minst)} – ${fmtMm(størst)}`
}

// Størst størrelse som passer i rammen, som standardvalg ved flervalg — samme "passer"-regel
// som resten av velgeren (< RAMME_GRENSE_MM i begge retninger). Passer ingen, brukes den med
// MINST STØRSTE DIMENSJON (bredde eller høyde, den som er størst av de to) — det er den
// dimensjonen som avgjør om motivet kommer inn i rammen, ikke arealet, så "minst ille" måles
// på den, ikke på areal. Er ingenting målt ennå, brukes ganske enkelt den første — samme som
// ved enkeltvalg kan et umålt motiv fortsatt legges til, målet løses uansett først når det
// faktisk skal tegnes (sikreMotivData i selve komposisjonseditoren). Har raden ingen størrelser
// i det hele tatt, er det ingenting å velge — returnerer undefined, og kallstedet
// (leggTilValgte) må filtrere disse bort.
function velgStandardStorrelse(vm: VirtuelMotiv, bboxCache: Map<string, BboxMm | null>): VirtuelStorrelse | undefined {
  const medMaal = vm.sizes
    .map(s => ({ s, b: bboxCache.get(`${s.embroideryId}:${s.sizeId}`) }))
    .filter((x): x is { s: VirtuelStorrelse; b: BboxMm } => x.b != null)
  const somPasser = medMaal.filter(x => x.b.widthMm < RAMME_GRENSE_MM && x.b.heightMm < RAMME_GRENSE_MM)
  if (somPasser.length > 0) {
    return somPasser.reduce((best, cur) =>
      cur.b.widthMm * cur.b.heightMm > best.b.widthMm * best.b.heightMm ? cur : best
    ).s
  }
  if (medMaal.length > 0) {
    return medMaal.reduce((best, cur) =>
      Math.max(cur.b.widthMm, cur.b.heightMm) < Math.max(best.b.widthMm, best.b.heightMm) ? cur : best
    ).s
  }
  return vm.sizes[0]
}

// Bygger virtuelle motiver fra biblioteket. STANDARD er regelen: én embroidery-rad blir
// ETT VirtuelMotiv, med radens egne data.sizes urørt. Grupperingen ligger allerede riktig
// i basen (embroidery/page.tsx setter én rad per motiv med alle dets størrelser) — å
// utlede identitet fra pesFilename og gruppere på nytt her var selve feilen: det splittet
// 12Berries (5 størrelser i én rad ble 5 kort) og kollapset BX Floral («A (stor)» og
// «a (liten)» er to rader med samme filnavn «A.PES», ble ett kort).
//
// UNNTAKET er fontrader: en rad der sizes[] i virkeligheten er ULIKE TEGN, ikke ulike
// størrelser (Seraphine: én rad per tommestørrelse, alle tegn enumerert som "størrelser").
// Bare DE splittes per tegn og grupperes PÅ TVERS av rader innad i samme bundle, slik at
// «a» i 2" og «a» i 3" blir ett kort med to størrelser. Deteksjon: utled identitet per
// størrelse som før (utledTomme sin identitet, ellers filnavnbasen), kjør
// trekktUtKarakter på hver — MINST TO ulike ikke-null tegn utløser fontrad-grenen. null
// (ikke gjenkjent som noe tegn) teller aldri som en forskjell, ellers ville f.eks.
// 12Berries (fem ukarakteriserte størrelsesnavn, alle null) blitt feilklassifisert.
// Fontrad-deteksjon gjelder kun rader i en bundle — et standalone-motiv kan ikke være det.
export function byggVirtuelleMotiver(
  biblioteket: Embroidery[],
  bundlerMap: Map<string, EmbroideryBundle>,
): VirtuelMotiv[] {
  const enkeltrader: VirtuelMotiv[] = []

  for (const m of biblioteket) {
    const bid = m.data.bundleId
    const bundle = bid ? bundlerMap.get(bid) : undefined
    const sizes = m.data.sizes ?? []

    const perStorrelse = sizes.map(s => {
      const t = utledTomme(s.pesFilename)
      const identitet = t?.identitet
        ?? s.pesFilename.replace(/\.pes$/i, '').split(/[\\/]/).pop()
        ?? s.pesFilename
      return { s, tomme: t?.tomme ?? null, identitet, karakter: trekktUtKarakter(identitet) }
    })
    const ulikeIkkeNullTegn = new Set(
      perStorrelse.map(p => p.karakter?.tegn).filter((t): t is string => t != null),
    )
    const erFontrad = bundle !== undefined && ulikeIkkeNullTegn.size >= 2

    if (erFontrad) {
      const { kats, arvet } = getKatsMedArv(m.data, bundle.data)
      for (const p of perStorrelse) {
        enkeltrader.push({
          key: `${bid}:${p.identitet}`,
          bundleId: bid!,
          identitet: p.identitet,
          navn: p.karakter ? p.karakter.tegn : (p.tomme !== null ? (m.data.navn || p.identitet) : p.identitet),
          coverImage: getCoverImage(m.data),
          kats, katArvet: arvet,
          karakter: p.karakter ?? undefined,
          sizes: [{ embroideryId: m.id, sizeId: p.s.id, tommeLabel: p.tomme, sizeLabel: p.s.sizeLabel }],
        })
      }
      continue
    }

    // STANDARD: ett kort per rad. Prøv karakter fra selve motivnavnet FØR
    // filnavn-identiteten — det er der «A (stor)» / «a (liten)» står (BX Floral), og
    // mønsteret finnes i tomme.ts men ble aldri kalt med navn før denne fiksen. Faller
    // navnet ikke til et tegn, men ALLE størrelsene i raden likevel enes om ETT og samme
    // tegn (blandet filnavnsstil i samme rad, se page.tsx:264), brukes det tegnet — raden
    // splittes uansett ikke, den er fortsatt ett kort.
    const karakterFraNavn = trekktUtKarakter(m.data.navn)
    const enkeltTegnFraFilnavn = ulikeIkkeNullTegn.size === 1
      ? perStorrelse.find(p => p.karakter)!.karakter
      : null
    const karakter = karakterFraNavn ?? enkeltTegnFraFilnavn
    const { kats, arvet } = bundle ? getKatsMedArv(m.data, bundle.data) : getKatsMedArv(m.data)
    enkeltrader.push({
      key: m.id,
      bundleId: bid && bundle ? bid : null,
      identitet: m.id,
      navn: karakter ? karakter.tegn : (m.data.navn || 'Uten navn'),
      coverImage: getCoverImage(m.data),
      kats, katArvet: arvet,
      karakter: karakter ?? undefined,
      sizes: sizes.map(s => ({ embroideryId: m.id, sizeId: s.id, tommeLabel: null, sizeLabel: s.sizeLabel })),
    })
  }

  // Slå sammen fontrad-VM-er fra SAMME bundle med SAMME tegn-identitet på tvers av rader
  // (forskjellige tommestørrelser). STANDARD-VM-er sin identitet ER rad-id-en (m.id), unik
  // per rad og kolliderer derfor aldri — denne sammenslåingen er et rent no-op for dem.
  const sett = new Map<string, VirtuelMotiv>()
  const resultat: VirtuelMotiv[] = []
  for (const vm of enkeltrader) {
    if (vm.bundleId === null) { resultat.push(vm); continue }
    const gruppeKey = `${vm.bundleId}:${vm.identitet}`
    const eksisterende = sett.get(gruppeKey)
    if (eksisterende) {
      eksisterende.sizes.push(...vm.sizes)
    } else {
      const kopi: VirtuelMotiv = { ...vm, sizes: [...vm.sizes] }
      sett.set(gruppeKey, kopi)
      resultat.push(kopi)
    }
  }
  return resultat
}

// Enkelt rutenett med luft mellom — ikke stablet i samme punkt som enkelt-tilleggets
// kaskade. Selve posisjonene, ETTER at beregnRutenettCelle (under) har avgjort hvor stor
// hver celle skal være.
export function beregnRutenettPosisjoner(n: number, celleTiendedelMm: number): Array<{ x: number; y: number }> {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const pos: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) {
    const rad = Math.floor(i / cols)
    const kol = i % cols
    pos.push({
      x: Math.round((kol - (cols - 1) / 2) * celleTiendedelMm),
      y: Math.round((rad - (rows - 1) / 2) * celleTiendedelMm),
    })
  }
  return pos
}

// Cellestørrelsen (avstand mellom cellesentre) rutenettet over trenger, og om det i det
// hele tatt er MULIG å holde alle n kvadratiske celler (sidelengde storsteDimMm — den
// STØRSTE kjente utstrekningen blant de valgte standardstørrelsene) innenfor ±halve
// RAMME_GRENSE_MM samtidig, uten at noen av dem overlapper (celle < storsteDimMm ville
// vært overlapp, og er derfor aldri tillatt, uansett hvor trangt det blir). Bruker
// RAMME_GRENSE_MM (98), ikke selve RAMME_MM (100) — to motiver som akkurat fyller cellen
// ville ellers havnet med ytterkant nøyaktig på rammekanten, uten klaring til foten.
//
// INVARIANTEN: er det geometrisk mulig for alle n å ligge innenfor rammen samtidig,
// strammes cellestørrelsen inn fra den ønskede 1.25×-margin til akkurat det som trengs
// for å holde ytterste cellekant innenfor rammen — aldri under 1×, som ville vært
// overlapp. Er det umulig (selv tett i tett, celle = storsteDimMm, ryker rammen),
// brukes likevel den tetteste cellen (fortsatt ALDRI overlapp) — kalleren viser da en
// melding i stedet for stille å late som det gikk bra.
export function beregnRutenettCelle(n: number, storsteDimMm: number): { celleMm: number; umulig: boolean } {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)

  // Størst celle DENNE aksen tillater for at ytterste cellekant skal holde seg innenfor
  // rammen. Uendelig (cellestørrelsen er irrelevant for denne aksen) når aksen bare har
  // ÉN celle, siden avstanden fra origo da er storsteDimMm/2 uansett celle. Er selv DET
  // for stort, er aksen umulig uansett cellestørrelse — signalisert med -Infinity, som
  // garantert taper i Math.min under.
  function maxCelleForAkse(antallCeller: number): number {
    if (antallCeller <= 1) return storsteDimMm <= RAMME_GRENSE_MM ? Infinity : -Infinity
    return (RAMME_GRENSE_MM - storsteDimMm) / (antallCeller - 1)
  }

  const maxCelle = Math.min(maxCelleForAkse(cols), maxCelleForAkse(rows))
  const umulig = maxCelle < storsteDimMm
  const celleMm = umulig ? storsteDimMm : Math.min(storsteDimMm * 1.25, maxCelle)
  return { celleMm, umulig }
}

// Topp-nivå (ikke nestet i MotivPicker) med rene props i stedet for closures over lokal
// state — resten av MotivPickers underkomponenter (Topptekst, ParseBunnlinje, osv.) er
// definert nestet inni MotivPicker og bygges derfor på nytt for hver rendring; det er et
// eksisterende mønster i denne fila (ikke noe innført her), men denne komponenten trengte
// ikke closures over lokal state, så den er skrevet som en vanlig topp-nivå-komponent i stedet.
function ValgtBunnlinje({ antall, onFjernValg, onLeggTilValgte }: {
  antall: number
  onFjernValg: () => void
  onLeggTilValgte: () => void
}) {
  if (antall === 0) return null
  return (
    <div className="px-5 py-2.5 border-t border-stone-100 flex-shrink-0 flex items-center justify-between gap-3 bg-stone-50">
      <span className="text-xs text-stone-500">{antall} valgt</span>
      <div className="flex gap-2">
        <button onClick={onFjernValg}
          className="text-xs text-stone-400 hover:text-stone-600 transition-colors">
          Fjern valg
        </button>
        <button onClick={onLeggTilValgte}
          className="px-3 py-1.5 text-xs text-white bg-stone-800 rounded-lg hover:bg-stone-700 transition-colors">
          {`Legg til ${antall} ${antall === 1 ? 'motiv' : 'motiver'}`}
        </button>
      </div>
    </div>
  )
}

function MotivPicker({ biblioteket, onVelg, onVelgFlere, onClose }: {
  biblioteket: Embroidery[]
  onVelg: (embroideryId: string, sizeId: string, navn: string) => void
  // rutenettUmulig: kun satt av leggTilValgte (flervalg), aldri av tekstverktøyets
  // onLeggTil — se beregnRutenettCelle for hva den faktisk betyr.
  onVelgFlere: (
    items: Array<{ embroideryId: string; sizeId: string; navn: string; x: number; y: number }>,
    rutenettUmulig?: boolean,
  ) => void
  onClose: () => void
}) {
  const [view, setView] = useState<PickerView>({ type: 'kategorier' })
  const [search, setSearch] = useState('')
  const [filterPaaRamme, setFilterPaaRamme] = useState(true)
  const [bboxCache, setBboxCache] = useState<Map<string, BboxMm | null>>(new Map())
  const [cacheLastet, setCacheLastet] = useState(false)
  const [globalCounts, setGlobalCounts] = useState<{ passer: number; passerIkke: number } | null>(null)
  const [bundlerMap, setBundlerMap] = useState<Map<string, EmbroideryBundle>>(new Map())
  const [parserAlle, setParserAlle] = useState(false)
  const [parseFremgang, setParseFremgang] = useState<ParseFremgang | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [lasterFeil, setLasterFeil] = useState<string | null>(null)
  const [lasterVersjon, setLasterVersjon] = useState(0) // increment to retry
  const [manglerMiniatyrKolonne, setManglerMiniatyrKolonne] = useState(false)
  const avbrytRef = useRef(false)

  useEffect(() => { return () => { avbrytRef.current = true } }, [])

  // Henter mål-kolonnene for ALLE rader — data-kolonnen (som også har alle stingkoordinatene,
  // stundom over 10 000 punkter per rad) røres aldri her. Postgres må dekomprimere hele
  // TOAST-verdien for å hente ut selv et lite underfelt som data->bbox, uansett hvor lite
  // som faktisk sendes over — det var den ekte kostnaden, ikke antall rader. Etter migration
  // 007 er bredde/høyde egne, ikke-TOASTede kolonner, så et par tusen rader med noen få
  // heltall hver er billig å hente og regne på i klienten.
  //
  // MEN: PostgREST/Supabase svarer maks 1000 rader per spørring uansett .range(), stille —
  // ingen feil, bare et halvfullt resultat. Uten paginering ble bboxCache derfor aldri
  // komplett (2994 rader > 1000), og uten en fast `order by` var det TILFELDIG hvilke 1000
  // rader som kom med hver gang, så det var IKKE data-feil som fikk per-bundle-tallene til å
  // endre seg mellom hver lasting. Løsning: `hentAllePaginert` (src/lib/supabasePaginering.ts)
  // henter i sider av 1000 med en deterministisk sortering til en side kommer kortere enn full —
  // samme hjelpefunksjon som biblioteklistene bruker, så pagineringslogikken finnes ett sted.
  useEffect(() => {
    let cancelled = false
    type Rad = { embroidery_id: string; size_id: string; bredde_tiendedel_mm: number | null; hoyde_tiendedel_mm: number | null; miniatyr_svg: string | null }
    type RadUtenMiniatyr = { embroidery_id: string; size_id: string; bredde_tiendedel_mm: number | null; hoyde_tiendedel_mm: number | null }
    async function lastAlleRader(): Promise<Map<string, BboxMm | null> | null> {
      const { data: rader, error } = await hentAllePaginert<Rad>(
        (fra, til) => supabase.from('broderi_motiv')
          .select('embroidery_id, size_id, bredde_tiendedel_mm, hoyde_tiendedel_mm, miniatyr_svg')
          .order('id', { ascending: true })
          .range(fra, til),
        ['id'],
      )
      let finalRader: Array<Rad | RadUtenMiniatyr>
      if (error) {
        if (error.code === '42703' && error.message.includes('miniatyr_svg')) {
          // Migration 008 not run — load without miniatyr_svg and show banner instead of blocking.
          if (!cancelled) setManglerMiniatyrKolonne(true)
          const { data: rader2, error: error2 } = await hentAllePaginert<RadUtenMiniatyr>(
            (fra, til) => supabase.from('broderi_motiv')
              .select('embroidery_id, size_id, bredde_tiendedel_mm, hoyde_tiendedel_mm')
              .order('id', { ascending: true })
              .range(fra, til),
            ['id'],
          )
          if (error2) {
            if (!cancelled) setLasterFeil(`Kunne ikke laste mål-data: ${error2.message}`)
            return null
          }
          finalRader = rader2
        } else {
          if (!cancelled) setLasterFeil(`Kunne ikke laste mål-data: ${error.message}`)
          return null
        }
      } else {
        finalRader = rader
      }
      const map = new Map<string, BboxMm | null>()
      for (const row of finalRader) {
        map.set(`${row.embroidery_id}:${row.size_id}`,
          row.bredde_tiendedel_mm != null && row.hoyde_tiendedel_mm != null
            ? { widthMm: row.bredde_tiendedel_mm / 10, heightMm: row.hoyde_tiendedel_mm / 10, miniatyrSvg: ('miniatyr_svg' in row ? row.miniatyr_svg : null) ?? null }
            : null)
      }
      return map
    }
    async function last() {
      const totalPromise = supabase
        .from('broderi_motiv')
        .select('id', { count: 'exact', head: true })

      const passerPromise = supabase
        .from('broderi_motiv')
        .select('id', { count: 'exact', head: true })
        .lt('bredde_tiendedel_mm', RAMME_GRENSE_MM * 10)
        .lt('hoyde_tiendedel_mm', RAMME_GRENSE_MM * 10)

      const passerIkkePromise = supabase
        .from('broderi_motiv')
        .select('id', { count: 'exact', head: true })
        .not('bredde_tiendedel_mm', 'is', null)
        .not('hoyde_tiendedel_mm', 'is', null)
        .or(`bredde_tiendedel_mm.gte.${RAMME_GRENSE_MM * 10},hoyde_tiendedel_mm.gte.${RAMME_GRENSE_MM * 10}`)

      const [map, totalRes, passerRes, passerIkkeRes] = await Promise.all([
        lastAlleRader(), totalPromise, passerPromise, passerIkkePromise,
      ])
      if (cancelled) return
      if (map === null) { if (!cancelled) setLasterFeil('Kunne ikke laste mål-data'); return }

      if (totalRes.error) console.error('[MotivPicker] totaltelling feilet', totalRes.error)
      if (passerRes.error) console.error('[MotivPicker] passer-telling feilet', passerRes.error)
      if (passerIkkeRes.error) console.error('[MotivPicker] passer-ikke-telling feilet', passerIkkeRes.error)

      // Overskriften (count-spørringer mot basen) og lista (bboxCache) er to uavhengige
      // kilder til samme sannhet — er de uenige er det alltid en feil i lastingen, ikke i
      // dataene. Tegn aldri en liste som motsier tallene; logg tydelig i stedet.
      if (totalRes.count != null && totalRes.count !== map.size) {
        console.error('[MotivPicker] bboxCache stemmer ikke med basen', {
          cacheStorrelse: map.size, baseAntallRader: totalRes.count,
        })
      }

      setBboxCache(map)
      setGlobalCounts({ passer: passerRes.count ?? 0, passerIkke: passerIkkeRes.count ?? 0 })
      setCacheLastet(true)
    }
    last()
    return () => { cancelled = true }
  }, [lasterVersjon])

  useEffect(() => {
    supabase.from('embroidery_bundles').select('*').then(({ data, error }) => {
      if (error) { setLasterFeil(`Kunne ikke laste bundles: ${error.message}`); return }
      const map = new Map<string, EmbroideryBundle>()
      for (const row of ((data ?? []) as EmbroideryBundle[])) map.set(row.id, row)
      setBundlerMap(map)
    })
  }, [lasterVersjon])

  // Virtuelle motiver: se byggVirtuelleMotiver (modulnivå, over MotivPicker) for selve
  // regelen og hvorfor den ikke lenger utleder gruppering fra filnavn på tvers av rader.
  const virtuelleMotiver = useMemo(
    () => byggVirtuelleMotiver(biblioteket, bundlerMap),
    [biblioteket, bundlerMap])

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

  // Nøyaktig hvilke par som mangler et forsøk — brukes bare til å BYGGE parse-køen (de
  // faktiske embroideryId/sizeId-parene som skal sendes til /api/broderi-motiv/parse), ikke
  // til å vise et tall. Et permanent feilet forsøk (finnes som rad, men uten mål) skal ikke
  // kø-es opp igjen, bare det som aldri har fått en rad.
  const ikkeForsokt = useMemo(() =>
    alleStoerr.filter(({ key }) => !bboxCache.has(key)),
    [alleStoerr, bboxCache])

  // globalCounts kommer fra count-spørringene i lasteeffekten over og teller RADER i
  // broderi_motiv, altså STØRRELSER — én rad per embroidery_id+size_id. "Ikke målt" er det
  // som blir igjen av det biblioteket faktisk har (alleStoerr, allerede kjent og gratis) etter
  // at begge telte gruppene er trukket fra, og dekker både "aldri forsøkt" og "forsøkt og
  // feilet" — begge betyr "vet ikke om det passer". Brukes til parseknappens tall (den sender
  // faktisk størrelser til /api/broderi-motiv/parse, én om gangen), ikke til toppteksten.
  const antallStorrelserIkkeMalt = globalCounts
    ? Math.max(0, alleStoerr.length - globalCounts.passer - globalCounts.passerIkke)
    : 0

  // Per-kategori data for forsiderutene: antall VMs, antall som passer, thumbnails.
  // Thumbnails er ALLTID ekte forsidebilder når de finnes — bundlenes egne (samme bilde som
  // biblioteket viser, hentet med getBundleCoverImage) for bundlede motiver, deretter løse
  // motivers egne forsidebilder (vm.coverImage, IKKE miniatyr_svg) for de som ikke er i noen
  // bundle. miniatyr_svg (den forenklede stingopptegningen) er kun en siste utvei, brukt bare
  // hvis en kategori ikke har ETT ENKELT ekte bilde å vise — se punkt 2 i samme runde for at
  // selve opptegningen også er forbedret der den faktisk brukes.
  // Samme regel og samme grunn brukes nå bevisst i MotivKort (motivlisten inni en
  // kategori): begge er stedet der brukeren KJENNER IGJEN og VELGER et motiv blant mange,
  // ikke der stingdetaljer skal bekreftes — det gjør lerretet, etter plassering.
  const kategoriData = useMemo(() => {
    // Build map: kat (null = "Uten kategori") → VirtuelMotiv[]
    const katToVms = new Map<string | null, VirtuelMotiv[]>()
    const katToBundleIds = new Map<string | null, Set<string>>()
    for (const vm of virtuelleMotiver) {
      const kats = vm.kats.length > 0 ? vm.kats : [null]
      for (const kat of kats) {
        const arr = katToVms.get(kat) ?? []
        arr.push(vm)
        katToVms.set(kat, arr)
        if (vm.bundleId) {
          const set = katToBundleIds.get(kat) ?? new Set<string>()
          set.add(vm.bundleId)
          katToBundleIds.set(kat, set)
        }
      }
    }
    // Build sorted list of categories (known ones first in KATEGORIER order, then "Uten kategori")
    const alleKats: Array<string | null> = []
    for (const k of ['Frukt','Bær','Dyr','Blomster','Natur','Rosemaling','Høytider','Rammer','Figurer','Bunad','Baby','Bokstaver','Monogram','Annet','font']) {
      if (katToVms.has(k)) alleKats.push(k)
    }
    // Any category not in KATEGORIER (user-added categories etc.)
    for (const k of katToVms.keys()) {
      if (k !== null && !alleKats.includes(k)) alleKats.push(k)
    }
    // "Uten kategori" last
    if (katToVms.has(null)) alleKats.push(null)

    return alleKats.map(kat => {
      const vms = katToVms.get(kat) ?? []
      let passerCount = 0
      for (const vm of vms) {
        if (vmStatus(vm, bboxCache) === 'passer') passerCount++
      }

      const thumbnails: string[] = []
      for (const bundleId of katToBundleIds.get(kat) ?? []) {
        if (thumbnails.length >= 4) break
        const cover = bundlerMap.get(bundleId) ? getBundleCoverImage(bundlerMap.get(bundleId)!.data) : null
        if (cover) thumbnails.push(cover)
      }
      if (thumbnails.length < 4) {
        for (const vm of vms) {
          if (thumbnails.length >= 4) break
          if (vm.bundleId) continue // dekket av bundelens eget forsidebilde over
          if (vm.coverImage) thumbnails.push(vm.coverImage)
        }
      }
      if (thumbnails.length === 0) {
        // Ingen ekte forsidebilde funnet noe sted i kategorien — siste utvei, per motiv.
        for (const vm of vms) {
          if (thumbnails.length >= 4) break
          const svg = vm.sizes
            .map(sz => bboxCache.get(`${sz.embroideryId}:${sz.sizeId}`)?.miniatyrSvg)
            .find(x => !!x)
          if (svg) thumbnails.push(svg)
        }
      }

      return { kat, total: vms.length, passerCount, thumbnails }
    })
  }, [virtuelleMotiver, bboxCache, bundlerMap])

  const alleBundleIds = useMemo(() => {
    const ids = new Set<string>()
    for (const m of biblioteket) {
      if (m.data.bundleId && bundlerMap.has(m.data.bundleId)) ids.add(m.data.bundleId)
    }
    return Array.from(ids)
  }, [biblioteket, bundlerMap])

  function navnForValgtStorrelse(vm: VirtuelMotiv, s: VirtuelStorrelse): string {
    const displaySize = vmSizeLabel(s)
    const bundleNavn = vm.bundleId ? bundlerMap.get(vm.bundleId)?.data.navn : null
    return vm.karakter
      ? `${vm.karakter.tegn}${bundleNavn ? ' (' + bundleNavn + ')' : ''} – ${displaySize}`
      : `${vm.navn} – ${displaySize}`
  }

  function velgStorrelse(vm: VirtuelMotiv, s: VirtuelStorrelse) {
    onVelg(s.embroideryId, s.sizeId, navnForValgtStorrelse(vm, s))
  }

  function velgVM(vm: VirtuelMotiv, prevView: PickerView) {
    const passende = vm.sizes.filter(s => {
      const b = bboxCache.get(`${s.embroideryId}:${s.sizeId}`)
      return b !== undefined && b !== null && b.widthMm < RAMME_GRENSE_MM && b.heightMm < RAMME_GRENSE_MM
    })
    if (passende.length === 1) { velgStorrelse(vm, passende[0]); return }
    setView({ type: 'storrelse', vm, prevView })
  }

  // ── Flervalg ─────────────────────────────────────────────────────────────────
  // Nedskopet til vanlige bundle-/enkeltmotiv-lister (bundle-innhold og toppnivå-lista) — ikke
  // alfabetgrid ('tegn') eller tekstverktøyet ('tekst'), som allerede har egne, helt andre måter
  // å velge på. Innenfor det skopet virker flervalg IDENTISK uansett hvordan bundlen er bygget
  // opp (Spiderverse/Mini Flowers, se punkt 3-undersøkelsen) — det opererer bare på hvilken liste
  // med VirtuelMotiv-er som allerede vises, uavhengig av hvorfor akkurat de radene ble slik.
  const [valgteVM, setValgteVM] = useState<Set<string>>(new Set())

  // Nullstiller valget når view endres — justert UNDER selve rendringen med en state-variabel
  // (React sin egen anbefalte måte å nullstille state ved en endring), ikke i en useEffect
  // (en ekstra rendrings-runde for noe som skjer på hver navigasjon) og ikke via en ref (som
  // ikke skal leses/skrives under selve rendringen).
  const [forrigeView, setForrigeView] = useState(view)
  if (forrigeView !== view) {
    setForrigeView(view)
    if (valgteVM.size > 0) setValgteVM(new Set())
  }

  function toggleValgt(key: string) {
    setValgteVM(prev => {
      const nytt = new Set(prev)
      if (nytt.has(key)) nytt.delete(key); else nytt.add(key)
      return nytt
    })
  }

  function leggTilValgte() {
    const utvalg = Array.from(valgteVM)
      .map(key => virtuelleMotiver.find(vm => vm.key === key))
      .filter((vm): vm is VirtuelMotiv => !!vm)
    if (utvalg.length === 0) return

    const valg = utvalg
      .map(vm => ({ vm, s: velgStandardStorrelse(vm, bboxCache) }))
      .filter((x): x is { vm: VirtuelMotiv; s: VirtuelStorrelse } => x.s !== undefined)
    if (valg.length === 0) return

    const størsteDimMm = Math.max(
      30,
      ...valg.map(({ s }) => {
        const b = bboxCache.get(`${s.embroideryId}:${s.sizeId}`)
        return b ? Math.max(b.widthMm, b.heightMm) : 0
      }),
    )
    const { celleMm, umulig } = beregnRutenettCelle(valg.length, størsteDimMm)
    const celleTiendedelMm = Math.round(celleMm * 10)
    const posisjoner = beregnRutenettPosisjoner(valg.length, celleTiendedelMm)

    onVelgFlere(valg.map(({ vm, s }, i) => ({
      embroideryId: s.embroideryId,
      sizeId: s.sizeId,
      navn: navnForValgtStorrelse(vm, s),
      x: posisjoner[i].x,
      y: posisjoner[i].y,
    })), umulig)
    setValgteVM(new Set())
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
              miniatyrSvg: (body.miniatyr_svg as string | null | undefined) ?? null,
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
    setParseFremgang(null)
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

  function filtrerForKategori(kat: string | null) {
    // Bundles in this category: any of the bundle's VMs has this kat (or null → no kat)
    const katBundleIds = alleBundleIds.filter(bid => {
      const vms = bundleVMs.get(bid) ?? []
      return vms.some(vm => kat === null ? vm.kats.length === 0 : vm.kats.includes(kat))
    })
    // Standalone VMs in this category
    const katStandalones = standaloneVMs.filter(vm =>
      kat === null ? vm.kats.length === 0 : vm.kats.includes(kat)
    )
    // Apply search filter
    const søktBundles = katBundleIds.filter(bid => bundleMatcherSok(bid))
    const søktStandalones = katStandalones.filter(vm =>
      !searchQ || vm.navn.toLowerCase().includes(searchQ)
    )
    // Apply frame filter
    if (!filterPaaRamme) return {
      passerListe: søktBundles, ikkeMåltListe: [] as string[],
      passerVMs: søktStandalones, ikkeMåltVMs: [] as VirtuelMotiv[],
      antallSkjult: 0,
    }
    const pb: string[] = [], imb: string[] = []
    for (const bid of søktBundles) {
      const s = bundleStat(bid)
      if (s === 'passer') pb.push(bid)
      else if (s === 'ikkeMalt') imb.push(bid)
    }
    const pv: VirtuelMotiv[] = [], imv: VirtuelMotiv[] = []
    let sk = 0
    for (const vm of søktStandalones) {
      const s = vmStatus(vm, bboxCache)
      if (s === 'passer') pv.push(vm)
      else if (s === 'ikkeMalt') imv.push(vm)
      else sk++
    }
    return { passerListe: pb, ikkeMåltListe: imb, passerVMs: pv, ikkeMåltVMs: imv, antallSkjult: sk }
  }

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

  // Ruta behandler maks 300 rader per kall (unngår tidsavbrudd på en serverløs funksjon som
  // regenererer ~3000 rader). Kaller den derfor på nytt til `ferdig`, med `sisteId` som en
  // stabil kursor (IKKE offset — se kommentaren i selve ruta for hvorfor offset mot et
  // filter som krymper for hver skriving hopper over rader).
  async function kjorMiniatyrJobb(tving: boolean) {
    setProgress(tving ? 'Fornyer alle miniatyrer…' : 'Genererer miniatyrer…')
    let totalOppdatert = 0
    let sisteId: string | undefined
    try {
      while (true) {
        const res = await fetch('/api/broderi-motiv/generer-miniatyrer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tving, etterId: sisteId }),
        })
        const body = await res.json()
        if (!res.ok) { setProgress(`Feil: ${body.error}`); return }
        totalOppdatert += body.oppdatert
        sisteId = body.sisteId
        setProgress(tving
          ? `Fornyer alle miniatyrer… ${totalOppdatert} gjort så langt`
          : `Genererer miniatyrer… ${totalOppdatert} gjort så langt`)
        if (body.ferdig) break
      }
      setProgress(`${totalOppdatert} miniatyrer ${tving ? 'fornyet' : 'generert'}`)
      setLasterVersjon(v => v + 1) // hent bboxCache på nytt så de nye miniatyrene vises
    } catch (err) {
      setProgress(`Feil: ${err instanceof Error ? err.message : 'Ukjent feil'}`)
    }
  }

  function ParseBunnlinje() {
    const antallUtenMiniatyr = cacheLastet
      ? Array.from(bboxCache.values()).filter(b => b !== null && b.miniatyrSvg === null).length
      : 0
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
        {progress && (
          <p className="text-xs text-stone-500 mb-2">{progress}</p>
        )}
        <div className="flex gap-2">
          {parserAlle ? (
            <button onClick={() => { avbrytRef.current = true; setParserAlle(false); setParseFremgang(null) }}
              className="flex-1 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:border-red-400 transition-colors">
              Avbryt parsing
            </button>
          ) : cacheLastet && antallStorrelserIkkeMalt > 0 ? (
            // Knappen sender faktisk STØRRELSER til /api/broderi-motiv/parse (én embroidery_id+
            // size_id om gangen), så tallet skal være antall størrelser, ikke motiver — samme
            // telle-baserte tall som parse-køen (ikkeForsokt) bygges fra, ikke en halvlastet
            // cache. Vises aldri før tallene er kjent (cacheLastet), og forsvinner helt når
            // ingen umålte størrelser er igjen, i stedet for å vise "Parse 0".
            <button onClick={parseAlle}
              className="flex-1 py-2 text-xs text-stone-500 border border-stone-200 rounded-lg hover:border-stone-400 transition-colors">
              {`Parse ${antallStorrelserIkkeMalt} ${antallStorrelserIkkeMalt === 1 ? 'størrelse' : 'størrelser'}`}
            </button>
          ) : null}
          {cacheLastet && antallUtenMiniatyr > 0 && (
            <button onClick={() => kjorMiniatyrJobb(false)}
              className="flex-1 py-2 text-xs text-stone-500 border border-stone-200 rounded-lg hover:border-stone-400 transition-colors">
              Generer miniatyrer
            </button>
          )}
          <button onClick={onClose} className="flex-1 py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
            Avbryt
          </button>
        </div>
        {cacheLastet && (
          // Eksisterende miniatyrer (fra før strektykkelse/punktbudsjett ble forbedret) blir
          // ikke rørt av knappen over — den fyller bare HULL. Denne kjører alle på nytt med
          // den forbedrede tegningen, uavhengig av om de allerede har en (dårligere) miniatyr.
          <button onClick={() => kjorMiniatyrJobb(true)}
            className="w-full mt-1.5 py-1 text-[11px] text-stone-400 hover:text-stone-600 transition-colors">
            Forny alle miniatyrer (bedre kvalitet på eksisterende)
          </button>
        )}
      </div>
    )
  }

  function BundleKort({ bundleId, fraKat }: { bundleId: string; fraKat?: string | null }) {
    const bundle = bundlerMap.get(bundleId)!
    const cover = getBundleCoverImage(bundle.data)
    const vms = bundleVMs.get(bundleId) ?? []
    const erFont = getKats(bundle.data).some(k => k.toLowerCase() === 'font')
    const erAlf = !erFont && alfabetBundles.has(bundleId)
    const antallPasser = vms.filter(vm => vmStatus(vm, bboxCache) === 'passer').length
    const stat = bundleStat(bundleId)
    function handleClick() {
      if (erFont) setView({ type: 'tekst', bundleId, fraKat })
      else if (erAlf) setView({ type: 'tegn', bundleId, fraKat })
      else setView({ type: 'bundle-innhold', bundleId, fraKat })
    }
    return (
      <article onClick={handleClick}
        className="rounded-xl border border-stone-200 bg-white shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden">
        <div className="relative aspect-[5/4] bg-stone-50 overflow-hidden">
          {cover
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={cover} alt={bundle.data.navn} className="w-full h-full object-contain" />
            : <div className="w-full h-full flex items-center justify-center">
                <svg className="w-10 h-10 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
          }
          {erFont && (
            <div className="absolute inset-0 flex items-center justify-center bg-stone-800/60">
              <span className="text-white font-serif font-bold text-2xl">T</span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 py-2.5">
            <p className="text-sm font-serif font-semibold text-white truncate">{bundle.data.navn || <span className="italic font-light opacity-70">Uten navn</span>}</p>
            <p className="text-xs text-white/70">{erFont || erAlf ? `${vms.length} tegn` : `${vms.length} motiver`}</p>
          </div>
        </div>
        <div className="px-3 py-1.5">
          <span className={`text-xs ${stat === 'passer' ? 'text-stone-500' : stat === 'ikkeMalt' ? 'text-amber-600' : 'text-red-400'}`}>
            {erFont ? 'Font' : stat === 'passer' ? `${antallPasser}/${vms.length} passer` : stat === 'ikkeMalt' ? 'Ikke målt' : 'For stor'}
          </span>
        </div>
      </article>
    )
  }

  // Klikkflaten er delt i to: bildet/navnet åpner størrelsesvisningen (onVelgVM, altså
  // velgVM — «passer nøyaktig én, velg den direkte, ellers vis størrelsene»), mens
  // avkryssingsmerket er flervalg (onToggle). Merket er ALLTID synlig nå (ikke bare når
  // valgt), som en ekte avkryssingsboks, og stopper propagering så et trykk der ikke også
  // åpner størrelsesvisningen.
  function MotivKort({ vm, valgt, onToggle, onVelgVM }: {
    vm: VirtuelMotiv; valgt: boolean; onToggle: () => void; onVelgVM: () => void
  }) {
    const maal = vmMaalTekst(vm, bboxCache)
    const forsteMiniatyr = vm.sizes
      .map(s => bboxCache.get(`${s.embroideryId}:${s.sizeId}`)?.miniatyrSvg)
      .find(svg => !!svg) ?? null
    const stat = vmStatus(vm, bboxCache)
    return (
      <article
        className={`rounded-xl border shadow-sm overflow-hidden transition-all ${
          valgt ? 'border-stone-700 ring-2 ring-stone-700/20 bg-stone-50' : 'border-stone-200 bg-white hover:shadow-md'
        }`}>
        <div onClick={onVelgVM} className="relative aspect-[5/4] bg-stone-50 overflow-hidden cursor-pointer">
          {/* Ekte forsidebilde FØR miniatyr_svg — samme regel og samme grunn som
             kategoriflisene (kategoriData over): dette kortet er for å KJENNE IGJEN og
             VELGE et motiv blant mange, ikke for å bekrefte stingdetaljer. Et ekte foto av
             det ferdigsydde motivet er lettere å gjenkjenne enn en skjematisk
             stingopptegning. Den nøyaktige geometrien vises uansett senere, når motivet er
             plassert på selve lerretet (PlassertMotivGruppe tegner de faktiske
             stingbanene der). miniatyr_svg er bare en siste utvei når ingen ekte bilde
             finnes (f.eks. før miniatyrer er generert, eller et løst motiv uten cover). */}
          {vm.coverImage
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={vm.coverImage} alt={vm.navn} className="w-full h-full object-contain" />
            : forsteMiniatyr
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`data:image/svg+xml;utf8,${encodeURIComponent(forsteMiniatyr)}`} alt={vm.navn} className="w-full h-full object-contain p-1" />
              : <div className="w-full h-full flex items-center justify-center text-stone-200">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                  </svg>
                </div>
          }
          <button
            onClick={e => { e.stopPropagation(); onToggle() }}
            aria-label={valgt ? 'Fjern fra flervalg' : 'Velg for flervalg'}
            aria-pressed={valgt}
            className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${
              valgt ? 'bg-stone-800 border-white' : 'bg-white/90 border-stone-300 hover:border-stone-500'
            }`}
          >
            {valgt && (
              <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </div>
        <div onClick={onVelgVM} className="px-2.5 py-2 cursor-pointer">
          <p className="text-sm text-stone-800 truncate leading-tight">{vm.navn}</p>
          <p className={`text-xs truncate mt-0.5 ${stat === 'passer' ? 'text-stone-400' : stat === 'ikkeMalt' ? 'text-amber-600' : 'text-red-400'}`}>
            {vm.sizes.length === 1 ? (maal ?? 'Ikke målt') : `${vm.sizes.length} størrelser${maal ? ` · ${maal}` : ''}`}
          </p>
        </div>
      </article>
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
          const sorterteSizes = [...vm.sizes].sort((a, b) => {
            const aCache = bboxCache.get(`${a.embroideryId}:${a.sizeId}`)
            const bCache = bboxCache.get(`${b.embroideryId}:${b.sizeId}`)
            if (aCache && bCache) return (aCache.widthMm * aCache.heightMm) - (bCache.widthMm * bCache.heightMm)
            if (aCache) return -1
            if (bCache) return 1
            return 0
          })
          // Variant-deteksjon: vis "Del opp"-knapp bare når alle størrelser er fra SAMME embroidery-rad
          // og har merkbart ulike sideforhold.
          const harEnBareEmbroideryId = new Set(vm.sizes.map(s => s.embroideryId)).size === 1
          const avMaalForSplit = vm.sizes.map(s => bboxCache.get(`${s.embroideryId}:${s.sizeId}`)).filter((b): b is BboxMm => b != null)
          const visDelOppKnapp = (() => {
            if (!harEnBareEmbroideryId || avMaalForSplit.length < 2) return false
            const ratios = avMaalForSplit.map(b => b.widthMm / b.heightMm)
            const avg = ratios.reduce((a, b) => a + b) / ratios.length
            const variasjon = (Math.max(...ratios) - Math.min(...ratios)) / avg
            return variasjon > 0.03
          })()
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
                  {sorterteSizes.map((s, i) => {
                    const b = bboxCache.get(`${s.embroideryId}:${s.sizeId}`)
                    const overGrense = b !== undefined && b !== null
                      && (b.widthMm >= RAMME_GRENSE_MM || b.heightMm >= RAMME_GRENSE_MM)
                    const dims = b !== undefined && b !== null
                      ? `${b.widthMm.toFixed(1)} × ${b.heightMm.toFixed(1)} mm`
                      : 'Ikke målt'
                    const miniatyrSvg = b?.miniatyrSvg ?? null
                    return (
                      <button key={i} onClick={() => velgStorrelse(vm, s)}
                        className="flex flex-col items-start px-3 py-2 rounded-lg border border-stone-200 text-left hover:border-stone-400 transition-colors">
                        {miniatyrSvg && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`data:image/svg+xml;utf8,${encodeURIComponent(miniatyrSvg)}`}
                            alt=""
                            className="w-8 h-8 mb-1 object-contain"
                          />
                        )}
                        <span className="text-sm text-stone-700">{vmSizeLabel(s)}</span>
                        <span className={`text-xs ${overGrense ? 'text-red-500' : b !== undefined && b !== null ? 'text-stone-500' : 'text-stone-300 italic'}`}>
                          {dims}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {visDelOppKnapp && (
                  <button
                    onClick={async () => {
                      if (!confirm(`Del "${vm.navn}" i ${vm.sizes.length} separate motiver?`)) return
                      const embroideryId = vm.sizes[0].embroideryId
                      const sizeIds = vm.sizes.map(s => s.sizeId)
                      const res = await fetch('/api/embroidery/del-opp', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ embroideryId, sizeIds }),
                      })
                      if (res.ok) {
                        window.location.reload()
                      } else {
                        const body = await res.json()
                        alert(`Feil: ${body.error}`)
                      }
                    }}
                    className="mt-2 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs hover:bg-amber-100 transition-colors"
                  >
                    ⚠ Del opp i {vm.sizes.length} separate motiver
                  </button>
                )}
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
                onTilbake={() => setView(view.fraKat !== undefined ? { type: 'kategori', kat: view.fraKat } : { type: 'kategorier' })} />
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
                onTilbake={() => setView(view.fraKat !== undefined ? { type: 'kategori', kat: view.fraKat } : { type: 'kategorier' })} />
              <div className="overflow-y-auto flex-1 min-h-0 p-3">
                {filtered.length === 0 ? (
                  <p className="text-sm text-stone-400 text-center py-12">Ingen motiver.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {passerListe.map(vm => (
                        <MotivKort key={vm.key} vm={vm}
                          valgt={valgteVM.has(vm.key)} onToggle={() => toggleValgt(vm.key)}
                          onVelgVM={() => velgVM(vm, view)} />
                      ))}
                    </div>
                    {ikkeMåltListe.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mt-4 mb-2">Ikke målt ennå</p>
                        <div className="grid grid-cols-2 gap-3">
                          {ikkeMåltListe.map(vm => (
                            <MotivKort key={vm.key} vm={vm}
                              valgt={valgteVM.has(vm.key)} onToggle={() => toggleValgt(vm.key)}
                              onVelgVM={() => velgVM(vm, view)} />
                          ))}
                        </div>
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
              <ValgtBunnlinje antall={valgteVM.size}
                onFjernValg={() => setValgteVM(new Set())} onLeggTilValgte={leggTilValgte} />
              <ParseBunnlinje />
            </>
          )
        })()}

        {view.type === 'tekst' && (() => {
          const vms = bundleVMs.get(view.bundleId) ?? []
          const bundleNavn = bundlerMap.get(view.bundleId)?.data.navn ?? ''
          const fraKat = view.fraKat
          return (
            <TextVerktoy
              bundleNavn={bundleNavn}
              vms={vms}
              biblioteket={biblioteket}
              onLeggTil={items => onVelgFlere(items)}
              onBack={() => setView(fraKat !== undefined ? { type: 'kategori', kat: fraKat } : { type: 'kategorier' })}
            />
          )
        })()}

        {(view.type === 'kategorier' || view.type === 'kategori') && (
          <>
            <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
              <div className="flex items-center gap-2 mb-3">
                {view.type === 'kategori' && (
                  <button
                    onClick={() => setView({ type: 'kategorier' })}
                    className="p-1 -ml-1 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors flex-shrink-0"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <h3 className="font-serif text-xl text-stone-800 truncate flex-1">
                  {view.type === 'kategorier' ? 'Velg motiv' : (view.kat ?? 'Uten kategori')}
                </h3>
              </div>
              <div className="relative mb-2">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                  autoFocus={view.type === 'kategorier'}
                  placeholder="Søk i hele biblioteket…"
                  className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={filterPaaRamme}
                  onChange={e => setFilterPaaRamme(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#C9A57A]" />
                <span className="text-sm text-stone-600">Bare motiver som passer (&lt;{RAMME_GRENSE_MM} mm)</span>
              </label>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0">
              {cacheLastet && manglerMiniatyrKolonne && !lasterFeil && (
                <div className="mx-3 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  Miniatyrbilder mangler — kjør{' '}
                  <code className="font-mono bg-amber-100 px-1 rounded">008_broderi_motiv_miniatyr.sql</code>{' '}
                  i Supabase SQL editor.
                </div>
              )}
              {lasterFeil ? (
                <div className="p-5 text-center">
                  <p className="text-sm text-red-600 mb-3">{lasterFeil}</p>
                  <button
                    onClick={() => { setLasterFeil(null); setCacheLastet(false); setLasterVersjon(v => v + 1) }}
                    className="px-4 py-2 text-sm border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors"
                  >
                    Prøv på nytt
                  </button>
                </div>
              ) : !cacheLastet ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin" />
                </div>
              ) : searchQ ? (
                // Global search results — flat list with bundle name visible
                (() => {
                  const allBundles = alleBundleIds.filter(bundleMatcherSok)
                  const allStandalones = standaloneVMs.filter(vm => vm.navn.toLowerCase().includes(searchQ))
                  const { passerListe: bPasser, ikkeMåltListe: bIkkeMalt, antallSkjult } = (() => {
                    if (!filterPaaRamme) return { passerListe: allBundles, ikkeMåltListe: [] as string[], antallSkjult: 0 }
                    const p: string[] = [], im: string[] = []
                    let sk = 0
                    for (const bid of allBundles) {
                      const s = bundleStat(bid)
                      if (s === 'passer') p.push(bid)
                      else if (s === 'ikkeMalt') im.push(bid)
                      else sk++
                    }
                    return { passerListe: p, ikkeMåltListe: im, antallSkjult: sk }
                  })()
                  const { passerListe: vPasser, ikkeMåltListe: vIkkeMalt } = (() => {
                    if (!filterPaaRamme) return { passerListe: allStandalones, ikkeMåltListe: [] as VirtuelMotiv[] }
                    const p: VirtuelMotiv[] = [], im: VirtuelMotiv[] = []
                    for (const vm of allStandalones) {
                      const s = vmStatus(vm, bboxCache)
                      if (s === 'passer') p.push(vm)
                      else if (s === 'ikkeMalt') im.push(vm)
                    }
                    return { passerListe: p, ikkeMåltListe: im }
                  })()
                  if (bPasser.length === 0 && bIkkeMalt.length === 0 && vPasser.length === 0 && vIkkeMalt.length === 0) {
                    return <p className="text-sm text-stone-400 text-center py-12">Ingen treff.</p>
                  }
                  return (
                    <div className="p-3 space-y-3">
                      {bPasser.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                          {bPasser.map(bid => <BundleKort key={bid} bundleId={bid} />)}
                        </div>
                      )}
                      {vPasser.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                          {vPasser.map(vm => (
                            <MotivKort key={vm.key} vm={vm}
                              valgt={valgteVM.has(vm.key)} onToggle={() => toggleValgt(vm.key)}
                              onVelgVM={() => velgVM(vm, view)} />
                          ))}
                        </div>
                      )}
                      {(bIkkeMalt.length > 0 || vIkkeMalt.length > 0) && (
                        <>
                          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide pt-1">Ikke målt ennå</p>
                          <div className="grid grid-cols-2 gap-3">
                            {bIkkeMalt.map(bid => <BundleKort key={bid} bundleId={bid} />)}
                            {vIkkeMalt.map(vm => (
                              <MotivKort key={vm.key} vm={vm}
                                valgt={valgteVM.has(vm.key)} onToggle={() => toggleValgt(vm.key)}
                                onVelgVM={() => velgVM(vm, view)} />
                            ))}
                          </div>
                        </>
                      )}
                      {filterPaaRamme && antallSkjult > 0 && (
                        <p className="text-xs text-stone-400 text-center py-3">
                          {antallSkjult} {antallSkjult === 1 ? 'bundle/motiv' : 'bundles/motiver'} skjult — alle størrelser bekreftet for store
                        </p>
                      )}
                    </div>
                  )
                })()
              ) : view.type === 'kategorier' ? (
                // Level 1: category grid
                <div className="p-4 grid grid-cols-2 gap-3">
                  {kategoriData.map(({ kat, total, passerCount, thumbnails }) => {
                    const visningsNavn = kat ?? 'Uten kategori'
                    const tom = filterPaaRamme && passerCount === 0
                    return (
                      <button
                        key={kat ?? '__ingen__'}
                        onClick={() => { setSearch(''); setView({ type: 'kategori', kat }) }}
                        className={`flex flex-col rounded-2xl border p-3 text-left transition-colors ${
                          tom
                            ? 'border-stone-100 bg-stone-50 opacity-60'
                            : 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm'
                        }`}
                      >
                        <div className="grid grid-cols-2 gap-0.5 mb-2 rounded-lg overflow-hidden bg-stone-100 aspect-square w-full">
                          {thumbnails.length === 0 ? (
                            <div className="col-span-2 row-span-2 flex items-center justify-center text-stone-300 text-xs">
                              Ingen
                            </div>
                          ) : (
                            <>
                              {thumbnails.slice(0, 4).map((thumb, i) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={i}
                                  src={thumb.startsWith('<svg') ? `data:image/svg+xml;utf8,${encodeURIComponent(thumb)}` : thumb}
                                  alt=""
                                  className="w-full h-full object-contain p-0.5 bg-white"
                                />
                              ))}
                              {Array.from({ length: Math.max(0, 4 - thumbnails.length) }).map((_, i) => (
                                <div key={`fill-${i}`} className="bg-stone-50" />
                              ))}
                            </>
                          )}
                        </div>
                        <p className="text-sm font-medium text-stone-800 truncate">{visningsNavn}</p>
                        <p className={`text-xs ${tom ? 'text-stone-400' : 'text-stone-500'}`}>
                          {filterPaaRamme ? `${passerCount} passer` : `${total} motiver`}
                        </p>
                      </button>
                    )
                  })}
                </div>
              ) : (
                // Level 2: inside a category
                (() => {
                  const currentView = view
                  if (currentView.type !== 'kategori') return null
                  const { passerListe, ikkeMåltListe, passerVMs, ikkeMåltVMs, antallSkjult } = filtrerForKategori(currentView.kat)
                  if (passerListe.length === 0 && ikkeMåltListe.length === 0 && passerVMs.length === 0 && ikkeMåltVMs.length === 0) {
                    return <p className="text-sm text-stone-400 text-center py-12">Ingen motiver i denne kategorien.</p>
                  }
                  return (
                    <div className="p-3 space-y-3">
                      {passerListe.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                          {passerListe.map(bid => <BundleKort key={bid} bundleId={bid} fraKat={currentView.kat} />)}
                        </div>
                      )}
                      {passerVMs.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                          {passerVMs.map(vm => (
                            <MotivKort key={vm.key} vm={vm}
                              valgt={valgteVM.has(vm.key)} onToggle={() => toggleValgt(vm.key)}
                              onVelgVM={() => velgVM(vm, currentView)} />
                          ))}
                        </div>
                      )}
                      {(ikkeMåltListe.length > 0 || ikkeMåltVMs.length > 0) && (
                        <>
                          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide pt-1">Ikke målt ennå</p>
                          {ikkeMåltListe.length > 0 && (
                            <div className="grid grid-cols-2 gap-3">
                              {ikkeMåltListe.map(bid => <BundleKort key={bid} bundleId={bid} fraKat={currentView.kat} />)}
                            </div>
                          )}
                          {ikkeMåltVMs.length > 0 && (
                            <div className="grid grid-cols-2 gap-3">
                              {ikkeMåltVMs.map(vm => (
                                <MotivKort key={vm.key} vm={vm}
                                  valgt={valgteVM.has(vm.key)} onToggle={() => toggleValgt(vm.key)}
                                  onVelgVM={() => velgVM(vm, currentView)} />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      {filterPaaRamme && antallSkjult > 0 && (
                        <p className="text-xs text-stone-400 text-center py-3">
                          {antallSkjult} motiv{antallSkjult === 1 ? '' : 'er'} skjult — alle størrelser bekreftet for store
                        </p>
                      )}
                    </div>
                  )
                })()
              )}
            </div>

            <ValgtBunnlinje antall={valgteVM.size}
              onFjernValg={() => setValgteVM(new Set())} onLeggTilValgte={leggTilValgte} />
            <ParseBunnlinje />
          </>
        )}
      </div>
    </div>
  )
}
