import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getStrikkOAuth2Client } from '@/lib/strikk-drive'
import { logDriveError } from '@/lib/drive-log'
import { planDriveRenames, type NamedRecipe } from '@/app/strikk/_lib/drive-names'
import { driveErrorResponse } from '../../driveError'

export const maxDuration = 60

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Called when Strikk › Oppskrifter opens. Renames every Drive file whose name does not
// match its recipe («Oppskrift - Designer.pdf»). Safe to run any number of times: once
// the names match, it reads and writes nothing more than the two listings.
export async function POST() {
  try {
    const { data, error } = await supabaseAdmin
      .from('strikk_oppskrift')
      .select('id, title, designer, file_name, drive_file_id')
    if (error) throw new Error(error.message)

    const drive = google.drive({ version: 'v3', auth: await getStrikkOAuth2Client() })
    const names = new Map<string, string>()
    let pageToken: string | undefined
    do {
      const res = await drive.files.list({
        q: "mimeType = 'application/pdf' and trashed = false",
        fields: 'nextPageToken, files(id, name)',
        pageSize: 1000,
        pageToken,
      })
      for (const f of res.data.files ?? []) if (f.id && f.name) names.set(f.id, f.name)
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)

    const plan = planDriveRenames((data ?? []) as NamedRecipe[], names)
    const renamed: { id: string; file_name: string }[] = []
    let failed = 0
    for (const r of plan.rename) {
      try {
        await drive.files.update({ fileId: r.fileId, requestBody: { name: r.to }, fields: 'id' })
        const { error: e } = await supabaseAdmin.from('strikk_oppskrift').update({ file_name: r.to }).eq('id', r.id)
        if (e) throw new Error(e.message)
        renamed.push({ id: r.id, file_name: r.to })
      } catch (err) {
        failed++
        logDriveError('strikk/drive/sync-names', err)
      }
    }
    for (const r of plan.rowOnly) {
      const { error: e } = await supabaseAdmin.from('strikk_oppskrift').update({ file_name: r.to }).eq('id', r.id)
      if (!e) renamed.push({ id: r.id, file_name: r.to })
    }
    if (renamed.length > 0 || failed > 0) {
      console.log(`[strikk/drive/sync-names] renamed ${renamed.length}, failed ${failed}`)
    }
    return NextResponse.json({ renamed, failed }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return driveErrorResponse(err, 'strikk/drive/sync-names')
  }
}
