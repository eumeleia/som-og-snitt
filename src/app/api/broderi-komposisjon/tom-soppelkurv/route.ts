import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { beregnGrense } from '@/app/dashboard/embroidery/arranger/soppelkurv'

// anon/authenticated bare får SELECT på broderi_komposisjon (migration 006) — all
// skriving går via denne ruta med service_role.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Kalt av klienten hver gang komposisjonslisten lastes (arranger/page.tsx) — det finnes
// ingen bakgrunnsjobb i appen. Grensen regnes her fra samme DAGER_I_KURVEN-konstant som
// erUtlopt bruker i klienten, så løftet «minst 30 dager» ikke kan sprike mellom dem.
export async function POST() {
  try {
    const grense = beregnGrense(new Date())

    const { data: slettede, error } = await supabaseAdmin
      .from('broderi_komposisjon')
      .delete()
      .lt('slettet_tid', grense.toISOString())
      .select('id')

    if (error) {
      return NextResponse.json({ error: `Klarte ikke tømme søppelkurven: ${error.message}` }, { status: 500 })
    }
    const ids = (slettede ?? []).map(r => r.id as string)
    return NextResponse.json({ slettet: ids.length, ids })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : 'Noe gikk galt' },
      { status: 500 }
    )
  }
}
