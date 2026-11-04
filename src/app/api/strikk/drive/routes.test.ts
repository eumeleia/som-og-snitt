import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Simulated Google and Supabase. Nothing here reaches the network or the shared database.
const sim = vi.hoisted(() => ({
  email: 'mariawasmuth.claude@gmail.com' as string | null,
  tokens: { refresh_token: 'rt-1', access_token: 'at-1' } as { refresh_token?: string; access_token?: string },
  upserts: [] as unknown[],
  redirectUris: [] as string[],
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: async (row: unknown) => { sim.upserts.push(row); return { error: null } },
    }),
  }),
}))

vi.mock('googleapis', async () => {
  const real = await vi.importActual<typeof import('googleapis')>('googleapis')
  class FakeOAuth2 extends real.google.auth.OAuth2 {
    constructor(id?: string, secret?: string, redirect?: string) {
      super(id, secret, redirect)
      if (redirect) sim.redirectUris.push(redirect)
    }
    // @ts-expect-error simplified signature for the fake
    async getToken() { return { tokens: sim.tokens } }
  }
  return {
    google: {
      auth: { OAuth2: FakeOAuth2 },
      drive: () => ({ about: { get: async () => ({ data: { user: { emailAddress: sim.email } } }) } }),
    },
  }
})

const { GET: authGET } = await import('./auth/route')
const { GET: callbackGET } = await import('./callback/route')

const ORIGIN = 'https://strikk.example.test'
const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret'
  sim.email = 'mariawasmuth.claude@gmail.com'
  sim.tokens = { refresh_token: 'rt-1', access_token: 'at-1' }
  sim.upserts = []
  sim.redirectUris = []
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function callback(query: string, cookieState: string | null = 's1') {
  return callbackGET(new NextRequest(`${ORIGIN}/api/strikk/drive/callback?${query}`, {
    headers: cookieState ? { cookie: `strikk_drive_oauth_state=${cookieState}` } : {},
  }))
}

describe('GET /api/strikk/drive/auth', () => {
  it('asks only for drive.file, shows the account picker and hints the Claude account', async () => {
    const res = await authGET(new NextRequest(`${ORIGIN}/api/strikk/drive/auth`))
    const url = new URL(res.headers.get('location')!)
    expect(url.hostname).toBe('accounts.google.com')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file')
    expect(url.searchParams.get('prompt')).toBe('select_account consent')
    expect(url.searchParams.get('login_hint')).toBe('mariawasmuth.claude@gmail.com')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/strikk/drive/callback`)
    const state = url.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(res.cookies.get('strikk_drive_oauth_state')?.value).toBe(state)
  })
})

describe('GET /api/strikk/drive/callback', () => {
  it('stores the token under its own key for the Claude account', async () => {
    const res = await callback('code=c&state=s1')
    expect(new URL(res.headers.get('location')!).search).toBe('?drive=connected')
    expect(sim.upserts).toEqual([expect.objectContaining({
      key: 'strikk_google_drive_token',
      value: { refresh_token: 'rt-1', email: 'mariawasmuth.claude@gmail.com' },
    })])
    expect(sim.redirectUris).toContain(`${ORIGIN}/api/strikk/drive/callback`)
  })

  it('accepts the address in another letter case', async () => {
    sim.email = 'MariaWasmuth.Claude@gmail.com'
    const res = await callback('code=c&state=s1')
    expect(new URL(res.headers.get('location')!).search).toBe('?drive=connected')
  })

  it('rejects any other account, stores nothing and revokes the grant at Google', async () => {
    sim.email = 'maria@aftenskolen.no'
    const res = await callback('code=c&state=s1')
    expect(new URL(res.headers.get('location')!).search).toBe('?drive=wrong_account')
    expect(sim.upserts).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/revoke')
    expect(String(init.body)).toBe('token=rt-1')
  })

  it('rejects when Google returns no email', async () => {
    sim.email = null
    const res = await callback('code=c&state=s1')
    expect(new URL(res.headers.get('location')!).search).toBe('?drive=wrong_account')
    expect(sim.upserts).toEqual([])
  })

  it('rejects a callback whose state does not match the cookie', async () => {
    const res = await callback('code=c&state=other')
    expect(new URL(res.headers.get('location')!).search).toBe('?drive=error')
    expect(sim.upserts).toEqual([])
  })

  it('rejects a callback without the state cookie', async () => {
    const res = await callback('code=c&state=s1', null)
    expect(new URL(res.headers.get('location')!).search).toBe('?drive=error')
  })

  it('reports a missing refresh token without storing anything', async () => {
    sim.tokens = { access_token: 'at-1' }
    const res = await callback('code=c&state=s1')
    expect(new URL(res.headers.get('location')!).search).toBe('?drive=no_refresh_token')
    expect(sim.upserts).toEqual([])
  })
})
