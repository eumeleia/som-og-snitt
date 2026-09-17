import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getOAuth2Client } from '@/lib/drive-helpers'

// Opprydding i project-images. To uavhengige jobber:
//
//   foreldrelose  — filer ingen rad i basen nevner. Rene rester.
//   oppskrifter   — oppskrifts-PDF-er som har en original i Drive, men fortsatt
//                   ligger som fast kopi i Supabase. Disse trenger ikke ligge her
//                   lenger: arbeidskopien hentes når et prosjekt blir aktivt.
//
// Sletting går via Storage-API-et. «delete from storage.objects» i SQL fjerner
// bare bokføringen og lar selve filen ligge igjen, usynlig men betalt for.

const BUCKET = 'project-images'

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface RecipePdf {
  id: string
  name: string
  url: string
  type?: string
  storage?: 'supabase' | 'drive'
  driveFileId?: string
  driveLink?: string
}
interface RecipeRad { id: string; data: { name?: string; pdfs?: RecipePdf[] } }

// getPublicUrl prosentkoder filnavn; storage.objects lagrer dem rått. Sletting med
// kodet navn treffer ingenting og melder likevel «ok» — derfor avkodingen.
function objektnavnFraUrl(url: string): string | null {
  const merke = `/object/public/${BUCKET}/`
  const i = url.indexOf(merke)
  if (i === -1) return null
  try { return decodeURIComponent(url.slice(i + merke.length)) }
  catch { return url.slice(i + merke.length) }
}

async function finnOppskriftskopier() {
  const { data, error } = await admin.from('recipes').select('id, data')
  if (error) throw new Error(`Kunne ikke lese oppskrifter: ${error.message}`)
  const ut: {
    recipeId: string; oppskrift: string; pdfId: string; filnavn: string
    objektnavn: string; driveFileId: string
  }[] = []
  for (const r of (data ?? []) as RecipeRad[]) {
    for (const p of r.data?.pdfs ?? []) {
      if ((p.type ?? 'Annet') !== 'Oppskrift') continue
      if (p.storage === 'drive') continue
      if (!p.driveFileId || !p.driveLink) continue   // uten original i Drive: rør ikke
      const objektnavn = objektnavnFraUrl(p.url)
      if (!objektnavn) continue
      ut.push({
        recipeId: r.id, oppskrift: r.data?.name ?? '(uten navn)',
        pdfId: p.id, filnavn: p.name, objektnavn, driveFileId: p.driveFileId,
      })
    }
  }
  return ut
}

export async function POST(req: NextRequest) {
  try {
    const { handling, navn, pdfIder } = await req.json()

    if (handling === 'analyse') {
      const { data, error } = await admin.rpc('foreldrelose_filer', { bkt: BUCKET })
      if (error) {
        return NextResponse.json(
          { error: `Kunne ikke finne foreldreløse filer: ${error.message}. Har du kjørt supabase/migrations/010_foreldrelose_filer.sql i SQL-editoren?` },
          { status: 500 },
        )
      }
      return NextResponse.json({
        foreldrelose: (data ?? []) as { navn: string; bytes: number }[],
        oppskrifter: await finnOppskriftskopier(),
      })
    }

    if (handling === 'slett-foreldrelose') {
      if (!Array.isArray(navn) || navn.length === 0) {
        return NextResponse.json({ error: 'Ingen filer valgt' }, { status: 400 })
      }
      // Sjekkes på nytt her, ikke bare i grensesnittet: lista kan være minutter
      // gammel, og i mellomtiden kan en fil ha blitt tatt i bruk.
      const { data: fortsattForeldrelose, error } = await admin.rpc('foreldrelose_filer', { bkt: BUCKET })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const trygge = new Set(((fortsattForeldrelose ?? []) as { navn: string }[]).map(f => f.navn))
      const iBruk = (navn as string[]).filter(n => !trygge.has(n))
      const slettes = (navn as string[]).filter(n => trygge.has(n))
      if (slettes.length > 0) {
        const { error: slettErr } = await admin.storage.from(BUCKET).remove(slettes)
        if (slettErr) return NextResponse.json({ error: slettErr.message }, { status: 500 })
      }
      return NextResponse.json({ slettet: slettes.length, hoppetOver: iBruk })
    }

    if (handling === 'flytt-oppskrifter') {
      if (!Array.isArray(pdfIder) || pdfIder.length === 0) {
        return NextResponse.json({ error: 'Ingen oppskrifter valgt' }, { status: 400 })
      }
      const valgt = (await finnOppskriftskopier()).filter(o => (pdfIder as string[]).includes(o.pdfId))
      const auth = await getOAuth2Client()
      const drive = google.drive({ version: 'v3', auth })

      const resultat: { pdfId: string; ok: boolean; feil?: string }[] = []
      for (const o of valgt) {
        try {
          // Originalen bekreftes FØR noe endres. Er den borte, er Supabase-kopien
          // den eneste versjonen, og da skal den bli liggende.
          const meta = await drive.files.get({ fileId: o.driveFileId, fields: 'id,trashed' })
          if (meta.data.trashed) throw new Error('originalen ligger i Drives papirkurv')

          // Raden oppdateres først. Feiler slettingen etterpå, blir filen en
          // foreldreløs rest som neste analyse fanger opp — motsatt rekkefølge
          // ville gitt en rad som peker på en fil som ikke finnes.
          const { data: rad, error: lesErr } = await admin
            .from('recipes').select('id, data').eq('id', o.recipeId).maybeSingle()
          if (lesErr || !rad) throw new Error(lesErr?.message ?? 'fant ikke oppskriften')
          const r = rad as RecipeRad
          const pdfs = (r.data?.pdfs ?? []).map(p =>
            p.id === o.pdfId ? { ...p, url: p.driveLink!, storage: 'drive' as const } : p)
          const { error: skrivErr } = await admin
            .from('recipes').update({ data: { ...r.data, pdfs } }).eq('id', o.recipeId)
          if (skrivErr) throw new Error(skrivErr.message)

          const { error: slettErr } = await admin.storage.from(BUCKET).remove([o.objektnavn])
          if (slettErr) throw new Error(`raden er oppdatert, men filen ble ikke slettet: ${slettErr.message}`)

          resultat.push({ pdfId: o.pdfId, ok: true })
        } catch (err) {
          resultat.push({ pdfId: o.pdfId, ok: false, feil: err instanceof Error ? err.message : 'ukjent feil' })
        }
      }
      return NextResponse.json({ resultat })
    }

    return NextResponse.json({ error: `Ukjent handling: ${handling}` }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : 'Ukjent feil'
    console.error('[opprydding]', err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
