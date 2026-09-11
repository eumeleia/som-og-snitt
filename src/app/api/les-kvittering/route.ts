import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { sniffBildeformat, forberedBilde, UgyldigBildeError } from '@/lib/heic'
import {
  parseKvitteringDato,
  sjekkSummering,
  normaliserBilagsnummer,
  type KvitteringLinje,
  type KvitteringRabatt,
} from '@/lib/kvittering'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MAKS_FILSTORRELSE = 20 * 1024 * 1024 // 20 MB

const PROMPT = `Du får et bilde av en kvittering fra Selfmade (stoffbutikk). Les den nøyaktig slik
den står trykt — ikke regn, ikke konverter, ikke gjett. Returner KUN gyldig JSON, ingen
forklaring:

{
  "bilagsnummer": "",
  "dato": "",
  "butikk": "",
  "sum": 0,
  "linjer": [
    { "produktnummer": "", "navn": "", "antall": 0, "enhetspris": 0, "linjesum": 0 }
  ],
  "rabatter": [
    { "tekst": "", "belop": 0 }
  ]
}

Feller å unngå, sett fra seks ekte kvitteringer:

- bilagsnummer: en STRENG, ALLTID i anførselstegn i JSON-svaret, selv om det består kun av
  siffer. Den kan ha en ledende null (f.eks. "02400100381832") — den nullen må overleve.
- dato: kvitteringen bruker DD-MM-YYYY (f.eks. "30-05-2026" er 30. mai). Returner den RÅ,
  akkurat som trykt, i feltet "dato" — IKKE konvertert til ISO. Det gjør koden etterpå.
- produktnummeret for en vare står på LINJEN OVER navnet, ikke ved siden av. Hver vare er
  altså to linjer på kvitteringen.
- navn kan være kuttet midt i ordet (kvitteringsskriveren klipper ved rundt 29 tegn).
  Returner navnet slik det står, ikke gjett hva resten var. Kvitteringen kan bruke danske
  navn på norske varer (f.eks. "Vævet hvid med blomster") — behold dem som de står.
- "Line discount" (eller lignende rabattekst) er en EGEN linje som trekker fra på
  totalen, og hører ikke synlig til noen bestemt vare. Den skal ALDRI legges inn som en
  varelinje — den hører hjemme i "rabatter".
- antall-tallet skal bare LESES, ikke tolkes — det kan være meter, stykk eller noe annet,
  det avgjøres ikke her.
- to linjer kan ha SAMME varenavn men ulikt produktnummer (f.eks. ulike trådfarger, eller
  ulike moduler). Slå ALDRI sammen linjer på navn — hver linje på kvitteringen blir én
  egen linje i "linjer", uansett om navnet er identisk med en annen linje.
- hvis et felt er umulig å lese (uskarpt, avkuttet av bildekanten), returner tom streng
  for tekstfelt eller 0 for tall — ikke fyll inn en gjetning.`

interface KlaudeRaLinje {
  produktnummer?: unknown
  navn?:          unknown
  antall?:        unknown
  enhetspris?:    unknown
  linjesum?:      unknown
}

interface KlaudeRaRabatt {
  tekst?: unknown
  belop?: unknown
}

interface KlaudeRaSvar {
  bilagsnummer?: unknown
  dato?:         unknown
  butikk?:       unknown
  sum?:          unknown
  linjer?:       unknown
  rabatter?:     unknown
}

function tallEller0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function tekstEllerTom(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function tolkLinje(raw: KlaudeRaLinje): KvitteringLinje {
  return {
    produktnummer: tekstEllerTom(raw.produktnummer),
    navn:          tekstEllerTom(raw.navn),
    antall:        tallEller0(raw.antall),
    enhetspris:    tallEller0(raw.enhetspris),
    linjesum:      tallEller0(raw.linjesum),
  }
}

function tolkRabatt(raw: KlaudeRaRabatt): KvitteringRabatt {
  return { tekst: tekstEllerTom(raw.tekst), belop: tallEller0(raw.belop) }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Ingen fil mottatt' }, { status: 400 })
    }
    if (file.size > MAKS_FILSTORRELSE) {
      return NextResponse.json(
        { error: `Filen er for stor (${Math.round(file.size / 1024 / 1024)} MB, maks 20 MB)` },
        { status: 400 },
      )
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const format = sniffBildeformat(buf)
    if (!format) {
      return NextResponse.json(
        { error: 'Filen ser ikke ut til å være et bilde (eller er et bildeformat som ikke støttes)' },
        { status: 400 },
      )
    }

    let bilde: { data: Buffer; mediaType: string }
    try {
      bilde = await forberedBilde(buf, format)
    } catch (err) {
      if (err instanceof UgyldigBildeError) {
        return NextResponse.json({ error: err.message }, { status: 422 })
      }
      throw err
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: bilde.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: bilde.data.toString('base64'),
            },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    })

    const raw = (msg.content[0] as Anthropic.TextBlock).text.trim()
    const start = raw.indexOf('{')
    const end   = raw.lastIndexOf('}')
    if (start === -1 || end === -1) {
      return NextResponse.json(
        { error: `Ugyldig svar fra Claude: ${raw.slice(0, 300)}` },
        { status: 500 },
      )
    }

    let parsed: KlaudeRaSvar
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      return NextResponse.json(
        { error: `Klarte ikke tolke svaret fra Claude som JSON: ${raw.slice(0, 300)}` },
        { status: 500 },
      )
    }

    if (!Array.isArray(parsed.linjer)) {
      return NextResponse.json(
        { error: 'Svaret fra Claude manglet en gyldig linjeliste — avlesningen feilet' },
        { status: 500 },
      )
    }

    let bilagsnummer: string
    let dato: string
    try {
      bilagsnummer = normaliserBilagsnummer(parsed.bilagsnummer)
      dato = parseKvitteringDato(tekstEllerTom(parsed.dato))
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Avlesningen feilet' },
        { status: 500 },
      )
    }

    const linjer   = (parsed.linjer as KlaudeRaLinje[]).map(tolkLinje)
    const rabatter = Array.isArray(parsed.rabatter) ? (parsed.rabatter as KlaudeRaRabatt[]).map(tolkRabatt) : []
    const sum       = tallEller0(parsed.sum)
    const butikk    = tekstEllerTom(parsed.butikk)
    const summeringssjekk = sjekkSummering(linjer, rabatter, sum)

    return NextResponse.json({
      bilagsnummer, dato, butikk, sum, linjer, rabatter, summeringssjekk,
    })
  } catch (err) {
    console.error('les-kvittering error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
