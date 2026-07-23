import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')

  const settingsUrl = new URL('/dashboard/settings', req.url)

  if (!code) {
    settingsUrl.searchParams.set('drive', 'error')
    return NextResponse.redirect(settingsUrl)
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    )

    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)
    console.log('[callback] token exchange ok:', !!tokens.access_token, 'refresh:', !!tokens.refresh_token)
    if (!tokens.refresh_token) {
      settingsUrl.searchParams.set('drive', 'no_refresh_token')
      return NextResponse.redirect(settingsUrl)
    }

    let upsertError: unknown = null
    try {
      const { error } = await supabaseAdmin.from('app_config').upsert(
        { key: 'som_og_snitt_google_drive_token', value: { refresh_token: tokens.refresh_token }, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )
      upsertError = error
      console.log('[callback] supabase upsert error:', error)
    } catch (e) {
      console.error('[callback] supabase threw:', e)
      throw e
    }

    if (upsertError) throw upsertError

    settingsUrl.searchParams.set('drive', 'connected')
    console.log('[callback] redirecting to:', settingsUrl.toString())
    return NextResponse.redirect(settingsUrl)
  } catch (err) {
    console.error('[Drive callback] full error:', err)
    settingsUrl.searchParams.set('drive', 'error')
    return NextResponse.redirect(settingsUrl)
  }
}
