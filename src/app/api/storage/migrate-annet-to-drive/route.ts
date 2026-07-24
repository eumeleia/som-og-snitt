import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

export async function POST() {
  try {
    const [{ data: recipes, error: recErr }, { data: projects, error: projErr }] = await Promise.all([
      supabaseAdmin.from('recipes').select('id,data'),
      supabaseAdmin.from('projects').select('id,data'),
    ])

    if (recErr)  console.error('[annet] recipes fetch error:', recErr)
    if (projErr) console.error('[annet] projects fetch error:', projErr)

    const allRows = [
      ...((recipes  ?? []) as DbRow[]).map(r => ({ ...r, table: 'recipes'  })),
      ...((projects ?? []) as DbRow[]).map(r => ({ ...r, table: 'projects' })),
    ]

    const annetPdfs = allRows.flatMap(row =>
      (row.data?.pdfs ?? []).filter(p => p.type === 'Annet')
    )
    console.log(`[annet] ${annetPdfs.length} Annet-PDF-er funnet totalt`)

    let oppdatert  = 0
    let hoppet_over = 0
    let feilet     = 0
    const detaljer: string[] = []

    for (const row of allRows) {
      const pdfs: PdfItem[] = row.data?.pdfs ?? []
      const annetIdxs = pdfs
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.type === 'Annet')

      if (annetIdxs.length === 0) continue

      let changed = false
      for (const { p: pdf, i } of annetIdxs) {
        if (pdf.storage === 'drive') {
          console.log(`[annet] hopper over (allerede drive): ${pdf.name}`)
          hoppet_over++
          continue
        }
        if (!pdf.driveFileId || !pdf.driveLink) {
          console.log(`[annet] hopper over (mangler driveFileId/driveLink): ${pdf.name}`)
          hoppet_over++
          continue
        }
        try {
          pdfs[i] = { ...pdf, storage: 'drive', url: pdf.driveLink }
          changed = true
          oppdatert++
          const msg = `${row.table}/${row.id}: ${pdf.name}`
          console.log(`[annet] oppdatert: ${msg}`)
          detaljer.push(msg)
        } catch (err) {
          feilet++
          const msg = `FEIL ${row.table}/${row.id}: ${pdf.name} — ${err instanceof Error ? err.message : String(err)}`
          console.error(`[annet] ${msg}`)
          detaljer.push(msg)
        }
      }

      if (changed) {
        const { error: updateErr } = await supabaseAdmin
          .from(row.table)
          .update({ data: { ...row.data, pdfs } })
          .eq('id', row.id)
        if (updateErr) {
          console.error(`[annet] skriving feilet for ${row.id}:`, updateErr)
          feilet += annetIdxs.filter(({ p }) => p.storage !== 'drive').length
          oppdatert -= annetIdxs.filter(({ p }) => p.storage !== 'drive').length
        }
      }
    }

    console.log(`[annet] ferdig — oppdatert: ${oppdatert}, hoppet over: ${hoppet_over}, feilet: ${feilet}`)
    return NextResponse.json({ oppdatert, hoppet_over, feilet, detaljer })
  } catch (err) {
    console.error('[annet] kritisk feil:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
