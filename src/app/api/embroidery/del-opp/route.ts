import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function pesFilenameToNavn(pesFilename: string): string {
  return pesFilename.replace(/\.pes$/i, '').replace(/[_-]+/g, ' ').trim()
}

export async function POST(req: NextRequest) {
  try {
    const { embroideryId, sizeIds } = await req.json() as { embroideryId?: string; sizeIds?: string[] }
    if (!embroideryId || !Array.isArray(sizeIds) || sizeIds.length < 2) {
      return NextResponse.json(
        { error: 'embroideryId og minst to sizeIds er påkrevd' },
        { status: 400 },
      )
    }

    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('embroidery')
      .select('id, data')
      .eq('id', embroideryId)
      .maybeSingle()
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    if (!original) return NextResponse.json({ error: `Fant ikke embroidery ${embroideryId}` }, { status: 404 })

    const allSizes: { id: string; sizeLabel: string; pesUrl: string; pesFilename: string; widthMm?: number; heightMm?: number }[] =
      (original.data?.sizes ?? [])

    // Only split the requested sizeIds; ignore any not in sizeIds
    const sizesToSplit = sizeIds
      .map(sid => allSizes.find(s => s.id === sid))
      .filter((s): s is NonNullable<typeof s> => s != null)

    if (sizesToSplit.length < 2) {
      return NextResponse.json({ error: 'Fant færre enn to størrelser med de oppgitte id-ene' }, { status: 400 })
    }

    const newIds: string[] = []

    for (const size of sizesToSplit) {
      const newData = {
        ...original.data,
        navn: pesFilenameToNavn(size.pesFilename),
        sizes: [size],
      }
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('embroidery')
        .insert({ data: newData })
        .select('id')
        .single()
      if (insErr) return NextResponse.json({ error: `Klarte ikke opprette rad for ${size.pesFilename}: ${insErr.message}` }, { status: 500 })
      newIds.push(inserted.id)

      // Reroute any existing broderi_motiv parse-results to the new embroidery row
      await supabaseAdmin
        .from('broderi_motiv')
        .update({ embroidery_id: inserted.id })
        .eq('embroidery_id', embroideryId)
        .eq('size_id', size.id)
    }

    // Delete the original row (remaining sizes, if any not in sizeIds, are lost — caller
    // passes all sizeIds when splitting the whole motif)
    await supabaseAdmin.from('embroidery').delete().eq('id', embroideryId)

    return NextResponse.json({ oppdatert: newIds.length, nyeIder: newIds })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : 'Noe gikk galt' },
      { status: 500 },
    )
  }
}
