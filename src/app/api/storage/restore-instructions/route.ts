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
    if (error || !data || data.length === 0) break
    for (const f of data) { if (f.name) set.add(f.name) }
    if (data.length < PAGE) break
    offset += PAGE
  }
  return set
}

function needsRestore(pdf: PdfItem, bucketSet: Set<string>): boolean {
  if (pdf.type !== 'Oppskrift' && pdf.type !== 'Annet') return false
  if (!pdf.driveFileId) return false
  // Missing if url points to Drive (no Supabase copy) or if Supabase file is gone
  if (pdf.url.includes('drive.google.com')) return true
  const match = pdf.url.split('/project-images/')[1]?.split('?')[0]
  if (match && !bucketSet.has(match)) return true
  return false
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

    async function processRows(rows: DbRow[], table: string) {
      for (const row of rows) {
        const pdfs: PdfItem[] = row.data?.pdfs ?? []
        let changed = false

        for (let i = 0; i < pdfs.length; i++) {
          const pdf = pdfs[i]
          if (!needsRestore(pdf, bucketSet)) { hoppet_over++; continue }

          try {
            const driveRes = await drive.files.get(
              { fileId: pdf.driveFileId!, alt: 'media' },
              { responseType: 'arraybuffer' },
            )
            const buffer   = Buffer.from(driveRes.data as unknown as ArrayBuffer)
            const filename = `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`

            const { error: uploadErr } = await supabaseAdmin.storage
              .from('project-images')
              .upload(filename, buffer, { contentType: 'application/pdf' })

            if (uploadErr) throw new Error(uploadErr.message)

            bucketSet.add(filename)
            pdfs[i] = { ...pdf, url: `${bucketBase}${filename}`, storage: 'supabase' }
            changed = true
            gjenopprettet++
            detaljer.push(`${table}/${row.id}: ${pdf.name} → ${filename}`)
          } catch (err) {
            feilet++
            detaljer.push(`FEIL ${table}/${row.id}: ${pdf.name} — ${err instanceof Error ? err.message : String(err)}`)
          }
        }

        if (changed) {
          await supabaseAdmin
            .from(table)
            .update({ data: { ...row.data, pdfs } })
            .eq('id', row.id)
        }
      }
    }

    await processRows((recipes ?? []) as DbRow[], 'recipes')
    await processRows((projects ?? []) as DbRow[], 'projects')

    return NextResponse.json({ gjenopprettet, hoppet_over, feilet, detaljer })
  } catch (err) {
    console.error('[restore-instructions]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
