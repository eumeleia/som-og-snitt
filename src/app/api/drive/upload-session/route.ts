import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getOAuth2Client, getOrCreateRootFolder, getOrCreateSubfolder } from '@/lib/drive-helpers'

export async function POST(req: NextRequest) {
  try {
    const { fileName, mimeType, folderName } = await req.json() as {
      fileName: string
      mimeType: string
      folderName?: string
    }

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const rootFolderId = await getOrCreateRootFolder(drive)
    const targetFolderId = folderName?.trim()
      ? await getOrCreateSubfolder(drive, rootFolderId, folderName.trim())
      : rootFolderId

    // Fresh access token for the browser to use in the resumable PUT
    const { token: accessToken } = await auth.getAccessToken()
    if (!accessToken) throw new Error('Kunne ikke hente access token')

    // Initiate resumable upload session — Drive returns a Location URL
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: fileName, parents: [targetFolderId] }),
      },
    )

    if (!initRes.ok) {
      const errText = await initRes.text()
      throw new Error(`Drive session init feilet: ${initRes.status} — ${errText}`)
    }

    const uploadUrl = initRes.headers.get('Location')
    if (!uploadUrl) throw new Error('Drive returnerte ingen Location-header')

    console.log('[upload] session opprettet for:', fileName, '→', folderName?.trim() || '(rot)')

    return NextResponse.json({ uploadUrl })
  } catch (err) {
    console.error('[upload] session-feil:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
