import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Et garn Maria skriver inn i «Finn alternativt garn» som ikke finnes i katalogen fra før.
// Lagt inn med status 'draft' («Ikke slått opp») — resten av feltene fylles ut senere med
// scripts/strikk/yarns.mjs, som docs/strikk-innlesing.md punkt 6 beskriver.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { brand?: unknown; name?: unknown }
    const brand = typeof body.brand === 'string' ? body.brand.trim() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Garnnavn er påkrevd' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('strikk_yarn').insert({ brand, name, status: 'draft' }).select('*').single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Dette garnet finnes allerede i katalogen' }, { status: 409 })
      return NextResponse.json({ error: `Klarte ikke lagre garnet: ${error.message}` }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
