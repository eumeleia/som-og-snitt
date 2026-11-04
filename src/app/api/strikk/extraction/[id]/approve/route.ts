import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { clearUncertain, normalizeExtraction } from '@/app/strikk/_lib/extraction'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Saves the reviewed and corrected data and locks it. Corrections clear the uncertain
// marks: what is approved is what you looked at.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/extraction/[id]/approve'>) {
  try {
    const { id } = await ctx.params
    const { data } = await req.json() as { data?: unknown }
    const clean = clearUncertain(normalizeExtraction(data))
    if (!clean.title) return NextResponse.json({ error: 'Tittel kan ikke være tom' }, { status: 400 })
    const { data: result, error } = await supabaseAdmin.rpc('strikk_save_extraction', {
      p_id: id,
      p_data: clean,
      p_approve: true,
    })
    if (error) return NextResponse.json({ error: `Godkjenning feilet: ${error.message}` }, { status: 500 })
    if (result === 'missing') return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })
    if (result === 'locked') return NextResponse.json({ error: 'Oppskriften er allerede godkjent' }, { status: 409 })
    return NextResponse.json({ status: 'approved' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
