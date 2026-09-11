import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { Readable } from 'stream'
import { getOAuth2Client, getOrCreateRootFolder, getOrCreateSubfolder } from '@/lib/drive-helpers'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const folderName = (formData.get('folderName') as string | null)?.trim() ?? ''
    // Kalleren kan sende et folderId den allerede har (f.eks. fra et eget ensure-folder-kall)
    // for å slippe et unødvendig ekstra oppslag her.
    const folderId = (formData.get('folderId') as string | null)?.trim() ?? ''
    if (!file) return NextResponse.json({ error: 'Ingen fil' }, { status: 400 })

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    const targetFolderId = folderId || (
      folderName
        ? await getOrCreateSubfolder(drive, await getOrCreateRootFolder(drive), folderName)
        : await getOrCreateRootFolder(drive)
    )

    const buffer = Buffer.from(await file.arrayBuffer())
    const stream = Readable.from(buffer)

    const uploaded = await drive.files.create({
      requestBody: { name: file.name, parents: [targetFolderId] },
      media: { mimeType: file.type || 'application/octet-stream', body: stream },
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
