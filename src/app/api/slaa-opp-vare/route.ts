import { NextRequest, NextResponse } from 'next/server'
import { HENT_SIDE_HEADERS, hentStoffdataFraHtml, type StoffData } from '@/app/api/import-fabric/route'
import { velgKandidat, tolkBrodsmulesti, avgjorEnhetsfelt, utledVariantHale, type Kandidat } from '@/lib/vareoppslag'

// Selfmade er Shopware-basert, samme plattform som import-fabric allerede leser — derfor
// gjenbrukes extractSections/Claude-kallet derfra (hentStoffdataFraHtml) for de frie
// tekstfeltene (materiale, bredde, vekt osv). Produktnummer, brødsmulesti og pris er
// derimot strukturert JSON-LD som leses direkte i denne fila, uten Claude.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonLdNode = Record<string, any>

function parseJsonLd(html: string): JsonLdNode[] {
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const noder: JsonLdNode[] = []
  let m
  while ((m = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim())
      if (Array.isArray(parsed)) noder.push(...parsed)
      else noder.push(parsed)
    } catch {
      // Ødelagt JSON-LD-blokk — hopp over, ikke la den velte hele oppslaget.
    }
  }
  return noder
}

function finnCanonicalUrl(html: string): string | null {
  const m = html.match(/<link rel="canonical" href="([^"]+)"/)
  return m?.[1] ?? null
}

function parsKandidater(html: string): Kandidat[] {
  const kandidater: Kandidat[] = []
  const cardRegex = /<div class="card product-box box-minimal">/g
  let m
  while ((m = cardRegex.exec(html)) !== null) {
    const snippet = html.slice(m.index, m.index + 1500)
    const lenke = snippet.match(/href="([^"]+)"\s*title="([^"]+)"\s*class="([^"]+)"/)
    if (!lenke) continue
    const [, url, navn, klasse] = lenke
    if (klasse.includes('gratis-product')) continue // gratis DIY-oppskrift, ikke en vare
    kandidater.push({ url, navn })
  }
  return kandidater
}

function finnEnhetstekst(html: string): string {
  const m = html.match(/class="price-per-label[^"]*">([^<]+)</)
  return m?.[1]?.trim() ?? ''
}

interface ProduktTreff {
  url:            string
  navn:           string
  kategori:       'Stoff' | 'Tilbehør' | 'Utstyr'
  underkategori?: string
  utstyrstype?:   string
  materiale?:     string
  bredde?:        string
  vekt?:          string
  vask?:          string
  krymp?:         string
  sertifisering?: string
  bilde?:         string
  enhetsfelt:     'mengde' | 'antall'
  sidenummer:     string
  variantHale:    string | null
}

type VareoppslagSvar =
  | { tilstand: 'funnet';      produkt: ProduktTreff }
  | { tilstand: 'flereTreff';  kandidater: Kandidat[] }
  | { tilstand: 'ikkeFunnet' }
  | { tilstand: 'feil';        melding: string }

async function tolkProduktside(html: string, kildeUrl: string, kvitteringensProduktnummer: string, kunNummer: boolean): Promise<VareoppslagSvar> {
  const jsonLd     = parseJsonLd(html)
  const product    = jsonLd.find(n => n['@type'] === 'Product')
  const breadcrumb = jsonLd.find(n => n['@type'] === 'BreadcrumbList')

  if (!product) {
    return { tilstand: 'feil', melding: 'Fant ikke strukturert produktdata (JSON-LD) på siden' }
  }

  const sidenummer = String(product.sku ?? product.mpn ?? '')
  const offers     = Array.isArray(product.offers) ? product.offers[0] : product.offers
  const url        = offers?.url ?? finnCanonicalUrl(html) ?? kildeUrl

  const segmenter = Array.isArray(breadcrumb?.itemListElement)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? breadcrumb.itemListElement.map((x: any) => String(x.name ?? ''))
    : []
  const { kategori, underkategori, utstyrstype } = tolkBrodsmulesti(segmenter)

  const enhetsfelt  = avgjorEnhetsfelt(finnEnhetstekst(html))
  const variantHale = sidenummer ? utledVariantHale(kvitteringensProduktnummer, sidenummer) : null

  let stoffdata: StoffData | null = null
  if (!kunNummer) {
    try {
      stoffdata = await hentStoffdataFraHtml(html)
    } catch {
      stoffdata = null // materiale/bredde/vekt/vask/krymp/sertifisering er tilleggsinfo — et
      // treff er fortsatt et treff selv om Claude-kallet på fritekstfeltene feiler.
    }
  }

  return {
    tilstand: 'funnet',
    produkt: {
      url,
      navn: String(product.name ?? stoffdata?.navn ?? ''),
      kategori, underkategori, utstyrstype,
      materiale:     stoffdata?.materiale     || undefined,
      bredde:        stoffdata?.bredde        || undefined,
      vekt:          stoffdata?.vekt          || undefined,
      vask:          stoffdata?.vask          || undefined,
      krymp:         stoffdata?.krymp         || undefined,
      sertifisering: stoffdata?.sertifisering || undefined,
      bilde:         stoffdata?.bilde         || undefined,
      enhetsfelt,
      sidenummer,
      variantHale,
    },
  }
}

