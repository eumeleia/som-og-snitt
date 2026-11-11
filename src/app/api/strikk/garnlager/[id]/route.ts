import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { STASH_SELECT, STASH_STATUSES } from '@/app/strikk/_lib/stash'

// anon/authenticated har bare SELECT på strikk_yarn_stash (migrasjon 024). Alt Maria
// retter, slår sammen, godkjenner eller sletter i Garnlager, går herfra.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function PATCH(req: NextRequest, ctx: RouteContext<'/api/strikk/garnlager/[id]'>) {
  try {
    const { id } = await ctx.params
    const body = await req.json() as Record<string, unknown>
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    const str = (k: string) => {
      if (body[k] === undefined) return
      if (body[k] !== null && typeof body[k] !== 'string') throw new Error(`${k} må være tekst eller null`)
      patch[k] = body[k] === null ? null : (body[k] as string).trim() || null
    }
    const num = (k: string) => {
      if (body[k] === undefined) return
      if (body[k] !== null && typeof body[k] !== 'number') throw new Error(`${k} må være tall eller null`)
      patch[k] = body[k]
    }
    str('color_number'); str('color_name'); str('note')
    num('skein_count'); num('leftover_g')

    if (body.status !== undefined) {
      if (!STASH_STATUSES.includes(body.status as never)) return NextResponse.json({ error: 'Ukjent status' }, { status: 400 })
      patch.status = body.status
      patch.approved_at = body.status === 'godkjent' ? new Date().toISOString() : null
    }
    // Rettet felt er ikke lenger usikkert.
    if (body.clear_uncertain !== undefined) {
      const clear = new Set(Array.isArray(body.clear_uncertain) ? body.clear_uncertain as string[] : [])
      const { data: current } = await supabaseAdmin.from('strikk_yarn_stash').select('uncertain_fields, uncertain_reasons').eq('id', id).maybeSingle()
      if (current) {
        patch.uncertain_fields = (current.uncertain_fields as string[]).filter(f => !clear.has(f))
        patch.uncertain_reasons = Object.fromEntries(Object.entries(current.uncertain_reasons as Record<string, string>).filter(([f]) => !clear.has(f)))
      }
    }

    const { data, error } = await supabaseAdmin
      .from('strikk_yarn_stash').update(patch).eq('id', id)
      .select(STASH_SELECT).maybeSingle()
    if (error) return NextResponse.json({ error: `Klarte ikke lagre: ${error.message}` }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Fant ikke raden' }, { status: 404 })
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: err instanceof Error && /må være/.test(err.message) ? 400 : 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/strikk/garnlager/[id]'>) {
  try {
    const { id } = await ctx.params
    const { data: row } = await supabaseAdmin.from('strikk_yarn_stash').select('thumbnail_path').eq('id', id).maybeSingle()
    const { error } = await supabaseAdmin.from('strikk_yarn_stash').delete().eq('id', id)
    if (error) return NextResponse.json({ error: `Klarte ikke slette: ${error.message}` }, { status: 500 })
    if (row?.thumbnail_path) await supabaseAdmin.storage.from('strikk-thumbnails').remove([row.thumbnail_path])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
