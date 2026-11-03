// Logger én linje per Disk-feil uten å skrive ut selve feilobjektet. Et GaxiosError fra
// googleapis bærer hele forespørselen i config (refresh-token, klienthemmelighet,
// Authorization-hode), så console.error(err) legger dem rett i Vercel-loggene.
//
// Bare melding, statuskode, Googles feilkode og en eventuell nettverkskode leses ut.
// Meldingen vaskes i tillegg for kjente tokenformer, i tilfelle et token havner der.

const MAX_MESSAGE = 300

const SECRET_PATTERNS: RegExp[] = [
  /ya29\.[\w.-]+/g, // access-token
  /1\/\/[\w.-]+/g, // refresh-token
  /Bearer\s+[\w.~+/-]+=*/gi,
  /\b(access_token|refresh_token|id_token|client_secret|code)=[^&\s"']+/gi,
]

function scrub(text: string): string {
  let out = text
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[skjult]')
  return out.length > MAX_MESSAGE ? out.slice(0, MAX_MESSAGE) + '…' : out
}

interface ErrorShape {
  message?: unknown
  status?: unknown
  code?: unknown
  response?: { status?: unknown; data?: { error?: unknown } }
}

function googleCode(data: { error?: unknown } | undefined): string | null {
  const e = data?.error
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const obj = e as { status?: unknown; errors?: { reason?: unknown }[] }
    const reason = obj.errors?.[0]?.reason
    if (typeof reason === 'string') return reason
    if (typeof obj.status === 'string') return obj.status
  }
  return null
}

export function describeDriveError(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as ErrorShape
  const message = typeof e.message === 'string' ? e.message : String(err)
  const status = typeof e.status === 'number' ? e.status
    : typeof e.response?.status === 'number' ? e.response.status
    : typeof e.code === 'number' ? e.code
    : null
  const code = typeof e.code === 'string' ? e.code : null
  const google = googleCode(e.response?.data)

  const parts = [
    status !== null ? `status ${status}` : null,
    google ? `google ${google}` : null,
    code ? `code ${code}` : null,
  ].filter(Boolean)
  return parts.length ? `${scrub(message)} (${parts.join(', ')})` : scrub(message)
}

export function logDriveError(label: string, err: unknown) {
  console.error(`[${label}] ${describeDriveError(err)}`)
}
