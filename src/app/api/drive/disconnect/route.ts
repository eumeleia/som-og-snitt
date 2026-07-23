import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST() {
  await supabaseAdmin.from('app_config').delete().eq('key', 'google_drive_token')
  await supabaseAdmin.from('app_config').delete().eq('key', 'google_drive_folder_id')
  return NextResponse.json({ ok: true })
}
