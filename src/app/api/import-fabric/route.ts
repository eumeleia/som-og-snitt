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
- vask: alle vaske-/pleielinjer slått sammen med ' · ', på norsk
- sertifisering: sertifisering som OEKO-TEX (f.eks. 'OEKO-TEX STANDARD 100' eller tom streng)
- bilde: første bilde-URL, full URL

Finn bredde/vekt/krymp/vask/sertifisering i properties-seksjonen, ikke i markedsføringsteksten. Hvis et felt mangler, bruk tom streng — ikke finn på.`

function extractSections(html: string): string {
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

  return parts.join('\n\n').slice(0, 200000)
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.7',
      },
    })

    if (!res.ok) {
      return NextResponse.json(
        { error: `HTTP ${res.status} – klarte ikke hente siden` },
        { status: 502 }
      )
    }

    const html = await res.text()
    const extracted = extractSections(html)

    if (!extracted.trim()) {
      return NextResponse.json(
        { error: 'Fant ingen relevant innhold i siden' },
        { status: 422 }
      )
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
      return NextResponse.json(
        { error: `Ugyldig svar fra Claude: ${raw.slice(0, 300)}` },
        { status: 500 }
      )
    }

    const fabric = JSON.parse(raw.slice(start, end + 1))
    return NextResponse.json({ fabric })
  } catch (err) {
    console.error('import-fabric error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 }
    )
  }
}
