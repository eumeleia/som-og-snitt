import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { mergeStashData, STASH_SELECT } from '@/app/strikk/_lib/stash'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const ROW_COLS = 'color_number, color_name, skein_count, leftover_g, note, uncertain_fields, uncertain_reasons, source_images, thumbnail_path, status'

// Slår sammen to rader Maria har sett er samme garn og farge: antall legges sammen, resten
// av feltene tas fra den som har dem. keepId beholder sin id og sitt miniatyrbilde; removeId
// sitt miniatyrbilde slettes fra lagring (med mindre keepId manglet et fra før).
export async function POST(req: NextRequest) {
  try {
    const { keep_id, remove_id } = await req.json() as { keep_id?: string; remove_id?: string }
    if (!keep_id || !remove_id || keep_id === remove_id) {
      return NextResponse.json({ error: 'Oppgi to ulike rader å slå sammen' }, { status: 400 })
    }
    const [{ data: a, error: aErr }, { data: b, error: bErr }] = await Promise.all([
      supabaseAdmin.from('strikk_yarn_stash').select(ROW_COLS).eq('id', keep_id).maybeSingle(),
      supabaseAdmin.from('strikk_yarn_stash').select(ROW_COLS).eq('id', remove_id).maybeSingle(),
    ])
    if (aErr || bErr) return NextResponse.json({ error: (aErr ?? bErr)!.message }, { status: 500 })
    if (!a || !b) return NextResponse.json({ error: 'Fant ikke en av radene' }, { status: 404 })

    const merged = mergeStashData(a, b)
    const nowApproved = a.status === 'godkjent' || b.status === 'godkjent'
    const patch = {
      ...merged,
      thumbnail_path: a.thumbnail_path ?? b.thumbnail_path,
      status: nowApproved ? 'godkjent' : 'til_gjennomgang',
      approved_at: nowApproved ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabaseAdmin.from('strikk_yarn_stash').update(patch).eq('id', keep_id).select(STASH_SELECT).maybeSingle()
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })

    const { error: delError } = await supabaseAdmin.from('strikk_yarn_stash').delete().eq('id', remove_id)
    if (delError) return NextResponse.json({ error: `Lagret, men klarte ikke slette den andre raden: ${delError.message}` }, { status: 500 })
    if (b.thumbnail_path && b.thumbnail_path !== a.thumbnail_path) await supabaseAdmin.storage.from('strikk-thumbnails').remove([b.thumbnail_path])

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
