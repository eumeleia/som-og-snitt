import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getStrikkOAuth2Client } from '@/lib/strikk-drive'
import { KNIT_FOLDER_NAME, getOrCreateTopLevelFolder } from '@/lib/knit-folder'
import { driveErrorResponse } from '../../driveError'

// Same resumable-session flow as /api/drive/upload-session, on the Strikk account, with
// the folder lookup folded in so each file costs one round trip less.
export async function POST(req: NextRequest) {
  try {
    const { fileName } = await req.json() as { fileName?: string }
    if (!fileName) return NextResponse.json({ error: 'fileName er påkrevd' }, { status: 400 })

    const auth = await getStrikkOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const folderId = await getOrCreateTopLevelFolder(drive.files, KNIT_FOLDER_NAME)

    const { token: accessToken } = await auth.getAccessToken()
    if (!accessToken) throw new Error('Kunne ikke hente access token')

    // Forwarded so the session URL may answer the browser's PUT with CORS; see the note
    // in /api/drive/upload-session.
    const origin = req.headers.get('origin')
    const initHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }
    if (origin) initHeaders.Origin = origin

    const sessionStartetVed = Date.now()
    const initRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: initHeaders,
      body: JSON.stringify({ name: fileName, parents: [folderId] }),
    })
    if (!initRes.ok) {
      throw new Error(`Drive session init feilet: ${initRes.status} — ${await initRes.text()}`)
    }
    const uploadUrl = initRes.headers.get('Location')
    if (!uploadUrl) throw new Error('Drive returnerte ingen Location-header')

    return NextResponse.json({ uploadUrl, folderId, sessionStartetVed })
  } catch (err) {
    return driveErrorResponse(err, 'strikk/drive/upload-session')
  }
}
