import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getStrikkOAuth2Client } from '@/lib/strikk-drive'
import { byggQ, slaOppMedGjentakelse } from '@/app/api/drive/file-by-name/route'
import { driveErrorResponse } from '../../driveError'

// Backstop for an unreadable PUT response, as /api/drive/file-by-name, on the Strikk account.
export async function POST(req: NextRequest) {
  try {
    const { fileName, folderId, sessionStartetVed } = await req.json() as {
      fileName: string
      folderId: string
      sessionStartetVed?: number
    }
    const drive = google.drive({ version: 'v3', auth: await getStrikkOAuth2Client() })
    const q = byggQ(fileName, folderId, sessionStartetVed)
    const { fil } = await slaOppMedGjentakelse(async () => {
      const res = await drive.files.list({ q, fields: 'files(id)', orderBy: 'createdTime desc', pageSize: 1 })
      return res.data.files?.[0] ?? null
    })
    if (!fil?.id) return NextResponse.json({ error: 'Fil ikke funnet' }, { status: 404 })
    return NextResponse.json({ fileId: fil.id })
  } catch (err) {
    return driveErrorResponse(err, 'strikk/drive/file-by-name')
  }
}
