import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getOAuth2Client } from '@/lib/drive-helpers'

// Googles klokke (som setter createdTime) er ikke garantert synkron med serverens som
// kaller herfra — uten en margin kunne filteret i sjeldne tilfeller avvise nøyaktig den
// fila DENNE sesjonen selv nettopp lastet opp, fordi Drive tidsstemplet den et par
// sekunder "før" vårt eget tidsstempel.
const TIDSSTEMPEL_MARGIN_MS = 10_000

// Økende pause før hvert forsøk, IKKE et fast intervall — Drives navnesøk er "eventually
// consistent", så en nettopp opprettet fil kan rett og slett ikke dukke opp i søket ennå.
// Summen av ventetiden (0+500+500+1000+500 = 2500 ms) pluss selve nettverkskallene skal
// holde seg trygt under Vercels funksjonstimeout — sikter på maks ~6 sekunder totalt.
const VENTER_MS_FOR_FORSOK = [0, 500, 500, 1000, 500]

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface FunnetFil {
  id?: string | null
  webViewLink?: string | null
}

// REIN funksjon — selve oppslaget kommer inn som parameter, så gjentakelsen kan testes
// uten en ekte Drive-tilkobling. Gjentar til oppslaget finner noe, eller gir opp etter
// siste forsøk (kallstedet svarer da 404 — se POST under).
export async function slaOppMedGjentakelse(
  oppslag: () => Promise<FunnetFil | null>,
  venterMs: number[] = VENTER_MS_FOR_FORSOK,
): Promise<{ fil: FunnetFil | null; forsok: number }> {
  for (let i = 0; i < venterMs.length; i++) {
    if (venterMs[i] > 0) await sleep(venterMs[i])
    const fil = await oppslag()
    if (fil?.id) return { fil, forsok: i + 1 }
  }
  return { fil: null, forsok: venterMs.length }
}

// Bygger Drive-søket. sessionStartetVed er valgfritt (utelatt = samme oppførsel som før
// denne fiksen) — når den er med, skiller `createdTime > ...`-leddet DENNE
// opplastingssesjonens fil fra en fil med samme navn fra et TIDLIGERE forsøk. Det er
// nettopp forvekslingen av disse to som lot et gjenopplastingsforsøk finne førsteforsøkets
// fil og etterlate en dublett i Drive.
export function byggQ(fileName: string, folderId: string, sessionStartetVed?: number): string {
  const safeName = fileName.replace(/'/g, "\\'")
  let q = `name = '${safeName}' and '${folderId}' in parents and trashed = false`
  if (sessionStartetVed !== undefined) {
    const grense = new Date(sessionStartetVed - TIDSSTEMPEL_MARGIN_MS).toISOString()
    q += ` and createdTime > '${grense}'`
  }
  return q
}

export async function POST(req: NextRequest) {
  try {
    const { fileName, folderId, sessionStartetVed } = await req.json() as {
      fileName: string
      folderId: string
      sessionStartetVed?: number
    }

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    const q = byggQ(fileName, folderId, sessionStartetVed)

    const { fil, forsok } = await slaOppMedGjentakelse(async () => {
      const res = await drive.files.list({
        q,
        fields: 'files(id,webViewLink)',
        orderBy: 'createdTime desc',
        pageSize: 1,
      })
      return res.data.files?.[0] ?? null
    })

    if (!fil?.id) {
      return NextResponse.json({ error: 'Fil ikke funnet', forsok }, { status: 404 })
    }

    const fileId = fil.id
    const webViewLink = fil.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`
    const downloadLink = `https://drive.google.com/uc?export=download&id=${fileId}`

    return NextResponse.json({ fileId, webViewLink, downloadLink, forsok })
  } catch (err) {
    console.error('[file-by-name]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
