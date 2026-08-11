import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Same helpers as in parse/route.ts
interface ParsedBlokk { farge_hex: string; sting: [number, number][] }
interface ParsedBbox { min_x: number; min_y: number; max_x: number; max_y: number }

const MAKS_PUNKT_PER_BLOKK = 40

function nedsampledPunkter(sting: [number, number][]): [number, number][] {
  if (sting.length <= MAKS_PUNKT_PER_BLOKK) return sting
  const steg = Math.ceil(sting.length / MAKS_PUNKT_PER_BLOKK)
  const ut: [number, number][] = []
  for (let i = 0; i < sting.length; i += steg) ut.push(sting[i])
  const siste = sting[sting.length - 1]
  if (ut[ut.length - 1] !== siste) ut.push(siste)
  return ut
}

function byggMotivMiniatyrSvg(bbox: ParsedBbox, blokker: ParsedBlokk[]): string {
  const pad = Math.max(bbox.max_x - bbox.min_x, bbox.max_y - bbox.min_y) * 0.05
  const vx = (bbox.min_x - pad) / 10
  const vy = (bbox.min_y - pad) / 10
  const vw = (bbox.max_x - bbox.min_x + 2 * pad) / 10
  const vh = (bbox.max_y - bbox.min_y + 2 * pad) / 10
  const lines = blokker.map(b => {
    const pts = nedsampledPunkter(b.sting).map(([x, y]) => `${(x / 10).toFixed(1)},${(y / 10).toFixed(1)}`).join(' ')
    return `<polyline points="${pts}" fill="none" stroke="${b.farge_hex}" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round"/>`
  }).join('')
  return `<svg viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" xmlns="http://www.w3.org/2000/svg">${lines}</svg>`
}

export async function POST(req: NextRequest) {
  // Only callable from the app itself (service_role)
  void req
  try {
    const BATCH = 100
    let offset = 0
    let totalOppdatert = 0
    const start = Date.now()

    while (true) {
      const { data: rader, error } = await supabaseAdmin
        .from('broderi_motiv')
        .select('id, data')
        .is('miniatyr_svg', null)
        .not('data', 'is', null)
        .order('id', { ascending: true })
        .range(offset, offset + BATCH - 1)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!rader || rader.length === 0) break

      for (const rad of rader) {
        const bbox = rad.data?.bbox as ParsedBbox | null | undefined
        const blokker = rad.data?.stingblokker as ParsedBlokk[] | null | undefined
        if (!bbox || !blokker || blokker.length === 0) continue
        const svg = byggMotivMiniatyrSvg(bbox, blokker)
        await supabaseAdmin.from('broderi_motiv').update({ miniatyr_svg: svg }).eq('id', rad.id)
        totalOppdatert++
      }

      if (rader.length < BATCH) break
      offset += BATCH
    }

    return NextResponse.json({
      oppdatert: totalOppdatert,
      tidMs: Date.now() - start,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Feil' }, { status: 500 })
  }
}
