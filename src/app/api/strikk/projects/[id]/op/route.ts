import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { applyOps, type Op, type DocState } from '@/app/strikk/_lib/markup-ops'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAX_ATTEMPTS = 5

// Samme lås-mønster som /api/strikk-prototype/[id]/op hadde: les–flett–skriv mot
// versjonen, så to enheter som skriver samtidig på samme prosjekt ikke overskriver
// hverandres streker.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/projects/[id]/op'>) {
  try {
    const { id } = await ctx.params
    const { ops } = await req.json() as { ops?: Op[] }
    if (!Array.isArray(ops) || ops.length === 0) {
      return NextResponse.json({ error: 'ops er påkrevd' }, { status: 400 })
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 20 + Math.random() * 60))
      const { data: row, error: readErr } = await supabaseAdmin
        .from('strikk_project')
        .select('strokes, counters, version')
        .eq('id', id)
        .single()
      if (readErr?.code === 'PGRST116' || (!readErr && !row)) {
        return NextResponse.json({ error: `Fant ikke prosjektet: ${id}` }, { status: 404 })
      }
      if (readErr || !row) {
        return NextResponse.json({ error: `Klarte ikke lese prosjektet: ${readErr?.message}` }, { status: 500 })
      }

      const next = applyOps({ strokes: row.strokes, counters: row.counters } as DocState, ops)
      const { data: updated, error: writeErr } = await supabaseAdmin
        .from('strikk_project')
        .update({ strokes: next.strokes, counters: next.counters, version: row.version + 1, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('version', row.version)
        .select('version')
      if (writeErr) {
        return NextResponse.json({ error: `Klarte ikke lagre: ${writeErr.message}` }, { status: 500 })
      }
      if (updated && updated.length > 0) {
        return NextResponse.json({ ok: true, version: updated[0].version, counters: next.counters })
      }
    }
    return NextResponse.json({ error: 'For mange samtidige skrivinger' }, { status: 409 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
