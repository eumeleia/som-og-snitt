import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MISSING_COLUMN, STASH_SELECTS, STASH_STATUSES } from '@/app/strikk/_lib/stash'

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
    str('color_number'); str('color_name'); str('note'); str('project_id')
    num('skein_count'); num('leftover_g'); num('project_skeins')
    // Skeins set aside for the project: not more than the row has, and gone with the project.
    if (patch.project_id === null) patch.project_skeins = null
    if (typeof patch.project_skeins === 'number') {
      let total = typeof patch.skein_count === 'number' ? patch.skein_count : null
      if (total === null) {
        const { data: cur } = await supabaseAdmin.from('strikk_yarn_stash').select('skein_count').eq('id', id).maybeSingle()
        total = cur ? Number(cur.skein_count) : null
      }
      if ((patch.project_skeins as number) <= 0 || (total !== null && (patch.project_skeins as number) > total)) {
        return NextResponse.json({ error: `Antall nøster til prosjektet må være mellom 0 og ${total ?? 'antallet i lageret'}` }, { status: 400 })
      }
      // All of them is the same as the whole row.
      if (total !== null && patch.project_skeins === total) patch.project_skeins = null
    }

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

    // Before migration 029: a whole-row assignment (project_skeins null) still works without
    // the column; only a part of the row needs it.
    const update = async (select: string) =>
      supabaseAdmin.from('strikk_yarn_stash').update(patch).eq('id', id).select(select).maybeSingle()
    let res = null as Awaited<ReturnType<typeof update>> | null
    for (let i = 0; i < STASH_SELECTS.length; i++) {
      res = await update(STASH_SELECTS[i])
      if (res.error?.code !== MISSING_COLUMN) break
      if (res.error.message.includes('project_skeins') && 'project_skeins' in patch) {
        if (patch.project_skeins !== null) {
          return NextResponse.json({ error: 'Kjør migrasjon 029 i Supabase for å tildele bare noen av nøstene.' }, { status: 409 })
        }
        delete patch.project_skeins
        i--
      }
    }
    if (res?.error) return NextResponse.json({ error: `Klarte ikke lagre: ${res.error.message}` }, { status: 500 })
    if (!res?.data) return NextResponse.json({ error: 'Fant ikke raden' }, { status: 404 })
    return NextResponse.json(res.data)
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
