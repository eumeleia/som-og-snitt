import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  EXTRACTION_SELECT,
  clearUncertain,
  corrections,
  normalizeExtraction,
  storedToExtraction,
  type StoredRecipe,
} from '@/app/strikk/_lib/extraction'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Saves the reviewed and corrected data and locks it against new extractions. What was
// changed from the extraction is stored as corrections, which the next extractions get
// as examples. `edit: true` corrects a recipe that is already approved.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/extraction/[id]/approve'>) {
  try {
    const { id } = await ctx.params
    const { data, edit } = await req.json() as { data?: unknown; edit?: boolean }
    const clean = clearUncertain(normalizeExtraction(data))
    if (!clean.title) return NextResponse.json({ error: 'Tittel kan ikke være tom' }, { status: 400 })

    const { data: stored, error: readError } = await supabaseAdmin
      .from('strikk_oppskrift').select(EXTRACTION_SELECT).eq('id', id).maybeSingle()
    if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
    if (!stored) return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })
    const before = stored as unknown as StoredRecipe
    const wasApproved = before.extraction_status === 'approved'
    if (wasApproved && edit !== true) {
      return NextResponse.json({ error: 'Oppskriften er allerede godkjent' }, { status: 409 })
    }

    const { data: result, error } = await supabaseAdmin.rpc('strikk_save_extraction', {
      p_id: id,
      p_data: clean,
      p_approve: true,
      p_edit_approved: wasApproved,
    })
    if (error) return NextResponse.json({ error: `Godkjenning feilet: ${error.message}` }, { status: 500 })
    if (result === 'missing') return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })
    if (result === 'locked') return NextResponse.json({ error: 'Oppskriften er allerede godkjent' }, { status: 409 })

    // Only against something that was read: a recipe never extracted has no reading to correct.
    let saved = 0
    if (before.extraction_status === 'extracted' || wasApproved) {
      const list = corrections(storedToExtraction(before), clean)
      if (list.length > 0) {
        const { error: corrError } = await supabaseAdmin.from('strikk_extraction_correction').insert(
          list.map(c => ({ oppskrift_id: id, recipe_title: clean.title, ...c })),
        )
        // The approval stands; only the examples for next time are missing.
        if (corrError) console.error(`[strikk/approve] corrections: ${corrError.message}`)
        else saved = list.length
      }
    }
    return NextResponse.json({ status: 'approved', corrections: saved })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
