import { NextRequest, NextResponse } from 'next/server'
import {
  STRIKK_ACCOUNT,
  STRIKK_SCOPES,
  STRIKK_STATE_COOKIE,
  newStrikkOAuthClient,
} from '@/lib/strikk-drive'

export async function GET(req: NextRequest) {
  const state = crypto.randomUUID()
  const authUrl = newStrikkOAuthClient(req.nextUrl.origin).generateAuthUrl({
    access_type: 'offline',
    scope: STRIKK_SCOPES,
    // select_account: Google always shows the account picker, even with one session.
    // consent: Google only returns a refresh token on a consent screen.
    prompt: 'select_account consent',
    login_hint: STRIKK_ACCOUNT,
    state,
  })

  const res = NextResponse.redirect(authUrl)
  res.cookies.set(STRIKK_STATE_COOKIE, state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/strikk/drive',
    maxAge: 600,
  })
  return res
}
