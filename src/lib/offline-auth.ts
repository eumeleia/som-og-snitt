import type { AuthError, Session } from '@supabase/supabase-js'

// Without a network an expired login cannot be renewed, and getSession then answers
// «no session» while the session is still stored. That must not send Maria to the login
// page when she opens a project offline: the stored project data is used instead.
export function signedInOrOffline(session: Session | null, error: AuthError | null): boolean {
  if (session) return true
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  return offline || error?.name === 'AuthRetryableFetchError'
}
