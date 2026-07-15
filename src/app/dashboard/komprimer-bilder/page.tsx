'use client'

import { useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const BUCKET = 'embroidery-files'
const MAX_PX = 800
const JPEG_QUALITY = 0.80
const SKIP_BELOW_KB = 400

type FileItem = {
  name: string
  sizeBytes: number
}

type Result = {
  name: string
  status: 'skipped' | 'compressed' | 'error'
  beforeBytes: number
  afterBytes?: number
  error?: string
}

async function listAllPngs(): Promise<FileItem[]> {
  const files: FileItem[] = []
  const limit = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list('', { limit, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const f of data) {
      if (f.name.toLowerCase().endsWith('.png') && f.metadata?.size) {
        files.push({ name: f.name, sizeBytes: f.metadata.size })
      }
    }
    if (data.length < limit) break
    offset += limit
  }
  return files
}

async function compressFile(name: string): Promise<Blob> {
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(name)
  if (error || !blob) throw new Error(error?.message ?? 'download failed')

  const blobUrl = URL.createObjectURL(blob)
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        let w = img.naturalWidth
        let h = img.naturalHeight
        if (Math.max(w, h) > MAX_PX) {
          const r = MAX_PX / Math.max(w, h)
          w = Math.round(w * r)
          h = Math.round(h * r)
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          b => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
          'image/jpeg',
          JPEG_QUALITY,
        )
      }
      img.onerror = () => reject(new Error('image load failed'))
      img.src = blobUrl
    })
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

function fmtMb(bytes: number) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

function fmtKb(bytes: number) {
  return Math.round(bytes / 1024) + ' KB'
}

export default function KomprimerBilderPage() {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'running' | 'done'>('idle')
  const [candidates, setCandidates] = useState<FileItem[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [current, setCurrent] = useState('')
  const [idx, setIdx] = useState(0)
  const abortRef = useRef(false)

  async function scan() {
    setPhase('scanning')
    setCandidates([])
    setResults([])
    try {
      const all = await listAllPngs()
      const large = all.filter(f => f.sizeBytes >= SKIP_BELOW_KB * 1024)
      setCandidates(large)
      setPhase('idle')
    } catch (e) {
      alert('Feil ved scanning: ' + String(e))
      setPhase('idle')
    }
  }

  async function runCompression() {
    abortRef.current = false
    setPhase('running')
    setResults([])
    setIdx(0)

    for (let i = 0; i < candidates.length; i++) {
      if (abortRef.current) break
      const file = candidates[i]
      setIdx(i + 1)
      setCurrent(file.name)

      let result: Result
      try {
        const compressed = await compressFile(file.name)
        const { error } = await supabase.storage.from(BUCKET).upload(file.name, compressed, {
          contentType: 'image/jpeg',
          upsert: true,
        })
        if (error) throw new Error(error.message)
        result = {
          name: file.name,
          status: 'compressed',
          beforeBytes: file.sizeBytes,
          afterBytes: compressed.size,
        }
      } catch (e) {
        result = {
          name: file.name,
          status: 'error',
          beforeBytes: file.sizeBytes,
          error: String(e),
        }
      }

      setResults(prev => [...prev, result])
    }

    setCurrent('')
    setPhase('done')
  }

  function stop() {
    abortRef.current = true
  }

  const totalBefore = results.filter(r => r.status === 'compressed').reduce((s, r) => s + r.beforeBytes, 0)
  const totalAfter = results.filter(r => r.status === 'compressed').reduce((s, r) => s + (r.afterBytes ?? 0), 0)
  const saved = totalBefore - totalAfter

  const th = 'px-3 py-2 text-xs font-semibold text-stone-600 bg-stone-100 border-b border-stone-200 text-left'
  const td = 'px-3 py-2 text-xs border-b border-stone-100'

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-bold text-stone-800">Komprimer broderibilder</h1>
        <p className="text-sm text-stone-500 mt-1">
          Skalerer ned og lagrer som JPEG (q80) — filer under {SKIP_BELOW_KB} KB hoppes over.
          Overskriver eksisterende filer, ingen DB-endringer.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={scan}
          disabled={phase === 'scanning' || phase === 'running'}
          className="px-4 py-2 bg-stone-800 text-white rounded-xl text-sm font-medium hover:bg-stone-700 transition-colors disabled:opacity-40"
        >
          {phase === 'scanning' ? 'Skanner…' : 'Skann bucket'}
        </button>

        {candidates.length > 0 && phase === 'idle' && (
          <button
            onClick={runCompression}
            className="px-4 py-2 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 transition-colors"
          >
            Komprimer {candidates.length} filer
          </button>
        )}

        {phase === 'running' && (
          <button
            onClick={stop}
            className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Stopp
          </button>
        )}
      </div>

      {candidates.length > 0 && phase === 'idle' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-stone-700">
          <strong>{candidates.length} PNG-filer</strong> over {SKIP_BELOW_KB} KB funnet —
          totalt {fmtMb(candidates.reduce((s, f) => s + f.sizeBytes, 0))}.
          Trykk «Komprimer» for å starte.
        </div>
      )}

      {phase === 'running' && (
        <div className="space-y-1">
          <p className="text-sm text-stone-600">
            {idx} / {candidates.length} — <span className="font-mono text-xs">{current}</span>
          </p>
          <div className="w-full bg-stone-200 rounded-full h-2">
            <div
              className="bg-amber-500 h-2 rounded-full transition-all"
              style={{ width: `${(idx / candidates.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {results.length > 0 && (
        <section className="space-y-3">
          {phase === 'done' && saved > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
              <strong>Ferdig!</strong> Spart {fmtMb(saved)} (
              {results.filter(r => r.status === 'compressed').length} filer komprimert,{' '}
              {results.filter(r => r.status === 'error').length} feil).
            </div>
          )}

          <h2 className="font-semibold text-stone-700">Resultat</h2>
          <table className="w-full border border-stone-200 rounded-lg overflow-hidden text-left">
            <thead>
              <tr>
                <th className={th}>Fil</th>
                <th className={`${th} text-right`}>Før</th>
                <th className={`${th} text-right`}>Etter</th>
                <th className={`${th} text-right`}>Spart</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.name} className={r.status === 'error' ? 'bg-red-50' : 'hover:bg-stone-50'}>
                  <td className={`${td} font-mono break-all max-w-xs`}>{r.name}</td>
                  <td className={`${td} text-right`}>{fmtKb(r.beforeBytes)}</td>
                  <td className={`${td} text-right`}>{r.afterBytes ? fmtKb(r.afterBytes) : '—'}</td>
                  <td className={`${td} text-right`}>
                    {r.afterBytes ? fmtKb(r.beforeBytes - r.afterBytes) : '—'}
                  </td>
                  <td className={td}>
                    {r.status === 'compressed' && <span className="text-green-700">OK</span>}
                    {r.status === 'error' && (
                      <span className="text-red-600" title={r.error}>Feil</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
