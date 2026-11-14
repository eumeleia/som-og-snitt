import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { MISSING_COLUMN, STASH_SELECT, STASH_SELECT_WITH_LOT, parseNewStash } from '@/app/strikk/_lib/stash'
import { matchYarn, type Alias } from '@/app/strikk/_lib/yarns'

// anon/authenticated har bare SELECT på strikk_yarn_stash og strikk_yarn (migrasjon 017/024).
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Garn Maria legger til selv i Lager. Et garn som ikke finnes i katalogen (heller ikke
// under en annen skrivemåte) legges inn med status 'draft' («Ikke slått opp») og slås opp
// senere etter docs/strikk-innlesing.md punkt 6. Raden er godkjent med en gang: Maria har
// tastet den inn selv, den kommer ikke fra et bilde.
export async function POST(req: NextRequest) {
  try {
    const input = parseNewStash(await req.json().catch(() => null))
    if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })

    let yarnId = input.yarn_id
    let createdYarn: Record<string, unknown> | null = null
    if (yarnId) {
      const { data } = await supabaseAdmin.from('strikk_yarn').select('id').eq('id', yarnId).maybeSingle()
      if (!data) return NextResponse.json({ error: 'Fant ikke garnet i katalogen' }, { status: 404 })
    } else {
      const { data: catalogue, error } = await supabaseAdmin.from('strikk_yarn').select('id, brand, name, aliases')
      if (error) return NextResponse.json({ error: `Klarte ikke lese katalogen: ${error.message}` }, { status: 500 })
      const match = matchYarn((catalogue ?? []) as { id: string; brand: string; name: string; aliases: Alias[] }[], input.brand, input.name)
      if (match?.certain) {
        yarnId = match.yarn.id
      } else {
        const { data: yarn, error: insertError } = await supabaseAdmin
          .from('strikk_yarn').insert({ brand: input.brand, name: input.name, status: 'draft' }).select('*').single()
        if (insertError) return NextResponse.json({ error: `Klarte ikke lagre garnet: ${insertError.message}` }, { status: 500 })
        yarnId = yarn.id as string
        createdYarn = yarn
      }
    }

    const now = new Date().toISOString()
    const row: Record<string, unknown> = {
      yarn_id: yarnId,
      color_name: input.color_name,
      color_number: input.color_number,
      skein_count: input.unit === 'skeins' ? input.amount : 0,
      leftover_g: input.unit === 'grams' ? input.amount : null,
      status: 'godkjent',
      approved_at: now,
    }
    let warning: string | null = null
    let res = await supabaseAdmin.from('strikk_yarn_stash')
      .insert({ ...row, dye_lot: input.dye_lot }).select(STASH_SELECT_WITH_LOT).single()
    if (res.error?.code === MISSING_COLUMN) {
      // Migration 028 not run yet: keep the parti in the note so it is not lost.
      if (input.dye_lot) warning = 'Partiet ble lagret i notatet, fordi migrasjon 028 ikke er kjørt ennå.'
      res = await supabaseAdmin.from('strikk_yarn_stash')
        .insert({ ...row, note: input.dye_lot ? `Parti: ${input.dye_lot}` : null }).select(STASH_SELECT).single()
    }
    if (res.error) return NextResponse.json({ error: `Klarte ikke lagre i lageret: ${res.error.message}` }, { status: 500 })
    return NextResponse.json({ row: res.data, yarn: createdYarn, warning })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
