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
    if (!tokens.refresh_token) {
      settingsUrl.searchParams.set('drive', 'no_refresh_token')
      return NextResponse.redirect(settingsUrl)
    }

    oauth2Client.setCredentials(tokens)
    const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2Api.userinfo.get()

    await supabaseAdmin.from('app_config').upsert(
      { key: 'google_drive_token', value: { refresh_token: tokens.refresh_token, email: userInfo.email }, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )

    settingsUrl.searchParams.set('drive', 'connected')
    return NextResponse.redirect(settingsUrl)
  } catch (err) {
    console.error('[Drive callback]', err)
    settingsUrl.searchParams.set('drive', 'error')
    return NextResponse.redirect(settingsUrl)
  }
}
