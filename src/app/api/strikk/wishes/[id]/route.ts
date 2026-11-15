import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { WISH_BUCKET, WISH_SELECT, parseWish } from '@/app/strikk/_lib/folders'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const fail = (err: unknown) => NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/strikk/wishes/[id]'>) {
  try {
    const { id } = await ctx.params
    const parsed = parseWish(await req.json().catch(() => null), true)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    delete parsed.value.oppskrift_id
    const { data, error } = await supabaseAdmin.from('strikk_wish').update(parsed.value).eq('id', id).select(WISH_SELECT).maybeSingle()
    if (error) return NextResponse.json({ error: error.code === '23514' ? 'Skriv navnet på oppskriften' : error.message }, { status: error.code === '23514' ? 400 : 500 })
    if (!data) return NextResponse.json({ error: 'Fant ikke ønsket' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) { return fail(err) }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/strikk/wishes/[id]'>) {
  try {
    const { id } = await ctx.params
    const { data: wish } = await supabaseAdmin.from('strikk_wish').select('image_path').eq('id', id).maybeSingle()
    const { error } = await supabaseAdmin.from('strikk_wish').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (wish?.image_path) await supabaseAdmin.storage.from(WISH_BUCKET).remove([wish.image_path])
    return NextResponse.json({ ok: true })
  } catch (err) { return fail(err) }
}
