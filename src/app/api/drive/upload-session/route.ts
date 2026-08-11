import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getOAuth2Client } from '@/lib/drive-helpers'

export async function POST(req: NextRequest) {
  try {
    const { fileName, mimeType, folderId } = await req.json() as {
      fileName: string
      mimeType: string
      folderId: string
    }

    const auth = await getOAuth2Client()
    google.drive({ version: 'v3', auth }) // ensures credentials are set

    const { token: accessToken } = await auth.getAccessToken()
    if (!accessToken) throw new Error('Kunne ikke hente access token')

    // Videresender den innkommende Origin til Drives init-kall — HYPOTESE, ikke
    // dokumentert av Google for Drive spesifikt: at sesjons-URL-en da svarer med CORS,
    // slik at browseren senere kan LESE PUT-svaret direkte i stedet for å måtte slå opp
    // fila etterpå (se file-by-name). Ikke hardkod et domene — preview-deployer har andre
    // opphav enn produksjon. Mangler headeren i det innkommende kallet, sender vi ingen.
    const origin = req.headers.get('origin')
    const initHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }
    if (origin) initHeaders.Origin = origin

    // Tatt RETT FØR init-kallet, sendes tilbake til klienten og videre til file-by-name —
    // skiller DENNE opplastingssesjonen fra en fil med samme navn fra et tidligere
    // (mislykket) forsøk, se createdTime-filteret der.
    const sessionStartetVed = Date.now()

    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: initHeaders,
        body: JSON.stringify({ name: fileName, parents: [folderId] }),
      },
    )

    if (!initRes.ok) {
      const errText = await initRes.text()
      throw new Error(`Drive session init feilet: ${initRes.status} — ${errText}`)
    }

    const uploadUrl = initRes.headers.get('Location')
    if (!uploadUrl) throw new Error('Drive returnerte ingen Location-header')

    return NextResponse.json({ uploadUrl, sessionStartetVed })
  } catch (err) {
    console.error('[upload] session-feil:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
