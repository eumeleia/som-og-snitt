// Arbeidskopi av en PDF: filen midlertidig lagt i Supabase Storage mens prosjektet
// er aktivt. Originalen ligger i Drive hele veien og røres aldri herfra.
//
// Hvorfor kopien må finnes: PDF-leseren kjører pdfjs i NETTLESEREN og må ha en
// adresse den selv kan hente bytes fra. En Drive-fil har ingen slik adresse —
// Googles egen dokumentasjon sier at nedlasting i nettleser må gå via
// webContentLink, ikke via et API-kall fra JavaScript, og den lenken kan ikke
// leses inn i sidens minne fra et annet domene.
//
// Og å la en egen rute levere filen videre til nettleseren er stengt: Vercel har
// et tak på 4,5 MB for både forespørsels- og svarkropp, og nitten av
// oppskrifts-PDF-ene er større enn det (største er 28 MB). Bytene kan bare
// passere server-til-server, som i /api/drive/hent-arbeidskopi.
//
// Merknadene (pins, tekstbokser, bokmerket for hvor du var sist) ligger på
// prosjektraden i databasen, ikke inni PDF-en. De overlever at kopien slettes,
// og treffer riktig side når den hentes inn igjen.

export interface ArbeidskopiPdf {
  id: string
  url: string
  storage?: 'supabase' | 'drive'
  driveFileId?: string
  driveLink?: string
}

export const NOTAT_OVERSKRIFT = 'Notater fra PDF-ene:'

async function lesFeil(res: Response, hvor: string): Promise<string> {
  const tekst = await res.text()
  try {
    return (JSON.parse(tekst) as { error?: string }).error ?? `HTTP ${res.status} fra ${hvor}`
  } catch {
    return `HTTP ${res.status} fra ${hvor}: ${tekst.slice(0, 200)}`
  }
}

/** Kopierer PDF-en fra Drive til Supabase og gir tilbake elementet med ny adresse. */
export async function hentArbeidskopi<T extends ArbeidskopiPdf>(pdf: T): Promise<T> {
  if (pdf.storage !== 'drive') return pdf
  if (!pdf.driveFileId) {
    throw new Error('Mangler driveFileId — denne PDF-en kan ikke hentes fra Drive')
  }
  const res = await fetch('/api/drive/hent-arbeidskopi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driveFileId: pdf.driveFileId, pdfId: pdf.id }),
  })
  if (!res.ok) throw new Error(await lesFeil(res, 'hent-arbeidskopi'))
  const body = await res.json() as { url: string }
  // driveLink beholdes urørt: den er veien tilbake når kopien siden slettes.
  return { ...pdf, url: body.url, storage: 'supabase' as const }
}

/** Sletter kopien i Supabase og peker elementet tilbake på Drive-originalen. */
export async function slettArbeidskopi<T extends ArbeidskopiPdf>(pdf: T): Promise<T> {
  if (pdf.storage === 'drive') return pdf
  if (!pdf.driveFileId) {
    throw new Error('Mangler driveFileId — uten en original i Drive er dette den eneste kopien')
  }
  const res = await fetch('/api/drive/slett-arbeidskopi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driveFileId: pdf.driveFileId, url: pdf.url }),
  })
  if (!res.ok) throw new Error(await lesFeil(res, 'slett-arbeidskopi'))
  if (!pdf.driveLink) {
    throw new Error('Kopien ble slettet, men driveLink mangler — åpne filen i Drive manuelt')
  }
  return { ...pdf, url: pdf.driveLink, storage: 'drive' as const }
}

export interface TekstAnnotasjon {
  pdfId: string
  page: number
  text: string
}

/**
 * Skriver merknadene ut som lesbar tekst, gruppert per PDF og sortert på side.
 * Brukes når et prosjekt fullføres, slik at det du lærte kan leses uten å åpne
 * PDF-leseren — merknadene blir uansett liggende der de er.
 */
export function annotasjonerSomTekst(
  annotasjoner: TekstAnnotasjon[],
  pdfNavn: (pdfId: string) => string,
): string {
  const perPdf = new Map<string, TekstAnnotasjon[]>()
  for (const a of annotasjoner) {
    if (!a.text?.trim()) continue
    const liste = perPdf.get(a.pdfId)
    if (liste) liste.push(a)
    else perPdf.set(a.pdfId, [a])
  }
  if (perPdf.size === 0) return ''

  const deler: string[] = []
  for (const [pdfId, liste] of perPdf) {
    liste.sort((a, b) => a.page - b.page)
    deler.push(`${pdfNavn(pdfId)}:`)
    for (const a of liste) deler.push(`  Side ${a.page}: ${a.text.trim()}`)
    deler.push('')
  }
  return deler.join('\n').trimEnd()
}
