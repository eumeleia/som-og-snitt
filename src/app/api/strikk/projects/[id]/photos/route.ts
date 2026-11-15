import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { COVER_BUCKET, COVER_MAX_BYTES } from '@/app/strikk/_lib/projects'
import { MIGRATION_030, PHOTO_SELECT, isMissingTable, nextPosition } from '@/app/strikk/_lib/project-photos'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// A photo of a finished project, compressed in the browser to under 200 kB. It goes last;
// the first photo is the cover.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/projects/[id]/photos'>) {
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
    const { data: project, error: pErr } = await supabaseAdmin.from('strikk_project').select('id, status').eq('id', id).maybeSingle()
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!project) return NextResponse.json({ error: 'Fant ikke prosjektet' }, { status: 404 })
    if (project.status !== 'done') return NextResponse.json({ error: 'Bilder kan bare legges til ferdige prosjekter' }, { status: 409 })

    const { data: existing, error: lErr } = await supabaseAdmin.from('strikk_project_photo').select('position').eq('project_id', id)
    if (lErr) return NextResponse.json({ error: isMissingTable(lErr) ? MIGRATION_030 : lErr.message }, { status: isMissingTable(lErr) ? 503 : 500 })

    const photoId = crypto.randomUUID()
    const path = `${id}/${photoId}.jpg`
    const { error: upError } = await supabaseAdmin.storage.from(COVER_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' })
    if (upError) return NextResponse.json({ error: `Klarte ikke lagre bildet: ${upError.message}` }, { status: 500 })

    const { data: row, error } = await supabaseAdmin.from('strikk_project_photo')
      .insert({ id: photoId, project_id: id, path, position: nextPosition(existing ?? []) }).select(PHOTO_SELECT).single()
    if (error) {
      await supabaseAdmin.storage.from(COVER_BUCKET).remove([path])
      return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json(row)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
