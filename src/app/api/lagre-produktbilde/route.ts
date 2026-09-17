import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { HENT_SIDE_HEADERS } from '@/app/api/import-fabric/route'

const MAKS_LENGSTE_SIDE = 800
const HENTE_TIDSAVBRUDD_MS = 15_000

// Denne ruta kjøres server-side uten en innlogget brukerøkt (ingen JWT å sende), så
// anon-klienten treffer RLS på storage.objects — «new row violates row-level security
// policy» — selv om bøtta tillater opplasting fra en innlogget bruker i nettleseren.
// Samme mønster som broderi-komposisjon/route.ts og storage-analyse/route.ts.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface Svar {
  ok:    boolean
  url?:  string
  error?: string
}

/**
 * Henter et eksternt produktbilde og lagrer det permanent i Supabase Storage
 * (`project-images`) i stedet for å peke videre til selgerens server — den kan fjerne
 * bildet når som helst, se docs. `dryRun: true` henter og validerer bildet uten å laste
 * opp noe, til bruk i «Etterfyll produktbilder»-tørrkjøringen.
 *
 * Svarer ALLTID 200: kalleren (import-flyten) skal aldri la en bilde-feil stoppe
 * importen, og et ikke-200-svar ville invitert til akkurat den behandlingen.
 */
export async function POST(req: NextRequest) {
  try {
    const { url, dryRun } = await req.json()
    if (typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ ok: false, error: 'Mangler URL' } satisfies Svar)
    }

    let res: Response
    try {
      res = await fetch(url, { headers: HENT_SIDE_HEADERS, signal: AbortSignal.timeout(HENTE_TIDSAVBRUDD_MS) })
    } catch (err) {
      const tidsavbrudd = err instanceof Error && err.name === 'TimeoutError'
      return NextResponse.json({
        ok: false,
        error: tidsavbrudd ? 'Bildet svarer ikke (tidsavbrudd)' : `Bildet svarer ikke (${err instanceof Error ? err.message : 'ukjent nettverksfeil'})`,
      } satisfies Svar)
    }
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Bildet svarer ikke (HTTP ${res.status})` } satisfies Svar)
    }
    const buf = Buffer.from(await res.arrayBuffer())

    let metadata
    try {
      metadata = await sharp(buf).metadata()
      if (!metadata.format) throw new Error('ukjent format')
    } catch {
      return NextResponse.json({ ok: false, error: 'Ikke et bilde sharp kan lese' } satisfies Svar)
    }

    if (dryRun) return NextResponse.json({ ok: true } satisfies Svar)

    const resized = await sharp(buf)
      .resize({ width: MAKS_LENGSTE_SIDE, height: MAKS_LENGSTE_SIDE, fit: 'inside', withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true })

    const endelse  = resized.info.format
    const filnavn  = `inventory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${endelse}`

    const { error: upErr } = await supabaseAdmin.storage
      .from('project-images')
      .upload(filnavn, resized.data, { contentType: `image/${endelse}` })
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message } satisfies Svar)

    const { data } = supabaseAdmin.storage.from('project-images').getPublicUrl(filnavn)
    return NextResponse.json({ ok: true, url: data.publicUrl } satisfies Svar)
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Ukjent feil' } satisfies Svar)
  }
}