export async function POST(req: NextRequest) {
  try {
    const { produktnummer, kvitteringsnavn, valgtUrl, kunNummer } = await req.json()

    if (typeof produktnummer !== 'string' || !produktnummer.trim()) {
      return NextResponse.json({ tilstand: 'feil', melding: 'Mangler produktnummer' } satisfies VareoppslagSvar)
    }

    // Brukeren har valgt en bestemt kandidat fra en tidligere «flereTreff» — hent DEN
    // siden direkte, ikke søk på nytt.
    if (typeof valgtUrl === 'string' && valgtUrl.trim()) {
      const res = await fetch(valgtUrl, { headers: HENT_SIDE_HEADERS })
      if (!res.ok) {
        return NextResponse.json({ tilstand: 'feil', melding: `HTTP ${res.status} – klarte ikke hente siden` } satisfies VareoppslagSvar)
      }
      const html = await res.text()
      return NextResponse.json(await tolkProduktside(html, valgtUrl, produktnummer, Boolean(kunNummer)))
    }

    const sokUrl = `https://www.selfmade.com/nb-no/search?search=${encodeURIComponent(produktnummer)}`
    const sokRes = await fetch(sokUrl, { headers: HENT_SIDE_HEADERS })
    if (!sokRes.ok) {
      return NextResponse.json({ tilstand: 'feil', melding: `HTTP ${sokRes.status} – klarte ikke søke` } satisfies VareoppslagSvar)
    }
    const sokHtml = await sokRes.text()

    // Et eksakt SKU-treff blir noen ganger servert direkte på søke-URL-en (samme HTML som
    // en produktside), andre ganger som en trefflisteside med ett kort. Begge må håndteres.
    if (parseJsonLd(sokHtml).some(n => n['@type'] === 'Product')) {
      return NextResponse.json(await tolkProduktside(sokHtml, sokUrl, produktnummer, Boolean(kunNummer)))
    }

    const kandidater = parsKandidater(sokHtml)
    const valg = velgKandidat(String(kvitteringsnavn ?? ''), kandidater)

    if (valg.utfall === 'ikkeFunnet') {
      return NextResponse.json({ tilstand: 'ikkeFunnet' } satisfies VareoppslagSvar)
    }
    if (valg.utfall === 'flereTreff') {
      return NextResponse.json({ tilstand: 'flereTreff', kandidater: valg.kandidater } satisfies VareoppslagSvar)
    }

    const prodRes = await fetch(valg.kandidat.url, { headers: HENT_SIDE_HEADERS })
    if (!prodRes.ok) {
      return NextResponse.json({ tilstand: 'feil', melding: `HTTP ${prodRes.status} – klarte ikke hente produktsiden` } satisfies VareoppslagSvar)
    }
    const prodHtml = await prodRes.text()
    return NextResponse.json(await tolkProduktside(prodHtml, valg.kandidat.url, produktnummer, Boolean(kunNummer)))
  } catch (err) {
    console.error('slaa-opp-vare error:', err)
    return NextResponse.json(
      { tilstand: 'feil', melding: err instanceof Error ? err.message : 'Ukjent feil' } satisfies VareoppslagSvar,
    )
  }
}
