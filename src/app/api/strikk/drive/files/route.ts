import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getStrikkOAuth2Client } from '@/lib/strikk-drive'
import { driveErrorResponse } from '../../driveError'

export interface StrikkDriveFile {
  id: string
  sha256: string | null
}

// Every PDF the app can see on the Strikk account. With drive.file that is exactly the
// files this app created there, so a row whose id is missing points somewhere else
// (the private Drive). sha256 lets the upload skip content that is already there.
export async function GET() {
  try {
    const drive = google.drive({ version: 'v3', auth: await getStrikkOAuth2Client() })
    const files: StrikkDriveFile[] = []
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: "mimeType = 'application/pdf' and trashed = false",
        fields: 'nextPageToken, files(id, sha256Checksum)',
        pageSize: 1000,
        pageToken,
      })
      for (const f of res.data.files ?? []) {
        if (f.id) files.push({ id: f.id, sha256: f.sha256Checksum ?? null })
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
    return NextResponse.json({ files }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return driveErrorResponse(err, 'strikk/drive/files')
  }
}
