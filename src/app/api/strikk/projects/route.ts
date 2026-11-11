import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { EXTRACTION_SELECT, storedToExtraction, type StoredRecipe } from '@/app/strikk/_lib/extraction'
import { PROJECT_SELECT, type Project } from '@/app/strikk/_lib/projects'

// anon/authenticated har bare SELECT på strikk_project (migrasjon 019).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Starter et prosjekt fra en oppskrift (seeder garnlinjene fra oppskriftens egne, i samme
// rekkefølge, slik at posisjonen i strikk_project_yarn svarer til yarn_line-indeksen) eller
// som et tomt prosjekt.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { oppskriftId?: string; name?: string }

    if (body.oppskriftId) {
      const { data: recipe, error: recipeErr } = await supabaseAdmin
        .from('strikk_oppskrift')
        .select(EXTRACTION_SELECT)
        .eq('id', body.oppskriftId)
        .maybeSingle()
      if (recipeErr) return NextResponse.json({ error: `Klarte ikke lese oppskriften: ${recipeErr.message}` }, { status: 500 })
      if (!recipe) return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })

      const d = storedToExtraction(recipe as unknown as StoredRecipe)
      const { data: project, error: insertErr } = await supabaseAdmin
        .from('strikk_project')
        .insert({
          name: d.title || 'Nytt prosjekt',
          oppskrift_id: body.oppskriftId,
          needles: d.needles.join(', ') || null,
        })
        .select('id')
        .single()
      if (insertErr) return NextResponse.json({ error: `Klarte ikke lagre prosjektet: ${insertErr.message}` }, { status: 500 })

      if (d.yarn_lines.length > 0) {
        const { error: yarnErr } = await supabaseAdmin.from('strikk_project_yarn').insert(
          d.yarn_lines.map((l, i) => ({
            project_id: project.id, position: i, yarn_id: l.yarn_id, color_label: l.color_label,
          })),
        )
        if (yarnErr) return NextResponse.json({ error: `Klarte ikke lagre garnlinjene: ${yarnErr.message}` }, { status: 500 })
      }

      const { data: full, error: fullErr } = await supabaseAdmin
        .from('strikk_project').select(PROJECT_SELECT).eq('id', project.id).single()
      if (fullErr) return NextResponse.json({ error: `Klarte ikke lese prosjektet: ${fullErr.message}` }, { status: 500 })
      return NextResponse.json(full as unknown as Project)
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Navn er påkrevd' }, { status: 400 })
    const { data, error } = await supabaseAdmin
      .from('strikk_project').insert({ name }).select(PROJECT_SELECT).single()
    if (error) return NextResponse.json({ error: `Klarte ikke lagre prosjektet: ${error.message}` }, { status: 500 })
    return NextResponse.json(data as unknown as Project)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
