import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getOAuth2Client } from '@/lib/drive-helpers'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface PdfItem {
  id: string
  name: string
  url: string
  type: string
  source: string
  storage?: string
  driveFileId?: string
  driveLink?: string
  formatLabel?: string
  displayName?: string
}

interface RowData { pdfs?: PdfItem[] }
interface DbRow  { id: string; data: RowData }

async function buildBucketSet(): Promise<Set<string>> {
  const set = new Set<string>()
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from('project-images')
      .list('', { limit: PAGE, offset })
    if (error) { console.error('[restore] bucket list error:', error); break }
    if (!data || data.length === 0) break
    for (const f of data) { if (f.name) set.add(f.name) }
    if (data.length < PAGE) break
    offset += PAGE
  }
  console.log(`[restore] bucket has ${set.size} objects`)
  return set
}

// Returns true if the instruction PDF's Supabase working copy is missing from the bucket.
function needsRestore(pdf: PdfItem, bucketSet: Set<string>): boolean {
  if (pdf.type !== 'Oppskrift' && pdf.type !== 'Annet') return false
  if (!pdf.driveFileId) return false
  const match = pdf.url.split('/project-images/')[1]?.split('?')[0]
  // Restore if there is no /project-images/ path in the URL, OR the extracted path is not in the bucket
  return !match || !bucketSet.has(match)
}

export async function POST() {
  try {
    const [{ data: recipes }, { data: projects }] = await Promise.all([
      supabaseAdmin.from('recipes').select('id,data'),
      supabaseAdmin.from('projects').select('id,data'),
    ])

    const bucketSet = await buildBucketSet()
    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const bucketBase  = `${supabaseUrl}/storage/v1/object/public/project-images/`

    let gjenopprettet = 0
    let hoppet_over  = 0
    let feilet       = 0
    const detaljer: string[] = []

    // Count how many need restore before starting
    const allRows = [
      ...((recipes ?? []) as DbRow[]).map(r => ({ ...r, table: 'recipes' })),
      ...((projects ?? []) as DbRow[]).map(r => ({ ...r, table: 'projects' })),
    ]
    const toRestore = allRows.flatMap(row =>
      (row.data?.pdfs ?? []).filter(pdf => needsRestore(pdf, bucketSet))
        .map(pdf => ({ row, pdf }))
    )
    console.log(`[restore] ${toRestore.length} instruksjoner mangler i Supabase-bucketen`)

    for (const row of allRows) {
      const pdfs: PdfItem[] = row.data?.pdfs ?? []
      let changed = false

      for (let i = 0; i < pdfs.length; i++) {
        const pdf = pdfs[i]
        if (!needsRestore(pdf, bucketSet)) {
          if (pdf.type === 'Oppskrift' || pdf.type === 'Annet') hoppet_over++
          continue
        }

        try {
          console.log(`[restore] laster ned fra Drive: ${pdf.name} (${pdf.driveFileId})`)
          const driveRes = await drive.files.get(
            { fileId: pdf.driveFileId!, alt: 'media' },
            { responseType: 'arraybuffer' },
          )
          const buffer   = Buffer.from(driveRes.data as unknown as ArrayBuffer)
          const filename = `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`

          console.log(`[restore] laster opp til Supabase: ${filename}`)
          const { error: uploadErr } = await supabaseAdmin.storage
            .from('project-images')
            .upload(filename, buffer, { contentType: 'application/pdf' })

          if (uploadErr) throw new Error(uploadErr.message)

          const newUrl = `${bucketBase}${filename}`
          bucketSet.add(filename)

          // Re-fetch the row to get the latest state before writing back
          const { data: freshRow } = await supabaseAdmin
            .from(row.table)
            .select('data')
            .eq('id', row.id)
            .single()

          const freshPdfs: PdfItem[] = (freshRow as RowData | null)?.pdfs ?? pdfs
          const freshIdx = freshPdfs.findIndex(p => p.id === pdf.id)
          if (freshIdx !== -1) {
            freshPdfs[freshIdx] = { ...freshPdfs[freshIdx], url: newUrl, storage: 'supabase' }
          }

          await supabaseAdmin
            .from(row.table)
            .update({ data: { ...(freshRow as RowData ?? row.data), pdfs: freshPdfs } })
            .eq('id', row.id)

          // Update local copy to stay consistent for remaining PDFs in this row
          pdfs[i] = { ...pdf, url: newUrl, storage: 'supabase' }
          changed = true
          gjenopprettet++
          const msg = `${row.table}/${row.id}: ${pdf.name} → ${filename}`
          console.log(`[restore] OK: ${msg}`)
          detaljer.push(msg)
        } catch (err) {
          feilet++
          const msg = `FEIL ${row.table}/${row.id}: ${pdf.name} — ${err instanceof Error ? err.message : String(err)}`
          console.error(`[restore] ${msg}`)
          detaljer.push(msg)
        }
      }

      void changed // local tracking only; writes happen per-pdf above
    }

    console.log(`[restore] ferdig — gjenopprettet: ${gjenopprettet}, hoppet over: ${hoppet_over}, feilet: ${feilet}`)
    return NextResponse.json({ gjenopprettet, hoppet_over, feilet, detaljer })
  } catch (err) {
    console.error('[restore] kritisk feil:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
