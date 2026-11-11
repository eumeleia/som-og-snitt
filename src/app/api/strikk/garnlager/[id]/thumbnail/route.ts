import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { makeThumbnail, sniffBildeformat, UgyldigBildeError } from '@/lib/heic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Maria bytter miniatyrbildet selv når pipelinen har valgt feil bilde. Erstatter alltid
// den gamle fila i lagringen — ingen versjonering, bildet trengs bare til gjenkjenning.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/garnlager/[id]/thumbnail'>) {
  try {
    const { id } = await ctx.params
    const bytes = Buffer.from(await req.arrayBuffer())
    if (bytes.length === 0) return NextResponse.json({ error: 'Bildet er tomt' }, { status: 400 })

    const format = sniffBildeformat(bytes)
    if (!format) return NextResponse.json({ error: 'Kjenner ikke igjen bildeformatet' }, { status: 415 })

    const { data: row, error: readErr } = await supabaseAdmin
      .from('strikk_yarn_stash').select('thumbnail_path').eq('id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: 'Fant ikke raden' }, { status: 404 })

    const thumb = await makeThumbnail(bytes, format)
    const path = `garnlager/${randomUUID()}.jpg`
    const { error: upErr } = await supabaseAdmin.storage.from('strikk-thumbnails')
      .upload(path, thumb, { contentType: 'image/jpeg', upsert: true })
    if (upErr) return NextResponse.json({ error: `Klarte ikke lagre bildet: ${upErr.message}` }, { status: 500 })

    const { error } = await supabaseAdmin.from('strikk_yarn_stash')
      .update({ thumbnail_path: path, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })

    if (row.thumbnail_path && row.thumbnail_path !== path) {
      await supabaseAdmin.storage.from('strikk-thumbnails').remove([row.thumbnail_path])
    }
    return NextResponse.json({ thumbnail_path: path })
  } catch (err) {
    if (err instanceof UgyldigBildeError) return NextResponse.json({ error: err.message }, { status: 422 })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
