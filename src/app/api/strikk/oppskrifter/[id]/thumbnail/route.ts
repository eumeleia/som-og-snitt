import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { THUMBNAIL_BUCKET, THUMBNAIL_MAX_BYTES } from '@/app/strikk/_lib/recipes'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// The first-page picture of a recipe, made in the browser (at upload, or the first time
// the recipe is opened without one). Replaces any earlier picture.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/oppskrifter/[id]/thumbnail'>) {
  try {
    const { id } = await ctx.params
    if (req.headers.get('content-type') !== 'image/jpeg') {
      return NextResponse.json({ error: 'Bildet må være JPEG' }, { status: 415 })
    }
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length === 0 || bytes.length > THUMBNAIL_MAX_BYTES) {
      return NextResponse.json({ error: `Bildet må være under ${THUMBNAIL_MAX_BYTES / 1024} kB` }, { status: 413 })
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return NextResponse.json({ error: 'Bildet er ikke en JPEG-fil' }, { status: 415 })
    }
    const { data: row, error: readError } = await supabaseAdmin.from('strikk_oppskrift').select('id').eq('id', id).maybeSingle()
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })

    const path = `${id}.jpg`
    const { error: upError } = await supabaseAdmin.storage.from(THUMBNAIL_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    if (upError) return NextResponse.json({ error: `Klarte ikke lagre bildet: ${upError.message}` }, { status: 500 })

    const thumbnail_at = new Date().toISOString()
    const { error } = await supabaseAdmin.from('strikk_oppskrift')
      .update({ thumbnail_path: path, thumbnail_at }).eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    return NextResponse.json({ thumbnail_path: path, thumbnail_at })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
