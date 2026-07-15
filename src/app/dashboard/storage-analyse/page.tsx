'use client'

import { useEffect, useState } from 'react'
import type { StorageReport } from '@/app/api/storage-analyse/route'

function mb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

function pct(bytes: number, total: number) {
  if (total === 0) return '0%'
  return ((bytes / total) * 100).toFixed(1) + '%'
}

export default function StorageAnalysePage() {
  const [report, setReport] = useState<StorageReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [missingKey, setMissingKey] = useState(false)

  useEffect(() => {
    fetch('/api/storage-analyse')
      .then(async res => {
        const json = await res.json()
        if (!res.ok) {
          if (json.error === 'MISSING_KEY') { setMissingKey(true); return }
          throw new Error(json.message ?? `HTTP ${res.status}`)
        }
        setReport(json as StorageReport)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const th = 'px-3 py-2 text-sm text-left font-semibold text-stone-600 bg-stone-100 border-b border-stone-200'
  const td = 'px-3 py-2 text-sm border-b border-stone-100'

  const pdfTotal = report?.pdfFiles.reduce((s, f) => s + f.size, 0) ?? 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">
      <div>
        <h1 className="text-xl font-bold text-stone-800">Storage-analyse</h1>
        <p className="text-sm text-stone-500 mt-1">Kun lesing — ingen filer slettes eller endres.</p>
      </div>

      {loading && (
        <p className="text-stone-500 text-sm animate-pulse">Analyserer alle buckets…</p>
      )}

      {missingKey && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-2">
          <p className="font-semibold text-amber-900">Mangler service role key</p>
          <p className="text-sm text-amber-800">
            API-routen krever <code className="bg-amber-100 px-1 rounded font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code> for å
            liste buckets. Legg den til i Vercel:
          </p>
          <ol className="text-sm text-amber-800 list-decimal list-inside space-y-1">
            <li>Gå til <strong>Vercel → ditt prosjekt → Settings → Environment Variables</strong></li>
            <li>Legg til: <code className="bg-amber-100 px-1 rounded font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code></li>
            <li>Verdien finner du i <strong>Supabase → Project Settings → API → service_role (secret)</strong></li>
            <li>Redeploy etter at variabelen er lagret</li>
          </ol>
          <p className="text-xs text-amber-700 mt-2">
            Nøkkelen brukes KUN server-side og sendes aldri til nettleseren.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          <strong>Feil:</strong> {error}
        </div>
      )}

      {report && (
        <>
          {/* Grand total */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <p className="text-stone-700 text-sm">
              <span className="font-bold text-stone-900 text-lg">{mb(report.grandTotal)}</span>
              {' '}totalt · {report.grandCount} filer · {report.bucketNames.length} bucket{report.bucketNames.length !== 1 ? 's' : ''}
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
                  <th className={`${th} text-right`}>PDF-filer</th>
                  <th className={`${th} text-right`}>PDF-størrelse</th>
                </tr>
              </thead>
              <tbody>
                {report.byBucket.map(b => (
                  <tr key={b.bucket} className="hover:bg-stone-50">
                    <td className={`${td} font-mono text-xs`}>{b.bucket}</td>
                    <td className={`${td} text-right`}>{b.count}</td>
                    <td className={`${td} text-right`}>{mb(b.totalBytes)}</td>
                    <td className={`${td} text-right`}>{pct(b.totalBytes, report.grandTotal)}</td>
                    <td className={`${td} text-right ${b.pdfCount > 0 ? 'text-blue-700 font-medium' : 'text-stone-400'}`}>
                      {b.pdfCount > 0 ? b.pdfCount : '—'}
                    </td>
                    <td className={`${td} text-right ${b.pdfBytes > 0 ? 'text-blue-700 font-medium' : 'text-stone-400'}`}>
                      {b.pdfBytes > 0 ? mb(b.pdfBytes) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* PDF highlight */}
          <section>
            <h2 className="font-semibold text-stone-700 mb-1">PDF-filer (mønstre og oppskrifter)</h2>
            {report.pdfFiles.length === 0 ? (
              <p className="text-sm text-stone-400">Ingen PDF-filer funnet på tvers av alle buckets.</p>
            ) : (
              <>
                <p className="text-sm text-stone-500 mb-3">
                  <span className="font-semibold text-stone-800">{report.pdfFiles.length} PDF-filer</span>
                  {' '}· totalt {mb(pdfTotal)} · {pct(pdfTotal, report.grandTotal)} av alt storage
                </p>
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
                    {report.pdfFiles.map((f, i) => (
                      <tr key={`${f.bucket}/${f.name}`} className="hover:bg-blue-50">
                        <td className={`${td} text-stone-400 text-xs`}>{i + 1}</td>
                        <td className={`${td} font-mono text-xs break-all max-w-xs`}>{f.name}</td>
                        <td className={`${td} text-xs text-stone-500`}>{f.bucket}</td>
                        <td className={`${td} text-right`}>{mb(f.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {/* Per filtype */}
          <section>
            <h2 className="font-semibold text-stone-700 mb-2">Per filtype (alle buckets)</h2>
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
                  <tr key={e.ext} className={`hover:bg-stone-50 ${e.ext === '.pdf' ? 'bg-blue-50' : ''}`}>
                    <td className={`${td} font-mono`}>{e.ext}</td>
                    <td className={`${td} text-right`}>{e.count}</td>
                    <td className={`${td} text-right`}>{mb(e.totalBytes)}</td>
                    <td className={`${td} text-right`}>{pct(e.totalBytes, report.grandTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Topp 20 */}
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
                  <tr key={`${f.bucket}/${f.name}`} className={`hover:bg-stone-50 ${f.ext === '.pdf' ? 'bg-blue-50' : ''}`}>
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
