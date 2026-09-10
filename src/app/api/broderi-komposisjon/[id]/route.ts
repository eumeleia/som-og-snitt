import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Skriver KUN data — rører aldri slettet_tid. Det er hele poenget med at slettet_tid er
// en egen kolonne (migrasjon 009): autolagringen fra editoren skal ikke kunne gjenopprette
// en komposisjon som er slettet fra en annen fane. Bruk PATCH for slettet_tid.
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
      .select('id, data, created_at, slettet_tid')
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

// Skriver KUN slettet_tid — rører aldri data. null = gjenopprett.
export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/broderi-komposisjon/[id]'>) {
  try {
    const { id } = await ctx.params
    const body = await req.json()
    if (!('slettetTid' in body) || (body.slettetTid !== null && typeof body.slettetTid !== 'string')) {
      return NextResponse.json({ error: 'slettetTid er påkrevd (string eller null)' }, { status: 400 })
    }

    const { data: saved, error } = await supabaseAdmin
      .from('broderi_komposisjon')
      .update({ slettet_tid: body.slettetTid })
      .eq('id', id)
      .select('id, data, created_at, slettet_tid')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: `Klarte ikke oppdatere slettestatus for ${id}: ${error.message}` }, { status: 500 })
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

// Permanent sletting. Klienten kaller denne bare fra søppelkurven («Slett for godt») —
// vanlig sletting fra lista går via PATCH (myk sletting, slettet_tid).
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
