import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type FileEntry = {
  bucket: string
  name: string
  size: number
  ext: string
}

export type ExtGroup = {
  ext: string
  count: number
  totalBytes: number
}

export type BucketGroup = {
  bucket: string
  count: number
  totalBytes: number
  pdfCount: number
  pdfBytes: number
}

export type StorageReport = {
  bucketNames: string[]
  byExt: ExtGroup[]
  byBucket: BucketGroup[]
  pdfFiles: FileEntry[]
  top20: FileEntry[]
  grandTotal: number
  grandCount: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listAllFiles(supabase: SupabaseClient<any>, bucket: string): Promise<FileEntry[]> {
  const files: FileEntry[] = []
  const limit = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list('', { limit, offset, sortBy: { column: 'name', order: 'asc' } })

    if (error) throw new Error(`${bucket}: ${error.message}`)
    if (!data || data.length === 0) break

    for (const item of data) {
      if (item.metadata?.size !== undefined) {
        const ext = item.name.includes('.')
          ? '.' + item.name.split('.').pop()!.toLowerCase()
          : '(ingen ext)'
        files.push({ bucket, name: item.name, size: item.metadata.size, ext })
      }
    }

    if (data.length < limit) break
    offset += limit
  }

  return files
}

function buildReport(all: FileEntry[], bucketNames: string[]): StorageReport {
  const extMap = new Map<string, ExtGroup>()
  const bucketMap = new Map<string, BucketGroup>()

  for (const name of bucketNames) {
    bucketMap.set(name, { bucket: name, count: 0, totalBytes: 0, pdfCount: 0, pdfBytes: 0 })
  }

  let grandTotal = 0
  let grandCount = 0

  for (const f of all) {
    grandTotal += f.size
    grandCount++

    const eg = extMap.get(f.ext) ?? { ext: f.ext, count: 0, totalBytes: 0 }
    eg.count++
    eg.totalBytes += f.size
    extMap.set(f.ext, eg)

    const bg = bucketMap.get(f.bucket) ?? { bucket: f.bucket, count: 0, totalBytes: 0, pdfCount: 0, pdfBytes: 0 }
    bg.count++
    bg.totalBytes += f.size
    if (f.ext === '.pdf') { bg.pdfCount++; bg.pdfBytes += f.size }
    bucketMap.set(f.bucket, bg)
  }

  return {
    bucketNames,
    byExt: [...extMap.values()].sort((a, b) => b.totalBytes - a.totalBytes),
    byBucket: [...bucketMap.values()].sort((a, b) => b.totalBytes - a.totalBytes),
    pdfFiles: all.filter(f => f.ext === '.pdf').sort((a, b) => b.size - a.size),
    top20: [...all].sort((a, b) => b.size - a.size).slice(0, 20),
    grandTotal,
    grandCount,
  }
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceKey) {
    return NextResponse.json(
      { error: 'MISSING_KEY', message: 'SUPABASE_SERVICE_ROLE_KEY er ikke satt som miljøvariabel. Legg den til i Vercel: Settings → Environment Variables → navn: SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503 },
    )
  }

  if (!url) {
    return NextResponse.json(
      { error: 'MISSING_URL', message: 'NEXT_PUBLIC_SUPABASE_URL er ikke satt.' },
      { status: 503 },
    )
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false },
    })

    const { data: buckets, error: bErr } = await supabase.storage.listBuckets()
    if (bErr) throw new Error('listBuckets: ' + bErr.message)

    const bucketNames = (buckets ?? []).map(b => b.name)
    const all: FileEntry[] = []

    for (const bucket of bucketNames) {
      const files = await listAllFiles(supabase, bucket)
      all.push(...files)
    }

    return NextResponse.json(buildReport(all, bucketNames))
  } catch (err) {
    console.error('[storage-analyse]', err)
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
