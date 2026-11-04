import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { logDriveError } from '@/lib/drive-log'
import {
  STRIKK_STATE_COOKIE,
  isAllowedAccount,
  newStrikkOAuthClient,
  saveStrikkToken,
} from '@/lib/strikk-drive'

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

// Lands on Strikk › Oppskrifter with ?drive=connected|wrong_account|no_refresh_token|error.
export async function GET(req: NextRequest) {
  const target = new URL('/strikk/oppskrifter', req.url)
  const done = (result: string) => {
    target.searchParams.set('drive', result)
    const res = NextResponse.redirect(target)
    res.cookies.delete({ name: STRIKK_STATE_COOKIE, path: '/api/strikk/drive' })
    return res
  }

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const expected = req.cookies.get(STRIKK_STATE_COOKIE)?.value
  if (!code || !state || !expected || state !== expected) return done('error')

  try {
    const client = newStrikkOAuthClient(req.nextUrl.origin)
    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)

    // about.get works with drive.file alone, so no email/openid scope is needed.
    const about = await google.drive({ version: 'v3', auth: client }).about.get({ fields: 'user(emailAddress)' })
    const email = about.data.user?.emailAddress ?? null

    if (!isAllowedAccount(email)) {
      // Withdraw the grant so the wrong account is not left connected at Google either.
      const token = tokens.refresh_token ?? tokens.access_token
      if (token) {
        await fetch(REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(10_000),
        }).catch(err => logDriveError('strikk/drive/callback revoke', err))
      }
      return done('wrong_account')
    }
    if (!tokens.refresh_token) return done('no_refresh_token')

    await saveStrikkToken(tokens.refresh_token, email!)
    return done('connected')
  } catch (err) {
    logDriveError('strikk/drive/callback', err)
    return done('error')
  }
}
