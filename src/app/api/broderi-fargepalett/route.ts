import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { HEX_RE } from '@/app/dashboard/embroidery/arranger/broderPalett'

// anon/authenticated får bare SELECT på broderi_fargepalett (migrasjon 011) — all
// skriving går via denne ruta med service_role.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Samme som MAKS_PALETT i arranger/fargepalett.ts — ikke importert derfra, fordi den fila
// drar med seg anon-klienten fra @/lib/supabase.
const MAKS_PALETT = 8

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const hex = typeof body?.hex === 'string' ? body.hex : ''
    if (!HEX_RE.test(hex)) {
      return NextResponse.json({ error: 'hex må være på formen #rrggbb' }, { status: 400 })
    }
    const kilde = body.kilde === 'lager' ? 'lager' : body.kilde === 'brother' ? 'brother' : null
    if (!kilde) {
      return NextResponse.json({ error: "kilde må være 'lager' eller 'brother'" }, { status: 400 })
    }

    // Maks 8 rader, så hele tabellen hentes. Duplikatsjekken kommer FØR fullsjekken: en farge
    // som allerede står i en full palett skal gi den eksisterende raden, ikke «full».
    const { data: rader, error: lesFeil } = await supabaseAdmin
      .from('broderi_fargepalett')
      .select('id, data, created_at')
    if (lesFeil) {
      return NextResponse.json({ error: `Klarte ikke lese paletten: ${lesFeil.message}` }, { status: 500 })
    }
    const eksisterende = (rader ?? []).find(
      r => typeof r.data?.hex === 'string' && r.data.hex.toLowerCase() === hex.toLowerCase(),
    )
    if (eksisterende) return NextResponse.json(eksisterende)
    if ((rader ?? []).length >= MAKS_PALETT) {
      return NextResponse.json({ error: `Paletten er full (${MAKS_PALETT} farger) — fjern en først` }, { status: 409 })
    }

    const data = {
      hex,
      navn: typeof body.navn === 'string' ? body.navn : '',
      tradkode: typeof body.tradkode === 'string' ? body.tradkode : '',
      merke: typeof body.merke === 'string' ? body.merke : '',
      kilde,
    }
    const { data: saved, error } = await supabaseAdmin
      .from('broderi_fargepalett')
      .insert({ data })
      .select('id, data, created_at')
      .single()

    if (error) {
      return NextResponse.json({ error: `Klarte ikke lagre fargen: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json(saved)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : 'Noe gikk galt' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id er påkrevd' }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from('broderi_fargepalett')
      .delete()
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: `Klarte ikke fjerne fargen ${id}: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : 'Noe gikk galt' },
      { status: 500 }
    )
  }
}
