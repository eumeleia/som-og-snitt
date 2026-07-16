'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConversionMeta {
  stitch_count: number
  color_count: number
  trim_count: number
  jump_count: number
  width_mm: number
  height_mm: number
  est_seconds: number
  colors: { r: number; g: number; b: number }[]
  warnings: string[]
}

interface ConversionResult {
  pesBlobUrl: string
  pesB64: string
  previewDataUrl: string | null
  meta: ConversionMeta
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function b64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function formatTime(sec: number): string {
  if (sec < 60) return `${sec} sek`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m} min ${s} sek` : `${m} min`
}

/**
 * Flood-fill from all 4 corners to build a background mask.
 * Returns a Uint8Array (1 = background) of length w*h.
 */
function computeBgMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8Array {
  const bg = new Uint8Array(w * h)
  const visited = new Uint8Array(w * h)
  const TOL_SQ = 30 * 30

  const corners = [0, w - 1, (h - 1) * w, (h - 1) * w + (w - 1)]
  for (const start of corners) {
    if (visited[start]) continue
    const sr = data[start * 4]
    const sg = data[start * 4 + 1]
    const sb = data[start * 4 + 2]
    const queue: number[] = [start]
    visited[start] = 1
    let qi = 0
    while (qi < queue.length) {
      const idx = queue[qi++]
      const r = data[idx * 4]
      const g = data[idx * 4 + 1]
      const b = data[idx * 4 + 2]
      if ((r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2 <= TOL_SQ) {
        bg[idx] = 1
        const x = idx % w
        const y = (idx - x) / w
        if (x > 0     && !visited[idx - 1]) { visited[idx - 1] = 1; queue.push(idx - 1) }
        if (x < w - 1 && !visited[idx + 1]) { visited[idx + 1] = 1; queue.push(idx + 1) }
        if (y > 0     && !visited[idx - w]) { visited[idx - w] = 1; queue.push(idx - w) }
        if (y < h - 1 && !visited[idx + w]) { visited[idx + w] = 1; queue.push(idx + w) }
      }
    }
  }
  return bg
}

/**
 * Client-side k-means colour quantisation applied directly to a canvas.
 * Scales the source image to ≤ MAX_PX before quantising for performance.
 * When removeBg is true, corner-flood-fill pixels are shown as checkerboard.
 */
function quantizeToCanvas(
  imgEl: HTMLImageElement,
  k: number,
  canvas: HTMLCanvasElement,
  removeBg: boolean,
) {
  const MAX = 250
  const { naturalWidth: nw, naturalHeight: nh } = imgEl
  const scale = Math.min(1, MAX / Math.max(nw, nh))
  const w = Math.max(1, Math.round(nw * scale))
  const h = Math.max(1, Math.round(nh * scale))
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d')!
  ctx.drawImage(imgEl, 0, 0, w, h)
  const imageData = ctx.getImageData(0, 0, w, h)
  const { data } = imageData
  const n = w * h

  const bgMask = removeBg ? computeBgMask(data, w, h) : null

  // Collect non-background pixel indices and RGB values
  const pixelIndices: number[] = []
  const pixels: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    if (!bgMask || !bgMask[i]) {
      pixelIndices.push(i)
      pixels.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]])
    }
  }

  const np = pixels.length
  if (np > 0) {
    const step = Math.max(1, Math.floor(np / k))
    const centers: [number, number, number][] = Array.from({ length: k }, (_, ci) => {
      const idx = Math.min(ci * step, np - 1)
      return [...pixels[idx]] as [number, number, number]
    })
    const assignments = new Int32Array(np)

    for (let iter = 0; iter < 8; iter++) {
      for (let pi = 0; pi < np; pi++) {
        const [r, g, b] = pixels[pi]
        let best = 0, bestD = Infinity
        for (let ci = 0; ci < k; ci++) {
          const [cr, cg, cb] = centers[ci]
          const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
          if (d < bestD) { bestD = d; best = ci }
        }
        assignments[pi] = best
      }
      const sums = Array.from({ length: k }, () => [0, 0, 0, 0])
      for (let pi = 0; pi < np; pi++) {
        const ci = assignments[pi]
        const [r, g, b] = pixels[pi]
        sums[ci][0] += r; sums[ci][1] += g; sums[ci][2] += b; sums[ci][3]++
      }
      for (let ci = 0; ci < k; ci++) {
        const [r, g, b, cnt] = sums[ci]
        if (cnt > 0) centers[ci] = [Math.round(r / cnt), Math.round(g / cnt), Math.round(b / cnt)]
      }
    }

    for (let pi = 0; pi < np; pi++) {
      const ci = assignments[pi]
      const i = pixelIndices[pi] * 4
      data[i]     = centers[ci][0]
      data[i + 1] = centers[ci][1]
      data[i + 2] = centers[ci][2]
      data[i + 3] = 255
    }
  }

  // Checkerboard pattern for background pixels
  if (bgMask) {
    for (let i = 0; i < n; i++) {
      if (bgMask[i]) {
        const x = i % w
        const y = (i - x) / w
        const light = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) === 0
        const v = light ? 220 : 180
        data[i * 4]     = v
        data[i * 4 + 1] = v
        data[i * 4 + 2] = v
        data[i * 4 + 3] = 255
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function BildeTilBroderiPage() {
  const [file, setFile]                         = useState<File | null>(null)
  const [stitchType, setStitchType]             = useState<'fill' | 'cross'>('fill')
  const [sizeMm, setSizeMm]                     = useState(100)
  const [numColors, setNumColors]               = useState(3)
  const [removeBg, setRemoveBg]                 = useState(false)
  const [converting, setConverting]             = useState(false)
  const [error, setError]                       = useState<string | null>(null)
  const [result, setResult]                     = useState<ConversionResult | null>(null)
  const [saving, setSaving]                     = useState(false)
  const [saved, setSaved]                       = useState(false)
  const [savedEmbroideryId, setSavedEmbroideryId] = useState<string | null>(null)

  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const imgElRef     = useRef<HTMLImageElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)

  const updatePreview = useCallback((img: HTMLImageElement, k: number, bg: boolean) => {
    const canvas = canvasRef.current
    if (!canvas) return
    quantizeToCanvas(img, k, canvas, bg)
  }, [])

  const handleFile = (f: File) => {
    if (!f.type.startsWith('image/')) return
    setFile(f)
    setResult(null)
    setSaved(false)
    setError(null)
    const url = URL.createObjectURL(f)
    const img = new window.Image()
    img.onload = () => {
      imgElRef.current = img
      updatePreview(img, numColors, removeBg)
    }
    img.src = url
  }

  // Debounced preview update when sliders or removeBg toggle changes
  useEffect(() => {
    if (!imgElRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (imgElRef.current) updatePreview(imgElRef.current, numColors, removeBg)
    }, 120)
  }, [numColors, removeBg, updatePreview])

  // Convert image → PES
  const handleConvert = async () => {
    if (!file) return
    setConverting(true)
    setError(null)
    setResult(null)
    setSaved(false)

    try {
      const imgEl = imgElRef.current!
      const MAX_PX = 800
      const sc = Math.min(1, MAX_PX / Math.max(imgEl.naturalWidth, imgEl.naturalHeight))
      const cw = Math.round(imgEl.naturalWidth  * sc)
      const ch = Math.round(imgEl.naturalHeight * sc)
      const tmp = document.createElement('canvas')
      tmp.width = cw; tmp.height = ch
      tmp.getContext('2d')!.drawImage(imgEl, 0, 0, cw, ch)
      const imgB64 = tmp.toDataURL('image/jpeg', 0.82).split(',')[1]

      const convRes = await fetch('/api/convert-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data:  imgB64,
          stitch_type: stitchType,
          size_mm:     sizeMm,
          num_colors:  numColors,
          remove_bg:   removeBg,
        }),
      })
      const convData = await convRes.json()
      if (!convRes.ok || convData.error) throw new Error(convData.error || 'Konvertering feilet')

      let previewDataUrl: string | null = null
      try {
        const renderRes = await fetch('/api/render-pes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pes_data: convData.pes_data }),
        })
        if (renderRes.ok) {
          const rd = await renderRes.json()
          if (rd.png_base64) {
            const mime = rd.content_type || 'image/jpeg'
            previewDataUrl = `data:${mime};base64,${rd.png_base64}`
          }
        }
      } catch { /* preview failure is non-fatal */ }

      const pesBlob    = b64ToBlob(convData.pes_data, 'application/octet-stream')
      const pesBlobUrl = URL.createObjectURL(pesBlob)

      setResult({ pesBlobUrl, pesB64: convData.pes_data, previewDataUrl, meta: convData.metadata })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setConverting(false)
    }
  }

  // Go back to settings with the same image and settings intact
  const handleRetry = () => {
    setResult(null)
    setSaved(false)
    // Keep savedEmbroideryId so next save replaces the existing record
  }

  // Save (or update) PES + cover in Supabase
  const handleSave = async () => {
    if (!result || !file) return
    setSaving(true)
    setError(null)

    try {
      const baseName = file.name.replace(/\.[^.]+$/, '')
      const ts       = Date.now()

      const pesFilename = `bilde-broderi-${ts}-${uid()}.pes`
      const pesBlob     = b64ToBlob(result.pesB64, 'application/octet-stream')
      const { error: pesErr } = await supabase.storage
        .from('embroidery-files')
        .upload(pesFilename, pesBlob, { contentType: 'application/octet-stream' })
      if (pesErr) throw pesErr
      const { data: pesUrlData } = supabase.storage
        .from('embroidery-files').getPublicUrl(pesFilename)

      let coverUrl = ''
      if (result.previewDataUrl) {
        const coverB64      = result.previewDataUrl.split(',')[1]
        const coverBlob     = b64ToBlob(coverB64, 'image/jpeg')
        const coverFilename = `bilde-broderi-cover-${ts}-${uid()}.jpg`
        const { error: covErr } = await supabase.storage
          .from('embroidery-files')
          .upload(coverFilename, coverBlob, { contentType: 'image/jpeg' })
        if (!covErr) {
          const { data: covUrlData } = supabase.storage
            .from('embroidery-files').getPublicUrl(coverFilename)
          coverUrl = covUrlData.publicUrl
        }
      }

      const embData = {
        navn: baseName,
        designer: '',
        kategori: '',
        coverImage: coverUrl,
        bmpPreview: coverUrl,
        customImage: '',
        useCustomImage: false,
        sizes: [{
          id:          uid(),
          sizeLabel:   `${result.meta.width_mm}×${result.meta.height_mm} mm`,
          pesUrl:      pesUrlData.publicUrl,
          pesFilename: `${baseName}.pes`,
          widthMm:     result.meta.width_mm,
          heightMm:    result.meta.height_mm,
        }],
        notater:
          `Konvertert fra bilde (${stitchType === 'fill' ? 'fyllsting' : 'korssting'}). ` +
          `${result.meta.stitch_count.toLocaleString('nb')} sting, ` +
          `${result.meta.color_count} farge(r).`,
      }

      if (savedEmbroideryId) {
        const { error: updErr } = await supabase
          .from('embroidery')
          .update({ data: embData })
          .eq('id', savedEmbroideryId)
        if (updErr) throw updErr
      } else {
        const { data: insData, error: insErr } = await supabase
          .from('embroidery')
          .insert({ data: embData })
          .select('id')
          .single()
        if (insErr) throw insErr
        setSavedEmbroideryId(insData.id)
      }

      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Feil ved lagring')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-lg mx-auto px-4 py-6 space-y-6 pb-24">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/embroidery"
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors"
          aria-label="Tilbake"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="font-serif text-2xl text-stone-700">Bilde til broderi</h1>
      </div>

      {/* Upload button */}
      <div className="space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors text-sm"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {file ? file.name : 'Last opp bilde (JPEG / PNG)'}
        </button>

        {/* Square preview window — shows quantized canvas */}
        <div
          className="relative w-full aspect-square bg-stone-100 rounded-2xl overflow-hidden border border-stone-200 flex items-center justify-center"
          onDragOver={e => { e.preventDefault() }}
          onDrop={e => {
            e.preventDefault()
            const f = e.dataTransfer.files?.[0]
            if (f) handleFile(f)
          }}
        >
          {!file ? (
            <span className="text-stone-400 text-sm select-none">
              Dra og slipp et bilde her
            </span>
          ) : (
            <canvas
              ref={canvasRef}
              style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }}
            />
          )}
        </div>
      </div>

      {/* Settings — only shown when an image is loaded */}
      {file && (
        <div className="space-y-5">

          {/* Stitch type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-stone-700">Stingtype</label>
            <div className="flex gap-2">
              {(['fill', 'cross'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setStitchType(t)}
                  className={`flex-1 py-2 px-3 rounded-xl border text-sm transition-colors ${
                    stitchType === t
                      ? 'bg-[#C9A57A] text-white border-[#C9A57A] font-medium'
                      : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                  }`}
                >
                  {t === 'fill' ? 'Fyllsting' : 'Korssting'}
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-stone-700">
                Størrelse (lengste side)
              </label>
              <span className="text-sm text-stone-500 tabular-nums">{sizeMm} mm</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={sizeMm}
              onChange={e => setSizeMm(Number(e.target.value))}
              className="w-full accent-[#C9A57A]"
            />
            <div className="flex justify-between text-xs text-stone-400">
              <span>10 mm</span>
              <span>100 mm</span>
            </div>
          </div>

          {/* Number of colours */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-stone-700">Antall farger</label>
              <span className="text-sm text-stone-500 tabular-nums">{numColors}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={numColors}
              onChange={e => setNumColors(Number(e.target.value))}
              className="w-full accent-[#C9A57A]"
            />
            <div className="flex justify-between text-xs text-stone-400">
              <span>1</span>
              <span>10</span>
            </div>
          </div>

          {/* Remove background toggle */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-stone-700">Fjern bakgrunn</label>
            <button
              role="switch"
              aria-checked={removeBg}
              onClick={() => setRemoveBg(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A57A] ${
                removeBg ? 'bg-[#C9A57A]' : 'bg-stone-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  removeBg ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Convert button */}
          <button
            onClick={handleConvert}
            disabled={converting}
            className="w-full py-3 bg-[#C9A57A] hover:bg-[#b8925f] disabled:opacity-50 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
          >
            {converting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Konverterer…
              </>
            ) : 'Konverter'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-5">

          {/* PES rendered preview */}
          {result.previewDataUrl ? (
            <div className="w-full aspect-square bg-stone-100 rounded-2xl overflow-hidden border border-stone-200 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.previewDataUrl}
                alt="Broderiforhåndsvisning"
                className="w-full h-full object-contain"
              />
            </div>
          ) : (
            <div className="w-full aspect-square bg-stone-100 rounded-2xl border border-stone-200 flex items-center justify-center text-stone-400 text-sm">
              Forhåndsvisning ikke tilgjengelig
            </div>
          )}

          {/* Quality panel */}
          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-3">
            <h2 className="font-medium text-stone-700 text-sm">Kvalitetspanel</h2>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <StatRow label="Antall sting"
                value={result.meta.stitch_count.toLocaleString('nb')} />
              <StatRow label="Farger / trådskift"
                value={String(result.meta.color_count)} />
              <StatRow label="Trims"
                value={String(result.meta.trim_count)} />
              <StatRow label="Jumps"
                value={String(result.meta.jump_count)} />
              <StatRow label="Størrelse"
                value={`${result.meta.width_mm}×${result.meta.height_mm} mm`} />
              <StatRow label="Estimert sømtid"
                value={formatTime(result.meta.est_seconds)} />
            </div>

            {/* Thread colour swatches */}
            {result.meta.colors.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {result.meta.colors.map((c, i) => (
                  <span
                    key={i}
                    className="w-5 h-5 rounded-full border border-stone-300 shadow-sm flex-shrink-0"
                    style={{ backgroundColor: `rgb(${c.r},${c.g},${c.b})` }}
                    title={`Farge ${i + 1}: rgb(${c.r},${c.g},${c.b})`}
                  />
                ))}
              </div>
            )}

            {/* Warnings */}
            {result.meta.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800"
              >
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {w}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <a
                href={result.pesBlobUrl}
                download={`broderi-${Date.now()}.pes`}
                className="flex-1 py-2.5 border border-stone-300 rounded-xl text-sm text-stone-700 hover:bg-stone-50 transition-colors text-center font-medium"
              >
                Last ned PES
              </a>
              <button
                onClick={handleRetry}
                className="flex-1 py-2.5 border border-stone-300 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors font-medium"
              >
                Prøv på nytt
              </button>
            </div>
            {saved ? (
              <div className="w-full py-2.5 flex items-center justify-center gap-1.5 text-sm text-green-700 font-medium">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M5 13l4 4L19 7" />
                </svg>
                {savedEmbroideryId ? 'Oppdatert i biblioteket' : 'Lagret i biblioteket'}
              </div>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-2.5 bg-stone-700 hover:bg-stone-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {savedEmbroideryId ? 'Oppdaterer…' : 'Lagrer…'}
                  </>
                ) : savedEmbroideryId ? 'Lagre (erstatt forrige)' : 'Lagre i biblioteket'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-stone-500">{label}</span>
      <span className="text-stone-800 font-medium tabular-nums text-right">{value}</span>
    </>
  )
}
