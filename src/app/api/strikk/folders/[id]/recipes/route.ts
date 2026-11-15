import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const fail = (err: unknown) => NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })

// { oppskrift_id, member }: puts a recipe in the folder or takes it out. A recipe can be in
// any number of folders.
export async function PUT(req: NextRequest, ctx: RouteContext<'/api/strikk/folders/[id]/recipes'>) {
  try {
    const { id } = await ctx.params
    const b = await req.json().catch(() => null)
    const recipeId = b?.oppskrift_id
    if (typeof recipeId !== 'string' || typeof b?.member !== 'boolean') return NextResponse.json({ error: 'Ugyldige data' }, { status: 400 })
    const { error } = b.member
      ? await supabaseAdmin.from('strikk_folder_recipe').upsert({ folder_id: id, oppskrift_id: recipeId }, { onConflict: 'folder_id,oppskrift_id', ignoreDuplicates: true })
      : await supabaseAdmin.from('strikk_folder_recipe').delete().eq('folder_id', id).eq('oppskrift_id', recipeId)
    if (error) return NextResponse.json({ error: error.code === '23503' ? 'Fant ikke mappa eller oppskriften' : error.message }, { status: error.code === '23503' ? 404 : 500 })
    return NextResponse.json({ ok: true })
  } catch (err) { return fail(err) }
}
