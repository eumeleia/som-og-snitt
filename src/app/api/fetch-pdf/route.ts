import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()

    let fetchUrl = url as string
    let isDrive = false
    let driveId = ''

    const driveMatch = fetchUrl.match(/\/file\/d\/([^/?]+)/)
    if (driveMatch) {
      driveId = driveMatch[1]
      fetchUrl = `https://drive.google.com/uc?id=${driveId}&export=download`
      isDrive = true
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }

    const res = await fetch(fetchUrl, { headers, redirect: 'follow' })

    if (!res.ok) {
      return NextResponse.json(
        { error: `HTTP ${res.status} – kunne ikke laste ned filen. Sjekk at delingsstilgangen er satt til «Alle med lenken».` },
        { status: 500 }
      )
    }

    const contentType = res.headers.get('content-type') || ''

    if (contentType.includes('text/html')) {
      const html = await res.text()

      if (isDrive) {
        // Google Drive virus-scan warning page – extract confirm token
        const confirmMatch = html.match(/confirm=([^&"'\s]+)/)
        if (confirmMatch) {
          const confirmUrl = `https://drive.google.com/uc?id=${driveId}&export=download&confirm=${confirmMatch[1]}`
          const confirmRes = await fetch(confirmUrl, { headers, redirect: 'follow' })
          if (!confirmRes.ok) {
            return NextResponse.json(
              { error: `Google Drive: HTTP ${confirmRes.status} etter bekreftelsesside` },
              { status: 500 }
            )
          }
          const buf = await confirmRes.arrayBuffer()
          const base64 = Buffer.from(buf).toString('base64')
          return NextResponse.json({ data: base64 })
        }

        if (html.includes('accounts.google.com') || html.includes('ServiceLogin')) {
          return NextResponse.json(
            { error: 'Google Drive krever innlogging. Del filen som «Alle med lenken kan se».' },
            { status: 500 }
          )
        }

        return NextResponse.json(
          { error: 'Google Drive returnerte en nettside i stedet for PDF. Filen er kanskje privat eller for stor.' },
          { status: 500 }
        )
      }

      return NextResponse.json(
        { error: 'Serveren returnerte en HTML-side i stedet for PDF. Lenken peker kanskje ikke direkte til en PDF-fil.' },
        { status: 500 }
      )
    }

    const buf = await res.arrayBuffer()
    const base64 = Buffer.from(buf).toString('base64')
    return NextResponse.json({ data: base64 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ukjent nettverksfeil'
    console.error('fetch-pdf error:', err)
    return NextResponse.json(
      { error: `Kunne ikke hente PDF: ${message}` },
      { status: 500 }
    )
  }
}
