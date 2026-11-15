import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MIGRATION_031, WISH_SELECT, parseWish } from '@/app/strikk/_lib/folders'
import { isMissingTable } from '@/app/strikk/_lib/project-photos'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const fail = (err: unknown) => NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })

// A wish: a recipe from the library (oppskrift_id), or one Maria does not have yet.
export async function POST(req: NextRequest) {
  try {
    const parsed = parseWish(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { data, error } = await supabaseAdmin.from('strikk_wish').insert(parsed.value).select(WISH_SELECT).single()
    if (error) {
      if (isMissingTable(error)) return NextResponse.json({ error: MIGRATION_031 }, { status: 503 })
      if (error.code === '23505') return NextResponse.json({ error: 'Oppskriften står alt på ønskelista' }, { status: 409 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (err) { return fail(err) }
}
