import { plassertUnderBbox, kombinerBbox, bokserOverlapper } from './geometri'
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

export function effektivFarge(ctx: SekvensKontekst, el: SekvensKjoring): string | undefined {
  if (el.fargeOverrideHex) return el.fargeOverrideHex
  return finnFargekjoring(ctx, el)?.kjoring.farge_hex
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

// Antall omtredninger = antall kjøringer etter at TILSTØTENDE kjøringer med samme
// effektive farge er slått sammen. En pause bryter alltid sammenslåingen, selv ved
// samme farge — maskinen stopper uansett, det er nettopp det pausen er til for.
export function tellOmtredninger(sekvens: SekvensElement[], ctx: SekvensKontekst): number {
  let count = 0
  let forrige: string | null = null
  for (const el of sekvens) {
    if (el.type === 'pause') { forrige = null; continue }
    const farge = effektivFarge(ctx, el)
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
  endrerLagrekkefolge: boolean
  overlappendeFarger: string[]
}

const MAKS_FORSLAG = 8

// Foreslår sammenslåing av par av IKKE-tilstøtende kjøringer med samme farge.
// "Sammenslåing" er alltid: flytt den andre kjøringen til rett etter den første i
// sekvensen — det er en ren reordering, stingblokkene inni røres aldri.
export function finnSammenslaingsforslag(
  sekvens: SekvensElement[],
  ctx: SekvensKontekst,
): { forslag: SammenslaingForslag[]; flereEnnVist: number } {
  const kjoringer = sekvens
    .map((el, idx) => ({ el, idx }))
    .filter((x): x is { el: SekvensKjoring; idx: number } => x.el.type === 'kjoring')

  const alle: SammenslaingForslag[] = []

  for (let a = 0; a < kjoringer.length; a++) {
    for (let b = a + 1; b < kjoringer.length; b++) {
      const iEl = kjoringer[a]
      const jEl = kjoringer[b]
      const fargeI = effektivFarge(ctx, iEl.el)
      const fargeJ = effektivFarge(ctx, jEl.el)
      if (!fargeI || !fargeJ || fargeI !== fargeJ) continue

      const mellomIndekser: number[] = []
      for (let k = iEl.idx + 1; k < jEl.idx; k++) mellomIndekser.push(k)
      if (mellomIndekser.length === 0) continue // allerede tilstøtende — ikke et forslag

      const mellomElementer = mellomIndekser.map(k => sekvens[k])
      // Alt mellom dem er allerede samme farge og ingen pause → allerede én omtredning i praksis.
      const alleSammeFargeUtenPause = mellomElementer.every(
        el => el.type === 'kjoring' && effektivFarge(ctx, el) === fargeI,
      )
      if (alleSammeFargeUtenPause) continue

      const forOmtredninger = tellOmtredninger(sekvens, ctx)
      const flyttet = flyttElementEtter(sekvens, jEl.el.id, iEl.el.id)
      const etterOmtredninger = tellOmtredninger(flyttet, ctx)
      const spart = forOmtredninger - etterOmtredninger
      if (spart <= 0) continue

      const mellomKjoringer = mellomElementer.filter((el): el is SekvensKjoring => el.type === 'kjoring')
      const fargerMellom = Array.from(
        new Set(mellomKjoringer.map(el => effektivFarge(ctx, el)).filter((f): f is string => !!f)),
      )

      const iBbox = plassertFargekjoringBbox(ctx, iEl.el)
      const jBbox = plassertFargekjoringBbox(ctx, jEl.el)
      const overlappendeFarger: string[] = []
      for (const mEl of mellomKjoringer) {
        const mFarge = effektivFarge(ctx, mEl)
        if (!mFarge || mFarge === fargeI) continue
        const mBbox = plassertFargekjoringBbox(ctx, mEl)
        if (!mBbox) continue
        const overlapper = (iBbox && bokserOverlapper(mBbox, iBbox)) || (jBbox && bokserOverlapper(mBbox, jBbox))
        if (overlapper && !overlappendeFarger.includes(mFarge)) overlappendeFarger.push(mFarge)
      }

      alle.push({
        iId: iEl.el.id,
        jId: jEl.el.id,
        farge: fargeI,
        sparteOmtredninger: spart,
        fargerMellom,
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
