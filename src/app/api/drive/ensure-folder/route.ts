import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getOAuth2Client, getOrCreateRootFolder, getOrCreateSubfolder } from '@/lib/drive-helpers'
import { getOrCreateTopLevelFolder } from '@/lib/knit-folder'
import { logDriveError } from '@/lib/drive-log'

export async function POST(req: NextRequest) {
  try {
    const { folderName, topLevel } = await req.json() as { folderName: string; topLevel?: boolean }
    if (topLevel && !folderName?.trim()) {
      return NextResponse.json({ error: 'folderName er påkrevd med topLevel' }, { status: 400 })
    }

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    if (topLevel) {
      return NextResponse.json({ folderId: await getOrCreateTopLevelFolder(drive.files, folderName.trim()) })
    }
    const rootFolderId = await getOrCreateRootFolder(drive)
    const folderId = folderName?.trim()
      ? await getOrCreateSubfolder(drive, rootFolderId, folderName.trim())
      : rootFolderId

    return NextResponse.json({ folderId })
  } catch (err) {
    logDriveError('ensure-folder', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
