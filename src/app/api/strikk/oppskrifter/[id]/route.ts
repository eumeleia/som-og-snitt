import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { RECIPE_SELECT, type KnitRecipe } from '@/app/strikk/_lib/recipes'
import { parseRecipePatch } from '@/app/strikk/_lib/recipe-patch'
import { syncRecipeDriveName } from '@/lib/strikk-drive'
import { logDriveError } from '@/lib/drive-log'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/strikk/oppskrifter/[id]'>) {
  try {
    const { id } = await ctx.params
    const parsed = parseRecipePatch(await req.json().catch(() => null))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { patch, rename } = parsed
    const { data, error } = await supabaseAdmin
      .from('strikk_oppskrift')
      .update(patch)
      .eq('id', id)
      .select(RECIPE_SELECT)
      .maybeSingle()
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })
    const recipe = data as KnitRecipe
    // A new title or designer renames the Drive file to «Oppskrift - Designer.pdf». The
    // change itself is saved either way; a file that cannot be renamed (e.g. it is in the
    // private Drive) keeps its old name.
    if (rename) {
      try {
        recipe.file_name = await syncRecipeDriveName(recipe)
      } catch (err) {
        logDriveError('strikk/oppskrifter rename', err)
      }
    }
    return NextResponse.json(recipe)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}

// Sletter bare raden. PDF-en blir liggende i Disk.
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/strikk/oppskrifter/[id]'>) {
  try {
    const { id } = await ctx.params
    const { error } = await supabaseAdmin.from('strikk_oppskrift').delete().eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke slette: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
