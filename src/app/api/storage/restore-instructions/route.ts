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
  const sample = [...set].slice(0, 5)
  console.log(`[restore] bucket-sett eksempel: [${sample.join(', ')}]`)
  return set
}

export async function POST() {
  try {
    const [{ data: recipes, error: recErr }, { data: projects, error: projErr }] = await Promise.all([
      supabaseAdmin.from('recipes').select('id,data'),
      supabaseAdmin.from('projects').select('id,data'),
    ])

    if (recErr)  console.error('[restore] recipes fetch error:', recErr)
    if (projErr) console.error('[restore] projects fetch error:', projErr)

    const recipeList  = (recipes  ?? []) as DbRow[]
    const projectList = (projects ?? []) as DbRow[]
    console.log(`[restore] hentet ${recipeList.length} recipes, ${projectList.length} projects`)

    // Count all PDFs and instruction PDFs
    const allPdfs = [...recipeList, ...projectList].flatMap(r => r.data?.pdfs ?? [])
    const instrPdfs = allPdfs.filter(p => p.type === 'Oppskrift' || p.type === 'Annet')
    console.log(`[restore] ${allPdfs.length} pdfs totalt, ${instrPdfs.length} instruksjoner (Oppskrift/Annet)`)

    const bucketSet = await buildBucketSet()
    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const bucketBase  = `${supabaseUrl}/storage/v1/object/public/project-images/`

    let gjenopprettet = 0
    let hoppet_over  = 0
    let feilet       = 0
    const detaljer: string[] = []

    const allRows = [
      ...recipeList.map(r => ({ ...r, table: 'recipes' })),
      ...projectList.map(r => ({ ...r, table: 'projects' })),
    ]

    // Log decision for each instruction PDF (first 20 to keep logs manageable)
    let loggedDecisions = 0
    for (const row of allRows) {
      for (const pdf of row.data?.pdfs ?? []) {
        if (pdf.type !== 'Oppskrift' && pdf.type !== 'Annet') continue
        const sti   = pdf.url.split('/project-images/')[1]?.split('?')[0] ?? null
        const finnes = sti !== null && bucketSet.has(sti)
        const restore = !sti || !finnes
        if (loggedDecisions < 20) {
          console.log(
            `[restore] vurderer "${pdf.name}": driveFileId=${pdf.driveFileId ? 'ja' : 'NEI'}, ` +
            `sti=${sti ?? '(ingen)'}, finnes_i_bucket=${finnes} → ${restore ? 'GJENOPPRETT' : 'hopp over'}`
          )
          loggedDecisions++
        }
      }
    }

    for (const row of allRows) {
      const pdfs: PdfItem[] = row.data?.pdfs ?? []

      for (let i = 0; i < pdfs.length; i++) {
        const pdf = pdfs[i]
        if (pdf.type !== 'Oppskrift' && pdf.type !== 'Annet') continue

        if (!pdf.driveFileId) { hoppet_over++; continue }

        const sti    = pdf.url.split('/project-images/')[1]?.split('?')[0] ?? null
        const finnes = sti !== null && bucketSet.has(sti)

        if (finnes) { hoppet_over++; continue }

        try {
          console.log(`[restore] laster ned fra Drive: "${pdf.name}" (${pdf.driveFileId})`)
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

          // Re-fetch the row before writing to avoid overwriting concurrent changes.
          // select('data') returns { data: RowData }, so column value is at .data
          const { data: freshRow, error: fetchErr } = await supabaseAdmin
            .from(row.table)
            .select('data')
            .eq('id', row.id)
            .single() as { data: { data: RowData } | null; error: unknown }

          if (fetchErr) console.error(`[restore] re-fetch feilet for ${row.id}:`, fetchErr)

          const freshData = freshRow?.data ?? row.data
          const freshPdfs: PdfItem[] = freshData?.pdfs ?? pdfs
          const freshIdx = freshPdfs.findIndex(p => p.id === pdf.id)
          if (freshIdx !== -1) {
            freshPdfs[freshIdx] = { ...freshPdfs[freshIdx], url: newUrl, storage: 'supabase' }
          }

          const { error: updateErr } = await supabaseAdmin
            .from(row.table)
            .update({ data: { ...freshData, pdfs: freshPdfs } })
            .eq('id', row.id)

          if (updateErr) throw new Error(updateErr.message)

          pdfs[i] = { ...pdf, url: newUrl, storage: 'supabase' }
          gjenopprettet++
          const msg = `${row.table}/${row.id}: ${pdf.name} → ${filename}`
          console.log(`[restore] OK: ${msg}`)
          detaljer.push(msg)
        } catch (err) {
          feilet++
          const msg = `FEIL ${row.table}/${row.id}: ${pdf.name} — ${err instanceof Error ? err.message : String(err)}`
          console.error(`[restore] feil på "${pdf.name}":`, err)
          detaljer.push(msg)
        }
      }
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
