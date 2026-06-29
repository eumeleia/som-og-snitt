import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | undefined

function getClient(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    }
  )
  return _client
}

export const supabase = getClient()
