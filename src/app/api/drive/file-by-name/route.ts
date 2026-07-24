import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getOAuth2Client } from '@/lib/drive-helpers'

export async function POST(req: NextRequest) {
  try {
    const { fileName, folderId } = await req.json() as { fileName: string; folderId: string }

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    const safeName = fileName.replace(/'/g, "\\'")
    const q = `name = '${safeName}' and '${folderId}' in parents and trashed = false`
    const res = await drive.files.list({
      q,
      fields: 'files(id,webViewLink)',
      orderBy: 'createdTime desc',
      pageSize: 1,
    })

    const file = res.data.files?.[0]
    if (!file?.id) {
      return NextResponse.json({ error: 'Fil ikke funnet' }, { status: 404 })
    }

    const fileId = file.id
    const webViewLink = file.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`
    const downloadLink = `https://drive.google.com/uc?export=download&id=${fileId}`

    return NextResponse.json({ fileId, webViewLink, downloadLink })
  } catch (err) {
    console.error('[file-by-name]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
