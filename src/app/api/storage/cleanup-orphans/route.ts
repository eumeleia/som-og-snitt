import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface PdfItem { url?: string; [key: string]: unknown }
interface DbRow  { data: { pdfs?: PdfItem[] } }

async function buildInUseSet(): Promise<Set<string>> {
  const [{ data: recipes }, { data: projects }] = await Promise.all([
    supabaseAdmin.from('recipes').select('data'),
    supabaseAdmin.from('projects').select('data'),
  ])

  const inUseSet = new Set<string>()
  for (const row of [...(recipes ?? []), ...(projects ?? [])] as DbRow[]) {
    for (const pdf of row.data?.pdfs ?? []) {
      if (pdf.url?.includes('/project-images/')) {
        const path = pdf.url.split('/project-images/')[1]?.split('?')[0]
        if (path) inUseSet.add(path)
      }
    }
  }
  console.log(`[cleanup] i bruk-sett: ${inUseSet.size} stier`)
  return inUseSet
}

async function listAllPdfs(): Promise<{ name: string; size: number }[]> {
  const all: { name: string; size: number }[] = []
  let offset = 0
  const PAGE = 1000

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from('project-images')
      .list('', { limit: PAGE, offset })

    if (error) { console.error('[cleanup] storage.list feilet:', error); break }
    if (!data || data.length === 0) break

    for (const f of data) {
      if (f.name?.toLowerCase().endsWith('.pdf')) {
        all.push({ name: f.name, size: f.metadata?.size ?? 0 })
      }
    }

    if (data.length < PAGE) break
    offset += PAGE
  }

  console.log(`[cleanup] ${all.length} PDF-objekter listet i bucket`)
  return all
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { dryRun?: boolean }
    const dryRun = body.dryRun !== false

    const inUseSet  = await buildInUseSet()
    const allPdfs   = await listAllPdfs()
    const orphans   = allPdfs.filter(o => !inUseSet.has(o.name))
    const totalBytes = orphans.reduce((sum, o) => sum + o.size, 0)

    console.log(`[cleanup] ${orphans.length} foreldreløse PDF-er (${totalBytes} bytes)`)

    if (dryRun) {
      return NextResponse.json({
        orphanCount: orphans.length,
        totalBytes,
        sample: orphans.slice(0, 20).map(o => o.name),
      })
    }

    if (orphans.length === 0) {
      return NextResponse.json({ deleted: 0, freedBytes: 0 })
    }

    const names = orphans.map(o => o.name)
    let deleted = 0
    let failed  = 0
    const BATCH = 50

    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH)
      const { error } = await supabaseAdmin.storage.from('project-images').remove(batch)
      if (error) {
        console.error('[cleanup] batch-sletting feilet:', error, 'filer:', batch)
        failed += batch.length
      } else {
        deleted += batch.length
      }
    }

    const freedBytes = orphans.length > 0
      ? Math.round((deleted / orphans.length) * totalBytes)
      : 0

    console.log(`[cleanup] slettet: ${deleted}, feilet: ${failed}`)
    return NextResponse.json({ deleted, freedBytes, failed })
  } catch (err) {
    console.error('[cleanup] kritisk feil:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
