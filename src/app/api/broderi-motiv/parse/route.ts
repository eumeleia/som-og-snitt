import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { byggMotivMiniatyrSvg, type MiniatyrBbox, type MiniatyrBlokk } from '@/lib/pesMiniatyr'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface EmbroiderySize {
  id: string
  sizeLabel: string
  pesUrl: string
  pesFilename: string
}

type ParsedBlokk = MiniatyrBlokk
type ParsedBbox = MiniatyrBbox

export async function POST(req: NextRequest) {
  try {
    const { embroideryId, sizeId } = await req.json()
    if (!embroideryId || !sizeId) {
      return NextResponse.json(
        { error: `embroideryId og sizeId er påkrevd (fikk embroideryId=${embroideryId}, sizeId=${sizeId})` },
        { status: 400 }
      )
    }

    // maybeSingle (not single) so a genuine "no row" case is distinguishable from a
    // query/auth error — .single() reports both as the same error, which is exactly
    // what hid the real cause last time.
    const { data: motif, error: motifErr } = await supabaseAdmin
      .from('embroidery')
      .select('id, data')
      .eq('id', embroideryId)
      .maybeSingle()
    if (motifErr) {
      console.error('[broderi-motiv/parse] embroidery-oppslag feilet', embroideryId, motifErr)
      return NextResponse.json(
        { error: `Feil ved oppslag i embroidery-tabellen for id ${embroideryId}: ${motifErr.message}` },
        { status: 500 }
      )
    }
    if (!motif) {
      return NextResponse.json(
        { error: `Fant ingen rad i embroidery-tabellen med id ${embroideryId}` },
        { status: 404 }
      )
    }

    const sizes = (motif.data?.sizes as EmbroiderySize[] | undefined) ?? []
    const size = sizes.find(s => s.id === sizeId)
    if (!size) {
      const available = sizes.map(s => `${s.sizeLabel} (${s.id})`).join(', ') || '(ingen størrelser)'
      return NextResponse.json(
        { error: `Fant ingen størrelse med id ${sizeId} på motivet ${embroideryId} ("${motif.data?.navn}"). Tilgjengelige størrelser: ${available}` },
        { status: 404 }
      )
    }

    // embroidery-files er en offentlig bucket — appen henter PES-filer med et vanlig
    // fetch() på pesUrl overalt ellers (se regenCoverFromSizes i embroidery/page.tsx),
    // ikke via Storage-SDK-en med utledet objekt-nøkkel. Gjenbruk samme mønster.
    const pesResp = await fetch(size.pesUrl)
    if (!pesResp.ok) {
      return NextResponse.json(
        { error: `Klarte ikke laste ned PES-filen fra ${size.pesUrl} (HTTP ${pesResp.status} ${pesResp.statusText})` },
        { status: 502 }
      )
    }
    const pesBuffer = Buffer.from(await pesResp.arrayBuffer())

    const origin = new URL(req.url).origin
    const parseRes = await fetch(`${origin}/api/parse-pes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pes_data: pesBuffer.toString('base64') }),
    })
    if (!parseRes.ok) {
      const rawBody = await parseRes.text()
      let pyError = rawBody
      try { pyError = JSON.parse(rawBody).error ?? rawBody } catch { /* body wasn't JSON */ }
      return NextResponse.json(
        { error: `Python-parsefunksjonen (/api/parse-pes) svarte HTTP ${parseRes.status}: ${pyError}` },
        { status: 502 }
      )
    }
    const parsed = await parseRes.json()

    // bredde/hoyde_tiendedel_mm er avledet av parsed.bbox, satt her i SAMME skriving som
    // data-jsonb-en — de kan da aldri komme i utakt med hverandre. Kolonnene finnes for at
    // motivvelgeren skal kunne filtrere/telle på mål uten å røre data (som også har alle
    // stingkoordinatene, og er treg å lese i bulk — se migration 007).
    const bbox = parsed?.bbox as ParsedBbox | null | undefined
    const breddeTiendedelMm = bbox ? bbox.max_x - bbox.min_x : null
    const hoydeTiendedelMm = bbox ? bbox.max_y - bbox.min_y : null

    const miniatyrSvg = (bbox && Array.isArray(parsed?.stingblokker) && parsed.stingblokker.length > 0)
      ? byggMotivMiniatyrSvg(bbox, parsed.stingblokker as ParsedBlokk[])
      : null

    const { data: saved, error: upsertErr } = await supabaseAdmin
      .from('broderi_motiv')
      .upsert({
        embroidery_id: embroideryId,
        size_id: sizeId,
        navn: `${motif.data.navn} – ${size.sizeLabel}`,
        fil_sti: size.pesUrl,
        data: parsed,
        bredde_tiendedel_mm: breddeTiendedelMm,
        hoyde_tiendedel_mm: hoydeTiendedelMm,
        miniatyr_svg: miniatyrSvg,
      }, { onConflict: 'embroidery_id,size_id' })
      .select('id, data, created_at, miniatyr_svg')
      .maybeSingle()
    if (upsertErr) {
      console.error('[broderi-motiv/parse] upsert mot broderi_motiv feilet', embroideryId, sizeId, upsertErr)
      if (upsertErr.code === '42P01') {
        return NextResponse.json(
          { error: 'Tabellen broderi_motiv finnes ikke i databasen — kjør supabase/migrations/004_create_broderi_motiv.sql i Supabase SQL editor.' },
          { status: 500 }
        )
      }
      if (upsertErr.code === '42501') {
        return NextResponse.json(
          { error: 'Appen har ikke rettigheter til å skrive til broderi_motiv — kjør supabase/migrations/005_grant_broderi_motiv.sql i Supabase SQL editor.' },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { error: `Klarte ikke lagre parsede data i broderi_motiv: ${upsertErr.message}` },
        { status: 500 }
      )
    }
    if (!saved) {
      return NextResponse.json(
        { error: `Upsert mot broderi_motiv returnerte ingen rad for embroidery_id=${embroideryId}, size_id=${sizeId}` },
        { status: 500 }
      )
    }

    return NextResponse.json(saved)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : 'Noe gikk galt' },
      { status: 500 }
    )
  }
}
