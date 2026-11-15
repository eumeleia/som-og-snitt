import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MIGRATION_031, cleanFolderName } from '@/app/strikk/_lib/folders'
import { isMissingTable } from '@/app/strikk/_lib/project-photos'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const fail = (err: unknown) => NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })

// A folder of Maria's own, e.g. one for each person she knits for.
export async function POST(req: NextRequest) {
  try {
    const name = cleanFolderName((await req.json().catch(() => null))?.name)
    if (!name) return NextResponse.json({ error: 'Skriv et navn på mappa (høyst 60 tegn)' }, { status: 400 })
    const { data, error } = await supabaseAdmin.from('strikk_folder').insert({ name }).select('id, name, created_at').single()
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ error: MIGRATION_031 }, { status: 503 })
      if (error.code === '23505') return NextResponse.json({ error: `Det finnes alt en mappe som heter «${name}»` }, { status: 409 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (err) { return fail(err) }
}
