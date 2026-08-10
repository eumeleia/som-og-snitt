import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function PUT(req: NextRequest, ctx: RouteContext<'/api/broderi-komposisjon/[id]'>) {
  try {
    const { id } = await ctx.params
    const body = await req.json()
    if (!body?.data) {
      return NextResponse.json({ error: 'data er påkrevd' }, { status: 400 })
    }

    const { data: saved, error } = await supabaseAdmin
      .from('broderi_komposisjon')
      .update({ data: body.data })
      .eq('id', id)
      .select('id, data, created_at')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: `Klarte ikke oppdatere komposisjonen ${id}: ${error.message}` }, { status: 500 })
    }
    if (!saved) {
      return NextResponse.json({ error: `Fant ingen komposisjon med id ${id}` }, { status: 404 })
    }
    return NextResponse.json(saved)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : 'Noe gikk galt' },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/broderi-komposisjon/[id]'>) {
  try {
    const { id } = await ctx.params
    const { error } = await supabaseAdmin
      .from('broderi_komposisjon')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: `Klarte ikke slette komposisjonen ${id}: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : 'Noe gikk galt' },
      { status: 500 }
    )
  }
}
