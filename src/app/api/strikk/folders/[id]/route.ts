import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cleanFolderName } from '@/app/strikk/_lib/folders'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const fail = (err: unknown) => NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/strikk/folders/[id]'>) {
  try {
    const { id } = await ctx.params
    const name = cleanFolderName((await req.json().catch(() => null))?.name)
    if (!name) return NextResponse.json({ error: 'Skriv et navn på mappa (høyst 60 tegn)' }, { status: 400 })
    const { data, error } = await supabaseAdmin.from('strikk_folder').update({ name }).eq('id', id).select('id, name, created_at').maybeSingle()
    if (error) return NextResponse.json({ error: error.code === '23505' ? `Det finnes alt en mappe som heter «${name}»` : error.message }, { status: error.code === '23505' ? 409 : 500 })
    if (!data) return NextResponse.json({ error: 'Fant ikke mappa' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) { return fail(err) }
}

// The folder goes; the recipes in it stay in the library.
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/strikk/folders/[id]'>) {
  try {
    const { id } = await ctx.params
    const { error } = await supabaseAdmin.from('strikk_folder').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) { return fail(err) }
}
