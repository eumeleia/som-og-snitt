import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { byggMotivMiniatyrSvg, type MiniatyrBbox, type MiniatyrBlokk } from '@/lib/pesMiniatyr'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Et enkelt kall behandler maks dette mange rader, uansett modus — å regenerere ALLE ~3000
// radene i én HTTP-forespørsel risikerer et tidsavbrudd på den serverløse funksjonen (hver
// rad er ett synkront update-kall). Klienten kaller ruta på nytt til `ferdig: true`, se
// KomposisjonEditor.tsx sin "Forny alle miniatyrer"-knapp.
const MAKS_PER_KALL = 300

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    // tving=true: regenerer ALLE rader (også de som allerede har en miniatyr_svg fra den
    // forrige, hardere nedsamplede algoritmen) — ikke bare de som mangler den. Standard
    // (tving=false/utelatt) beholder det opprinnelige, trygge oppfyll-hull-oppsettet.
    const tving = body?.tving === true
    // etterId er en KURSOR (siste behandlede id), ikke en offset. Den forrige versjonen av
    // denne ruta brukte .range(offset, offset+BATCH-1) mens filteret .is('miniatyr_svg',null)
    // gjorde at MATCHENDE sett ble mindre for hver skriving — offset pekte da inn i et sett
    // som allerede hadde krympet, og hoppet over rader som aldri ble behandlet. En kursor på
    // id (som er stabil uansett hvilke rader som endres) har ikke dette problemet, og
    // fungerer likt i "tving"-modus, der filteret ikke krymper i det hele tatt.
    const etterId = typeof body?.etterId === 'string' ? body.etterId : null

    let query = supabaseAdmin
      .from('broderi_motiv')
      .select('id, data')
      .not('data', 'is', null)
      .order('id', { ascending: true })
      .limit(MAKS_PER_KALL)
    if (!tving) query = query.is('miniatyr_svg', null)
    if (etterId) query = query.gt('id', etterId)

    const start = Date.now()
    const { data: rader, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let totalOppdatert = 0
    for (const rad of rader ?? []) {
      const bbox = rad.data?.bbox as MiniatyrBbox | null | undefined
      const blokker = rad.data?.stingblokker as MiniatyrBlokk[] | null | undefined
      if (!bbox || !blokker || blokker.length === 0) continue
      const svg = byggMotivMiniatyrSvg(bbox, blokker)
      await supabaseAdmin.from('broderi_motiv').update({ miniatyr_svg: svg }).eq('id', rad.id)
      totalOppdatert++
    }

    return NextResponse.json({
      oppdatert: totalOppdatert,
      tidMs: Date.now() - start,
      ferdig: (rader?.length ?? 0) < MAKS_PER_KALL,
      sisteId: rader && rader.length > 0 ? rader[rader.length - 1].id : etterId,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Feil' }, { status: 500 })
  }
}
