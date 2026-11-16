import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseSwatch } from '@/app/strikk/_lib/gauge-calc'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// A swatch Maria measured (Kalkulator › «Lagre som strikkeprøve»): the yarns with strands, the
// needle and the measured gauge. Used before the estimate the next time the same yarns and
// needle are chosen, and as «Egen strikkeprøve» among the alternatives.
export async function POST(req: NextRequest) {
  try {
    const parsed = parseSwatch(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { members, ...swatch } = parsed.value
    const { data, error } = await supabaseAdmin.from('strikk_swatch').insert(swatch)
      .select('id, gauge_stitches_10cm, gauge_rows_10cm, needle_mm, notes, created_at').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const { error: memberError } = await supabaseAdmin.from('strikk_swatch_yarn')
      .insert(members.map((m, position) => ({ swatch_id: data.id, position, yarn_id: m.yarn_id, strands: m.strands })))
    if (memberError) {
      // Without its yarns the swatch matches nothing; take it out again.
      await supabaseAdmin.from('strikk_swatch').delete().eq('id', data.id)
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }
    return NextResponse.json({ ...data, strikk_swatch_yarn: members.map((m, position) => ({ position, ...m })) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
