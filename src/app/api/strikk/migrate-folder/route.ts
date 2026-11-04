import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getOAuth2Client } from '@/lib/drive-helpers'
import { migrateLegacyKnitFolder } from '@/lib/knit-folder'
import { driveErrorResponse } from '../driveError'

// Called each time Strikk › Oppskrifter opens. After the first successful run there is
// no old folder left, so it costs two Drive searches and writes nothing.
export async function POST() {
  try {
    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const result = await migrateLegacyKnitFolder(drive.files)
    if (result.moved > 0 || result.trashedFolders > 0) {
      console.log(
        `[strikk/migrate-folder] moved ${result.moved} file(s) to ${result.folderId}, ` +
        `trashed ${result.trashedFolders} old Strikk folder(s)`,
      )
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return driveErrorResponse(err, 'strikk/migrate-folder')
  }
}
