import { NextResponse } from 'next/server'

// Et tilbakekalt eller utløpt refresh-token gir invalid_grant fra Googles token-endepunkt.
// Det kommer enten som response.data.error eller i selve meldingen (google-auth-library
// skriver om meldingen ved ReAuth-feil), så begge sjekkes.
export function isDriveAuthExpired(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { message?: string; response?: { data?: { error?: string } } }
  return e.response?.data?.error === 'invalid_grant' || (e.message ?? '').includes('invalid_grant')
}

export function driveErrorResponse(err: unknown, label: string) {
  if (isDriveAuthExpired(err)) {
    return NextResponse.json(
      { error: 'Disk-tilgangen har utløpt', code: 'DRIVE_AUTH_EXPIRED' },
      { status: 401 },
    )
  }
  const message = err instanceof Error ? err.message : 'Ukjent feil'
  if (message === 'Drive ikke tilkoblet') {
    return NextResponse.json({ error: message, code: 'DRIVE_AUTH_EXPIRED' }, { status: 401 })
  }
  // Only the message: the full gaxios error carries the refresh token in config.data, and
  // logging it would put the token in the Vercel logs.
  console.error(`[${label}]`, message)
  return NextResponse.json({ error: message }, { status: 500 })
}
