import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

// Strikk's own Drive connection, on a separate Google account from sewing's
// som_og_snitt_google_drive_token. Same OAuth client, its own redirect URI and token row.

export const STRIKK_TOKEN_KEY = 'strikk_google_drive_token'
export const STRIKK_ACCOUNT = 'mariawasmuth.claude@gmail.com'
export const STRIKK_SCOPES = ['https://www.googleapis.com/auth/drive.file']
export const STRIKK_CALLBACK_PATH = '/api/strikk/drive/callback'
export const STRIKK_STATE_COOKIE = 'strikk_drive_oauth_state'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface StoredToken {
  refresh_token?: string
  email?: string
}

export function isAllowedAccount(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === STRIKK_ACCOUNT
}

// Built from the request's own origin, so the redirect URI follows whichever domain the
// app runs on. Each origin must be listed under the OAuth client in Google Cloud Console.
export function newStrikkOAuthClient(origin: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    new URL(STRIKK_CALLBACK_PATH, origin).toString(),
  )
}

async function readToken(): Promise<StoredToken | null> {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', STRIKK_TOKEN_KEY)
    .maybeSingle()
  if (error) throw error
  return (data?.value as StoredToken | undefined) ?? null
}

// Same message as getOAuth2Client in drive-helpers, so driveErrorResponse answers 401
// DRIVE_AUTH_EXPIRED and the client shows the connect button.
export async function getStrikkOAuth2Client() {
  const token = await readToken()
  if (!token?.refresh_token) throw new Error('Drive ikke tilkoblet')
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)
  client.setCredentials({ refresh_token: token.refresh_token })
  return client
}

export async function getStrikkConnection(): Promise<{ email: string | null } | null> {
  const token = await readToken()
  return token?.refresh_token ? { email: token.email ?? null } : null
}

export async function saveStrikkToken(refreshToken: string, email: string) {
  const { error } = await supabaseAdmin.from('app_config').upsert(
    { key: STRIKK_TOKEN_KEY, value: { refresh_token: refreshToken, email }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (error) throw error
}
