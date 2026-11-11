import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// anon/authenticated har bare SELECT på strikk_yarn (migrasjon 017). favorite og
// price_per_skein er Marias egne — overalt et garn vises kan hun sette dem herfra.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/strikk/yarn/[id]'>) {
  try {
    const { id } = await ctx.params
    const body = await req.json() as { favorite?: unknown; price_per_skein?: unknown }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (body.favorite !== undefined) {
      if (body.favorite !== null && typeof body.favorite !== 'boolean') {
        return NextResponse.json({ error: 'favorite må være boolean eller null' }, { status: 400 })
      }
      patch.favorite = body.favorite
    }
    if (body.price_per_skein !== undefined) {
      if (body.price_per_skein !== null && typeof body.price_per_skein !== 'number') {
        return NextResponse.json({ error: 'price_per_skein må være tall eller null' }, { status: 400 })
      }
      patch.price_per_skein = body.price_per_skein
    }

    const { data, error } = await supabaseAdmin
      .from('strikk_yarn').update(patch).eq('id', id)
      .select('id, favorite, price_per_skein').maybeSingle()
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Fant ikke garnet' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
