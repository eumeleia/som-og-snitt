import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logDriveError } from '@/lib/drive-log'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const TOKEN_KEY = 'som_og_snitt_google_drive_token'
// Format fra «Token revocation» i https://developers.google.com/identity/protocols/oauth2/web-server
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const REVOKE_TIMEOUT_MS = 10_000

export async function POST() {
  // Trekk tokenet tilbake hos Google først; å bare slette det hos oss lar det være gyldig
  // der. Feiler noe her, logges det, og frakoblingen fullføres likevel under.
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', TOKEN_KEY)
      .maybeSingle()
    if (error) throw error
    const refreshToken = (data?.value as { refresh_token?: string } | undefined)?.refresh_token
    if (refreshToken) {
      // Tokenet i kroppen, ikke i URL-en, så det ikke havner i noen URL-logg.
      const res = await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        logDriveError('Drive disconnect', {
          message: 'Tilbaketrekking hos Google feilet',
          response: { status: res.status, data: body },
        })
      }
    }
  } catch (err) {
    logDriveError('Drive disconnect', err)
  }

  await supabaseAdmin.from('app_config').delete().eq('key', TOKEN_KEY)
  await supabaseAdmin.from('app_config').delete().eq('key', 'google_drive_folder_id')
  return NextResponse.json({ ok: true })
}
