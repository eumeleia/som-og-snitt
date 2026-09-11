import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PROMPT = `Du får utdrag fra en Selfmade-produktside. Returner KUN gyldig JSON, ingen forklaring:

{
  "navn": "",
  "materiale": "",
  "bredde": "",
  "vekt": "",
  "krymp": "",
  "vask": "",
  "sertifisering": "",
  "bilde": ""
}

Feltforklaring:
- navn: produktets navn
- materiale: hva stoffet er laget av (f.eks. '70% lin, 30% bomull')
- bredde: stoffbredde med 'cm' suffiks (f.eks. '140 cm')
- vekt: gram per kvadratmeter med enhet (f.eks. '160 g/m²', eller tom streng)
- krymp: krympverdi (f.eks. '3%' eller tom streng)
- vask: kombiner alt fra "Maintenance/Care"-seksjonen (vaskesymboler) OG eventuell "Vaskeanvisning"-tekst fra Properties, slå sammen med ' · ', på norsk
- sertifisering: sertifisering som OEKO-TEX (f.eks. 'OEKO-TEX STANDARD 100' eller tom streng)
- bilde: første bilde-URL, full URL

Finn bredde/vekt/krymp/vask/sertifisering i properties-seksjonen, ikke i markedsføringsteksten. Hvis et felt mangler, bruk tom streng — ikke finn på.`

export interface StoffData {
  navn:          string
  materiale:     string
  bredde:        string
  vekt:          string
  krymp:         string
  vask:          string
  sertifisering: string
  bilde:         string
}

export const HENT_SIDE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
}

/** Feil med en HTTP-status ferdig påsatt, slik at ruter som gjenbruker hentingen kan
 *  gjengi nøyaktig samme statuskode som denne ruta alltid har gitt. */
export class HentSideFeil extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function extractSections(html: string): string {
  const parts: string[] = []

  // Extract JSON-LD blocks (Product schema with name, image, sku)
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = jsonLdRegex.exec(html)) !== null) {
    parts.push(`=== JSON-LD ===\n${match[1].trim()}`)
  }

  // Extract properties section by looking for known id patterns in Shopware
  const propertiesIdPrefixes = ['propertiesToggle', 'properties-tab']
  let foundProperties = false
  for (const prefix of propertiesIdPrefixes) {
    const idx = html.indexOf(`id="${prefix}`)
    if (idx !== -1) {
      const tagStart = html.lastIndexOf('<', idx)
      parts.push(`=== Properties section ===\n${html.slice(tagStart, tagStart + 15000)}`)
      foundProperties = true
      break
    }
  }

  // Fallback: look for characteristic Norwegian property keywords
  if (!foundProperties) {
    const keywords = ['Bredde:', 'Krymp vask', 'OEKO-TEX', 'Vaskeanvisning', 'g/m²']
    for (const kw of keywords) {
      const idx = html.indexOf(kw)
      if (idx !== -1) {
        parts.push(`=== Properties (via "${kw}") ===\n${html.slice(Math.max(0, idx - 2000), idx + 8000)}`)
        break
      }
    }
  }

  // Extract care/maintenance symbols from maintenance-property-wrapper divs
  const maintenanceRegex = /<div[^>]*maintenance-property-wrapper[^>]*>[\s\S]*?alt="([^"]+)"/g
  const careLabels: string[] = []
  let m
  while ((m = maintenanceRegex.exec(html)) !== null) {
    if (m[1] && !careLabels.includes(m[1])) careLabels.push(m[1])
  }
  if (careLabels.length > 0) {
    parts.push(`=== Maintenance/Care ===\n${careLabels.join(' · ')}`)
  }

  return parts.join('\n\n').slice(0, 200000)
}

/** Claude-kallet alene, for gjenbruk når HTML-en allerede er hentet et annet sted
 *  (f.eks. /api/slaa-opp-vare, som også trenger produktnummer/brødsmulesti fra den
 *  samme siden og ellers måtte hentet den to ganger). */
export async function hentStoffdataFraHtml(html: string): Promise<StoffData> {
  const extracted = extractSections(html)
  if (!extracted.trim()) {
    throw new HentSideFeil('Fant ingen relevant innhold i siden', 422)
  }

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: `${PROMPT}\n\nSideinnhold:\n${extracted}` }],
  })

  const raw = (msg.content[0] as Anthropic.TextBlock).text.trim()
  const start = raw.indexOf('{')
  const end   = raw.lastIndexOf('}')

  if (start === -1 || end === -1) {
    throw new HentSideFeil(`Ugyldig svar fra Claude: ${raw.slice(0, 300)}`, 500)
  }

  return JSON.parse(raw.slice(start, end + 1)) as StoffData
}

export async function hentStoffdata(url: string): Promise<StoffData> {
  const res = await fetch(url, { headers: HENT_SIDE_HEADERS })
  if (!res.ok) {
    throw new HentSideFeil(`HTTP ${res.status} – klarte ikke hente siden`, 502)
  }
  const html = await res.text()
  return hentStoffdataFraHtml(html)
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    const fabric = await hentStoffdata(url)
    return NextResponse.json({ fabric })
  } catch (err) {
    console.error('import-fabric error:', err)
    const status = err instanceof HentSideFeil ? err.status : 500
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status },
    )
  }
}
