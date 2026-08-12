import {
  plassertUnderBbox, kombinerBbox, bokserOverlapper, plassertPunkter, interpolerSting, rasterCeller, cellerKolliderer,
} from './geometri'
import { snappTilPalett } from './broderPalett'
import type {
  BroderiBbox, BroderiMotivData, PlassertMotiv, SekvensElement, SekvensKjoring,
} from './types'

export function motivKey(embroideryId: string, sizeId: string): string {
  return `${embroideryId}:${sizeId}`
}

export interface SekvensKontekst {
  motiver: PlassertMotiv[]
  resolved: Record<string, BroderiMotivData>
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export function finnPlassertMotiv(ctx: SekvensKontekst, plassertMotivId: string): PlassertMotiv | undefined {
  return ctx.motiver.find(pm => pm.id === plassertMotivId)
}

function finnMotivData(ctx: SekvensKontekst, pm: PlassertMotiv): BroderiMotivData | undefined {
  return ctx.resolved[motivKey(pm.embroideryId, pm.sizeId)]
}

// Underliggende, ALDRI-endrede fargekjøringsdata (fra parse-pes-cachen) for et
// sekvenselement. Returnerer undefined mens motivet fortsatt tolkes.
export function finnFargekjoring(ctx: SekvensKontekst, el: SekvensKjoring) {
  const pm = finnPlassertMotiv(ctx, el.plassertMotivId)
  if (!pm) return undefined
  const data = finnMotivData(ctx, pm)
  const kjoring = data?.fargekjoringer[el.fargekjoringIndex]
  if (!pm || !data || !kjoring) return undefined
  return { pm, data, kjoring }
}

// Den RÅ effektive fargen — brukerens overstyring hvis den finnes, ellers fargen slik
// den ble tolket fra kildefila. IKKE snappet til Brother-paletten. Trengs bare til å vise
// «opprinnelig farge»; alt som skal representere hva maskinen faktisk syr (telling,
// likhetstester, eksport, visning) skal bruke effektivTradfarge under.
export function effektivFargeRaa(ctx: SekvensKontekst, el: SekvensKjoring): string | undefined {
  if (el.fargeOverrideHex) return el.fargeOverrideHex
  return finnFargekjoring(ctx, el)?.kjoring.farge_hex
}

// Den effektive TRÅDFARGEN — effektivFargeRaa snappet til nærmeste farge i Brothers
// 64-fargers palett (snappTilPalett), altså den samme fargen PesWriter kommer til å
// bruke når fila faktisk bygges. Dette er fargen "sant" i appens forstand: to kjøringer
// som snapper likt ER samme tråd, selv om de rå hex-verdiene er ulike.
export function effektivTradfarge(ctx: SekvensKontekst, el: SekvensKjoring): { hex: string; navn: string } | undefined {
  const raa = effektivFargeRaa(ctx, el)
  if (!raa) return undefined
  return snappTilPalett(raa)
}

// Snappet trådfarge PER STINGBLOKK per plassert motiv, for ALLE blokker — ikke bare de
// som er dekket av en kjøring i sekvensen. Palett-snapping er billig for ett kall, men
// lerretet og miniatyren tegner opptil tusenvis av blokker per rendring; å snappe INNI
// den løkken ville gjort det samme oppslaget på nytt for hver enkelt polyline. Regn den
// ut HER, én gang per sekvens-/motiv-endring (se kalleren, KomposisjonEditor.tsx), og slå
// bare opp i det ferdige arrayet i selve rendringen.
//
// To lag: (1) hver blokk fylles først med SIN EGEN rå farge_hex snappet til paletten —
// dette er den eneste plassen i appen der en blokk uten egen kjøring (eller en sekvens
// som ennå ikke har rukket å synkroniseres for dette motivet) likevel får en snappet
// farge, i stedet for at kalleren måtte falle tilbake til en rå hex-verdi selv. (2) alle
// blokker som faktisk inngår i en kjøring i sekvensen overskrives med kjøringens
// EFFEKTIVE farge (inkl. en eventuell brukeroverstyring) — samme som før. Resultatet er
// et array uten hull: komponenten skal aldri trenge en "?? rå-farge"-fallback selv.
// Nøkkelen er plassertMotivId, indeksen er stingblokk-indeksen i motivets egen
// data.stingblokker — en kjøring kan spenne flere blokker (fra_index..til_index), og
// ALLE dem får samme (snappede) farge.
export function byggFargePerBlokk(
  sekvens: SekvensElement[], ctx: SekvensKontekst,
): Record<string, string[]> {
  const ut: Record<string, string[]> = {}
  for (const pm of ctx.motiver) {
    const data = ctx.resolved[motivKey(pm.embroideryId, pm.sizeId)]
    if (!data) continue
    ut[pm.id] = data.stingblokker.map(b => snappTilPalett(b.farge_hex).hex)
  }
  for (const el of sekvens) {
    if (el.type !== 'kjoring') continue
    const funn = finnFargekjoring(ctx, el)
    if (!funn) continue
    const { kjoring } = funn
    const tradfarge = effektivTradfarge(ctx, el)
    if (!tradfarge) continue
    const arr = ut[el.plassertMotivId]
    if (!arr) continue
    for (let i = kjoring.fra_index; i <= kjoring.til_index; i++) {
      if (i >= 0 && i < arr.length) arr[i] = tradfarge.hex
    }
  }
  return ut
}

// Bbox for selve fargekjøringen (ikke hele motivet), plassert på lerretet etter
// motivets rotasjon+posisjon — brukes til overlapptesten ved sammenslåingsforslag.
export function plassertFargekjoringBbox(ctx: SekvensKontekst, el: SekvensKjoring): BroderiBbox | undefined {
  const funn = finnFargekjoring(ctx, el)
  if (!funn) return undefined
  const { pm, data, kjoring } = funn
  const motivBbox = data.bbox
  if (!motivBbox) return undefined
  const underBokser: BroderiBbox[] = []
  for (let i = kjoring.fra_index; i <= kjoring.til_index; i++) {
    const blokk = data.stingblokker[i]
    if (blokk) underBokser.push(blokk.bbox)
  }
  const underBbox = kombinerBbox(underBokser)
  if (!underBbox) return undefined
  return plassertUnderBbox(underBbox, motivBbox, pm.rotasjonGrader, pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm)
}

const OVERLAPP_CELLE_TIENDEDEL_MM = 10 // ≈ 1 mm per celle

// Steglengden ved interpolering langs stingene før rasterisering (se beregnFargekjoringRaster
// under og interpolerSting i geometri.ts) — en halv rastercelle, altså 5 tiendedels mm ≈ 0,5 mm.
// Regnet ut FRA cellestørrelsen (ikke et eget fast tall) så de to alltid forblir i det
// tiltenkte forholdet til hverandre.
const OVERLAPP_INTERPOLER_STEG_TIENDEDEL_MM = OVERLAPP_CELLE_TIENDEDEL_MM / 2

// Bygger rasteret for én fargekjøring BLOKK FOR BLOKK, aldri over hele kjøringens flate
// stingliste. En fargekjøring kan spenne flere stingblokker (kjoring.fra_index..til_index),
// og grensen mellom to blokker kan være et klipp — der finnes ingen tråd. Å flate ut alle
// blokkenes sting til én liste og interpolere over DEN ville trekke en falsk linje fra siste
// sting i én blokk til første sting i neste, tvers over klippet, og gi falske kollisjoner.
// Derfor: interpoler og rasteriser hver blokk for seg, og slå bare sammen CELLENE (ikke
// punktene) i ett Set til slutt — ingen interpolert linje kan da krysse en blokkgrense.
// plassertFargekjoringBbox er fortsatt riktig verktøy der en rask, grov boks er nok (den
// brukes andre steder som forhåndssjekk); dette dekker selve den presise overlapptesten.
function beregnFargekjoringRaster(ctx: SekvensKontekst, el: SekvensKjoring): Set<string> | undefined {
  const funn = finnFargekjoring(ctx, el)
  if (!funn) return undefined
  const { pm, data, kjoring } = funn
  const motivBbox = data.bbox
  if (!motivBbox) return undefined
  const celler = new Set<string>()
  let harSting = false
  for (let i = kjoring.fra_index; i <= kjoring.til_index; i++) {
    const blokk = data.stingblokker[i]
    if (!blokk || blokk.sting.length === 0) continue
    harSting = true
    const interpolert = interpolerSting(blokk.sting, OVERLAPP_INTERPOLER_STEG_TIENDEDEL_MM)
    const plassert = plassertPunkter(interpolert, motivBbox, pm.rotasjonGrader, pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm)
    for (const celle of rasterCeller(plassert, OVERLAPP_CELLE_TIENDEDEL_MM)) celler.add(celle)
  }
  return harSting ? celler : undefined
}

// Rutenettet for en kjøring kan koste å bygge (opptil tusenvis av sting) og avhenger BARE av
// motivets egen geometri (faktiske stingpunkter, posisjon, rotasjon) — ALDRI av rekkefølgen i
// sekvensen. cache er derfor gyldig på tvers av enhver omrokkering, og skal bare nullstilles av
// kalleren når selve motivene (ctx) endres — se rasterCache i SekvensPanel.tsx.
export function plassertFargekjoringRaster(
  ctx: SekvensKontekst, el: SekvensKjoring, cache: Map<string, Set<string> | null>,
): Set<string> | undefined {
  const key = `${el.plassertMotivId}:${el.fargekjoringIndex}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached ?? undefined
  const raster = beregnFargekjoringRaster(ctx, el) ?? null
  cache.set(key, raster)
  return raster ?? undefined
}

// Antall omtredninger = antall kjøringer etter at TILSTØTENDE kjøringer med samme
// effektive TRÅDFARGE (snappet, ikke rå) er slått sammen. En pause bryter alltid
// sammenslåingen, selv ved samme farge — maskinen stopper uansett, det er nettopp det
// pausen er til for. Må bruke den snappede fargen: to rå hex-verdier som er ULIKE kan
// snappe til samme palettfarge, og da blir de faktisk EN omtredning i fila, uansett hva
// de rå verdiene sier.
export function tellOmtredninger(sekvens: SekvensElement[], ctx: SekvensKontekst): number {
  let count = 0
  let forrige: string | null = null
  for (const el of sekvens) {
    if (el.type === 'pause') { forrige = null; continue }
    const farge = effektivTradfarge(ctx, el)?.hex
    if (farge === undefined) continue
    if (farge !== forrige) count++
    forrige = farge
  }
  return count
}

export function flyttElementEtter(sekvens: SekvensElement[], flyttId: string, etterId: string): SekvensElement[] {
  const flyttet = sekvens.find(el => el.id === flyttId)
  if (!flyttet) return sekvens
  const uten = sekvens.filter(el => el.id !== flyttId)
  const idx = uten.findIndex(el => el.id === etterId)
  if (idx === -1) return sekvens
  return [...uten.slice(0, idx + 1), flyttet, ...uten.slice(idx + 1)]
}

export interface SammenslaingForslag {
  iId: string
  jId: string
  farge: string
  sparteOmtredninger: number
  fargerMellom: string[]
  mellomKjoringIder: string[]
  endrerLagrekkefolge: boolean
  overlappendeFarger: string[]
}

const MAKS_FORSLAG = 8

// Returnerer true hvis sekvensen bevarer rekkefølgen innenfor hvert motiv:
// for et gitt plassertMotivId må fargekjoringIndex-verdiene øke monotont gjennom sekvensen.
export function bevarerMotivRekkefølge(sekvens: SekvensElement[]): boolean {
  const sist = new Map<string, number>()
  for (const el of sekvens) {
    if (el.type !== 'kjoring') continue
    const prev = sist.get(el.plassertMotivId)
    if (prev !== undefined && el.fargekjoringIndex <= prev) return false
    sist.set(el.plassertMotivId, el.fargekjoringIndex)
  }
  return true
}

// Foreslår sammenslåing av par av IKKE-tilstøtende kjøringer med samme TRÅDFARGE (snappet,
// ikke rå) — to kjøringer som snapper likt ER samme tråd i fila, selv om de rå hex-verdiene
// er ulike, så de skal regnes som kandidater her. At det gir FLERE forslag enn en ren
// rå-hex-sammenligning ville gjort, er riktig, ikke en bug.
// "Sammenslåing" er alltid: flytt den andre kjøringen til rett etter den første i
// sekvensen — det er en ren reordering, stingblokkene inni røres aldri.
export function finnSammenslaingsforslag(
  sekvens: SekvensElement[],
  ctx: SekvensKontekst,
  rasterCache: Map<string, Set<string> | null> = new Map(),
): { forslag: SammenslaingForslag[]; flereEnnVist: number } {
  const kjoringer = sekvens
    .map((el, idx) => ({ el, idx }))
    .filter((x): x is { el: SekvensKjoring; idx: number } => x.el.type === 'kjoring')

  const alle: SammenslaingForslag[] = []

  for (let a = 0; a < kjoringer.length; a++) {
    for (let b = a + 1; b < kjoringer.length; b++) {
      const iEl = kjoringer[a]
      const jEl = kjoringer[b]
      const fargeI = effektivTradfarge(ctx, iEl.el)?.hex
      const fargeJ = effektivTradfarge(ctx, jEl.el)?.hex
      if (!fargeI || !fargeJ || fargeI !== fargeJ) continue

      const mellomIndekser: number[] = []
      for (let k = iEl.idx + 1; k < jEl.idx; k++) mellomIndekser.push(k)
      if (mellomIndekser.length === 0) continue // allerede tilstøtende — ikke et forslag

      const mellomElementer = mellomIndekser.map(k => sekvens[k])
      // Alt mellom dem er allerede samme farge og ingen pause → allerede én omtredning i praksis.
      const alleSammeFargeUtenPause = mellomElementer.every(
        el => el.type === 'kjoring' && effektivTradfarge(ctx, el)?.hex === fargeI,
      )
      if (alleSammeFargeUtenPause) continue

      const forOmtredninger = tellOmtredninger(sekvens, ctx)
      const flyttet = flyttElementEtter(sekvens, jEl.el.id, iEl.el.id)
      const etterOmtredninger = tellOmtredninger(flyttet, ctx)
      const spart = forOmtredninger - etterOmtredninger
      if (spart <= 0) continue
      if (!bevarerMotivRekkefølge(flyttet)) continue

      const mellomKjoringer = mellomElementer.filter((el): el is SekvensKjoring => el.type === 'kjoring')
      const fargerMellom = Array.from(
        new Set(mellomKjoringer.map(el => effektivTradfarge(ctx, el)?.hex).filter((f): f is string => !!f)),
      )

      // Sammenslåingen flytter ALDRI i — bare j, til rett etter i. Rekkefølgen mellom i og
      // hvert mellom-element er derfor UENDRET av flyttingen (i lå før dem, og ligger fortsatt
      // før dem) — det er bare j sin rekkefølge relativt til dem som kan bytte side (j lå etter
      // dem, ligger nå før). Bare overlapp med j sitt sting-rutenett er derfor en reell
      // lagrekkefølge-risiko; overlapp med i alene endrer ingenting og skal ikke varsles.
      const jBbox = plassertFargekjoringBbox(ctx, jEl.el)
      const overlappendeFarger: string[] = []
      if (jBbox) {
        for (const mEl of mellomKjoringer) {
          const mFarge = effektivTradfarge(ctx, mEl)?.hex
          if (!mFarge || mFarge === fargeI) continue
          const mBbox = plassertFargekjoringBbox(ctx, mEl)
          // Bbox-krysset er en billig FORHÅNDSSJEKK, ikke selve avgjørelsen — to bokser kan
          // krysse hverandre uten at et enkelt sting fra de to formene faktisk møtes. Bare når
          // boksene i det hele tatt krysser, er det verdt å bygge de (dyrere) sting-rutenettene
          // og sjekke en presis cellekollisjon.
          if (!mBbox || !bokserOverlapper(mBbox, jBbox)) continue
          const jRaster = plassertFargekjoringRaster(ctx, jEl.el, rasterCache)
          const mRaster = plassertFargekjoringRaster(ctx, mEl, rasterCache)
          const kolliderer = jRaster && mRaster && cellerKolliderer(jRaster, mRaster)
          if (kolliderer && !overlappendeFarger.includes(mFarge)) overlappendeFarger.push(mFarge)
        }
      }

      alle.push({
        iId: iEl.el.id,
        jId: jEl.el.id,
        farge: fargeI,
        sparteOmtredninger: spart,
        fargerMellom,
        mellomKjoringIder: mellomKjoringer.map(el => el.id),
        endrerLagrekkefolge: overlappendeFarger.length > 0,
        overlappendeFarger,
      })
    }
  }

  alle.sort((a, b) => b.sparteOmtredninger - a.sparteOmtredninger)
  return { forslag: alle.slice(0, MAKS_FORSLAG), flereEnnVist: Math.max(0, alle.length - MAKS_FORSLAG) }
}

export interface FasesorteringStatus {
  kan: boolean
  grunn?: string
}

export function sjekkFasesortering(ctx: SekvensKontekst): FasesorteringStatus {
  if (ctx.motiver.length < 2) {
    return { kan: false, grunn: 'Trenger minst to plasserte motiver' }
  }
  const fargelister: (string[] | undefined)[] = ctx.motiver.map(pm => {
    const data = finnMotivData(ctx, pm)
    return data?.fargekjoringer.map(k => k.farge_hex)
  })
  if (fargelister.some(f => !f)) {
    return { kan: false, grunn: 'Venter på at alle motiver skal tolkes' }
  }
  const forste = fargelister[0] as string[]
  for (let i = 1; i < fargelister.length; i++) {
    const f = fargelister[i] as string[]
    if (f.length !== forste.length) {
      return { kan: false, grunn: `Motivene har ulikt antall fargekjøringer (${forste.length} mot ${f.length})` }
    }
    for (let j = 0; j < f.length; j++) {
      if (f[j] !== forste[j]) {
        return { kan: false, grunn: 'Motivene har ulik fargerekkefølge' }
      }
    }
  }
  return { kan: true }
}

// Bygger om sekvensen til: kjøring 1 fra alle motiver, så kjøring 2 fra alle, osv.
// Beholder eksisterende fargeoverride pr. (motiv, kjøringsindeks) — pauser forsvinner,
// siden de gamle posisjonene ikke nødvendigvis gir mening i den nye rekkefølgen.
export function fasesorter(sekvens: SekvensElement[], ctx: SekvensKontekst): SekvensElement[] {
  const overrides = new Map<string, string>()
  for (const el of sekvens) {
    if (el.type === 'kjoring' && el.fargeOverrideHex) {
      overrides.set(`${el.plassertMotivId}:${el.fargekjoringIndex}`, el.fargeOverrideHex)
    }
  }
  const antallFaser = finnMotivData(ctx, ctx.motiver[0])?.fargekjoringer.length ?? 0
  const ny: SekvensElement[] = []
  for (let fase = 0; fase < antallFaser; fase++) {
    for (const pm of ctx.motiver) {
      ny.push({
        id: uid(),
        type: 'kjoring',
        plassertMotivId: pm.id,
        fargekjoringIndex: fase,
        fargeOverrideHex: overrides.get(`${pm.id}:${fase}`),
      })
    }
  }
  return ny
}

// Legger til sekvenselementer for nylig tilkomne motiver (så snart de er tolket) og
// fjerner elementer som pekte på motiver som ikke lenger er plassert.
export function synkroniserSekvens(sekvens: SekvensElement[], ctx: SekvensKontekst): SekvensElement[] {
  let ny = sekvens
  let endret = false

  for (const pm of ctx.motiver) {
    const harElementer = ny.some(el => el.type === 'kjoring' && el.plassertMotivId === pm.id)
    if (harElementer) continue
    const data = finnMotivData(ctx, pm)
    if (!data) continue
    const nye: SekvensElement[] = data.fargekjoringer.map((_, i) => ({
      id: uid(), type: 'kjoring', plassertMotivId: pm.id, fargekjoringIndex: i,
    }))
    if (nye.length > 0) {
      ny = [...ny, ...nye]
      endret = true
    }
  }

  const gyldigeIder = new Set(ctx.motiver.map(pm => pm.id))
  const filtrert = ny.filter(el => el.type === 'pause' || gyldigeIder.has(el.plassertMotivId))
  if (filtrert.length !== ny.length) endret = true

  return endret ? filtrert : sekvens
}

export function nyPause(): SekvensElement {
  return { id: uid(), type: 'pause' }
}
