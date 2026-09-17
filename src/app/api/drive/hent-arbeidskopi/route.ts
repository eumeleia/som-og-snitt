import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getOAuth2Client } from '@/lib/drive-helpers'

// Henter en PDF fra Drive og legger den som ARBEIDSKOPI i Supabase Storage.
//
// Hvorfor filen må kopieres i det hele tatt, og ikke bare leses fra Drive når den
// trengs: PDF-leseren kjører pdfjs i NETTLESEREN og må ha en adresse nettleseren
// selv kan hente bytes fra. En Drive-fil har ingen slik adresse — den må hentes
// med innloggingsnøkkel gjennom Googles grensesnitt.
//
// Og å la en rute levere selve filen videre til nettleseren er ingen vei ut:
// Vercel har et tak på 4,5 MB for BÅDE forespørsels- og svarkropp. Nitten av
// oppskrifts-PDF-ene er større enn det (største er 28 MB), så de ville feilet med
// 413. Den eksisterende /api/fetch-pdf har samme tak, og strengere, siden base64
// gjør filen 33 % større — der ryker den allerede rundt 3,4 MB.
//
// Bytene kan derimot passere HER: de går Drive → denne funksjonen → Supabase,
// server-til-server, og havner aldri i en forespørsels- eller svarkropp.

const BUCKET = 'project-images'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// En 28 MB PDF er godt innenfor funksjonens minne (2 GB på Hobby), men et tak
// hindrer at en feilaktig stor fil spiser hele kjøringen før den feiler.
const MAKS_BYTES = 200 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const { driveFileId, pdfId } = await req.json()
    if (!driveFileId) {
      return NextResponse.json({ error: 'driveFileId er påkrevd' }, { status: 400 })
    }

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    // Metadata først: gir et tydelig svar på «finnes ikke / ligger i papirkurven»
    // i stedet for en nedlasting som feiler uforklarlig halvveis.
    let meta
    try {
      meta = await drive.files.get({ fileId: driveFileId, fields: 'id,name,size,trashed,mimeType' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { error: `Fant ikke filen i Drive (id ${driveFileId}): ${msg}` },
        { status: 404 },
      )
    }
    if (meta.data.trashed) {
      return NextResponse.json(
        { error: `Filen «${meta.data.name}» ligger i Drives papirkurv. Gjenopprett den før import.` },
        { status: 409 },
      )
    }
    const storrelse = Number(meta.data.size ?? 0)
    if (storrelse > MAKS_BYTES) {
      return NextResponse.json(
        { error: `Filen er ${(storrelse / 1024 / 1024).toFixed(1)} MB, over taket på ${MAKS_BYTES / 1024 / 1024} MB.` },
        { status: 413 },
      )
    }

    const nedlasting = await drive.files.get(
      { fileId: driveFileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    )
    const bytes = Buffer.from(nedlasting.data as ArrayBuffer)
    if (bytes.length === 0) {
      return NextResponse.json({ error: 'Drive returnerte en tom fil' }, { status: 502 })
    }

    // Navnet inneholder pdfId når den finnes, slik at slett-arbeidskopi kan finne
    // igjen kopien uten at klienten må huske et filnavn den ikke har sett før.
    const filnavn = `arbeidskopi-${pdfId ?? driveFileId}-${Date.now()}.pdf`

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filnavn, bytes, { contentType: 'application/pdf', upsert: true })
    if (uploadErr) {
      return NextResponse.json(
        { error: `Kunne ikke legge arbeidskopien i Supabase: ${uploadErr.message}` },
        { status: 500 },
      )
    }

    const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filnavn)

    return NextResponse.json({
      url: urlData.publicUrl,
      filnavn,
      driveNavn: meta.data.name,
      bytes: bytes.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : 'Ukjent feil'
    console.error('[drive/hent-arbeidskopi]', err)
    return NextResponse.json({ error: `Import fra Drive feilet: ${msg}` }, { status: 500 })
  }
}
