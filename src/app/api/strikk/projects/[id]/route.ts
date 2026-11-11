import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PROJECT_SELECT, STATUSES, type Project, type ProjectStatus } from '@/app/strikk/_lib/projects'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface YarnLinePatch { position: number; yarn_id: string | null; color_label: string | null }

interface Body {
  name?: unknown; size_index?: unknown; size_label?: unknown; needles?: unknown
  status?: unknown; start_date?: unknown; end_date?: unknown; notes?: unknown; sort_order?: unknown
  yarnLines?: unknown
}

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/strikk/projects/[id]'>) {
  try {
    const { id } = await ctx.params
    const body = await req.json() as Body
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return NextResponse.json({ error: 'Navn kan ikke være tomt' }, { status: 400 })
      patch.name = name
    }
    if (body.size_index !== undefined) patch.size_index = typeof body.size_index === 'number' ? body.size_index : null
    if (body.size_label !== undefined) patch.size_label = typeof body.size_label === 'string' ? body.size_label.trim() || null : null
    if (body.needles !== undefined) patch.needles = typeof body.needles === 'string' ? body.needles.trim() || null : null
    if (body.notes !== undefined) patch.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    if (body.start_date !== undefined) patch.start_date = typeof body.start_date === 'string' ? body.start_date || null : null
    if (body.end_date !== undefined) patch.end_date = typeof body.end_date === 'string' ? body.end_date || null : null
    if (body.sort_order !== undefined && typeof body.sort_order === 'number') patch.sort_order = body.sort_order
    if (body.status !== undefined) {
      if (!(STATUSES as readonly unknown[]).includes(body.status)) {
        return NextResponse.json({ error: 'Ukjent status' }, { status: 400 })
      }
      patch.status = body.status as ProjectStatus
    }

    const { error } = await supabaseAdmin.from('strikk_project').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })

    if (Array.isArray(body.yarnLines)) {
      const lines = body.yarnLines as YarnLinePatch[]
      const { error: delErr } = await supabaseAdmin.from('strikk_project_yarn').delete().eq('project_id', id)
      if (delErr) return NextResponse.json({ error: `Klarte ikke lagre garnet: ${delErr.message}` }, { status: 500 })
      if (lines.length > 0) {
        const { error: insErr } = await supabaseAdmin.from('strikk_project_yarn').insert(
          lines.map(l => ({ project_id: id, position: l.position, yarn_id: l.yarn_id, color_label: l.color_label })),
        )
        if (insErr) return NextResponse.json({ error: `Klarte ikke lagre garnet: ${insErr.message}` }, { status: 500 })
      }
    }

    const { data, error: readErr } = await supabaseAdmin
      .from('strikk_project').select(PROJECT_SELECT).eq('id', id).maybeSingle()
    if (readErr) return NextResponse.json({ error: `Klarte ikke lese prosjektet: ${readErr.message}` }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Fant ikke prosjektet' }, { status: 404 })
    return NextResponse.json(data as unknown as Project)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}

// Sletter bare raden. Oppskriften (og PDF-en i Disk) blir liggende.
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/strikk/projects/[id]'>) {
  try {
    const { id } = await ctx.params
    const { error } = await supabaseAdmin.from('strikk_project').delete().eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke slette: ${error.message}` }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
