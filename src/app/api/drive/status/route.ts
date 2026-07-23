import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET() {
  const { data } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'google_drive_token')
    .single()

  if (!data) return NextResponse.json({ connected: false })
  const { email } = data.value as { refresh_token: string; email?: string }
  return NextResponse.json({ connected: true, email })
}
