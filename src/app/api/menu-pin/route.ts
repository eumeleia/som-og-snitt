import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parsePinBody } from '@/lib/menu-pin'

// anon/authenticated har bare SELECT på menu_pin (migrasjon 027).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// { kind, project_id } fester prosjektet og erstatter forrige pin av samme type;
// { kind, project_id: null } løsner den.
export async function POST(req: NextRequest) {
  try {
    const parsed = parsePinBody(await req.json().catch(() => null))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { kind, projectId } = parsed

    if (projectId === null) {
      const { error } = await supabaseAdmin.from('menu_pin').delete().eq('kind', kind)
      if (error) return NextResponse.json({ error: `Klarte ikke løsne: ${error.message}` }, { status: 500 })
      return NextResponse.json({ ok: true, kind, project_id: null })
    }

    const table = kind === 'strikk' ? 'strikk_project' : 'projects'
    const { data: project, error: findError } = await supabaseAdmin.from(table).select('id').eq('id', projectId).maybeSingle()
    if (findError) return NextResponse.json({ error: `Klarte ikke finne prosjektet: ${findError.message}` }, { status: 500 })
    if (!project) return NextResponse.json({ error: 'Fant ikke prosjektet' }, { status: 404 })

    const { error } = await supabaseAdmin.from('menu_pin')
      .upsert({ kind, project_id: projectId, pinned_at: new Date().toISOString() }, { onConflict: 'kind' })
    if (error) {
      const missing = error.code === '42P01' || error.code === 'PGRST205'
      return NextResponse.json(
        { error: missing ? 'Tabellen menu_pin finnes ikke ennå. Kjør migrasjon 027 i Supabase.' : `Klarte ikke feste: ${error.message}` },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true, kind, project_id: projectId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
