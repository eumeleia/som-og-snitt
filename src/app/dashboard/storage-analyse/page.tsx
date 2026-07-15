'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const BUCKETS = ['project-images', 'embroidery-files']

type FileEntry = {
  bucket: string
  name: string
  size: number
  ext: string
}

type ExtGroup = {
  ext: string
  count: number
  totalBytes: number
}

type BucketGroup = {
  bucket: string
  count: number
  totalBytes: number
}

type Report = {
  byExt: ExtGroup[]
  byBucket: BucketGroup[]
  top20: FileEntry[]
  grandTotal: number
  grandCount: number
}

async function listAllFiles(bucket: string): Promise<FileEntry[]> {
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

function buildReport(all: FileEntry[]): Report {
  const extMap = new Map<string, ExtGroup>()
  const bucketMap = new Map<string, BucketGroup>()

  let grandTotal = 0
  let grandCount = 0

  for (const f of all) {
    grandTotal += f.size
    grandCount++

    const eg = extMap.get(f.ext) ?? { ext: f.ext, count: 0, totalBytes: 0 }
    eg.count++
    eg.totalBytes += f.size
    extMap.set(f.ext, eg)

    const bg = bucketMap.get(f.bucket) ?? { bucket: f.bucket, count: 0, totalBytes: 0 }
    bg.count++
    bg.totalBytes += f.size
    bucketMap.set(f.bucket, bg)
  }

  const byExt = [...extMap.values()].sort((a, b) => b.totalBytes - a.totalBytes)
  const byBucket = [...bucketMap.values()].sort((a, b) => b.totalBytes - a.totalBytes)
  const top20 = [...all].sort((a, b) => b.size - a.size).slice(0, 20)

  return { byExt, byBucket, top20, grandTotal, grandCount }
}

function mb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

function pct(bytes: number, total: number) {
  if (total === 0) return '0%'
  return ((bytes / total) * 100).toFixed(1) + '%'
}

export default function StorageAnalysePage() {
  const [report, setReport] = useState<Report | null>(null)
  const [progress, setProgress] = useState<string>('Analyserer…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const all: FileEntry[] = []
        for (const bucket of BUCKETS) {
          setProgress(`Henter filer fra «${bucket}»…`)
          const files = await listAllFiles(bucket)
          if (!cancelled) all.push(...files)
        }
        if (!cancelled) {
          setReport(buildReport(all))
          setProgress('Ferdig')
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    })()
    return () => { cancelled = true }
  }, [])

  const cell = 'px-3 py-2 text-sm'
  const th = `${cell} text-left font-semibold text-stone-600 bg-stone-100 border-b border-stone-200`
  const td = `${cell} border-b border-stone-100`

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">
      <div>
        <h1 className="text-xl font-bold text-stone-800">Storage-analyse</h1>
        <p className="text-sm text-stone-500 mt-1">Kun lesing — ingen filer slettes eller endres.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          <strong>Feil:</strong> {error}
        </div>
      )}

      {!report && !error && (
        <p className="text-stone-500 text-sm animate-pulse">{progress}</p>
      )}

      {report && (
        <>
          {/* Totalsummary */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-stone-700 text-sm">
              <span className="font-bold text-stone-900 text-lg">{mb(report.grandTotal)}</span>
              {' '}totalt ({report.grandCount} filer på tvers av {BUCKETS.length} buckets)
            </p>
          </div>

          {/* Per bucket */}
          <section>
            <h2 className="font-semibold text-stone-700 mb-2">Per bucket</h2>
            <table className="w-full border border-stone-200 rounded-lg overflow-hidden">
              <thead>
                <tr>
                  <th className={th}>Bucket</th>
                  <th className={`${th} text-right`}>Filer</th>
                  <th className={`${th} text-right`}>Størrelse</th>
                  <th className={`${th} text-right`}>Andel</th>
                </tr>
              </thead>
              <tbody>
                {report.byBucket.map(b => (
                  <tr key={b.bucket} className="hover:bg-stone-50">
                    <td className={`${td} font-mono text-xs`}>{b.bucket}</td>
                    <td className={`${td} text-right`}>{b.count}</td>
                    <td className={`${td} text-right`}>{mb(b.totalBytes)}</td>
                    <td className={`${td} text-right`}>{pct(b.totalBytes, report.grandTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Per filtype */}
          <section>
            <h2 className="font-semibold text-stone-700 mb-2">Per filtype</h2>
            <table className="w-full border border-stone-200 rounded-lg overflow-hidden">
              <thead>
                <tr>
                  <th className={th}>Endelse</th>
                  <th className={`${th} text-right`}>Filer</th>
                  <th className={`${th} text-right`}>Størrelse</th>
                  <th className={`${th} text-right`}>Andel</th>
                </tr>
              </thead>
              <tbody>
                {report.byExt.map(e => (
                  <tr key={e.ext} className="hover:bg-stone-50">
                    <td className={`${td} font-mono`}>{e.ext}</td>
                    <td className={`${td} text-right`}>{e.count}</td>
                    <td className={`${td} text-right`}>{mb(e.totalBytes)}</td>
                    <td className={`${td} text-right`}>{pct(e.totalBytes, report.grandTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Topp 20 største filer */}
          <section>
            <h2 className="font-semibold text-stone-700 mb-2">De 20 største enkeltfilene</h2>
            <table className="w-full border border-stone-200 rounded-lg overflow-hidden">
              <thead>
                <tr>
                  <th className={`${th} w-6`}>#</th>
                  <th className={th}>Filnavn</th>
                  <th className={th}>Bucket</th>
                  <th className={`${th} text-right`}>Størrelse</th>
                </tr>
              </thead>
              <tbody>
                {report.top20.map((f, i) => (
                  <tr key={`${f.bucket}/${f.name}`} className="hover:bg-stone-50">
                    <td className={`${td} text-stone-400 text-xs`}>{i + 1}</td>
                    <td className={`${td} font-mono text-xs break-all max-w-xs`}>{f.name}</td>
                    <td className={`${td} text-xs text-stone-500`}>{f.bucket}</td>
                    <td className={`${td} text-right`}>{mb(f.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
