import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Removes the row only. The PDF stays where it is in Drive.
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/strikk-prototype/[id]'>) {
  try {
    const { id } = await ctx.params
    const { error } = await supabaseAdmin.from('strikk_prototype').delete().eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke fjerne: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
