// Structured error info for on-screen diagnostics — lets a user without devtools
// (typically on mobile) report back the real error instead of a generic message.

export interface ErrorDetails {
  message: string
  name: string
  stackLines: string[]
}

export function describeError(err: unknown): ErrorDetails {
  if (err instanceof Error) {
    return {
      message: err.message || 'Ukjent feil',
      name: err.name || 'Error',
      stackLines: (err.stack ?? '').split('\n').slice(0, 3),
    }
  }
  return {
    message: typeof err === 'string' ? err : 'Noe gikk galt',
    name: 'UnknownError',
    stackLines: [],
  }
}

export function formatErrorDetails(details: ErrorDetails, context?: string): string {
  return [context, `${details.name}: ${details.message}`, ...details.stackLines]
    .filter(Boolean)
    .join('\n')
}
