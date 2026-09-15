// Ren logikk for lesing av Selfmade-kvitteringer — ingen nettkall, se kvittering.test.ts.
// Dato- og summeringsaritmetikk gjøres HER, ikke av modellen: Claude skal bare lese det
// som står trykt, ikke regne eller konvertere.

export interface KvitteringLinje {
  produktnummer: string
  navn:          string
  antall:        number
  enhetspris:    number
  linjesum:      number
}

export interface KvitteringRabatt {
  tekst: string
  belop: number
}

export interface KvitteringResultat {
  bilagsnummer: string
  dato:         string
  butikk:       string
  sum:          number
  linjer:       KvitteringLinje[]
  rabatter:     KvitteringRabatt[]
}

export interface SummeringssjekkResultat {
  ok:          boolean
  differanse: number
}

const TOLERANSE = 0.05

/** DD-MM-YYYY, slik det står trykt på kvitteringen, til ISO YYYY-MM-DD. */
export function parseKvitteringDato(raw: string): string {
  const match = raw.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (!match) throw new Error(`Ugyldig datoformat på kvittering: «${raw}» (forventet DD-MM-YYYY)`)
  const [, dag, maaned, aar] = match
  return `${aar}-${maaned}-${dag}`
}

/**
 * sum(linjesum) + sum(rabatt.belop) skal stemme med sum fra kvitteringen, med 0,05
 * i slingring for øreavrunding. Dette er den eneste billige kontrollen på at et
 * krøllete bilde i skrå sol er lest riktig.
 */
export function sjekkSummering(
  linjer:   KvitteringLinje[],
  rabatter: KvitteringRabatt[],
  sum:      number,
): SummeringssjekkResultat {
  const linjesum  = linjer.reduce((acc, l) => acc + l.linjesum, 0)
  const rabattsum = rabatter.reduce((acc, r) => acc + r.belop, 0)
  const differanse = Math.round((linjesum + rabattsum - sum) * 100) / 100
  return { ok: Math.abs(differanse) <= TOLERANSE, differanse }
}

/**
 * Bilagsnummeret må overleve som streng — den ledende nullen forsvinner hvis noen
 * (Claude eller JSON.parse) har gjort det om til et tall underveis. Kaster tydelig
 * i stedet for å late som et number-bilagsnummer er brukbart.
 */
export function normaliserBilagsnummer(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  throw new Error(
    `Bilagsnummer ble ikke lest som streng (fikk ${typeof raw}: ${JSON.stringify(raw)}) — ` +
    'avlesningen er ikke til å stole på.',
  )
}

/**
 * Filnavnet kvitteringsbildet arkiveres under i Drive — originalfilens ENDELSE (aldri den
 * nedskalerte JPEG-en som ble sendt til Claude), normalisert til små bokstaver siden noen
 * iPhone-innstillinger gir «.HEIC».
 */
export function byggKvitteringsfilnavn(dato: string, bilagsnummer: string, originaltFilnavn: string): string {
  const prikk = originaltFilnavn.lastIndexOf('.')
  const endelse = prikk === -1 ? 'jpg' : originaltFilnavn.slice(prikk + 1).toLowerCase()
  return `${dato}-${bilagsnummer}.${endelse}`
}

// Vercel avviser request-bodyer over denne grensa med 413 FUNCTION_PAYLOAD_TOO_LARGE FØR
// funksjonen kjører — udokumentert, men målt. MAKS_FILSTORRELSE i les-kvittering/route.ts
// (20 MB) er dermed dødt for filer mellom denne grensa og 20 MB; plattformen har alt sagt nei.
export const VERCEL_PAYLOAD_GRENSE_MB = 4.5
export const VERCEL_PAYLOAD_GRENSE_BYTES = VERCEL_PAYLOAD_GRENSE_MB * 1024 * 1024

/**
 * Samme regel som sharp bruker server-side i lib/heic.ts (`fit: 'inside',
 * withoutEnlargement: true`): skaler ned til maks `maksSide` på lengste kant, aldri opp.
 */
export function beregnMaalstorrelse(
  bredde: number, hoyde: number, maksSide = 1568,
): { bredde: number; hoyde: number } {
  const lengsteSide = Math.max(bredde, hoyde)
  if (lengsteSide <= maksSide) return { bredde, hoyde }
  const skala = maksSide / lengsteSide
  return { bredde: Math.round(bredde * skala), hoyde: Math.round(hoyde * skala) }
}

export type KvitteringSendestrategi = 'skaler' | 'send-original' | 'avvis'

/**
 * Kan nettleseren dekode bildet (PNG/JPEG, og HEIC der plattformen selv støtter det)?
 * Da skaleres det ned client-side uansett størrelse. Kan den ikke (typisk HEIC i Chrome),
 * er originalen eneste mulighet — send den hvis den er under Vercels grense, ellers finnes
 * det ingenting denne koden kan gjøre med den.
 */
export function velgKvitteringsstrategi(kanDekodes: boolean, storrelseBytes: number): KvitteringSendestrategi {
  if (kanDekodes) return 'skaler'
  return storrelseBytes <= VERCEL_PAYLOAD_GRENSE_BYTES ? 'send-original' : 'avvis'
}
