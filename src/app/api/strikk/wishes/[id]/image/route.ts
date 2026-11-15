import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { WISH_BUCKET } from '@/app/strikk/_lib/folders'
import { COVER_MAX_BYTES } from '@/app/strikk/_lib/projects'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const fail = (err: unknown) => NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })

// The wish's own picture, compressed in the browser to under 200 kB.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/wishes/[id]/image'>) {
  try {
    const { id } = await ctx.params
    if (req.headers.get('content-type') !== 'image/jpeg') return NextResponse.json({ error: 'Bildet må være JPEG' }, { status: 415 })
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length === 0 || bytes.length > COVER_MAX_BYTES) return NextResponse.json({ error: `Bildet må være under ${COVER_MAX_BYTES / 1024} kB` }, { status: 413 })
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return NextResponse.json({ error: 'Bildet er ikke en JPEG-fil' }, { status: 415 })
    const { data: wish, error: wErr } = await supabaseAdmin.from('strikk_wish').select('id').eq('id', id).maybeSingle()
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })
    if (!wish) return NextResponse.json({ error: 'Fant ikke ønsket' }, { status: 404 })
    const path = `${id}.jpg`
    const { error: upError } = await supabaseAdmin.storage.from(WISH_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    if (upError) return NextResponse.json({ error: `Klarte ikke lagre bildet: ${upError.message}` }, { status: 500 })
    const image_at = new Date().toISOString()
    const { error } = await supabaseAdmin.from('strikk_wish').update({ image_path: path, image_at }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ image_path: path, image_at })
  } catch (err) { return fail(err) }
}
