import type { BxGlyf, BxMetrikk, FontMetrikk } from './types'
import { bxTommeStemmer, utledTomme, utledTommeFraBxSti, utledTommeFraSizeLabel } from './tomme'

// Svaret fra api/parse-bx, før filnavn/tidspunkt legges på.
export type BxParseSvar = Omit<BxMetrikk, 'filnavn' | 'lastInn'>

function endeligTall(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

function gyldigGlyf(g: unknown): g is BxGlyf {
  if (!g || typeof g !== 'object') return false
  const x = g as Record<string, unknown>
  return (x.tegn === null || typeof x.tegn === 'string') && typeof x.noekkel === 'string'
    && endeligTall(x.bredde) && endeligTall(x.hoyde) && x.hoyde > 0
    && endeligTall(x.grunnlinjeY) && endeligTall(x.underlengdeAndel)
}

// Data i databasen kan være skrevet av en eldre versjon, eller av en BX med en struktur vi
// ikke har sett — alt som ikke har formen under behandles som «ingen BX» (heuristikken
// tar over), aldri som en feil.
export function gyldigBxMetrikk(x: unknown): x is BxMetrikk {
  if (!x || typeof x !== 'object') return false
  const m = x as Record<string, unknown>
  return endeligTall(m.mHeight) && m.mHeight > 0 && Array.isArray(m.glyphs) && m.glyphs.every(gyldigGlyf)
}

// Tommestørrelsene en bundle faktisk har PES-filer for — samme utledning som
// motivvalg.ts bruker for tommeLabel (filnavnet først, så sizeLabel).
export function tommerForSizes(sizes: Array<{ pesFilename: string; sizeLabel: string }>): Set<string> {
  const ut = new Set<string>()
  for (const s of sizes) {
    const t = utledTomme(s.pesFilename)?.tomme
    if (t) ut.add(t)
    else for (const x of utledTommeFraSizeLabel(s.sizeLabel)) ut.add(x)
  }
  return ut
}

export interface BxFil {
  sti: string
  getData: () => Promise<Uint8Array>
}

export interface BxInnlesing {
  perTomme: Record<string, BxMetrikk>
  meldinger: string[]
}

// Parser hver BX og knytter den til én tomme. En fil som ikke lar seg tolke, eller der
// tommen ikke kan fastslås sikkert, gir en melding og hoppes over — aldri en kastet feil.
export async function lesBxFiler(
  filer: BxFil[],
  parse: (data: Uint8Array) => Promise<BxParseSvar>,
  tilgjengeligeTommer: Set<string>,
  naa: string = new Date().toISOString(),
): Promise<BxInnlesing> {
  const perTomme: Record<string, BxMetrikk> = {}
  const meldinger: string[] = []
  for (const fil of filer) {
    const filnavn = fil.sti.replace(/\\/g, '/').split('/').pop() ?? fil.sti
    const tomme = utledTommeFraBxSti(fil.sti)
    if (!tomme) {
      meldinger.push(`${filnavn}: fant ikke tommestørrelsen i stien — ikke brukt`)
      continue
    }
    let svar: BxParseSvar
    try {
      svar = await parse(await fil.getData())
    } catch (err) {
      meldinger.push(`${filnavn}: kunne ikke tolkes (${err instanceof Error ? err.message : String(err)}) — grunnlinja utledes som før`)
      continue
    }
    if (!gyldigBxMetrikk(svar)) {
      meldinger.push(`${filnavn}: svaret fra BX-parseren hadde ukjent form — ikke brukt`)
      continue
    }
    if (!bxTommeStemmer(tomme, svar.mHeight)) {
      meldinger.push(`${filnavn}: stien sier ${tomme}", men fonthøyden er ${(svar.mHeight / 254).toFixed(2)}" — ikke brukt`)
      continue
    }
    if (!tilgjengeligeTommer.has(tomme)) {
      meldinger.push(`${filnavn}: bundelen har ingen PES-filer i ${tomme}" — ikke brukt`)
      continue
    }
    if (perTomme[tomme]) {
      meldinger.push(`${filnavn}: det finnes allerede en BX for ${tomme}" (${perTomme[tomme].filnavn}) — ikke brukt`)
      continue
    }
    perTomme[tomme] = { ...svar, filnavn, lastInn: naa }
  }
  return { perTomme, meldinger }
}

// Ny bundle-data med BX-metrikken lagt inn og «font» som kategori. Rører ikke tegn,
// sporingAndel eller mellomromAndel — manuell kalibrering skal overleve en ny innlesing.
export function slaaInnBx<T extends { kategori?: string; kategorier?: string[]; fontMetrikk?: FontMetrikk }>(
  data: T,
  perTomme: Record<string, BxMetrikk>,
): T {
  if (Object.keys(perTomme).length === 0) return data
  const kats = data.kategorier && data.kategorier.length > 0
    ? data.kategorier
    : data.kategori ? [data.kategori] : []
  const kategorier = kats.some(k => k.toLowerCase() === 'font') ? kats : [...kats, 'font']
  const fm = data.fontMetrikk
  return {
    ...data,
    kategorier,
    fontMetrikk: { ...fm, tegn: fm?.tegn ?? {}, bx: { ...fm?.bx, ...perTomme } },
  }
}
