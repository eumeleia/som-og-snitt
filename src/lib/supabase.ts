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

/**
 * Peker denne URL-en allerede til en fil i vår egen Supabase Storage, eller er den
 * ekstern (selfmade.com o.l.)? Brukes til å unngå å laste opp samme bilde på nytt, og
 * til å gruppere lagerrader i «Etterfyll produktbilder».
 */
export function erSupabaseStorageUrl(url: string): boolean {
  try {
    return new URL(url).hostname === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname
  } catch {
    return false
  }
}
