import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { Readable } from 'stream'
import { getOAuth2Client, getOrCreateRootFolder, getOrCreateSubfolder } from '@/lib/drive-helpers'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const folderName = (formData.get('folderName') as string | null)?.trim() ?? ''
    if (!file) return NextResponse.json({ error: 'Ingen fil' }, { status: 400 })

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const rootFolderId = await getOrCreateRootFolder(drive)

    const targetFolderId = folderName
      ? await getOrCreateSubfolder(drive, rootFolderId, folderName)
      : rootFolderId

    const buffer = Buffer.from(await file.arrayBuffer())
    const stream = Readable.from(buffer)

    const uploaded = await drive.files.create({
      requestBody: { name: file.name, parents: [targetFolderId] },
      media: { mimeType: 'application/pdf', body: stream },
      fields: 'id,webViewLink',
    })

    return NextResponse.json({
      fileId: uploaded.data.id,
      webViewLink: uploaded.data.webViewLink,
    })
  } catch (err) {
    console.error('[Drive upload]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
