import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PROMPT = `Du får HTML-innhold fra en produktside for stoff. Finn og returner JSON med følgende felter (alle på norsk, tom streng hvis ikke funnet):
{
  "navn": "produktets navn",
  "materiale": "hva stoffet er laget av (f.eks. '100% bomull')",
  "bredde": "stoffbredde i cm (bare tallet, f.eks. '140')",
  "vekt": "gram per kvadratmeter (bare tallet, f.eks. '120')",
  "vask": "vaskeinstruksjoner (alle relevante linjer, separert med ' · ')",
  "bilde": "URL til hovedbildet hvis funnet"
}

Returner KUN JSON, ingen forklaring. Pleieinfo ligger ofte i en 'Egenskaper'-seksjon som er kollapset i UI-en, men HTML-en inneholder dataen. Let i hele HTML-en, inkludert JSON-LD og data-attributter.`

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

    // Strip scripts, styles and comments to get more content within the limit
    let html = await res.text()
    html = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .slice(0, 50000)

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `${PROMPT}\n\nHTML:\n${html}` }],
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
