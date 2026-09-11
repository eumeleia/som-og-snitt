'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { hentAllePaginert } from '@/lib/supabasePaginering'
import { describeError, type ErrorDetails } from '@/lib/error-details'
import { ErrorDetailsView } from '@/components/ErrorDetailsView'
import { roterLokalePunkter, plassertBbox, kombinerBbox, lagRotasjon } from './geometri'
import { synkroniserSekvens, byggFargePerBlokk, tellSting, tellOmtredninger, type SekvensKontekst } from './sekvens'
import { ryddOppEnkeltmedlemsgrupper, utvidTilGrupper, nyttUtvalgVedKlikk } from './grupper'
import { byggMiniatyrSvg } from './miniatyr'
import { erEndret, serialiserSnapshot, type KomposisjonSnapshot } from './lagreSnapshot'
import { hentMineTrader, byggPecTilEkteMap, type MinTrad } from './minTraadpalett'
import { SekvensPanel } from './SekvensPanel'
import { EksportPanel } from './EksportPanel'
import { StingSimulator } from './StingSimulator'
import {
  type Embroidery, type BroderiMotivData, type BroderiBbox,
  type BroderiKomposisjon, type PlassertMotiv, type SekvensElement, type SekvensKjoring, type EmbroideryBundle,
  type EmbroideryBundleData, type VirtuelMotiv, type VirtuelStorrelse, type FontMetrikk,
  getBundleCoverImage, getKats,
} from './types'
import {
  buildFontData, layoutTekst, klassifiser, malSporingFraPosisjoner, omplasserTekstgruppe,
  trekkFraFellesForskyvning, type FontData, type TextLayout,
} from './fontUtils'
import {
  RAMME_MM, RAMME_GRENSE_MM, type BboxMm,
  velgStandardStorrelse, byggVirtuelleMotiver, beregnRutenettPosisjoner, beregnRutenettCelle,
} from './motivvalg'

const RAMME_HALV_TIENDEDEL_MM = (RAMME_MM / 2) * 10 // 500 — ±50 mm sentrert på origo

// Rutenettet på lerretet (rene visningskonstanter, se rendring av <g> rutenett i
// hovedkomponenten). Linjer ved hver 10 mm INNENFOR rammen (kantene selv tegnes allerede
// av rammens rect); tall ved hver 10 mm LANGS kantene, 0–100 fra øvre venstre hjørne.
const RUTENETT_LINJER = Array.from({ length: RAMME_MM / 10 - 1 }, (_, i) => (i + 1) * 10 - RAMME_MM / 2)
const RUTENETT_TALL = Array.from({ length: RAMME_MM / 10 + 1 }, (_, i) => i * 10)

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function motivKey(embroideryId: string, sizeId: string): string {
  return `${embroideryId}:${sizeId}`
}

// Reserveverdi bare for mellomrom-glidernes område/andel-omregning når ikke ETT tegn i
// bundlen har en resolved bbox å måle x-høyde fra (bør aldri treffe i praksis — tekstGrupper
// under krever selv resolved bbox på minst to tegn for at en gruppe skal vises).
const XHEIGHT_FALLBACK_MM = 1.6

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

