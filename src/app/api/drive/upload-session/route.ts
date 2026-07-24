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

    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: fileName, parents: [folderId] }),
      },
    )

    if (!initRes.ok) {
      const errText = await initRes.text()
      throw new Error(`Drive session init feilet: ${initRes.status} — ${errText}`)
    }

    const uploadUrl = initRes.headers.get('Location')
    if (!uploadUrl) throw new Error('Drive returnerte ingen Location-header')

    console.log('[upload] session opprettet for:', fileName)

    return NextResponse.json({ uploadUrl })
  } catch (err) {
    console.error('[upload] session-feil:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
