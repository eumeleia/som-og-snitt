import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getOAuth2Client, getOrCreateRootFolder, getOrCreateSubfolder } from '@/lib/drive-helpers'

export async function POST(req: NextRequest) {
  try {
    const { folderName } = await req.json() as { folderName: string }

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const rootFolderId = await getOrCreateRootFolder(drive)
    const folderId = folderName?.trim()
      ? await getOrCreateSubfolder(drive, rootFolderId, folderName.trim())
      : rootFolderId

    return NextResponse.json({ folderId })
  } catch (err) {
    console.error('[ensure-folder]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