// Styrer AUTOlagring (navnefeltets onBlur, tilbakeknappen, avmontering, beforeunload) —
// aldri den direkte "Lagre"/"Lagre som komposisjon"-knappen, som alltid går rett til
// lagre() uansett disse to reglene:
//  - En helt ny, tom komposisjon skal aldri opprettes av seg selv (id null + ingen motiver).
//  - Et enkeltmotiv åpnet fra biblioteket (startMotiv) skal aldri bli en lagret komposisjon
//    av seg selv — bare et eksplisitt knappetrykk skal kunne opprette den raden.
function skalAutolagre(snap: { id: string | null; antallMotiver: number; startMotivSatt: boolean }): boolean {
  if (snap.id === null && snap.antallMotiver === 0) return false
  if (snap.startMotivSatt && snap.id === null) return false
  return true
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// Steg A-målingene (docs/fontmaling-2026-08-13.md, bredde-profil terskel 0,3) — vist som
// et KLIKKBART FORSLAG i "Lagre grunnlinje"-panelet, aldri forhåndsutfylt (se "Beslutning
// etter steg A" i docs/plan-og-prompter-2026-08-13.md: den samme automatikken forkastet
// som STANDARD, men tallene er fortsatt et nyttig utgangspunkt å dra mot med øyet). Nøkkel
// er bundle-navnet slik det står i basen; bare de to fontene og tegnene som faktisk ble
// målt der.
const STEG_A_MALT_HALE_MM: Record<string, Record<string, number>> = {
  'SERAPHINE SATIN FONT': {
    H: 3.0, O: 1.5, A: 2.5, o: 0.5, c: 0.0, e: 0.0, x: 2.0, z: 0.5, l: 0.5, '1': 19.5,
    i: 0.5, g: 0.5, p: 20.5, y: 0.5, q: 2.5, j: 0.5, f: 0.5, Q: 1.5, J: 1.5, ',': 0.5,
  },
  'BX FLORAL ALPHABET PINK': {
    H: 0.0, O: 1.5, A: 0.0, o: 1.0, c: 0.5, e: 0.5, x: 0.0, z: 0.5, l: 0.0, '1': 0.0,
    i: 0.0, g: 0.5, p: 0.0, y: 1.5, q: 0.0, j: 0.5, f: 0.5, Q: 1.0, J: 0.0,
  },
}

export function KomposisjonEditor({ komposisjon, biblioteket, onBack, startMotiv }: {
  komposisjon: BroderiKomposisjon | null
  biblioteket: Embroidery[]
  onBack: () => void
  // Ett motiv som skal ligge ferdig plassert i en NY komposisjon fra første rendring.
  // Brukes når biblioteksvisningen (MotivVisning i arranger/page.tsx) åpner et enkeltmotiv
  // for redigering: i stedet for et eget, halvt redigeringsverktøy for enkeltmotiv får
  // motivet den fulle editoren med bare seg selv på lerretet. Ignoreres når `komposisjon`
  // er satt — en lagret komposisjon har alltid sine egne motiver.
  startMotiv?: { embroideryId: string; sizeId: string; navn: string }
}) {
  const [id, setId] = useState<string | null>(komposisjon?.id ?? null)
  const [navn, setNavn] = useState(
    komposisjon?.data.navn ?? (startMotiv ? startMotiv.navn : 'Ny komposisjon'),
  )
  const [motiver, setMotiver] = useState<PlassertMotiv[]>(() => {
    if (komposisjon?.data.motiver) return komposisjon.data.motiver
    if (startMotiv) {
      return [{
        id: uid(),
        embroideryId: startMotiv.embroideryId,
        sizeId: startMotiv.sizeId,
        navn: startMotiv.navn,
        posisjonXTiendedelMm: 0,
        posisjonYTiendedelMm: 0,
        rotasjonGrader: 0,
      }]
    }
    return []
  })
  const [sekvens, setSekvens] = useState<SekvensElement[]>(komposisjon?.data.sekvens ?? [])
  // Angring dekker BÅDE motiver og sekvens (punkt C, docs/onsker-2026-09-08.md) — en
  // flytting, tilføying eller sletting er like mye en angrebar handling som en
  // sekvensendring. Push skjer bare ved DISKRETE handlinger (slutten av et dra, et
  // forlatt tallfelt, tilføying, sletting, sekvensendring) — se pushUndoHvisEndret,
  // aldri per pointermove/onChange-steg. navn er MED VILJE utenfor: å skrive om navnet
  // er ikke en angrebar handling her.
  const [undoStack, setUndoStack] = useState<KomposisjonSnapshot[]>([])
  const [redoStack, setRedoStack] = useState<KomposisjonSnapshot[]>([])
  // Punkt B1, docs/onsker-2026-09-08.md: markering av FLERE motiver, ikke bare bokstaver.
  // Klikk = velg ett (erstatter settet); shift/cmd/ctrl-klikk = legg til eller fjern; klikk
  // på tom lerretsflate = tøm. Sett i stedet for array — medlemskap sjekkes langt oftere
  // enn rekkefølgen betyr noe.
  const [valgtIds, setValgtIds] = useState<Set<string>>(new Set())
  // Ren VISNING av rotasjonsglideren når mer enn ett motiv er valgt (punkt B2) — det
  // finnes ingen «gjeldende» gruppe-rotasjon å vise (motivene kan ha ulik rotasjonGrader
  // fra før), så glideren viser alltid DELTA siden dra-start og hopper tilbake til 0 når
  // draget slippes.
  const [gruppeRotasjonVisning, setGruppeRotasjonVisning] = useState(0)
  const [showPicker, setShowPicker] = useState(false)
  // Punkt B3: hvilke grupperader som er slått ut i motivlisten under lerretet — ren
  // visningstilstand, uavhengig av valgtIds.
  const [apneGrupper, setApneGrupper] = useState<Set<string>>(new Set())
  // Satt av leggTilValgte (via onVelgFlere) når flervalgets rutenett IKKE kunne holde
  // alle nylig tilføyde motiver innenfor rammen uten overlapp — se beregnRutenettCelle.
  // Blokkerer aldri tilføyingen selv (motivene legges til uansett); bare et varsel om
  // at de bør flyttes eller byttes til en mindre størrelse.
  const [rutenettAdvarsel, setRutenettAdvarsel] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveErrorDetails, setSaveErrorDetails] = useState<ErrorDetails | null>(null)
  const [fokusKjoringId, setFokusKjoringId] = useState<string | null>(null)
  const [hoverKjoringId, setHoverKjoringId] = useState<string | null>(null)

  // ── Grunnlinje-kalibrering med øyet ("Lagre grunnlinje for denne fonten") ──────────
  // Se "Beslutning etter steg A" i docs/plan-og-prompter-2026-08-13.md: automatikken
  // (finnGrunnlinjeFraSting) ble forkastet, kalibrering skjer i stedet ved at brukeren
  // drar tegn til riktig sted på dette lerretet og lagrer differansen som fontMetrikk.
  const [kalibreringApneBundles, setKalibreringApneBundles] = useState<Set<string>>(new Set())
  // Manuell overstyring av en rad — fraværende nøkkel betyr "bruk levende dra-differanse".
  // Satt av "målt hale"-forslaget (steg A) eller av tallfeltet, ALDRI forhåndsutfylt.
  const [kalibreringOverride, setKalibreringOverride] = useState<Record<string, number>>({})
  const [kalibreringInkludert, setKalibreringInkludert] = useState<Record<string, boolean>>({})
  const [kalibreringLagrer, setKalibreringLagrer] = useState<string | null>(null)
  const [kalibreringFeil, setKalibreringFeil] = useState<ErrorDetails | null>(null)

  // ── Mellomrom bokstaver/ord PÅ LERRETET ("Lagre som standard for denne fonten") ────
  // Se punkt E i docs/onsker-2026-09-08.md — samme prinsipp som grunnlinje-kalibreringen
  // over, men for x-avstand i stedet for y. mellomromLagrer/-Feil er nøkkelet på
  // gruppens key (tekst:<tekstId> eller bundle:<bundleId>), ikke bundleId alene, siden
  // flere tekster fra samme bundle kan stå på lerretet samtidig.
  const [mellomromLagrer, setMellomromLagrer] = useState<string | null>(null)
  const [mellomromFeil, setMellomromFeil] = useState<{ key: string; feil: ErrorDetails } | null>(null)

  const [resolved, setResolved] = useState<Record<string, BroderiMotivData>>({})
  const [fetchErrors, setFetchErrors] = useState<Record<string, string>>({})
  const fetchingRef = useRef<Set<string>>(new Set())

  // Brukerens egne broderitråder fra Lageret — hentet én gang ved åpning, ikke koblet
  // til noen live-oppdatering (redigerer man en tråd i Lageret mens komposisjonen
  // står åpen i en annen fane, må denne siden lastes på nytt for å se det, samme
  // begrensning som resten av appens engangs-lastinger).
  const [mineTrader, setMineTrader] = useState<MinTrad[]>([])
  useEffect(() => { hentMineTrader().then(setMineTrader) }, [])
  const pecTilEkte = useMemo(() => byggPecTilEkteMap(mineTrader), [mineTrader])

  // ── Utgangslagring (tilbakeknapp, browser-navigasjon, fanelukking) ────────────────
  // latestRef holder de ferskeste verdiene av alt lagre() trenger, oppdatert etter HVER
  // rendring (ingen dependency-liste) — se lagre()-kommentaren under for hvorfor: en
  // avmonteringseffekt sin cleanup kan kalles fra en closure satt opp ved MOUNT, og en
  // lukket variabel derfra ville vært det aller første øyeblikksbildet, ikke det siste.
  const latestRef = useRef({ id, navn, motiver, sekvens, resolved, pecTilEkte, startMotiv })
  useEffect(() => {
    latestRef.current = { id, navn, motiver, sekvens, resolved, pecTilEkte, startMotiv }
  })

  // Siste vellykkede lagring — DEN ENE sannheten om "endret", se lagreSnapshot.ts.
  const lagretSnapshotRef = useRef<KomposisjonSnapshot>({ navn, motiver, sekvens })
  // Én lagring om gangen: et nytt lagre()-kall mens en pågående fetch ikke er ferdig
  // venter på DEN i stedet for å starte sin egen — se lagre() under for hullet dette
  // tetter (navnefeltets onBlur og en utgangslagring som treffer samtidig).
  const pendingSaveRef = useRef<Promise<boolean> | null>(null)
  // Siste miniatyr bygget fra et KOMPLETT sett tolkede motiver — se lagre() under.
  const sisteKomplettMiniatyrRef = useRef<string | undefined>(komposisjon?.data.miniatyrSvg)

  const svgRef = useRef<SVGSVGElement>(null)
  // startPos dekker ALLE valgte motiver (punkt B1) — dra flytter hele utvalget med samme
  // delta, regnet fra hvert motivs EGEN startposisjon, aldri fra forrige steg (unngår
  // avrundingsdrift, samme prinsipp som B2 sin rotasjon under).
  const dragRef = useRef<{
    startClientX: number
    startClientY: number
    startPos: Map<string, { x: number; y: number }>
  } | null>(null)
  // Øyeblikksbilde for gruppe-ROTASJON (B2) — senter og hvert motivs startposisjon +
  // -rotasjon, tatt når glideren/tallfeltet tas i bruk. Bare relevant når mer enn ett
  // motiv er valgt; for ett motiv beholdes den enklere oppdaterValgt(MedAngre)-veien.
  const gruppeRotasjonRef = useRef<{
    senterXTiendedelMm: number
    senterYTiendedelMm: number
    perMotiv: Map<string, { x: number; y: number; rot: number }>
  } | null>(null)
  // Øyeblikksbilde tatt ved dra-START (pointerdown/pointerdown på rotasjonsglideren) —
  // sammenlignet mot NÅ-tilstanden ved dra-SLUTT, én angre-push per dra, aldri per steg.
  const dragUndoRef = useRef<KomposisjonSnapshot | null>(null)

  // Skipper push-en når "før" og "etter" faktisk serialiserer likt (et forlatt tallfelt
  // som ikke endret verdien, et dra som endte der det startet) — se
  // KomposisjonSnapshot/serialiserSnapshot i lagreSnapshot.ts. Samme navn på begge sider
  // med vilje: navn er ikke en angrebar handling her, og skal aldri i seg selv utløse
  // en push.
  function pushUndoHvisEndret(
    forrige: { motiver: PlassertMotiv[]; sekvens: SekvensElement[] },
    na: { motiver: PlassertMotiv[]; sekvens: SekvensElement[] },
  ) {
    if (serialiserSnapshot({ navn, ...forrige }) === serialiserSnapshot({ navn, ...na })) return
    setUndoStack(u => [...u.slice(-29), { navn, ...forrige }])
    setRedoStack([])
  }

  function handleSekvensChange(ny: SekvensElement[]) {
    pushUndoHvisEndret({ motiver, sekvens }, { motiver, sekvens: ny })
    setSekvens(ny)
  }

  function handleUndo() {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack(r => [{ navn, motiver, sekvens }, ...r.slice(0, 29)])
    setUndoStack(u => u.slice(0, -1))
    setMotiver(prev.motiver)
    setSekvens(prev.sekvens)
  }

  function handleRedo() {
    if (redoStack.length === 0) return
    const next = redoStack[0]
    setUndoStack(u => [...u.slice(-29), { navn, motiver, sekvens }])
    setRedoStack(r => r.slice(1))
    setMotiver(next.motiver)
    setSekvens(next.sekvens)
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

  function leggTilMotiv(embroideryId: string, sizeId: string, navnParam: string) {
    const nyId = uid()
    const kaskade = motiver.length * 50 // 5 mm forskyvning per nytt motiv, så de ikke stables eksakt
    const ny: PlassertMotiv = {
      id: nyId,
      embroideryId,
      sizeId,
      navn: navnParam,
      posisjonXTiendedelMm: kaskade,
      posisjonYTiendedelMm: kaskade,
      rotasjonGrader: 0,
    }
    const nyeMotiver = [...motiver, ny]
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
    setValgtIds(new Set([nyId]))
    setShowPicker(false)
    setRutenettAdvarsel(false)
    sikreMotivData(embroideryId, sizeId)
  }

  function leggTilMotiverBolk(
    items: Array<{
      embroideryId: string; sizeId: string; navn: string; x: number; y: number
      fontKilde?: { bundleId: string; bundleNavn: string; tegn: string; tekstId?: string; indeks?: number }
    }>,
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
      fontKilde: item.fontKilde,
    }))
    const nyeMotiver = [...motiver, ...nye]
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
    setValgtIds(new Set())
    setShowPicker(false)
    setRutenettAdvarsel(!!rutenettUmulig)
    for (const item of items) sikreMotivData(item.embroideryId, item.sizeId)
  }

  // Fortløpende (rotasjonsglideren for ETT motiv mens den dras) — INGEN angre-push her,
  // se oppdaterValgtMedAngre for den diskrete varianten (tallfelt-commit, glider-slipp).
  // Brukes bare når nøyaktig ETT motiv er valgt — flere valgt bruker gruppe-rotasjonen
  // (committGruppeRotasjon/gruppeRotasjonRef) i stedet, se punkt B2.
  function oppdaterValgt(patch: Partial<PlassertMotiv>) {
    if (valgtIds.size === 0) return
    setMotiver(m => m.map(pm => valgtIds.has(pm.id) ? { ...pm, ...patch } : pm))
  }

  function oppdaterValgtMedAngre(patch: Partial<PlassertMotiv>) {
    if (valgtIds.size === 0) return
    const nyeMotiver = motiver.map(pm => valgtIds.has(pm.id) ? { ...pm, ...patch } : pm)
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
  }

  // Punkt B1: Delete/piltaster og X/Y-feltet flytter/sletter alltid HELE utvalget.
  // ryddOppEnkeltmedlemsgrupper (punkt B3): sletting kan krympe en gruppe til ett
  // gjenværende medlem, som da ikke lenger er en gruppe.
  function slettValgte() {
    if (valgtIds.size === 0) return
    const nyeMotiver = ryddOppEnkeltmedlemsgrupper(motiver.filter(pm => !valgtIds.has(pm.id)))
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
    setValgtIds(new Set())
  }

  // Punkt B3: alle valgte får samme nye gruppeId. Kan stjele medlemmer fra en ANNEN,
  // eksisterende gruppe og etterlate den med ett medlem igjen — ryddOppEnkeltmedlemsgrupper
  // fanger opp nettopp det.
  function grupperValgte() {
    if (valgtIds.size < 2) return
    const nyGruppeId = uid()
    const nyeMotiver = ryddOppEnkeltmedlemsgrupper(
      motiver.map(pm => valgtIds.has(pm.id) ? { ...pm, gruppeId: nyGruppeId, gruppeNavn: undefined } : pm),
    )
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
  }

  // Bare kalt når utvalget ER nøyaktig én hel gruppe (erHelGruppeValgt) — trenger derfor
  // ingen egen opprydning etterpå, hele gruppen løses opp på én gang.
  function losOppValgte() {
    if (!erHelGruppeValgt || !valgtGruppeId) return
    const nyeMotiver = motiver.map(pm => {
      if (pm.gruppeId !== valgtGruppeId) return pm
      const rest = { ...pm }
      delete rest.gruppeId
      delete rest.gruppeNavn
      return rest
    })
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
  }

  // Gruppenavn er en diskret feltredigering (commit ved blur, som TallFelt) — i
  // motsetning til komposisjonens EGET navn er dette angrebart, som andre felt-commits.
  function settGruppeNavn(gruppeId: string, navnVerdi: string) {
    const verdi = navnVerdi.trim() || undefined
    const nyeMotiver = motiver.map(pm => pm.gruppeId === gruppeId ? { ...pm, gruppeNavn: verdi } : pm)
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
  }

  function flyttValgteMedDelta(dxTiendedelMm: number, dyTiendedelMm: number) {
    if (valgtIds.size === 0 || (dxTiendedelMm === 0 && dyTiendedelMm === 0)) return
    const nyeMotiver = motiver.map(pm => valgtIds.has(pm.id)
      ? { ...pm, posisjonXTiendedelMm: pm.posisjonXTiendedelMm + dxTiendedelMm, posisjonYTiendedelMm: pm.posisjonYTiendedelMm + dyTiendedelMm }
      : pm)
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
  }

  // X/Y-feltene med flere valgt viser utvalgets samlede bboks-senter (se valgtBbox under)
  // og flytter HELE utvalget dit — innbyrdes avstander endres aldri, bare hele gruppens
  // felles posisjon. null for en akse betyr «rør ikke denne».
  function flyttValgteTilSenter(nyttSenterXTiendedelMm: number | null, nyttSenterYTiendedelMm: number | null) {
    if (!valgtBbox) return
    const senterX = Math.round((valgtBbox.min_x + valgtBbox.max_x) / 2)
    const senterY = Math.round((valgtBbox.min_y + valgtBbox.max_y) / 2)
    flyttValgteMedDelta(
      nyttSenterXTiendedelMm != null ? nyttSenterXTiendedelMm - senterX : 0,
      nyttSenterYTiendedelMm != null ? nyttSenterYTiendedelMm - senterY : 0,
    )
  }

  // Snarvei «Velg hele teksten» (punkt B1): bruker fontKilde.tekstId, IKKE bundleId —
  // bundleId ville slått sammen to ulike ord fra samme font. Eldre komposisjoner (fra før
  // tekstId fantes) faller tilbake til bundleId; knappeteksten sier fra om det, se
  // velgHeleTekstenKilde (definert nedenfor, ved valgtMotiver) og JSX-en som bruker den.
  function velgHeleTeksten() {
    const kilde = valgtMotiver.find(pm => pm.fontKilde)?.fontKilde
    if (!kilde) return
    const nyttUtvalg = kilde.tekstId != null
      ? new Set(motiver.filter(pm => pm.fontKilde?.tekstId === kilde.tekstId).map(pm => pm.id))
      : new Set(motiver.filter(pm => pm.fontKilde?.bundleId === kilde.bundleId).map(pm => pm.id))
    // Punkt B3: samme regel som lerretet/listen — er en av bokstavene gruppert med noe
    // annet, følger resten av DEN gruppen med. Én regel, ikke to.
    setValgtIds(utvidTilGrupper(nyttUtvalg, motiver))
  }

  // Gruppe-rotasjon (punkt B2): rene funksjoner som regner ut nye motiver fra et
  // øyeblikksbilde tatt ved dra-start, aldri fra forrige steg — se gruppeRotasjonRef.
  // Brukes av BÅDE den fortløpende glideren og det diskrete tallfeltet.
  function beregnGruppeRotasjon(
    snap: { senterXTiendedelMm: number; senterYTiendedelMm: number; perMotiv: Map<string, { x: number; y: number; rot: number }> },
    deltaGrader: number,
  ): PlassertMotiv[] {
    const roter = lagRotasjon(deltaGrader)
    return motiver.map(pm => {
      const s = snap.perMotiv.get(pm.id)
      if (!s) return pm
      const [rx, ry] = roter(s.x - snap.senterXTiendedelMm, s.y - snap.senterYTiendedelMm)
      return {
        ...pm,
        posisjonXTiendedelMm: Math.round(snap.senterXTiendedelMm + rx),
        posisjonYTiendedelMm: Math.round(snap.senterYTiendedelMm + ry),
        rotasjonGrader: s.rot + deltaGrader,
      }
    })
  }

  function lagGruppeRotasjonSnapshot() {
    if (!valgtBbox) return null
    return {
      senterXTiendedelMm: Math.round((valgtBbox.min_x + valgtBbox.max_x) / 2),
      senterYTiendedelMm: Math.round((valgtBbox.min_y + valgtBbox.max_y) / 2),
      perMotiv: new Map(valgtMotiver.map(pm => [pm.id, { x: pm.posisjonXTiendedelMm, y: pm.posisjonYTiendedelMm, rot: pm.rotasjonGrader }])),
    }
  }

  // Diskret variant (tallfelt-commit) — snapshot, regn ut, angre-push og lagre i ETT
  // steg, aldri via mellomliggende state (motiver-closuren er ellers utdatert til neste
  // rendring, se pushUndoHvisEndret-kommentaren over).
  function committGruppeRotasjon(deltaGrader: number) {
    const snap = lagGruppeRotasjonSnapshot()
    if (!snap || deltaGrader === 0) return
    const nyeMotiver = beregnGruppeRotasjon(snap, deltaGrader)
    pushUndoHvisEndret({ motiver, sekvens }, { motiver: nyeMotiver, sekvens })
    setMotiver(nyeMotiver)
  }

  // Slett/piltaster med Delete/Backspace/piler, men ikke mens man skriver i et tekstfelt.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (valgtIds.size === 0) return
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        slettValgte()
        return
      }
      // Piltaster flytter utvalget 0,5 mm, shift+piltast 2 mm (punkt B1).
      const retning: Record<string, [number, number]> = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      }
      const d = retning[e.key]
      if (d) {
        e.preventDefault()
        const stegTiendedelMm = e.shiftKey ? 20 : 5
        flyttValgteMedDelta(d[0] * stegTiendedelMm, d[1] * stegTiendedelMm)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [valgtIds, motiver, sekvens, navn, pushUndoHvisEndret, slettValgte, flyttValgteMedDelta])

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

  // Punkt B1/B2: de valgte motivene og utvalgets samlede bboks — senteret her er
  // referansepunktet BÅDE for X/Y-visning/-flytting (flyttValgteTilSenter) og for
  // gruppe-rotasjon (lagGruppeRotasjonSnapshot). For ETT motiv er dette senteret alltid
  // nøyaktig likt motivets EGEN posisjonX/Y — plassertBbox roterer om motivets eget
  // senter, som derfor aldri flytter seg — så ingen egen kodevei trengs for det tilfellet.
  const valgtMotiver = useMemo(() => motiver.filter(pm => valgtIds.has(pm.id)), [motiver, valgtIds])
  const valgtBbox = useMemo(
    () => kombinerBbox(valgtMotiver.map(pm => plasserteBbokser.get(pm.id)).filter((b): b is BroderiBbox => !!b)),
    [valgtMotiver, plasserteBbokser],
  )
  const velgHeleTekstenKilde = useMemo(
    () => valgtMotiver.find(pm => pm.fontKilde)?.fontKilde ?? null,
    [valgtMotiver],
  )
  // Punkt B3: «Løs opp» vises bare når utvalget ER nøyaktig én hel, eksisterende gruppe —
  // ikke en DEL av en gruppe (utvidTilGrupper garanterer at markering aldri lander der i
  // praksis, men et delvis utvalg kan oppstå via alt-klikk), og ikke flere grupper på én gang.
  const valgtGruppeId = valgtMotiver[0]?.gruppeId
  const erHelGruppeValgt = useMemo(() => {
    if (!valgtGruppeId || !valgtMotiver.every(pm => pm.gruppeId === valgtGruppeId)) return false
    return motiver.filter(pm => pm.gruppeId === valgtGruppeId).length === valgtMotiver.length
  }, [valgtMotiver, motiver, valgtGruppeId])

  // Punkt B3, motivlisten (:1378 i det opprinnelige forslaget): grupperte motiver samles
  // i ÉN rad per gruppe, ugrupperte står som før. Gruppens rad plasseres der FØRSTE
  // medlem forekommer i motiver — resten av gruppen (og ugrupperte motiver ellers)
  // beholder sin innbyrdes rekkefølge uendret.
  type MotivRad = { type: 'motiv'; pm: PlassertMotiv } | { type: 'gruppe'; gruppeId: string; medlemmer: PlassertMotiv[] }
  const motivRader = useMemo<MotivRad[]>(() => {
    const rader: MotivRad[] = []
    const settGrupper = new Set<string>()
    for (const pm of motiver) {
      if (!pm.gruppeId) {
        rader.push({ type: 'motiv', pm })
        continue
      }
      if (settGrupper.has(pm.gruppeId)) continue
      settGrupper.add(pm.gruppeId)
      rader.push({ type: 'gruppe', gruppeId: pm.gruppeId, medlemmer: motiver.filter(m => m.gruppeId === pm.gruppeId) })
    }
    return rader
  }, [motiver])
  const valgtSenterXTiendedelMm = valgtBbox ? Math.round((valgtBbox.min_x + valgtBbox.max_x) / 2) : 0
  const valgtSenterYTiendedelMm = valgtBbox ? Math.round((valgtBbox.min_y + valgtBbox.max_y) / 2) : 0

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

  // Punkt B1/B3: shift/cmd/ctrl-klikk legger til/fjerner en HEL gruppe (aldri bare ett
  // medlem) og starter ALDRI et dra (bare en ren markeringshandling). Alt-klikk velger
  // BARE dette ene motivet, uten å løse opp gruppen det tilhører — den eneste veien til
  // et delvis utvalg. Reglene er delt med motivlisten via nyttUtvalgVedKlikk (grupper.ts),
  // ett sted, ikke to som kan sprike.
  //
  // nyttUtvalg må utvides til hele gruppen FØR startPos bygges under, ellers starter
  // draget med bare halve gruppen.
  function onPointerDownMotiv(e: ReactPointerEvent, pm: PlassertMotiv) {
    e.stopPropagation()
    const nyttUtvalg = nyttUtvalgVedKlikk(e, pm, valgtIds, motiver)
    setValgtIds(nyttUtvalg)
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      dragRef.current = null
      return
    }
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPos: new Map(
        motiver.filter(m => nyttUtvalg.has(m.id)).map(m => [m.id, { x: m.posisjonXTiendedelMm, y: m.posisjonYTiendedelMm }]),
      ),
    }
    dragUndoRef.current = { navn, motiver, sekvens }
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  // Motivlistens klikk (gruppe-rad, medlemsrad inni en utslått gruppe, og ugrupperte
  // rader) — samme markeringsregel som lerretet, se onPointerDownMotiv, bare uten
  // dra-oppsettet (listen drar ikke).
  function velgVedListeKlikk(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }, pm: PlassertMotiv) {
    setValgtIds(nyttUtvalgVedKlikk(e, pm, valgtIds, motiver))
  }

  function veksleApenGruppe(gruppeId: string) {
    setApneGrupper(s => {
      const n = new Set(s)
      if (n.has(gruppeId)) n.delete(gruppeId); else n.add(gruppeId)
      return n
    })
  }

  // Flytter HELE utvalget med samme delta, regnet fra hvert motivs egen startposisjon i
  // dragRef (aldri fra forrige steg) — ingen avrundingsdrift, og innbyrdes avstand
  // endres aldri.
  function onPointerMoveSvg(e: ReactPointerEvent) {
    const drag = dragRef.current
    const svg = svgRef.current
    if (!drag || !svg) return
    const rect = svg.getBoundingClientRect()
    const mmPerPx = (halv * 2) / rect.width
    const dxTiendedelMm = Math.round((e.clientX - drag.startClientX) * mmPerPx * 10)
    const dyTiendedelMm = Math.round((e.clientY - drag.startClientY) * mmPerPx * 10)
    setMotiver(m => m.map(pm => {
      const start = drag.startPos.get(pm.id)
      if (!start) return pm
      return { ...pm, posisjonXTiendedelMm: start.x + dxTiendedelMm, posisjonYTiendedelMm: start.y + dyTiendedelMm }
    }))
  }

  function onPointerUpSvg() {
    dragRef.current = null
    if (dragUndoRef.current) {
      pushUndoHvisEndret(dragUndoRef.current, { motiver, sekvens })
      dragUndoRef.current = null
    }
  }

  // ── Mellomrom bokstaver/ord PÅ LERRETET (punkt E) — deler dragUndoRef med
  // rotasjonsglideren over, siden bare ett dra kan pågå om gangen. Selve re-plasseringen
  // (onOmplasserTekstgruppe) er den fortløpende, IKKE angre-sporede delen — bare X endres,
  // aldri Y, se omplasserTekstgruppe i fontUtils.ts.
  function onTekstgruppeDragStart() {
    dragUndoRef.current = { navn, motiver, sekvens }
  }

  function onTekstgruppeDragEnd() {
    if (dragUndoRef.current) {
      pushUndoHvisEndret(dragUndoRef.current, { motiver, sekvens })
      dragUndoRef.current = null
    }
  }

  function onOmplasserTekstgruppe(nye: Array<{ id: string; posisjonXTiendedelMm: number }>) {
    const nyeX = new Map(nye.map(n => [n.id, n.posisjonXTiendedelMm]))
    setMotiver(m => m.map(pm => nyeX.has(pm.id) ? { ...pm, posisjonXTiendedelMm: nyeX.get(pm.id)! } : pm))
  }

  // ── Lagre ────────────────────────────────────────────────────────────────────
  // Selve nettverkskallet — leser ALLTID fra latestRef, aldri fra motiver/navn/sekvens
  // direkte i denne funksjonens egen closure. Det er det som gjør det trygt å kalle
  // lagre() fra en avmonteringseffekt sin cleanup, som kan kjøre en closure satt opp
  // ved mount: funksjonen selv har ingen utdatert tilstand å være uenig med seg selv om.
  async function lagreNaa(): Promise<boolean> {
    const snap = latestRef.current
    // Aldri opprett en tom rad — se skalAutolagre-kommentaren. Gjelder OGSÅ det
    // eksplisitte knappetrykket: en tom, ny komposisjon er ingenting å lagre.
    if (snap.id === null && snap.motiver.length === 0) return true

    setSaveStatus('saving')
    setSaveErrorDetails(null)
    try {
      // Miniatyren regnes ut HER, ved lagring — aldri når komposisjonslista bare vises.
      // Er ikke ALLE motiver tolket ferdig ennå (resolved mangler en eller flere), ville
      // byggMiniatyrSvg bygget en miniatyr med hull (den hopper stille over det som
      // mangler, se miniatyr.ts) — i stedet beholdes forrige komplette miniatyr uendret,
      // eller ingen (for en helt ny komposisjon: den regnes uansett på nytt ved neste
      // lagring, en manglende miniatyr nå er ikke tapt informasjon).
      const komplett = snap.motiver.every(pm => !!snap.resolved[motivKey(pm.embroideryId, pm.sizeId)])
      const miniatyrSvg = komplett
        ? byggMiniatyrSvg(snap.motiver, snap.resolved, snap.sekvens, snap.pecTilEkte)
        : sisteKomplettMiniatyrRef.current
      const body = { data: { navn: snap.navn, motiver: snap.motiver, sekvens: snap.sekvens, miniatyrSvg } }
      const res = snap.id
        ? await fetch(`/api/broderi-komposisjon/${snap.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await fetch('/api/broderi-komposisjon', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
      const responseBody = await res.json()
      if (!res.ok) throw new Error(responseBody.error ?? 'Klarte ikke lagre')
      if (!snap.id) setId(responseBody.id)
      if (komplett) sisteKomplettMiniatyrRef.current = miniatyrSvg
      lagretSnapshotRef.current = { navn: snap.navn, motiver: snap.motiver, sekvens: snap.sekvens }
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 1500)
      return true
    } catch (err) {
      setSaveErrorDetails(describeError(err))
      setSaveStatus('error')
      return false
    }
  }

  // Ytre innpakning for hull 1: navnefeltets onBlur fyrer PÅ VEI UT av feltet, og for en
  // ny komposisjon (id null) rett før tilbakeknappens egen utgangslagring — uten denne
  // ville begge startet sin egen fetch, og «id er satt» kappløpet ville gitt to POST-er
  // og to rader. Én lagring om gangen: et kall mens en annen fetch pågår venter på DEN i
  // stedet for å starte sitt eget (dekker også dobbelttrykk på tilbakeknappen/Lagre).
  async function lagre(): Promise<boolean> {
    if (pendingSaveRef.current) return pendingSaveRef.current
    const promise = lagreNaa()
    pendingSaveRef.current = promise
    try {
      return await promise
    } finally {
      pendingSaveRef.current = null
    }
  }

  // Har noe som faktisk skal lagres endret seg siden forrige vellykkede lagring? Ren
  // sammenligning av hele øyeblikksbildet (lagreSnapshot.ts) — IKKE et dirty-flagg satt
  // av hver enkelt handling, som alltid før eller senere glemmer én.
  function harUlagredeEndringer(): boolean {
    const snap = latestRef.current
    return erEndret(lagretSnapshotRef.current, { navn: snap.navn, motiver: snap.motiver, sekvens: snap.sekvens })
  }

  // Lagrer automatisk når navnefeltet forlates, IKKE bare på trykk av "Lagre" — samme
  // lagre()-kall (motiver/sekvens følger med, siden data er én sammenhengende jsonb),
  // bare utløst av et annet event.
  function onNavnBlur() {
    if (!skalAutolagre({ id, antallMotiver: motiver.length, startMotivSatt: !!startMotiv })) return
    if (harUlagredeEndringer()) lagre()
  }

  // Enkeltmotiv fra biblioteket, ikke lagret som komposisjon ennå — se skalAutolagre.
  const kunUlagretEnkeltmotiv = !!startMotiv && id === null

  // ── Utgangslagring ved navigasjon ─────────────────────────────────────────────────
  // Nettleserens tilbakeknapp og sidemeny-navigasjon går IKKE via onBack — de avmonterer
  // KomposisjonEditor direkte (useHistoryVisning i arranger/page.tsx bytter visning,
  // eller en Link i sidemenyen navigerer bort). Denne effektens cleanup er derfor den
  // ENESTE krok som fanger dem begge. "Fire and forget": en cleanup kan ikke være async
  // eller stanse avmonteringen, så lagre() sendes uten å vente — feiler den, mister
  // brukeren de aller siste endringene på nøyaktig den ene turen, men det er likevel
  // langt bedre enn å aldri prøve i det hele tatt.
  useEffect(() => {
    return () => {
      const snap = latestRef.current
      if (!skalAutolagre({ id: snap.id, antallMotiver: snap.motiver.length, startMotivSatt: !!snap.startMotiv })) return
      if (!erEndret(lagretSnapshotRef.current, { navn: snap.navn, motiver: snap.motiver, sekvens: snap.sekvens })) return
      lagre()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Fanelukking ────────────────────────────────────────────────────────────────────
  // beforeunload kan ikke vente på en fetch (og sendBeacon kan bare POST-e — å oppdatere
  // en eksisterende komposisjon er en PUT), så dette varsler i stedet: nettleseren spør
  // brukeren om hen vil forlate siden når det finnes ulagrede endringer.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      const snap = latestRef.current
      if (!skalAutolagre({ id: snap.id, antallMotiver: snap.motiver.length, startMotivSatt: !!snap.startMotiv })) return
      if (!erEndret(lagretSnapshotRef.current, { navn: snap.navn, motiver: snap.motiver, sekvens: snap.sekvens })) return
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // ── Tilbakeknappen i editoren ──────────────────────────────────────────────────────
  // Gjør onBack-veien asynkron: lagrer først (om reglene tillater det og noe er endret),
  // og navigerer bare videre om det gikk bra. Feiler lagringen, blir brukeren stående i
  // editoren med feilen synlig (saveErrorDetails/ErrorDetailsView under) — å navigere
  // bort etter en feilet lagring er nøyaktig det tapet denne oppgaven skal fjerne.
  async function handleTilbake() {
    if (skalAutolagre({ id, antallMotiver: motiver.length, startMotivSatt: !!startMotiv }) && harUlagredeEndringer()) {
      const ok = await lagre()
      if (!ok) return
    }
    onBack()
  }

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
  const ctx: SekvensKontekst = useMemo(() => ({ motiver, resolved, pecTilEkte }), [motiver, resolved, pecTilEkte])
  const fargePerBlokk = useMemo(() => byggFargePerBlokk(sekvens, ctx), [sekvens, ctx])

  // Stingteller og fargetall mot Skitch PP1 sine faste grenser (30 000 sting, 63 farger
  // per design, Brother support artikkel 145472) — regnet FØR eksport, fra samme data
  // lerretet allerede har (resolved), ingen ny henting. Advarer, blokkerer aldri — samme
  // prinsipp som rammevarselet: en fil jeg har tenkt å dele i to hoopinger skal fortsatt
  // kunne bygges ferdig. omtredninger er allerede "fargekjøringer slik fila faktisk får
  // dem" (etter snapping og sammenslåing av like nabofarger, se tellOmtredninger).
  const stingAntall = useMemo(() => tellSting(sekvens, ctx), [sekvens, ctx])
  const fargeAntall = useMemo(() => tellOmtredninger(sekvens, ctx), [sekvens, ctx])
  const STING_GRENSE = 30000
  const STING_ADVARSEL = 25000
  const FARGE_GRENSE = 63

  // Kalibreringskandidater: motiver på lerretet plassert av TextVerktoy (fontKilde satt),
  // gruppert per bundle og tegn (samme tegn flere ganger i teksten, f.eks. de to o-ene i
  // "zoo", gjennomsnittes). Diffen regnes ALLTID mot NAIV standard (bif = heightMm,
  // andel 0) — se FontMetrikk i types.ts — aldri mot en tidligere lagret fontMetrikk, slik
  // at et nytt lagre-trykk overskriver i stedet for å akkumulere oppå forrige runde.
  //
  // Punkt A, docs/onsker-2026-09-08.md: den rå diffen måler mot y = 0 (rammens
  // midtlinje) — flytter man HELE ordet, leser alle bokstavene det som manglende
  // grunnlinje. trekkFraFellesForskyvning trekker fra ordets FELLES forskyvning
  // (medianen av gruppens rå diff) før tallene vises/lagres — rad.draggedDiffMm under er
  // derfor NETTOAVVIKET, ikke det rå tallet. Med bare ett tegn kan plassering og
  // grunnlinje ikke skilles (fellesForskyvningMm blir null); lagreGrunnlinje nekter da å
  // lagre — se der.
  const kalibreringsGrupper = useMemo(() => {
    type Akk = { bundleNavn: string; perTegn: Map<string, { heightMmSum: number; diffSumMm: number; antall: number }> }
    const perBundle = new Map<string, Akk>()
    for (const pm of motiver) {
      if (!pm.fontKilde) continue
      const data = resolved[motivKey(pm.embroideryId, pm.sizeId)]
      if (!data?.bbox) continue
      const heightMm = (data.bbox.max_y - data.bbox.min_y) / 10
      if (heightMm <= 0) continue
      const naivYTiendedelMm = Math.round(-heightMm / 2 * 10)
      const diffMm = (pm.posisjonYTiendedelMm - naivYTiendedelMm) / 10
      const gruppe = perBundle.get(pm.fontKilde.bundleId) ?? { bundleNavn: pm.fontKilde.bundleNavn, perTegn: new Map() }
      const rad = gruppe.perTegn.get(pm.fontKilde.tegn) ?? { heightMmSum: 0, diffSumMm: 0, antall: 0 }
      rad.heightMmSum += heightMm
      rad.diffSumMm += diffMm
      rad.antall += 1
      gruppe.perTegn.set(pm.fontKilde.tegn, rad)
      perBundle.set(pm.fontKilde.bundleId, gruppe)
    }
    return Array.from(perBundle.entries()).map(([bundleId, g]) => {
      const raaRader = Array.from(g.perTegn.entries())
        .map(([tegn, r]) => ({ tegn, heightMm: r.heightMmSum / r.antall, diffMm: r.diffSumMm / r.antall }))
        .sort((a, b) => a.tegn.localeCompare(b.tegn))
      const { rader, fellesForskyvningMm, advarselTegn } = trekkFraFellesForskyvning(raaRader)
      return {
        bundleId,
        bundleNavn: g.bundleNavn,
        rader: rader.map(r => ({ tegn: r.tegn, heightMm: r.heightMm, draggedDiffMm: r.diffMm })),
        fellesForskyvningMm,
        advarselTegn,
      }
    })
  }, [motiver, resolved])

  async function lagreGrunnlinje(gruppe: (typeof kalibreringsGrupper)[number]) {
    // Bare ett tegn i gruppen: plassering og grunnlinje kan ikke skilles fra hverandre
    // (punkt A) — knappen er allerede deaktivert i UI-et, dette er bare et sikkerhetsnett.
    if (gruppe.fellesForskyvningMm === null) return
    setKalibreringLagrer(gruppe.bundleId)
    setKalibreringFeil(null)
    try {
      const inkluderte = gruppe.rader.filter(r => kalibreringInkludert[`${gruppe.bundleId}:${r.tegn}`] !== false)
      if (inkluderte.length === 0) { setKalibreringLagrer(null); return }
      const { data: bundleRow, error } = await supabase
        .from('embroidery_bundles').select('data').eq('id', gruppe.bundleId).single()
      if (error || !bundleRow) throw new Error(error?.message ?? 'Fant ikke fontbunten')
      const eksisterendeTegn = (bundleRow.data as EmbroideryBundleData).fontMetrikk?.tegn ?? {}
      const nyttTegnOppslag = { ...eksisterendeTegn }
      const now = new Date().toISOString()
      for (const rad of inkluderte) {
        const key = `${gruppe.bundleId}:${rad.tegn}`
        const verdiMm = kalibreringOverride[key] ?? rad.draggedDiffMm
        nyttTegnOppslag[rad.tegn] = { underlengdeAndel: verdiMm / rad.heightMm, kilde: 'manuell' as const, oppdatert: now }
      }
      // Spre inn EKSISTERENDE fontMetrikk (sporingAndel/mellomromAndel hører til
      // mellomrom-lagringen, punkt E) før tegn overskrives — ellers sletter denne
      // lagringen mellomrom-innstillingene, og omvendt.
      const eksisterendeFontMetrikk = (bundleRow.data as EmbroideryBundleData).fontMetrikk
      const nyData = { ...bundleRow.data, fontMetrikk: { ...eksisterendeFontMetrikk, tegn: nyttTegnOppslag } }
      const { error: saveErr } = await supabase.from('embroidery_bundles').update({ data: nyData }).eq('id', gruppe.bundleId)
      if (saveErr) throw new Error(saveErr.message)
      setKalibreringApneBundles(s => { const n = new Set(s); n.delete(gruppe.bundleId); return n })
      setKalibreringOverride(o => {
        const n = { ...o }
        for (const r of gruppe.rader) delete n[`${gruppe.bundleId}:${r.tegn}`]
        return n
      })
    } catch (err) {
      setKalibreringFeil(describeError(err))
    } finally {
      setKalibreringLagrer(null)
    }
  }

  // ── Mellomrom bokstaver/ord PÅ LERRETET (punkt E, docs/onsker-2026-09-08.md) ───────
  // Grupperer plasserte motiver med fontKilde etter HVILKEN TEKST de kommer fra
  // (fontKilde.tekstId), IKKE bare bundle — «Ellinor» og en senere, separat innsatt
  // «Test» fra samme font skal justeres hver for seg. Eldre komposisjoner uten tekstId
  // faller tilbake til ÉN gruppe per bundle, sortert på x (kjenteIndekser: false) — se
  // omplasserTekstgruppe/malSporingFraPosisjoner i fontUtils.ts. Grupper med under to
  // tegn har ingenting å justere og vises ikke.
  //
  // MED VILJE ikke PlassertMotiv.gruppeId (punkt B3): dette justerer mellomrom i en
  // TEKST, ikke en figur. Er bokstavene i et ord gruppert sammen med en blomst, skal
  // glideren fortsatt bare flytte bokstavene — det er riktig, ikke en feil å rette.
  const tekstGrupper = useMemo(() => {
    type Ledd = { id: string; posisjonXTiendedelMm: number; widthMm: number; indeks: number | null }
    type Akk = { bundleId: string; bundleNavn: string; kjenteIndekser: boolean; ledd: Ledd[] }
    const perGruppe = new Map<string, Akk>()
    for (const pm of motiver) {
      if (!pm.fontKilde) continue
      const data = resolved[motivKey(pm.embroideryId, pm.sizeId)]
      if (!data?.bbox) continue
      const widthMm = (data.bbox.max_x - data.bbox.min_x) / 10
      const kjentIndeks = pm.fontKilde.tekstId != null && pm.fontKilde.indeks != null
      const key = kjentIndeks ? `tekst:${pm.fontKilde.tekstId}` : `bundle:${pm.fontKilde.bundleId}`
      const g = perGruppe.get(key) ?? {
        bundleId: pm.fontKilde.bundleId, bundleNavn: pm.fontKilde.bundleNavn,
        kjenteIndekser: kjentIndeks, ledd: [],
      }
      g.ledd.push({
        id: pm.id, posisjonXTiendedelMm: pm.posisjonXTiendedelMm, widthMm,
        indeks: kjentIndeks ? pm.fontKilde.indeks! : null,
      })
      perGruppe.set(key, g)
    }
    return Array.from(perGruppe.entries())
      .map(([key, g]) => {
        const ledd = [...g.ledd].sort((a, b) =>
          g.kjenteIndekser ? (a.indeks! - b.indeks!) : (a.posisjonXTiendedelMm - b.posisjonXTiendedelMm),
        )
        const { sporingMm, mellomromMm } = malSporingFraPosisjoner(ledd)
        return { key, bundleId: g.bundleId, bundleNavn: g.bundleNavn, kjenteIndekser: g.kjenteIndekser, ledd, sporingMm, mellomromMm }
      })
      .filter(g => g.sporingMm != null)
  }, [motiver, resolved])

  // Median høyde av x-høyde-klassifiserte tegn fra denne bundlen SOM STÅR PÅ LERRETET nå
  // (samme idé som buildFontData sin xHeight-måling, bare mot det plasserte utvalget i
  // stedet for hele fontbiblioteket — bundlerMap/vms finnes bare inne i MotivPicker, se
  // KomposisjonEditor-toppnivået). Faller tilbake til medianen av ALLE tegn fra bundlen
  // hvis ingen x-høyde-tegn er plassert ennå (f.eks. bare VERSALER så langt).
  const bundleXHeightMm = useMemo(() => {
    const perBundleXHoyde = new Map<string, number[]>()
    const perBundleAlle = new Map<string, number[]>()
    for (const pm of motiver) {
      if (!pm.fontKilde) continue
      const data = resolved[motivKey(pm.embroideryId, pm.sizeId)]
      if (!data?.bbox) continue
      const heightMm = (data.bbox.max_y - data.bbox.min_y) / 10
      if (heightMm <= 0) continue
      const alle = perBundleAlle.get(pm.fontKilde.bundleId) ?? []
      alle.push(heightMm)
      perBundleAlle.set(pm.fontKilde.bundleId, alle)
      if (klassifiser(pm.fontKilde.tegn) === 'x-hoyde') {
        const xh = perBundleXHoyde.get(pm.fontKilde.bundleId) ?? []
        xh.push(heightMm)
        perBundleXHoyde.set(pm.fontKilde.bundleId, xh)
      }
    }
    function medianAv(tall: number[]): number {
      const s = [...tall].sort((a, b) => a - b)
      return s[Math.floor(s.length / 2)]
    }
    const result = new Map<string, number>()
    for (const bundleId of perBundleAlle.keys()) {
      const xh = perBundleXHoyde.get(bundleId)
      result.set(bundleId, xh && xh.length > 0 ? medianAv(xh) : medianAv(perBundleAlle.get(bundleId)!))
    }
    return result
  }, [motiver, resolved])

  async function lagreMellomromStandard(bundleId: string, gruppeKey: string, sporingMm: number, mellomromMm: number | null, xHeightMm: number) {
    setMellomromLagrer(gruppeKey)
    setMellomromFeil(null)
    try {
      const { data: bundleRow, error } = await supabase
        .from('embroidery_bundles').select('data').eq('id', bundleId).single()
      if (error || !bundleRow) throw new Error(error?.message ?? 'Fant ikke fontbunten')
      // Spre inn eksisterende fontMetrikk.tegn (grunnlinje-kalibreringen, se lagreGrunnlinje
      // over) — denne lagringen rører bare sporingAndel/mellomromAndel.
      const eksisterende = (bundleRow.data as EmbroideryBundleData).fontMetrikk
      const nyFontMetrikk: FontMetrikk = {
        tegn: eksisterende?.tegn ?? {},
        sporingAndel: xHeightMm > 0 ? sporingMm / xHeightMm : eksisterende?.sporingAndel,
        mellomromAndel: mellomromMm != null && xHeightMm > 0 ? mellomromMm / xHeightMm : eksisterende?.mellomromAndel,
      }
      const nyData = { ...bundleRow.data, fontMetrikk: nyFontMetrikk }
      const { error: saveErr } = await supabase.from('embroidery_bundles').update({ data: nyData }).eq('id', bundleId)
      if (saveErr) throw new Error(saveErr.message)
    } catch (err) {
      setMellomromFeil({ key: gruppeKey, feil: describeError(err) })
    } finally {
      setMellomromLagrer(null)
    }
  }

  return (
    <div className="w-full max-w-3xl lg:max-w-6xl mx-auto px-4 sm:px-6 py-3 pb-24">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={handleTilbake}
          disabled={saveStatus === 'saving'}
          className="p-2 rounded-xl hover:bg-stone-100 text-stone-500 transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
        >
          {saveStatus === 'saving' ? (
            <span className="text-sm px-1 whitespace-nowrap">Lagrer…</span>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          )}
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
          {saveStatus === 'saving' ? 'Lagrer…' : saveStatus === 'saved' ? 'Lagret ✓' : kunUlagretEnkeltmotiv ? 'Lagre som komposisjon' : 'Lagre'}
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

      {fargeAntall > FARGE_GRENSE && (
        <div className="px-4 py-3 mb-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          {fargeAntall} fargekjøringer — over Skitch PP1 sin grense på {FARGE_GRENSE} farger per design.
          Fila kan fortsatt bygges, men maskinen vil trolig avvise den.
        </div>
      )}

      {/* To kolonner fra lg og opp: lerret + motivkontroller til venstre (sticky, så det
         står stille mens sekvensen til høyre skrolles), sekvens/trådrekkefølge +
         stingsimulator + eksport til høyre. Én kolonne som før under lg. */}
      <div className="lg:grid lg:grid-cols-[26rem_1fr] lg:gap-6 lg:items-start">
      <div className="lg:sticky lg:top-4 lg:self-start">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 mb-4">
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="w-full aspect-square touch-none"
          onPointerMove={onPointerMoveSvg}
          onPointerUp={onPointerUpSvg}
          onPointerDown={() => setValgtIds(new Set())}
        >
          <rect
            x={-halvRamme} y={-halvRamme} width={RAMME_MM} height={RAMME_MM}
            fill="none" stroke="#C9A57A" strokeWidth={0.5} strokeDasharray="2 2"
          />
          {/* Svakt 10 mm-rutenett med tall langs kantene, i SAMME konvensjon som X/Y-feltene
             under (avstand fra rammens øvre venstre hjørne, 0–100) — ren visningshjelp, rører
             aldri de lagrede koordinatene (som fortsatt er senter-baserte internt). En liten
             sirkel+kryss ved (0,0) markerer det gamle senter-origo, til hjelp under overgangen. */}
          <g className="pointer-events-none">
            {RUTENETT_LINJER.map(g => (
              <line key={`v${g}`} x1={g} y1={-halvRamme} x2={g} y2={halvRamme} stroke="#C9A57A" strokeWidth={0.15} opacity={0.35} />
            ))}
            {RUTENETT_LINJER.map(g => (
              <line key={`h${g}`} x1={-halvRamme} y1={g} x2={halvRamme} y2={g} stroke="#C9A57A" strokeWidth={0.15} opacity={0.35} />
            ))}
            {RUTENETT_TALL.map(tall => (
              <text key={`tx${tall}`} x={tall - halvRamme} y={-halvRamme - 1.5} fontSize={2.5} textAnchor="middle" fill="#B8A68C">{tall}</text>
            ))}
            {RUTENETT_TALL.map(tall => (
              <text key={`ty${tall}`} x={-halvRamme - 1.5} y={tall - halvRamme} fontSize={2.5} textAnchor="end" dominantBaseline="middle" fill="#B8A68C">{tall}</text>
            ))}
            <circle cx={0} cy={0} r={0.8} fill="none" stroke="#C9A57A" strokeWidth={0.3} />
            <line x1={-1.5} y1={0} x2={1.5} y2={0} stroke="#C9A57A" strokeWidth={0.3} />
            <line x1={0} y1={-1.5} x2={0} y2={1.5} stroke="#C9A57A" strokeWidth={0.3} />
          </g>
          {motiver.map(pm => {
            const data = resolved[motivKey(pm.embroideryId, pm.sizeId)]
            if (!data?.bbox) return null
            return (
              <PlassertMotivGruppe
                key={pm.id}
                pm={pm}
                data={data}
                bbox={data.bbox}
                valgt={valgtIds.has(pm.id)}
                utenforRamme={utenforRammeIder.includes(pm.id)}
                aktivKjoring={aktivKjoring}
                fargePerBlokk={fargePerBlokk[pm.id] ?? []}
                onPointerDown={e => onPointerDownMotiv(e, pm)}
              />
            )
          })}
          {/* Grunnlinje (y=0) — kun synlig mens minst ett tekst-plassert tegn ligger på
             lerretet, ikke permanent støy i vanlige komposisjoner. Uten en strek å se mot
             er kalibrering med øyet bare gjetning. */}
          {kalibreringsGrupper.length > 0 && (
            <line
              x1={-halv} y1={0} x2={halv} y2={0}
              stroke="#8B6340" strokeWidth={0.25} strokeDasharray="1.5 1" opacity={0.6}
              className="pointer-events-none"
            />
          )}
        </svg>
      </div>

      {sekvens.length > 0 && (
        <p className={`text-xs text-center mb-4 -mt-2 ${
          stingAntall > STING_GRENSE ? 'text-red-600' : stingAntall > STING_ADVARSEL ? 'text-amber-600' : 'text-stone-400'
        }`}>
          {combinedBbox && `${komposisjonBreddeMm.toFixed(1)} × ${komposisjonHoydeMm.toFixed(1)} mm · `}
          {stingAntall.toLocaleString('nb-NO')} av {STING_GRENSE.toLocaleString('nb-NO')} sting
        </p>
      )}

      <button
        onClick={() => setShowPicker(true)}
        className="w-full mb-4 py-2.5 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors"
      >
        + Legg til motiv
      </button>

      {tekstGrupper.map(gruppe => (
        <TekstMellomromKontroll
          key={gruppe.key}
          bundleNavn={gruppe.bundleNavn}
          ledd={gruppe.ledd}
          kjenteIndekser={gruppe.kjenteIndekser}
          sporingMaalt={gruppe.sporingMm!}
          mellomromMaalt={gruppe.mellomromMm}
          xHeightMm={bundleXHeightMm.get(gruppe.bundleId) ?? XHEIGHT_FALLBACK_MM}
          onOmplasser={onOmplasserTekstgruppe}
          onDragStart={onTekstgruppeDragStart}
          onDragEnd={onTekstgruppeDragEnd}
          onLagreStandard={(sporingMm, mellomromMm) => lagreMellomromStandard(
            gruppe.bundleId, gruppe.key, sporingMm, mellomromMm,
            bundleXHeightMm.get(gruppe.bundleId) ?? XHEIGHT_FALLBACK_MM,
          )}
          lagrer={mellomromLagrer === gruppe.key}
          feil={mellomromFeil?.key === gruppe.key ? mellomromFeil.feil : null}
        />
      ))}

      {kalibreringsGrupper.map(gruppe => (
        <div key={gruppe.bundleId} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 mb-4">
          {!kalibreringApneBundles.has(gruppe.bundleId) ? (
            <button
              onClick={() => setKalibreringApneBundles(s => new Set(s).add(gruppe.bundleId))}
              className="w-full text-sm text-stone-600 hover:text-[#8B6340] transition-colors"
            >
              Lagre grunnlinje for {gruppe.bundleNavn}
            </button>
          ) : (
            <div>
              <p className="text-sm font-medium text-stone-700 mb-1">Lagre grunnlinje for {gruppe.bundleNavn}</p>
              <p className="text-xs text-stone-400 mb-3">
                Dra bokstavene på lerretet til ordet står riktig, hopp så over tegn du bare
                flyttet av estetiske grunner.
              </p>
              {gruppe.fellesForskyvningMm === null ? (
                <p className="text-xs text-amber-600 mb-3">
                  Bare ett tegn her — plassering og grunnlinje kan ikke skilles fra
                  hverandre. Sett inn flere tegn fra samme font før du lagrer.
                </p>
              ) : (
                <p className="text-xs text-stone-400 mb-3">
                  Felles forskyvning {gruppe.fellesForskyvningMm.toFixed(1)} mm trukket fra —
                  det er ordets plassering, ikke grunnlinjen.
                </p>
              )}
              <ul className="space-y-2 mb-3">
                {gruppe.rader.map(rad => {
                  const key = `${gruppe.bundleId}:${rad.tegn}`
                  const inkludert = kalibreringInkludert[key] !== false
                  const verdi = kalibreringOverride[key] ?? rad.draggedDiffMm
                  const forslag = STEG_A_MALT_HALE_MM[gruppe.bundleNavn]?.[rad.tegn]
                  const advarsel = gruppe.advarselTegn.has(rad.tegn)
                  return (
                    <li key={rad.tegn} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox" checked={inkludert}
                        onChange={e => setKalibreringInkludert(m => ({ ...m, [key]: e.target.checked }))}
                        className="accent-[#C9A57A]"
                      />
                      <span className="font-mono w-5 text-stone-700">{rad.tegn === ' ' ? '·' : rad.tegn}</span>
                      <TallFelt
                        step={0.1} value={verdi}
                        onCommit={v => setKalibreringOverride(m => ({ ...m, [key]: v }))}
                        className="w-20 px-2 py-1 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
                      />
                      <span className="text-stone-400 text-xs">mm</span>
                      {advarsel && (
                        <span className="text-xs text-amber-600" title="Avviket er over 30 % av tegnets egen høyde">
                          ⚠
                        </span>
                      )}
                      {forslag != null && forslag !== 0 && (
                        <button
                          onClick={() => setKalibreringOverride(m => ({ ...m, [key]: forslag }))}
                          className="text-xs text-[#8B6340] hover:underline ml-auto"
                          title="Målt i steg A — trykk for å bruke denne verdien i stedet"
                        >
                          målt hale: {forslag.toFixed(1)} mm
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              {kalibreringFeil && (
                <div className="mb-3">
                  <ErrorDetailsView details={kalibreringFeil} context="Lagre grunnlinje" />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => lagreGrunnlinje(gruppe)}
                  disabled={kalibreringLagrer === gruppe.bundleId || gruppe.fellesForskyvningMm === null}
                  className="flex-1 py-1.5 text-sm bg-stone-800 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
                >
                  {kalibreringLagrer === gruppe.bundleId ? 'Lagrer…' : 'Lagre grunnlinje'}
                </button>
                <button
                  onClick={() => setKalibreringApneBundles(s => { const n = new Set(s); n.delete(gruppe.bundleId); return n })}
                  className="px-3 py-1.5 text-sm text-stone-400 hover:text-stone-600 transition-colors"
                >
                  Avbryt
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {valgtMotiver.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-stone-700 truncate">
              {valgtMotiver.length === 1 ? valgtMotiver[0].navn : `${valgtMotiver.length} motiver valgt`}
            </p>
            <button
              onClick={slettValgte}
              className="p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors flex-shrink-0"
              aria-label={valgtMotiver.length === 1 ? 'Slett motiv' : 'Slett valgte motiver'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" />
              </svg>
            </button>
          </div>
          {(valgtMotiver.length >= 2 || erHelGruppeValgt) && (
            // Punkt B3: «Grupper» når to eller flere er valgt (uansett om noen av dem
            // allerede tilhører en annen gruppe — den blir da med hit, se
            // ryddOppEnkeltmedlemsgrupper i grupperValgte). «Løs opp» bare når utvalget ER
            // nøyaktig én hel, eksisterende gruppe.
            <div className="flex gap-2 mb-3">
              {valgtMotiver.length >= 2 && (
                <button
                  onClick={grupperValgte}
                  className="flex-1 py-1.5 text-xs border border-stone-200 rounded-lg text-stone-600 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors"
                >
                  Grupper
                </button>
              )}
              {erHelGruppeValgt && (
                <button
                  onClick={losOppValgte}
                  className="flex-1 py-1.5 text-xs border border-stone-200 rounded-lg text-stone-600 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors"
                >
                  Løs opp
                </button>
              )}
            </div>
          )}
          {velgHeleTekstenKilde && (
            // Punkt B1: bruker fontKilde.tekstId — ALDRI bundleId — så to ulike ord fra
            // samme font ikke velges samlet. Eldre komposisjoner uten tekstId faller
            // tilbake til bundleId (hele fonten); knappeteksten sier fra om det.
            <button
              onClick={velgHeleTeksten}
              className="w-full mb-3 py-1.5 text-xs border border-stone-200 rounded-lg text-stone-600 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors"
            >
              {velgHeleTekstenKilde.tekstId != null
                ? 'Velg hele teksten'
                : 'Velg hele fonten (eldre komposisjon — rekkefølge ukjent)'}
            </button>
          )}
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="block text-[10px] text-stone-400 mb-1">
                {valgtMotiver.length > 1 ? 'X (mm, utvalgets senter)' : 'X (mm, fra venstre)'}
              </span>
              {/* Vist 0–100 fra rammens ØVRE VENSTRE hjørne (+RAMME_MM/2), ikke lagringens
                 egen ±50 mm fra senter — se KRAV 6. Lagringen (posisjonXTiendedelMm) er
                 fortsatt senter-basert i tiendedels mm, helt uendret; dette er bare en
                 visnings-/innskrivingskonvertering ved selve feltet. Utvalgets bboks-senter
                 (valgtSenterXTiendedelMm) er nøyaktig likt motivets EGEN posisjon når bare
                 ett er valgt, se kommentaren ved valgtBbox — samme felt dekker begge. */}
              <TallFelt
                step={0.1}
                value={valgtSenterXTiendedelMm / 10 + RAMME_MM / 2}
                onCommit={visX => flyttValgteTilSenter(Math.round((visX - RAMME_MM / 2) * 10), null)}
                className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] text-stone-400 mb-1">
                {valgtMotiver.length > 1 ? 'Y (mm, utvalgets senter)' : 'Y (mm, fra toppen)'}
              </span>
              <TallFelt
                step={0.1}
                value={valgtSenterYTiendedelMm / 10 + RAMME_MM / 2}
                onCommit={visY => flyttValgteTilSenter(null, Math.round((visY - RAMME_MM / 2) * 10))}
                className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] text-stone-400 mb-1">Rotasjon (°)</span>
              {/* Ett motiv: absolutt vinkel, som før. Flere: feltet er en DELTA som legges
                 til hvert motivs egen rotasjonGrader og roterer posisjonen om utvalgets
                 senter (punkt B2) — viser derfor alltid 0 (ingenting «gjeldende» å vise
                 for en blandet gruppe), og committGruppeRotasjon nullstiller selv videre. */}
              {valgtMotiver.length === 1 ? (
                <TallFelt
                  step={1}
                  value={valgtMotiver[0].rotasjonGrader}
                  onCommit={n => oppdaterValgtMedAngre({ rotasjonGrader: n })}
                  className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
                />
              ) : (
                <TallFelt
                  step={1}
                  value={0}
                  onCommit={committGruppeRotasjon}
                  className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
                />
              )}
            </label>
          </div>
          <div className="mt-3">
            <input
              type="range" min={-180} max={180} step={1}
              value={valgtMotiver.length === 1 ? normaliserForGlider(valgtMotiver[0].rotasjonGrader) : gruppeRotasjonVisning}
              onPointerDown={() => {
                if (valgtMotiver.length > 1) gruppeRotasjonRef.current = lagGruppeRotasjonSnapshot()
                dragUndoRef.current = { navn, motiver, sekvens }
              }}
              onChange={e => {
                if (valgtMotiver.length === 1) {
                  oppdaterValgt({ rotasjonGrader: snappRotasjon(Number(e.target.value)) })
                  return
                }
                const snap = gruppeRotasjonRef.current
                if (!snap) return
                const delta = Number(e.target.value)
                setGruppeRotasjonVisning(delta)
                setMotiver(beregnGruppeRotasjon(snap, delta))
              }}
              onPointerUp={() => {
                gruppeRotasjonRef.current = null
                setGruppeRotasjonVisning(0)
                if (dragUndoRef.current) {
                  pushUndoHvisEndret(dragUndoRef.current, { motiver, sekvens })
                  dragUndoRef.current = null
                }
              }}
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
          {motivRader.map(rad => rad.type === 'motiv' ? (
            <MotivRadItem
              key={rad.pm.id}
              pm={rad.pm}
              valgt={valgtIds.has(rad.pm.id)}
              utenforRamme={utenforRammeIder.includes(rad.pm.id)}
              feil={fetchErrors[motivKey(rad.pm.embroideryId, rad.pm.sizeId)]}
              lastet={!!resolved[motivKey(rad.pm.embroideryId, rad.pm.sizeId)]}
              onClick={e => velgVedListeKlikk(e, rad.pm)}
            />
          ) : (
            <li key={rad.gruppeId}>
              <div
                onClick={e => velgVedListeKlikk(e, rad.medlemmer[0])}
                className={`w-full flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors ${
                  rad.medlemmer.every(m => valgtIds.has(m.id)) ? 'bg-stone-50' : 'hover:bg-stone-50'
                }`}
              >
                <button
                  onClick={e => { e.stopPropagation(); veksleApenGruppe(rad.gruppeId) }}
                  className="p-0.5 text-stone-400 hover:text-stone-600 flex-shrink-0"
                  aria-label={apneGrupper.has(rad.gruppeId) ? 'Skjul gruppemedlemmer' : 'Vis gruppemedlemmer'}
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${apneGrupper.has(rad.gruppeId) ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <GruppeNavnFelt
                  value={rad.medlemmer[0].gruppeNavn ?? ''}
                  plassholder={`Gruppe (${rad.medlemmer.length} motiver)`}
                  onCommit={v => settGruppeNavn(rad.gruppeId, v)}
                />
              </div>
              {apneGrupper.has(rad.gruppeId) && (
                <ul className="divide-y divide-stone-50 bg-stone-50/60">
                  {rad.medlemmer.map(pm => (
                    <MotivRadItem
                      key={pm.id}
                      pm={pm}
                      valgt={valgtIds.has(pm.id)}
                      utenforRamme={utenforRammeIder.includes(pm.id)}
                      feil={fetchErrors[motivKey(pm.embroideryId, pm.sizeId)]}
                      lastet={!!resolved[motivKey(pm.embroideryId, pm.sizeId)]}
                      onClick={e => velgVedListeKlikk(e, pm)}
                      innrykk
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      </div>

      <div className="mt-6 lg:mt-0 lg:min-w-0">
      {sekvens.length > 0 && (
        <div className="mt-6 lg:mt-0">
          <h3 className="font-serif text-lg text-stone-700 mb-3">Sekvens</h3>
          <SekvensPanel
            sekvens={sekvens}
            onChange={handleSekvensChange}
            motiver={motiver}
            resolved={resolved}
            pecTilEkte={pecTilEkte}
            mineTrader={mineTrader}
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
          <StingSimulator sekvens={sekvens} motiver={motiver} resolved={resolved} halv={halv} pecTilEkte={pecTilEkte} />
        </div>
      )}

      {sekvens.length > 0 && (
        <div className="mt-6">
          <EksportPanel sekvens={sekvens} motiver={motiver} resolved={resolved} navn={navn} />
        </div>
      )}
      </div>
      </div>

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

// ── Kontrollert tallfelt ─────────────────────────────────────────────────────────

function formatTall(n: number): string {
  // Number(...toFixed(2)) fjerner både flyttall-støy (17.30000000000001) og
  // overflødige nuller (17.00 → 17) i samme slag.
  return Number(n.toFixed(2)).toString()
}

function parseTall(tekst: string): number | null {
  const normalisert = tekst.trim().replace(',', '.')
  if (normalisert === '' || normalisert === '-') return null
  const n = Number(normalisert)
  return Number.isFinite(n) ? n : null
}

// Kontrollert tekstfelt for tall — <input type="number"> lar seg ikke skrive fritt i:
// "-" kan ikke skrives manuelt (minus må klikkes fram med pilene), og feltet kan ikke
// tømmes midlertidig (siste siffer byttes straks ut med "0" av nettleseren). Løsningen
// er lokal tekst-state som får være midlertidig ugyldig ("", "-", "17,") mens brukeren
// skriver; verdien tolkes og skrives til state FØRST når feltet mister fokus eller
// Enter trykkes. Escape angrer til sist forpliktede verdi. Komma og punktum godtas
// begge som desimalskilletegn. Piltastene justerer fortsatt ±step, med umiddelbar commit
// (ingen grunn til å vente på blur for et eksplisitt tastetrykk).
function TallFelt({ value, onCommit, step = 1, className }: {
  value: number
  onCommit: (n: number) => void
  step?: number
  className?: string
}) {
  const [tekst, setTekst] = useState(() => formatTall(value))
  const redigererRef = useRef(false)

  useEffect(() => {
    if (!redigererRef.current) setTekst(formatTall(value))
  }, [value])

  function commit() {
    redigererRef.current = false
    const n = parseTall(tekst)
    if (n === null) { setTekst(formatTall(value)); return }
    onCommit(n)
    setTekst(formatTall(n))
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={tekst}
      onFocus={() => { redigererRef.current = true }}
      onChange={e => setTekst(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          redigererRef.current = false
          setTekst(formatTall(value))
          e.currentTarget.blur()
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const naa = parseTall(tekst) ?? value
          const ny = e.key === 'ArrowUp' ? naa + step : naa - step
          onCommit(ny)
          setTekst(formatTall(ny))
        }
      }}
      className={className}
    />
  )
}

// Gruppens (valgfrie) navn i motivlisten (punkt B3) — samme commit-ved-blur-mønster som
// TallFelt over. stopPropagation: raden rundt velger hele gruppen ved klikk, feltet skal
// bare redigere navnet.
function GruppeNavnFelt({ value, plassholder, onCommit }: {
  value: string
  plassholder: string
  onCommit: (v: string) => void
}) {
  const [tekst, setTekst] = useState(value)
  const redigererRef = useRef(false)

  useEffect(() => {
    if (!redigererRef.current) setTekst(value)
  }, [value])

  function commit() {
    redigererRef.current = false
    if (tekst !== value) onCommit(tekst)
  }

  return (
    <input
      type="text"
      value={tekst}
      placeholder={plassholder}
      onFocus={() => { redigererRef.current = true }}
      onChange={e => setTekst(e.target.value)}
      onBlur={commit}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      className="flex-1 min-w-0 px-2 py-1 text-sm text-stone-700 bg-transparent border border-transparent hover:border-stone-200 focus:border-stone-300 rounded-lg focus:outline-none"
    />
  )
}

// Én rad i motivlisten under lerretet — brukt for ugrupperte motiver OG for hvert
// medlem inni en utslått gruppe (punkt B3). innrykk skyver raden litt inn så
// medlemmene visuelt ligger under sin gruppes rad.
function MotivRadItem({ pm, valgt, utenforRamme, feil, lastet, onClick, innrykk }: {
  pm: PlassertMotiv
  valgt: boolean
  utenforRamme: boolean
  feil: string | undefined
  lastet: boolean
  onClick: (e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => void
  innrykk?: boolean
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 py-2.5 text-left text-sm transition-colors ${innrykk ? 'pl-9 pr-4' : 'px-4'} ${
          valgt ? 'bg-stone-50' : 'hover:bg-stone-50'
        }`}
      >
        <span className={`flex-1 min-w-0 truncate ${innrykk ? 'text-stone-600' : 'text-stone-700'}`}>{pm.navn}</span>
        {utenforRamme && (
          <span className="text-xs text-red-500 flex-shrink-0" title="Stikker utenfor rammen">⚠ Utenfor</span>
        )}
        {feil ? (
          <span className="text-xs text-red-500 flex-shrink-0">Feil</span>
        ) : !lastet ? (
          <span className="w-3.5 h-3.5 border-2 border-stone-200 border-t-stone-500 rounded-full animate-spin flex-shrink-0" />
        ) : null}
      </button>
      {feil && (
        <p className={`pb-2 text-xs text-red-500 ${innrykk ? 'pl-9 pr-4' : 'px-4'}`}>{feil}</p>
      )}
    </li>
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

// ── Mellomrom bokstaver/ord PÅ LERRETET (punkt E, docs/onsker-2026-09-08.md) ───────────

function TekstMellomromKontroll({
  bundleNavn, ledd, kjenteIndekser, sporingMaalt, mellomromMaalt, xHeightMm,
  onOmplasser, onDragStart, onDragEnd, onLagreStandard, lagrer, feil,
}: {
  bundleNavn: string
  ledd: Array<{ id: string; posisjonXTiendedelMm: number; widthMm: number; indeks: number | null }>
  kjenteIndekser: boolean
  sporingMaalt: number
  mellomromMaalt: number | null
  xHeightMm: number
  onOmplasser: (nye: Array<{ id: string; posisjonXTiendedelMm: number }>) => void
  onDragStart: () => void
  onDragEnd: () => void
  onLagreStandard: (sporingMm: number, mellomromMm: number | null) => void
  lagrer: boolean
  feil: ErrorDetails | null
}) {
  // Startverdi MÅLT fra det som faktisk står der (se malSporingFraPosisjoner) — ikke et
  // gjett. useState leser dette bare ved MOUNT (React ignorerer argumentet ved senere
  // rendringer så lenge komponenten beholder identitet via key=gruppe.key), så glideren
  // fanges ikke i en løkke med foreldrekomponentens egen re-måling under dra.
  const [tracking, setTracking] = useState(sporingMaalt)
  const [mellomrom, setMellomrom] = useState(mellomromMaalt ?? 0)
  // Øyeblikksbilde av gruppens senter, tatt ved dra-START — se omplasserTekstgruppe i
  // fontUtils.ts og B2-regelen i docs/onsker-2026-09-08.md (samme anti-drift-prinsipp).
  const senterRef = useRef<number | null>(null)

  function start() {
    senterRef.current = ledd.length > 0
      ? Math.round((ledd[0].posisjonXTiendedelMm + ledd[ledd.length - 1].posisjonXTiendedelMm) / 2)
      : 0
    onDragStart()
  }

  function slutt() {
    senterRef.current = null
    onDragEnd()
  }

  function omplasser(nySporingMm: number, nyMellomromMm: number) {
    if (senterRef.current == null) return
    const input = ledd.map(l => ({ id: l.id, widthMm: l.widthMm, indeks: l.indeks }))
    onOmplasser(omplasserTekstgruppe(input, nySporingMm, nyMellomromMm, senterRef.current))
  }

  const harOrdgrense = mellomromMaalt != null

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-sm font-medium text-stone-700 truncate">Mellomrom for teksten fra {bundleNavn}</p>
        <button
          onClick={() => onLagreStandard(tracking, harOrdgrense ? mellomrom : null)}
          disabled={lagrer}
          className="flex-shrink-0 px-3 py-1.5 text-xs bg-stone-800 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50 transition-colors"
        >
          {lagrer ? 'Lagrer…' : 'Lagre som standard for denne fonten'}
        </button>
      </div>
      {!kjenteIndekser && (
        <p className="text-xs text-stone-400 mb-3">
          Eldre tekst uten lagret rekkefølge — glideren gjelder bokstavene slik de står nå, sortert fra venstre til høyre.
        </p>
      )}
      {feil && (
        <div className="mb-3">
          <ErrorDetailsView details={feil} context="Lagre mellomrom for denne fonten" />
        </div>
      )}
      <div className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-stone-500 mb-1.5">
            <span>Mellomrom bokstaver</span>
            <span>{tracking >= 0 ? '+' : ''}{tracking.toFixed(1)} mm</span>
          </div>
          <input type="range"
            min={-0.7 * xHeightMm} max={0.5 * xHeightMm} step={0.1}
            value={tracking}
            onPointerDown={start}
            onChange={e => { const v = parseFloat(e.target.value); setTracking(v); omplasser(v, mellomrom) }}
            onPointerUp={slutt}
            className="w-full accent-[#C9A57A]" />
        </div>
        {harOrdgrense && (
          <div>
            <div className="flex justify-between text-xs text-stone-500 mb-1.5">
              <span>Mellomrom ord</span>
              <span>{mellomrom.toFixed(1)} mm</span>
            </div>
            <input type="range"
              min={0.3 * xHeightMm} max={1.2 * xHeightMm} step={0.1}
              value={mellomrom}
              onPointerDown={start}
              onChange={e => { const v = parseFloat(e.target.value); setMellomrom(v); omplasser(tracking, v) }}
              onPointerUp={slutt}
              className="w-full accent-[#C9A57A]" />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tekstverktøy ─────────────────────────────────────────────────────────────

function TextVerktoy({ bundleId, bundleNavn, fontMetrikk, vms, biblioteket, onLeggTil, onBack, onEnkelttegn }: {
  bundleId: string
  bundleNavn: string
  fontMetrikk?: FontMetrikk
  vms: VirtuelMotiv[]
  biblioteket: Embroidery[]
  onLeggTil: (items: Array<{
    embroideryId: string; sizeId: string; navn: string; x: number; y: number
    fontKilde?: { bundleId: string; bundleNavn: string; tegn: string; tekstId?: string; indeks?: number }
  }>) => void
  onBack: () => void
  // Vei ut av tekstmodus for en font-bundle: samme tegn kan brukes som ETT motiv, ikke bare
  // som bokstav i en tekst. Uten denne var en «font»-kategorisert bundle låst til
  // tekstverktøyet, og enkelttegn var utilgjengelige når teksten ikke lot seg bygge.
  onEnkelttegn: () => void
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

  // Ingen gjettet standard lenger (punkt E, docs/onsker-2026-09-08.md) — 0,08 × x-høyde
  // var begrunnet for en OPPREIST font (ingen sidelagre i filene, min_x = 0), men
  // Seraphine er kursiv: en skråstilt bboks er bredere enn der bokstaven faktisk møter
  // den neste, så hullet blir stort selv ved 0 mm — gjetningen traff aldri der. Uten en
  // lagret sporingAndel for fonten starter glideren derfor rett og slett på 0; den
  // egentlige startverdien kommer nå fra dra-og-lagre på LERRETET (se
  // omplasserTekstgruppe/malSporingFraPosisjoner i fontUtils.ts og glideren under
  // lerretet i hovedkomponenten), ikke fra denne dialogen. sporingAndel er lagret som
  // andel av x-høyden nettopp for å gjelde i ALLE tommestørrelser — regnes derfor om til
  // mm på nytt for den tommen som faktisk er valgt, se beregnSporingMm under.
  function beregnSporingMm(t: string): number {
    if (!t || fontMetrikk?.sporingAndel == null) return 0
    const fd = buildFontData(vms, t, biblioteket, fontMetrikk)
    return Math.round(fontMetrikk.sporingAndel * fd.metrics.xHeight * 10) / 10
  }

  const [tomme, setTomme] = useState<string>(tilgjengeligeTommes[0] ?? '')
  const [tekst, setTekst] = useState('')
  const [tracking, setTracking] = useState(() => beregnSporingMm(tilgjengeligeTommes[0] ?? ''))
  // mellomromAndel er allerede en x-høyde-andel (samme enhet som mellomromFaktor), så
  // den brukes uendret — se FontMetrikk i types.ts.
  const [mellomromFaktor, setMellomromFaktor] = useState(() => fontMetrikk?.mellomromAndel ?? 0.6)

  // Bytt størrelse → regn tracking om til mm på nytt for den nye tommen (samme andel,
  // annet tall) — «justert under rendring», IKKE en useEffect (unngår et synlig
  // 0 mm-glimt før korrigering, og trigger-avhengigheten er allerede eksplisitt her).
  const [forrigeTomme, setForrigeTomme] = useState(tomme)
  if (tomme !== forrigeTomme) {
    setForrigeTomme(tomme)
    setTracking(beregnSporingMm(tomme))
  }

  const fontData: FontData | null = useMemo(
    () => tomme ? buildFontData(vms, tomme, biblioteket, fontMetrikk) : null,
    [vms, tomme, biblioteket, fontMetrikk],
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
      const fd = buildFontData(vms, t, biblioteket, fontMetrikk)
      const lay = layoutTekst(rene, fd, { tracking, mellomromFaktor })
      if (lay.totalBreddeMm <= RAMME_MM && lay.totalHøydeMm <= RAMME_MM) return t
    }
    return null
  }, [layout, tilgjengeligeTommes, tomme, tekst, vms, biblioteket, fontMetrikk, tracking, mellomromFaktor])

  const passerBredde = !layout || layout.totalBreddeMm <= RAMME_MM
  const passerHøyde = !layout || layout.totalHøydeMm <= RAMME_MM
  const passerIRamme = passerBredde && passerHøyde

  function leggTil() {
    if (!layout || !fontData || !tekst.trim() || layout.bokstaver.length === 0) return
    // Én tekstId for HELE denne innsettingen — sammen med indeks (posisjonen i den
    // originale strengen) er det slik mellomrom-glideren på lerretet vet hvilke motiver
    // som hører til samme tekst og i hvilken rekkefølge, uten å gjette fra x-posisjon
    // (punkt E, docs/onsker-2026-09-08.md).
    const tekstId = uid()
    onLeggTil(layout.bokstaver.map(b => ({
      embroideryId: b.info.embroideryId,
      sizeId: b.info.sizeId,
      navn: `${b.tegn} – ${tomme}" (${bundleNavn})`,
      x: b.posXTiendedelMm,
      y: b.posYTiendedelMm,
      fontKilde: { bundleId, bundleNavn, tegn: b.tegn, tekstId, indeks: b.indeksITekst },
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
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-xl text-stone-800 truncate">{bundleNavn}</h3>
          <p className="text-xs text-stone-400">Legg til tekst</p>
        </div>
        <button
          onClick={onEnkelttegn}
          className="flex-shrink-0 h-8 px-3 rounded-lg border border-stone-200 text-xs text-stone-600 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors"
        >
          Sett inn enkelttegn
        </button>
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
              <span>Mellomrom bokstaver</span>
              <span>{tracking >= 0 ? '+' : ''}{tracking.toFixed(1)} mm</span>
            </div>
            {/* Området er relativt til fontens x-høyde, ikke et fast mm-tall (punkt E) —
               en stor font trenger et større sprik enn en liten for samme visuelle
               tetthet. mm-visningen er uendret, bare grensene skalerer med fonten. */}
            <input type="range"
              min={-0.7 * (fontData?.metrics.xHeight ?? 0)} max={0.5 * (fontData?.metrics.xHeight ?? 0)}
              step={0.1} value={tracking}
              onChange={e => setTracking(parseFloat(e.target.value))}
              className="w-full accent-[#C9A57A]" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-stone-500 mb-1.5">
              <span>Mellomrom ord</span>
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
            {fontData && !fontData.metrics.xHeightMalt
              && layout?.bokstaver.some(b => klassifiser(b.tegn) === 'underlengde') && (
              <p className="text-xs text-amber-600 mb-2">
                Fant ingen x-høyde-bokstaver (a c e m n o r s u v w x z) å måle grunnlinjen
                mot i denne størrelsen — g/j/p/q/y/f vises på egen bunn til x-høyden er målt
                eller korrigert manuelt.
              </p>
            )}
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

type ParseFremgang = { done: number; total: number; errors: number }

type PickerView =
  | { type: 'kategorier' }
  | { type: 'kategori'; kat: string | null }
  | { type: 'bundle-innhold'; bundleId: string; fraKat?: string | null }
  // fraTekst: tegnrutenettet ble åpnet FRA tekstverktøyet («Sett inn enkelttegn»), ikke
  // fra kategorilista. Da skal tilbakeknappen føre tilbake dit man kom fra, ikke hoppe
  // helt ut til kategorien — og «Skriv tekst i stedet» vises som veien tilbake.
  | { type: 'tegn'; bundleId: string; fraKat?: string | null; fraTekst?: boolean }
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

// velgStandardStorrelse, byggVirtuelleMotiver, beregnRutenettPosisjoner og
// beregnRutenettCelle bor nå i motivvalg.ts (importert over) — flyttet ut som rene,
// testbare funksjoner uten avhengighet til React/Supabase.

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

// Topp-nivå av samme grunn som ValgtBunnlinje over — brukes to steder i MotivPicker
// (kategorier/kategori-headeren og bundle-innhold, se KRAV 8: filteret skal kunne slås
// av/på UANSETT hvor i velgeren brukeren står, ikke bare på toppnivå), og trengte ingen
// closures, bare rene props.
function FilterPasserCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-[#C9A57A]" />
      <span className="text-sm text-stone-600">Bare motiver som passer (&lt;{RAMME_GRENSE_MM} mm)</span>
    </label>
  )
}

// ── Motivvelgerens mål-/miniatyr-cache (MODULNIVÅ, ikke komponent-state) ─────────────────
// Steg 3, docs/plan-og-prompter-2026-08-25.md: MotivPicker avmonteres hver gang velgeren
// lukkes, OG når KomposisjonEditor selv avmonteres (arranger/page.tsx sine tidlige returer
// når man går tilbake til komposisjonslista). Komponent-state ville betalt full pris på
// nytt hver eneste åpning — modulnivå overlever begge, bare en faktisk sidelasting (F5)
// nullstiller den.
//
// Cachen blir utdatert (og må friskes opp via forceRefreshCache, som nullstiller
// modulCacheLastet før lasterVersjon bumpes) når: en ny embroidery-rad er lastet opp i en
// annen fane midt i økten, eller «Generer miniatyrer»/«Forny alle miniatyrer» nettopp har
// skrevet nye miniatyr_svg-verdier i basen (se kjorMiniatyrJobb).
let modulBboxCache = new Map<string, BboxMm | null>()
let modulCacheLastet = false
let modulGlobalCounts: { passer: number; passerIkke: number } | null = null
// null = ukjent ennå ELLER kolonnen mangler (migrasjon 008 ikke kjørt) — se
// modulManglerMiniatyrKolonne for å skille de to.
let modulManglerMiniatyrCount: number | null = null
let modulManglerMiniatyrKolonne = false

// Selve skrivingen til modulvariablene skjer HER, i vanlige topp-nivå-funksjoner utenfor
// komponenten — ikke inni MotivPicker. React sin regel om at render skal være ren tillater
// ikke å reassignere en modul-variabel fra kode som ligger inni en komponent/hook, uansett
// om det faktisk bare skjer fra en event-handler (som her). Komponenten kaller disse, den
// skriver aldri til modulBboxCache/modulCacheLastet/osv. selv.
function modulSettBboxCache(v: Map<string, BboxMm | null>) { modulBboxCache = v }
function modulSettCacheLastet(v: boolean) { modulCacheLastet = v }
function modulSettGlobalCounts(v: { passer: number; passerIkke: number } | null) { modulGlobalCounts = v }
function modulSettManglerMiniatyrCount(v: number | null) { modulManglerMiniatyrCount = v }
function modulSettManglerMiniatyrKolonne(v: boolean) { modulManglerMiniatyrKolonne = v }

function MotivPicker({ biblioteket, onVelg, onVelgFlere, onClose }: {
  biblioteket: Embroidery[]
  onVelg: (embroideryId: string, sizeId: string, navn: string) => void
  // rutenettUmulig: kun satt av leggTilValgte (flervalg), aldri av tekstverktøyets
  // onLeggTil — se beregnRutenettCelle for hva den faktisk betyr.
  onVelgFlere: (
    items: Array<{
      embroideryId: string; sizeId: string; navn: string; x: number; y: number
      fontKilde?: { bundleId: string; bundleNavn: string; tegn: string; tekstId?: string; indeks?: number }
    }>,
    rutenettUmulig?: boolean,
  ) => void
  onClose: () => void
}) {
  const [view, setView] = useState<PickerView>({ type: 'kategorier' })
  const [search, setSearch] = useState('')
  // Standard AV (viser alt) — se KRAV 8: velgeren skal aldri skjule noe pga. størrelse
  // med mindre brukeren selv har bedt om det. Filteret er fortsatt der for den som vil
  // ha et ryddigere utvalg, bare ikke lenger påslått som standard.
  const [filterPaaRamme, setFilterPaaRamme] = useState(false)
  // De fire neste speiler seg til modul-nivå-variablene over ved HVER skriving (se
  // setBboxCache/setCacheLastet/setGlobalCounts/setManglerMiniatyrKolonne under) — starter
  // fra modulvariabelen, ikke tom/false, slik at en ny MotivPicker-instans i samme økt ser
  // en allerede varm cache med én gang, uten et eneste nytt kall mot broderi_motiv.
  const [bboxCache, setBboxCacheState] = useState<Map<string, BboxMm | null>>(modulBboxCache)
  const [cacheLastet, setCacheLastetState] = useState(modulCacheLastet)
  const [globalCounts, setGlobalCountsState] = useState<{ passer: number; passerIkke: number } | null>(modulGlobalCounts)
  const [manglerMiniatyrCount, setManglerMiniatyrCountState] = useState<number | null>(modulManglerMiniatyrCount)
  const [manglerMiniatyrKolonne, setManglerMiniatyrKolonneState] = useState(modulManglerMiniatyrKolonne)

  function setBboxCache(updater: Map<string, BboxMm | null> | ((prev: Map<string, BboxMm | null>) => Map<string, BboxMm | null>)) {
    setBboxCacheState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      modulSettBboxCache(next)
      return next
    })
  }
  function setCacheLastet(v: boolean) {
    modulSettCacheLastet(v)
    setCacheLastetState(v)
  }
  function setGlobalCounts(v: { passer: number; passerIkke: number } | null) {
    modulSettGlobalCounts(v)
    setGlobalCountsState(v)
  }
  function setManglerMiniatyrCount(v: number | null) {
    modulSettManglerMiniatyrCount(v)
    setManglerMiniatyrCountState(v)
  }
  function setManglerMiniatyrKolonne(v: boolean) {
    modulSettManglerMiniatyrKolonne(v)
    setManglerMiniatyrKolonneState(v)
  }
  // Kalt av "Prøv på nytt" og av kjorMiniatyrJobb (etter at nye miniatyrer er skrevet) —
  // nullstiller modul-flagget FØR lasterVersjon bumpes, ellers ville useEffect-en under bare
  // synkronisert lokal state fra den (fortsatt varme) modul-cachen i stedet for å hente på nytt.
  function forceRefreshCache() {
    modulSettCacheLastet(false)
    setLasterVersjon(v => v + 1)
  }

  const [bundlerMap, setBundlerMap] = useState<Map<string, EmbroideryBundle>>(new Map())
  const [parserAlle, setParserAlle] = useState(false)
  const [parseFremgang, setParseFremgang] = useState<ParseFremgang | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [lasterFeil, setLasterFeil] = useState<string | null>(null)
  const [lasterVersjon, setLasterVersjon] = useState(0) // increment to retry
  const avbrytRef = useRef(false)

  useEffect(() => { return () => { avbrytRef.current = true } }, [])

  // Henter MÅL-kolonnene for ALLE rader — data-kolonnen (som har alle stingkoordinatene,
  // stundom over 10 000 punkter per rad) OG miniatyr_svg (en hel SVG som tekst per rad)
  // røres aldri her. Postgres må dekomprimere hele TOAST-verdien for å hente ut selv et
  // lite underfelt som data->bbox, uansett hvor lite som faktisk sendes over — det var den
  // ekte kostnaden, ikke antall rader. Etter migration 007 er bredde/høyde egne,
  // ikke-TOASTede kolonner, så et par tusen rader med noen få heltall hver er billig å
  // hente og regne på i klienten. miniatyr_svg hentes ALDRI her i det hele tatt — bare lat,
  // for de nøklene som faktisk er synlige, se hentMiniatyrerForNokler under. Målt (steg 3):
  // full grunnlast var 13,1 MiB komprimert over 4 sekvensielle sider og kunne 500-feile
  // rett ut; uten miniatyr_svg er samme spørring 112 KiB — mindre enn hovedbibliotekets
  // egen grunnlast.
  //
  // MEN: PostgREST/Supabase svarer maks 1000 rader per spørring uansett .range(), stille —
  // ingen feil, bare et halvfullt resultat. Uten paginering ble bboxCache derfor aldri
  // komplett (over 1000 rader), og uten en fast `order by` var det TILFELDIG hvilke 1000
  // rader som kom med hver gang, så det var IKKE data-feil som fikk per-bundle-tallene til å
  // endre seg mellom hver lasting. Løsning: `hentAllePaginert` (src/lib/supabasePaginering.ts)
  // henter i sider av 1000 med en deterministisk sortering til en side kommer kortere enn full —
  // samme hjelpefunksjon som biblioteklistene bruker, så pagineringslogikken finnes ett sted.
  useEffect(() => {
    let cancelled = false
    type Rad = { embroidery_id: string; size_id: string; bredde_tiendedel_mm: number | null; hoyde_tiendedel_mm: number | null }
    async function lastAlleRader(): Promise<Map<string, BboxMm | null> | null> {
      const { data: rader, error } = await hentAllePaginert<Rad>(
        (fra, til) => supabase.from('broderi_motiv')
          .select('embroidery_id, size_id, bredde_tiendedel_mm, hoyde_tiendedel_mm')
          .order('id', { ascending: true })
          .range(fra, til),
        ['id'],
      )
      if (error) {
        if (!cancelled) setLasterFeil(`Kunne ikke laste mål-data: ${error.message}`)
        return null
      }
      const map = new Map<string, BboxMm | null>()
      for (const row of rader) {
        // miniatyrSvg starter alltid som undefined (ikke forsøkt) — se BboxMm i motivvalg.ts.
        map.set(`${row.embroidery_id}:${row.size_id}`,
          row.bredde_tiendedel_mm != null && row.hoyde_tiendedel_mm != null
            ? { widthMm: row.bredde_tiendedel_mm / 10, heightMm: row.hoyde_tiendedel_mm / 10, miniatyrSvg: undefined }
            : null)
      }
      return map
    }
    async function last() {
      // Allerede lastet i en tidligere MotivPicker-åpning i samme økt (modulnivå-cache) —
      // bare synk lokal state, IKKE hent alle radene på nytt. forceRefreshCache
      // (retry-knappen, kjorMiniatyrJobb) nullstiller modulCacheLastet før den bumper
      // lasterVersjon, så denne grenen bare treffer på en helt vanlig gjenåpning.
      if (modulCacheLastet) {
        setBboxCache(modulBboxCache)
        setGlobalCounts(modulGlobalCounts)
        setManglerMiniatyrCount(modulManglerMiniatyrCount)
        setManglerMiniatyrKolonne(modulManglerMiniatyrKolonne)
        setCacheLastet(true)
        return
      }

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

      // Punkt 5, docs/plan-og-prompter-2026-08-25.md steg 3: «Generer miniatyrer»-tallet må
      // telles i BASEN (som passerPromise/passerIkkePromise), ikke ved å skanne bboxCache
      // etter miniatyrSvg === null — nå som miniatyr_svg ikke lenger hentes for alle rader,
      // ville en slik skanning bare talt "ikke ennå forsøkt hentet", ikke "mangler faktisk".
      // Feiler DENNE med 42703 er migrasjon 008 ikke kjørt — det er her (og i
      // hentMiniatyrerForNokler), ikke i lastAlleRader over, at det nå oppdages.
      const manglerMiniatyrPromise = supabase
        .from('broderi_motiv')
        .select('id', { count: 'exact', head: true })
        .is('miniatyr_svg', null)

      const [map, totalRes, passerRes, passerIkkeRes, manglerMiniatyrRes] = await Promise.all([
        lastAlleRader(), totalPromise, passerPromise, passerIkkePromise, manglerMiniatyrPromise,
      ])
      if (cancelled) return
      if (map === null) { if (!cancelled) setLasterFeil('Kunne ikke laste mål-data'); return }

      if (totalRes.error) console.error('[MotivPicker] totaltelling feilet', totalRes.error)
      if (passerRes.error) console.error('[MotivPicker] passer-telling feilet', passerRes.error)
      if (passerIkkeRes.error) console.error('[MotivPicker] passer-ikke-telling feilet', passerIkkeRes.error)

      let manglerKolonne = false
      let manglerMiniatyrCountVerdi: number | null = null
      if (manglerMiniatyrRes.error) {
        if (manglerMiniatyrRes.error.code === '42703') {
          manglerKolonne = true
        } else {
          console.error('[MotivPicker] mangler-miniatyr-telling feilet', manglerMiniatyrRes.error)
        }
      } else {
        manglerMiniatyrCountVerdi = manglerMiniatyrRes.count ?? null
      }

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
      setManglerMiniatyrCount(manglerMiniatyrCountVerdi)
      setManglerMiniatyrKolonne(manglerKolonne)
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

  // Samme gruppering og samme «har et ekte bilde noe sted»-regel som kategoriData over,
  // men helt UAVHENGIG av bboxCache — hvorvidt et ekte forsidebilde finnes, avgjøres aldri
  // av mål-/miniatyr-cachen. Brukt bare av den late miniatyr-hentingen under til å vite
  // NØYAKTIG hvilke kategorier (og dermed hvilke nøkler) som trenger en SVG-fallback, uten
  // å måtte gjenta kategoriData sin fulle thumbnail-bygging.
  const kategorierUtenEktebilde = useMemo(() => {
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
    const resultat: { kat: string | null; vms: VirtuelMotiv[] }[] = []
    for (const [kat, vms] of katToVms) {
      const harBundleCover = Array.from(katToBundleIds.get(kat) ?? []).some(
        bid => !!(bundlerMap.get(bid) && getBundleCoverImage(bundlerMap.get(bid)!.data)),
      )
      const harLosCover = vms.some(vm => !vm.bundleId && !!vm.coverImage)
      if (!harBundleCover && !harLosCover) resultat.push({ kat, vms })
    }
    return resultat
  }, [virtuelleMotiver, bundlerMap])

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

  // ── Lat henting av miniatyr_svg (punkt 4a, docs/plan-og-prompter-2026-08-25.md steg 3) ──
  // Grunnlasten over henter ALDRI denne kolonnen. Effekten under bygger nøklene DEN AKTIVE
  // SKJERMEN i velgeren trenger en miniatyr for, akkurat nå — de tre stedene et kort/en flis
  // kan vise miniatyr_svg (kategoriflisenes forsidebilder, MotivKort sitt forsidebilde,
  // størrelses-rutenettet), hver begrenset til NØYAKTIG det skjermbildet som er åpent. Kjøres
  // på nytt hver gang skjermbildet endres (view, søket eller rammefilteret), aldri en
  // akkumulerende kø av alt som har vært synlig i økten. hentAlleRader/lastAlleRader-mønsteret
  // over (nestet inni effekten, egen cancelled-guard) gjenbrukes bevisst her.
  useEffect(() => {
    let cancelled = false
    if (manglerMiniatyrKolonne) return

    function nøklerForVM(vm: VirtuelMotiv) {
      return vm.sizes.map(s => ({ embroideryId: s.embroideryId, sizeId: s.sizeId }))
    }
    // Et motiv med et EKTE forsidebilde viser aldri miniatyr_svg (se MotivKort) — ingen
    // grunn til å hente den for de kortene.
    function utenEktBilde(vms: VirtuelMotiv[]) {
      return vms.filter(vm => !vm.coverImage)
    }

    let kandidater: { embroideryId: string; sizeId: string }[]
    if (searchQ) {
      // Søkeresultatene (rendres når view.type === 'kategorier' og søket ikke er tomt).
      const treff = standaloneVMs.filter(vm => vm.navn.toLowerCase().includes(searchQ))
      kandidater = utenEktBilde(treff).flatMap(nøklerForVM)
    } else if (view.type === 'kategorier') {
      // Kategoriflisenes siste-utvei-thumbnails — kun kategorier uten noe ekte bilde noe sted.
      kandidater = kategorierUtenEktebilde.flatMap(({ vms }) => utenEktBilde(vms).flatMap(nøklerForVM))
    } else if (view.type === 'kategori') {
      const { passerVMs, ikkeMåltVMs } = filtrerForKategori(view.kat)
      kandidater = utenEktBilde([...passerVMs, ...ikkeMåltVMs]).flatMap(nøklerForVM)
    } else if (view.type === 'bundle-innhold') {
      const vms = (bundleVMs.get(view.bundleId) ?? []).filter(vm => !searchQ || vm.navn.toLowerCase().includes(searchQ))
      kandidater = utenEktBilde(vms).flatMap(nøklerForVM)
    } else if (view.type === 'storrelse') {
      // Størrelses-rutenettet viser én miniatyr PER STØRRELSE, uavhengig av vm.coverImage —
      // annen regel enn MotivKort, se rendringen (:~3076 i det opprinnelige forslaget).
      kandidater = nøklerForVM(view.vm)
    } else {
      kandidater = []
    }

    // Selvbegrensende paginering: en større kandidatliste enn 200 henter bare de første nå —
    // bboxCache i avhengighetslisten under gjør at effekten kjører igjen når disse er løst,
    // og henter neste bolk da. Aldri én kjempe-batch.
    const uløste = kandidater.filter(({ embroideryId, sizeId }) => {
      const b = bboxCache.get(`${embroideryId}:${sizeId}`)
      return b != null && b.miniatyrSvg === undefined
    }).slice(0, 200)
    if (uløste.length === 0) return

    // Skriver ALLTID et resultat (streng eller null) for hver etterspurt nøkkel som allerede
    // har mål i cachen, slik at neste kjøring av effekten finner dem løst og ikke spør på nytt
    // (se merk-som-undefined-betyr-ikke-forsøkt i motivvalg.ts). To 500-feil dukket opp under
    // målingen i steg 3 nettopp fordi FULL-kolonne-sider på 1000 rader er tunge — derfor
    // batches det her BARE det synlige trenger, aldri en voksende kø av alt som noen gang har
    // vært synlig.
    async function hentMiniatyrer() {
      const embroideryIds = Array.from(new Set(uløste.map(p => p.embroideryId)))
      const sizeIds = Array.from(new Set(uløste.map(p => p.sizeId)))
      const { data, error } = await supabase
        .from('broderi_motiv')
        .select('embroidery_id, size_id, miniatyr_svg')
        .in('embroidery_id', embroideryIds)
        .in('size_id', sizeIds)
      if (cancelled) return

      const funnet = new Map<string, string | null>()
      if (error) {
        if (error.code === '42703') {
          setManglerMiniatyrKolonne(true)
          return
        }
        console.error('[MotivPicker] lat miniatyr-henting feilet', error)
        return
      }
      for (const row of (data ?? [])) {
        funnet.set(`${row.embroidery_id}:${row.size_id}`, row.miniatyr_svg ?? null)
      }
      setBboxCache(prev => {
        const next = new Map(prev)
        for (const p of uløste) {
          const key = `${p.embroideryId}:${p.sizeId}`
          const eksisterende = next.get(key)
          if (!eksisterende || eksisterende.miniatyrSvg !== undefined) continue
          next.set(key, { ...eksisterende, miniatyrSvg: funnet.get(key) ?? null })
        }
        return next
      })
    }
    hentMiniatyrer()
    return () => { cancelled = true }
  }, [view, searchQ, filterPaaRamme, virtuelleMotiver, bundlerMap, bboxCache, manglerMiniatyrKolonne, kategorierUtenEktebilde, standaloneVMs, bundleVMs])

  // ── UI-deler ──────────────────────────────────────────────────────────────

  function Topptekst({ tittel, onTilbake, handling }: {
    tittel: string
    onTilbake?: () => void
    // Valgfri handling helt til høyre i toppteksten (f.eks. «Skriv tekst» i tegnrutenettet).
    handling?: ReactNode
  }) {
    return (
      <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0 flex items-center gap-3">
        {onTilbake && (
          <button onClick={onTilbake} className="p-1 -ml-1 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <h3 className="font-serif text-xl text-stone-800 truncate flex-1">{tittel}</h3>
        {handling}
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
      forceRefreshCache() // hent bboxCache (og mangler-miniatyr-tellingen) på nytt
    } catch (err) {
      setProgress(`Feil: ${err instanceof Error ? err.message : 'Ukjent feil'}`)
    }
  }

  function ParseBunnlinje() {
    // Punkt 5, docs/plan-og-prompter-2026-08-25.md steg 3: talt i BASEN (manglerMiniatyrPromise
    // i lasteeffekten over), ALDRI ved å skanne bboxCache etter miniatyrSvg === null — etter
    // at grunnlasten sluttet å hente miniatyr_svg for alle rader, ville en slik skanning bare
    // talt "ikke ennå forsøkt hentet lat", ikke "mangler faktisk i basen". null her betyr
    // enten "ikke talt ennå" eller "kolonnen mangler" (manglerMiniatyrKolonne skiller dem).
    const antallUtenMiniatyr = manglerMiniatyrCount ?? 0
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
            {erFont ? 'Font' : stat === 'passer' ? `${antallPasser}/${vms.length} passer` : stat === 'ikkeMalt' ? 'Ikke målt' : 'Passer ikke i rammen'}
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
            {/* Eksplisitt tekst, ikke bare rødfarget mål — se KRAV 8: ingenting skal
               skjules pga. størrelse, bare merkes. Et tall alene ("45×89 mm") sier ikke
               SELV at det er for stort uten at man kjenner rammegrensen utenat. */}
            {stat === 'passerIkke' && ' · Passer ikke i rammen'}
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
          const bundleHer = bundlerMap.get(view.bundleId)
          const erFontHer = bundleHer ? getKats(bundleHer.data).some(k => k.toLowerCase() === 'font') : false
          const tilbakeTilTekst = () => setView({ type: 'tekst', bundleId: view.bundleId, fraKat: view.fraKat })
          return (
            <>
              <Topptekst tittel={bundleHer?.data.navn ?? ''}
                onTilbake={() => setView(
                  view.fraTekst
                    ? { type: 'tekst', bundleId: view.bundleId, fraKat: view.fraKat }
                    : view.fraKat !== undefined ? { type: 'kategori', kat: view.fraKat } : { type: 'kategorier' },
                )}
                handling={erFontHer ? (
                  <button onClick={tilbakeTilTekst}
                    className="flex-shrink-0 h-8 px-3 rounded-lg border border-stone-200 text-xs text-stone-600 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors">
                    Skriv tekst
                  </button>
                ) : undefined} />
              <p className="px-5 pt-3 text-xs text-stone-400">
                Trykk på et tegn for å sette det inn som et enkeltmotiv.
              </p>
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
              <div className="px-5 py-3 border-b border-stone-100 flex-shrink-0">
                <FilterPasserCheckbox checked={filterPaaRamme} onChange={setFilterPaaRamme} />
              </div>
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
              bundleId={view.bundleId}
              bundleNavn={bundleNavn}
              fontMetrikk={bundlerMap.get(view.bundleId)?.data.fontMetrikk}
              vms={vms}
              biblioteket={biblioteket}
              onLeggTil={items => onVelgFlere(items)}
              onBack={() => setView(fraKat !== undefined ? { type: 'kategori', kat: fraKat } : { type: 'kategorier' })}
              onEnkelttegn={() => setView({ type: 'tegn', bundleId: view.bundleId, fraKat, fraTekst: true })}
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
              <FilterPasserCheckbox checked={filterPaaRamme} onChange={setFilterPaaRamme} />
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
                    onClick={() => { setLasterFeil(null); setCacheLastet(false); forceRefreshCache() }}
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
