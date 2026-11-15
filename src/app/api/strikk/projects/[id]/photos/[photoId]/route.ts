import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { COVER_BUCKET } from '@/app/strikk/_lib/projects'
import { PHOTO_SELECT, frontPosition } from '@/app/strikk/_lib/project-photos'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Ctx = RouteContext<'/api/strikk/projects/[id]/photos/[photoId]'>

async function photoOf(id: string, photoId: string) {
  const { data, error } = await supabaseAdmin.from('strikk_project_photo').select(PHOTO_SELECT).eq('id', photoId).eq('project_id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// { cover: true }: the photo goes before all the others and becomes the cover.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id, photoId } = await ctx.params
    const body = await req.json().catch(() => null)
    if (body?.cover !== true) return NextResponse.json({ error: 'Ugyldig endring' }, { status: 400 })
    if (!await photoOf(id, photoId)) return NextResponse.json({ error: 'Fant ikke bildet' }, { status: 404 })
    const { data: all, error: lErr } = await supabaseAdmin.from('strikk_project_photo').select('position').eq('project_id', id)
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
    const { data, error } = await supabaseAdmin.from('strikk_project_photo')
      .update({ position: frontPosition(all ?? []) }).eq('id', photoId).select(PHOTO_SELECT).single()
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id, photoId } = await ctx.params
    const photo = await photoOf(id, photoId)
    if (!photo) return NextResponse.json({ error: 'Fant ikke bildet' }, { status: 404 })
    const { error: rmError } = await supabaseAdmin.storage.from(COVER_BUCKET).remove([photo.path])
    if (rmError) return NextResponse.json({ error: `Klarte ikke slette bildet: ${rmError.message}` }, { status: 500 })
    const { error } = await supabaseAdmin.from('strikk_project_photo').delete().eq('id', photoId)
    if (error) return NextResponse.json({ error: `Klarte ikke slette: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
