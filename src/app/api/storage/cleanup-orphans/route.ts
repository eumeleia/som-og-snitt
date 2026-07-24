import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface PdfItem { url?: string; [key: string]: unknown }
interface DbRow  { data: { pdfs?: PdfItem[] } }

async function buildInUseSet(): Promise<{ inUseSet: Set<string>; recipeCount: number; projectCount: number }> {
  const [{ data: recipes }, { data: projects }] = await Promise.all([
    supabaseAdmin.from('recipes').select('data'),
    supabaseAdmin.from('projects').select('data'),
  ])

  const inUseSet = new Set<string>()
  for (const row of (recipes ?? []) as DbRow[]) {
    for (const pdf of row.data?.pdfs ?? []) {
      if (pdf.url?.includes('/project-images/')) {
        const path = pdf.url.split('/project-images/')[1]?.split('?')[0]
        if (path) inUseSet.add(path)
      }
    }
  }
  for (const row of (projects ?? []) as DbRow[]) {
    for (const pdf of row.data?.pdfs ?? []) {
      if (pdf.url?.includes('/project-images/')) {
        const path = pdf.url.split('/project-images/')[1]?.split('?')[0]
        if (path) inUseSet.add(path)
      }
    }
  }

  return { inUseSet, recipeCount: (recipes ?? []).length, projectCount: (projects ?? []).length }
}

async function listAllObjects(): Promise<{ name: string; size: number }[]> {
  const all: { name: string; size: number }[] = []
  let offset = 0
  const PAGE = 1000

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from('project-images')
      .list('', { limit: PAGE, offset })

    if (error) {
      console.error('[cleanup] storage.list feilet:', error)
      break
    }
    if (!data || data.length === 0) break

    for (const f of data) {
      if (f.name) all.push({ name: f.name, size: f.metadata?.size ?? 0 })
    }

    if (data.length < PAGE) break
    offset += PAGE
  }

  return all
}

export async function GET() {
  return scan()
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { dryRun?: boolean }
  if (body.dryRun !== false) return scan()
  return deleteOrphans()
}

async function scan(): Promise<NextResponse> {
  try {
    const { inUseSet, recipeCount, projectCount } = await buildInUseSet()
    const allObjects = await listAllObjects()
    const orphans = allObjects.filter(o => o.name.toLowerCase().endsWith('.pdf') && !inUseSet.has(o.name))
    const totalOrphanBytes = orphans.reduce((sum, o) => sum + o.size, 0)

    return NextResponse.json({
      scanned: { recipes: recipeCount, projects: projectCount },
      inUseCount: inUseSet.size,
      totalObjects: allObjects.length,
      orphanCount: orphans.length,
      orphanSample: orphans.slice(0, 10).map(o => o.name),
      totalOrphanBytes,
    })
  } catch (err) {
    console.error('[cleanup] scan feilet:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}

async function deleteOrphans(): Promise<NextResponse> {
  try {
    const { inUseSet } = await buildInUseSet()
    const allObjects = await listAllObjects()
    const orphans = allObjects.filter(o => o.name.toLowerCase().endsWith('.pdf') && !inUseSet.has(o.name))
    const totalOrphanBytes = orphans.reduce((sum, o) => sum + o.size, 0)

    if (orphans.length === 0) {
      return NextResponse.json({ deleted: 0, freedBytes: 0, failed: 0 })
    }

    const names = orphans.map(o => o.name)
    let deleted = 0, failed = 0
    const BATCH = 50

    for (let i = 0; i < names.length; i += BATCH) {
      const batch = names.slice(i, i + BATCH)
      const { error } = await supabaseAdmin.storage.from('project-images').remove(batch)
      if (error) {
        console.error('[cleanup] batch-sletting feilet:', JSON.stringify(error), 'filer:', batch)
        failed += batch.length
      } else {
        deleted += batch.length
      }
    }

    const freedBytes = (deleted / orphans.length) * totalOrphanBytes
    return NextResponse.json({ deleted, freedBytes: Math.round(freedBytes), failed })
  } catch (err) {
    console.error('[cleanup] delete feilet:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Ukjent feil' }, { status: 500 })
  }
}
