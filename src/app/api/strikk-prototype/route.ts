import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// anon/authenticated har bare SELECT på strikk_prototype (migrasjon 012).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const { driveFileId, fileName } = await req.json() as { driveFileId?: string; fileName?: string }
    if (!driveFileId || !fileName) {
      return NextResponse.json({ error: 'driveFileId og fileName er påkrevd' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from('strikk_prototype')
      .insert({ drive_file_id: driveFileId, file_name: fileName })
      .select('id, drive_file_id, file_name, strokes, counters')
      .single()
    if (error) {
      return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
