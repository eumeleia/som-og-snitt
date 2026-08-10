import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

// pesUrl is the public URL returned by getPublicUrl() when the size was uploaded —
// the object key inside the bucket is everything after "/embroidery-files/".
function storageKeyFromPublicUrl(pesUrl: string): string | null {
  const marker = '/embroidery-files/'
  const idx = pesUrl.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(pesUrl.slice(idx + marker.length))
}

export async function POST(req: NextRequest) {
  try {
    const { embroideryId, sizeId } = await req.json()
    if (!embroideryId || !sizeId) {
      return NextResponse.json({ error: 'embroideryId og sizeId er påkrevd' }, { status: 400 })
    }

    const { data: motif, error: motifErr } = await supabaseAdmin
      .from('embroidery')
      .select('id, data')
      .eq('id', embroideryId)
      .single()
    if (motifErr || !motif) {
      return NextResponse.json({ error: 'Fant ikke motivet' }, { status: 404 })
    }

    const size = (motif.data.sizes as EmbroiderySize[] | undefined)?.find(s => s.id === sizeId)
    if (!size) {
      return NextResponse.json({ error: 'Fant ikke størrelsen på motivet' }, { status: 404 })
    }

    const storageKey = storageKeyFromPublicUrl(size.pesUrl)
    if (!storageKey) {
      return NextResponse.json({ error: 'Klarte ikke tolke lagringsstien for PES-filen' }, { status: 500 })
    }

    const { data: pesBlob, error: downloadErr } = await supabaseAdmin
      .storage
      .from('embroidery-files')
      .download(storageKey)
    if (downloadErr || !pesBlob) {
      return NextResponse.json({ error: `Klarte ikke laste ned PES-filen: ${downloadErr?.message}` }, { status: 500 })
    }

    const pesBuffer = Buffer.from(await pesBlob.arrayBuffer())
    const origin = new URL(req.url).origin
    const parseRes = await fetch(`${origin}/api/parse-pes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pes_data: pesBuffer.toString('base64') }),
    })
    if (!parseRes.ok) {
      const errBody = await parseRes.json().catch(() => ({}))
      return NextResponse.json({ error: `Parsing feilet: ${errBody.error ?? parseRes.statusText}` }, { status: 502 })
    }
    const parsed = await parseRes.json()

    const { data: saved, error: upsertErr } = await supabaseAdmin
      .from('broderi_motiv')
      .upsert({
        embroidery_id: embroideryId,
        size_id: sizeId,
        navn: `${motif.data.navn} – ${size.sizeLabel}`,
        fil_sti: storageKey,
        data: parsed,
      }, { onConflict: 'embroidery_id,size_id' })
      .select('id, data, created_at')
      .single()
    if (upsertErr || !saved) {
      return NextResponse.json({ error: `Klarte ikke lagre parsede data: ${upsertErr?.message}` }, { status: 500 })
    }

    return NextResponse.json(saved)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Noe gikk galt' },
      { status: 500 }
    )
  }
}
