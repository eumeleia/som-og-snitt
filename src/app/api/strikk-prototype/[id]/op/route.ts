import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { applyOps, type Op, type DocState } from '@/app/strikk/prototype/ops'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAX_ATTEMPTS = 5

export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk-prototype/[id]/op'>) {
  try {
    const { id } = await ctx.params
    const { ops } = await req.json() as { ops?: Op[] }
    if (!Array.isArray(ops) || ops.length === 0) {
      return NextResponse.json({ error: 'ops er påkrevd' }, { status: 400 })
    }

    // Les–flett–skriv med versjonen som lås: oppdateringen treffer bare hvis ingen andre
    // har skrevet i mellomtiden, ellers leses raden på nytt.
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data: row, error: readErr } = await supabaseAdmin
        .from('strikk_prototype')
        .select('strokes, counters, version')
        .eq('id', id)
        .single()
      if (readErr || !row) {
        return NextResponse.json({ error: `Fant ikke raden: ${readErr?.message ?? id}` }, { status: 404 })
      }

      const next = applyOps({ strokes: row.strokes, counters: row.counters } as DocState, ops)
      const { data: updated, error: writeErr } = await supabaseAdmin
        .from('strikk_prototype')
        .update({
          strokes: next.strokes,
          counters: next.counters,
          version: row.version + 1,
          last_opened: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('version', row.version)
        .select('version')
      if (writeErr) {
        return NextResponse.json({ error: `Klarte ikke lagre: ${writeErr.message}` }, { status: 500 })
      }
      if (updated && updated.length > 0) {
        return NextResponse.json({ ok: true, version: updated[0].version })
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
