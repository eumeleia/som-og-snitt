import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getOAuth2Client } from '@/lib/drive-helpers'

// Sletter arbeidskopien i Supabase Storage. Drive-originalen røres ikke.
//
// Ruta NEKTER å slette uten at den først har bekreftet at Drive-originalen finnes
// og ikke ligger i papirkurven. Uten den sjekken ville et feil driveFileId — eller
// en fil brukeren har slettet i Drive i mellomtiden — føre til at den siste kopien
// forsvinner. Rekkefølgen er alltid: bekreft originalen, så slett kopien.
//
// Merknadene (pins, tekstbokser, bokmerket for hvor du var sist) ligger på
// prosjektraden i databasen, ikke inni PDF-en, og berøres ikke av noe her.

const BUCKET = 'project-images'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// getPublicUrl prosentkoder filnavn (mellomrom blir %20), mens storage.objects
// lagrer navnet rått. Sletting med det kodede navnet treffer ingenting og melder
// likevel «ok», så avkodingen her er ikke pynt — den er forskjellen på at filen
// faktisk blir borte og at den bare ser ut til å bli det.
function objektnavnFraUrl(url: string): string | null {
  const merke = `/object/public/${BUCKET}/`
  const i = url.indexOf(merke)
  if (i === -1) return null
  try {
    return decodeURIComponent(url.slice(i + merke.length))
  } catch {
    return url.slice(i + merke.length)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url, filnavn, driveFileId } = await req.json()
    if (!driveFileId) {
      return NextResponse.json(
        { error: 'driveFileId er påkrevd — uten den kan ikke ruta bekrefte at originalen finnes' },
        { status: 400 },
      )
    }

    const navn = filnavn ?? (typeof url === 'string' ? objektnavnFraUrl(url) : null)
    if (!navn) {
      return NextResponse.json(
        { error: `Klarte ikke utlede objektnavn. Send filnavn, eller en url som peker inn i bøtta ${BUCKET}.` },
        { status: 400 },
      )
    }

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    let meta
    try {
      meta = await drive.files.get({ fileId: driveFileId, fields: 'id,name,trashed' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { error: `Avbrutt: fant ikke originalen i Drive (id ${driveFileId}): ${msg}. Arbeidskopien er IKKE slettet.` },
        { status: 409 },
      )
    }
    if (meta.data.trashed) {
      return NextResponse.json(
        { error: `Avbrutt: originalen «${meta.data.name}» ligger i Drives papirkurv. Arbeidskopien er IKKE slettet.` },
        { status: 409 },
      )
    }

    const { error: slettErr } = await supabaseAdmin.storage.from(BUCKET).remove([navn])
    if (slettErr) {
      return NextResponse.json(
        { error: `Kunne ikke slette arbeidskopien: ${slettErr.message}` },
        { status: 500 },
      )
    }

    return NextResponse.json({ slettet: navn, originalIDrive: meta.data.name })
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : 'Ukjent feil'
    console.error('[drive/slett-arbeidskopi]', err)
    return NextResponse.json({ error: `Sletting feilet: ${msg}` }, { status: 500 })
  }
}
