import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { COVER_BUCKET, COVER_MAX_BYTES } from '@/app/strikk/_lib/projects'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function exists(id: string) {
  const { data, error } = await supabaseAdmin.from('strikk_project').select('id').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

// Maria's own cover picture for a project, compressed in the browser to under 200 kB.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/projects/[id]/cover'>) {
  try {
    const { id } = await ctx.params
    if (req.headers.get('content-type') !== 'image/jpeg') {
      return NextResponse.json({ error: 'Bildet må være JPEG' }, { status: 415 })
    }
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length === 0 || bytes.length > COVER_MAX_BYTES) {
      return NextResponse.json({ error: `Bildet må være under ${COVER_MAX_BYTES / 1024} kB` }, { status: 413 })
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return NextResponse.json({ error: 'Bildet er ikke en JPEG-fil' }, { status: 415 })
    }
    if (!await exists(id)) return NextResponse.json({ error: 'Fant ikke prosjektet' }, { status: 404 })

    const path = `${id}.jpg`
    const { error: upError } = await supabaseAdmin.storage.from(COVER_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    if (upError) return NextResponse.json({ error: `Klarte ikke lagre bildet: ${upError.message}` }, { status: 500 })

    const cover_at = new Date().toISOString()
    const { error } = await supabaseAdmin.from('strikk_project').update({ cover_path: path, cover_at }).eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    return NextResponse.json({ cover_path: path, cover_at })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}

// Back to the recipe's first page: the own picture is deleted.
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/strikk/projects/[id]/cover'>) {
  try {
    const { id } = await ctx.params
    if (!await exists(id)) return NextResponse.json({ error: 'Fant ikke prosjektet' }, { status: 404 })
    const { error: rmError } = await supabaseAdmin.storage.from(COVER_BUCKET).remove([`${id}.jpg`])
    if (rmError) return NextResponse.json({ error: `Klarte ikke slette bildet: ${rmError.message}` }, { status: 500 })
    const { error } = await supabaseAdmin.from('strikk_project').update({ cover_path: null, cover_at: null }).eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    return NextResponse.json({ cover_path: null, cover_at: null })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
