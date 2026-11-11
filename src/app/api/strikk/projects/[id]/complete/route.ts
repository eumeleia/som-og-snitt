import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface LeftoverInput { stash_id: unknown; skein_count: unknown; leftover_g: unknown }

// Fullfører et prosjekt: garnet som var tildelt det (strikk_yarn_stash.project_id) er brukt
// opp og blir ikke stående i prosjektet lenger, men restegarn Maria oppgir legges tilbake i
// Garnlageret som nye, godkjente rader — samme garn og farge, tilbake til tildeling.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/projects/[id]/complete'>) {
  try {
    const { id } = await ctx.params
    const { data: project, error: projErr } = await supabaseAdmin.from('strikk_project').select('id, name').eq('id', id).maybeSingle()
    if (projErr) return NextResponse.json({ error: projErr.message }, { status: 500 })
    if (!project) return NextResponse.json({ error: 'Fant ikke prosjektet' }, { status: 404 })

    const body = await req.json() as { leftovers?: unknown }
    const leftovers = (Array.isArray(body.leftovers) ? body.leftovers as LeftoverInput[] : [])
      .map(l => ({
        stash_id: typeof l.stash_id === 'string' ? l.stash_id : null,
        skein_count: typeof l.skein_count === 'number' && l.skein_count > 0 ? l.skein_count : 0,
        leftover_g: typeof l.leftover_g === 'number' && l.leftover_g > 0 ? l.leftover_g : 0,
      }))
      .filter(l => l.stash_id && (l.skein_count > 0 || l.leftover_g > 0))

    for (const l of leftovers) {
      const { data: original, error: readErr } = await supabaseAdmin
        .from('strikk_yarn_stash').select('yarn_id, color_number, color_name, thumbnail_path')
        .eq('id', l.stash_id).eq('project_id', id).maybeSingle()
      if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
      if (!original) continue // raden var ikke tildelt dette prosjektet — hopp over, ikke feil hele fullføringen
      const now = new Date().toISOString()
      const { error: insErr } = await supabaseAdmin.from('strikk_yarn_stash').insert({
        yarn_id: original.yarn_id, color_number: original.color_number, color_name: original.color_name,
        skein_count: l.skein_count, leftover_g: l.leftover_g || null, thumbnail_path: original.thumbnail_path,
        source_images: [], note: `Rest fra ${project.name}`, status: 'godkjent', approved_at: now,
      })
      if (insErr) return NextResponse.json({ error: `Klarte ikke legge tilbake restegarn: ${insErr.message}` }, { status: 500 })
    }

    const { error } = await supabaseAdmin.from('strikk_project').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke fullføre prosjektet: ${error.message}` }, { status: 500 })

    return NextResponse.json({ ok: true, leftovers_added: leftovers.length })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
