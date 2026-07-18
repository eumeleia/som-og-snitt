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
  info?: string[]
  auto_angles?: number[]
}

interface ConversionResult {
  pesBlobUrl: string
  pesB64: string
  previewDataUrl: string | null
  meta: ConversionMeta
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const FABRIC_COLORS = [
  { hex: '#ffffff', label: 'Hvit' },
  { hex: '#f4ede0', label: 'Naturhvit' },
  { hex: '#cfc9c0', label: 'Lys grå' },
  { hex: '#1a2744', label: 'Marine' },
]

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
 * Composite a transparent PNG data URL onto white and return as JPEG base64.
 * Used when saving cover images from the transparent preview.
 */
function transparentPngToJpegB64(dataUrl: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new window.Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width  = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
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
 * O(n) box blur via integral image. Used by stencilToCanvas for adaptive threshold.
 */
function computeBoxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const ii = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      ii[(y + 1) * (w + 1) + (x + 1)] =
        src[y * w + x] +
        ii[y * (w + 1) + (x + 1)] +
        ii[(y + 1) * (w + 1) + x] -
        ii[y * (w + 1) + x]
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
      const area = (y1 - y0 + 1) * (x1 - x0 + 1)
      out[y * w + x] = (
        ii[(y1 + 1) * (w + 1) + (x1 + 1)] -
        ii[y0 * (w + 1) + (x1 + 1)] -
        ii[(y1 + 1) * (w + 1) + x0] +
        ii[y0 * (w + 1) + x0]
      ) / area
    }
  }
  return out
}

/**
 * Stencil mode preview: grayscale + adaptive threshold → black/white canvas.
 * detailLevel 0–100; C = detailLevel−50: higher = more detail (less black).
 */
function stencilToCanvas(
  imgEl: HTMLImageElement,
  canvas: HTMLCanvasElement,
  removeBg: boolean,
  detailLevel: number,
) {
  const MAX = 250
  const { naturalWidth: nw, naturalHeight: nh } = imgEl
  const scale = Math.min(1, MAX / Math.max(nw, nh))
  const w = Math.max(1, Math.round(nw * scale))
  const h = Math.max(1, Math.round(nh * scale))
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d')!
  ctx.filter = 'blur(2px)'
  ctx.drawImage(imgEl, 0, 0, w, h)
  ctx.filter = 'none'
  const imageData = ctx.getImageData(0, 0, w, h)
  const { data } = imageData
  const n = w * h

  const bgMask = removeBg ? computeBgMask(data, w, h) : null

  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }

  const r = Math.max(5, Math.round(20 * Math.min(w, h) / 250))
  const localMean = computeBoxBlur(gray, w, h, r)
  const C = detailLevel - 50

  for (let i = 0; i < n; i++) {
    if (bgMask && bgMask[i]) {
      const x = i % w, y = (i - x) / w
      const light = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) === 0
      const v = light ? 220 : 180
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    } else {
      const v = gray[i] < localMean[i] - C ? 0 : 255
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    }
    data[i * 4 + 3] = 255
  }

  ctx.putImageData(imageData, 0, 0)
}

/**
 * Client-side k-means colour quantisation applied directly to a canvas.
 * Scales the source image to ≤ MAX_PX before quantising for performance.
 * When removeBg is true, corner-flood-fill pixels are shown as checkerboard.
 * blurPx: optional pre-blur radius (CSS pixels) for portrait-colour smoothing preview.
 */
function quantizeToCanvas(
  imgEl: HTMLImageElement,
  k: number,
  canvas: HTMLCanvasElement,
  removeBg: boolean,
  blurPx = 0,
) {
  const MAX = 250
  const { naturalWidth: nw, naturalHeight: nh } = imgEl
  const scale = Math.min(1, MAX / Math.max(nw, nh))
  const w = Math.max(1, Math.round(nw * scale))
  const h = Math.max(1, Math.round(nh * scale))
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d')!
  if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`
  ctx.drawImage(imgEl, 0, 0, w, h)
  if (blurPx > 0) ctx.filter = 'none'
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
  const [fabricColor, setFabricColor]           = useState<string>('#ffffff')
  const [saving, setSaving]                     = useState(false)
  const [saved, setSaved]                       = useState(false)
  const [savedEmbroideryId, setSavedEmbroideryId] = useState<string | null>(null)
  // Per-color angle overrides: null = Auto (use server's auto_angles)
  const [angleOverrides, setAngleOverrides]     = useState<(number | null)[]>([])
  // Preprocessing mode
  const [prepMode, setPrepMode]                 = useState<'standard' | 'portrait_color' | 'portrait_stencil'>('standard')
  const [smoothing, setSmoothing]               = useState(1)   // 0=lav 1=middels 2=høy
  const [detailLevel, setDetailLevel]           = useState(50)  // 0–100 stencil threshold offset
  const [lineThickness, setLineThickness]       = useState(1.5) // mm min sewable width

  const [fileObjectUrl, setFileObjectUrl]         = useState<string | null>(null)
  const [portraitPreview, setPortraitPreview]     = useState<{
    url: string
    palette: { r: number; g: number; b: number; frac: number }[]
  } | null>(null)
  const [portraitPreviewLoading, setPortraitPreviewLoading] = useState(false)

  const canvasRef         = useRef<HTMLCanvasElement>(null)
  const imgElRef          = useRef<HTMLImageElement | null>(null)
  const fileInputRef      = useRef<HTMLInputElement>(null)
  const timerRef          = useRef<ReturnType<typeof setTimeout> | null>(null)
  const portraitAbortRef  = useRef<AbortController | null>(null)

  const updatePreview = useCallback(
    (img: HTMLImageElement, k: number, bg: boolean,
     mode: 'standard' | 'portrait_color' | 'portrait_stencil',
     sm: number, dl: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (mode === 'portrait_stencil') {
        stencilToCanvas(img, canvas, bg, dl)
      } else {
        const blurPx = mode === 'portrait_color' ? [2, 4, 6][sm] : 0
        quantizeToCanvas(img, k, canvas, bg, blurPx)
      }
    },
    [],
  )

  const fetchPortraitPreview = useCallback(async (
    imgEl: HTMLImageElement,
    k: number,
    bg: boolean,
    sm: number,
  ) => {
    if (portraitAbortRef.current) portraitAbortRef.current.abort()
    const ctrl = new AbortController()
    portraitAbortRef.current = ctrl
    setPortraitPreviewLoading(true)
    try {
      const MAX_PX = 800
      const sc = Math.min(1, MAX_PX / Math.max(imgEl.naturalWidth, imgEl.naturalHeight))
      const cw = Math.round(imgEl.naturalWidth  * sc)
      const ch = Math.round(imgEl.naturalHeight * sc)
      const tmp = document.createElement('canvas')
      tmp.width = cw; tmp.height = ch
      tmp.getContext('2d')!.drawImage(imgEl, 0, 0, cw, ch)
      const imgB64 = tmp.toDataURL('image/jpeg', 0.82).split(',')[1]

      const res = await fetch('/api/convert-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          image_data: imgB64,
          stitch_type: 'fill',
          size_mm: 100,
          num_colors: k,
          remove_bg: bg,
          preprocessing_mode: 'portrait_color',
          smoothing: sm,
          preview_only: true,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.png_b64) {
        setPortraitPreview({
          url: `data:image/png;base64,${data.png_b64}`,
          palette: data.palette ?? [],
        })
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return
    } finally {
      setPortraitPreviewLoading(false)
    }
  }, [])

  const handleFile = (f: File) => {
    if (!f.type.startsWith('image/')) return
    setFile(f)
    setResult(null)
    setSaved(false)
    setError(null)
    setAngleOverrides([])
    setPortraitPreview(null)
    const url = URL.createObjectURL(f)
    setFileObjectUrl(url)
    const img = new window.Image()
    img.onload = () => {
      imgElRef.current = img
      const effK = prepMode === 'portrait_stencil' ? 1 : numColors
      updatePreview(img, effK, removeBg, prepMode, smoothing, detailLevel)
    }
    img.src = url
  }

  // Debounced preview update when sliders or mode-related state changes
  useEffect(() => {
    if (!imgElRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    const img = imgElRef.current
    if (prepMode === 'portrait_color') {
      // Server-side WYSIWYG preview — debounced
      timerRef.current = setTimeout(() => {
        fetchPortraitPreview(img, numColors, removeBg, smoothing)
      }, 400)
    } else {
      setPortraitPreview(null)
      timerRef.current = setTimeout(() => {
        if (!imgElRef.current) return
        const effK = prepMode === 'portrait_stencil' ? 1 : numColors
        updatePreview(imgElRef.current, effK, removeBg, prepMode, smoothing, detailLevel)
      }, 120)
    }
  }, [numColors, removeBg, updatePreview, fetchPortraitPreview, prepMode, smoothing, detailLevel])

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

      // fill_angles is per-active-color; null entry = "keep auto for this color"
      // Only send it when at least one entry has an explicit override.
      const hasOverride = stitchType === 'fill' && angleOverrides.some(a => a !== null)
      const fillAngles = hasOverride ? angleOverrides.map(a => a ?? null) : null

      const effNumColors = prepMode === 'portrait_stencil' ? 1 : numColors

      const convRes = await fetch('/api/convert-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data:         imgB64,
          stitch_type:        stitchType,
          size_mm:            sizeMm,
          num_colors:         effNumColors,
          remove_bg:          removeBg,
          fill_angles:        fillAngles,
          preprocessing_mode: prepMode,
          smoothing:          smoothing,
          detail_level:       detailLevel,
          line_thickness_mm:  lineThickness,
        }),
      })
      const convData = await convRes.json()
      if (!convRes.ok || convData.error) throw new Error(convData.error || 'Konvertering feilet')

      let previewDataUrl: string | null = null
      try {
        const renderRes = await fetch('/api/render-pes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pes_data: convData.pes_data, transparent_bg: true }),
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

      const newMeta: ConversionMeta = convData.metadata
      setResult({ pesBlobUrl, pesB64: convData.pes_data, previewDataUrl, meta: newMeta })
      // Keep overrides that were explicitly set; pad/trim to new active-color count
      setAngleOverrides(prev => {
        const n = newMeta.colors.length
        const next: (number | null)[] = Array.from({ length: n }, (_, i) => prev[i] ?? null)
        return next
      })
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
        // Composite transparent preview onto white before storing as cover
        const coverB64 = await transparentPngToJpegB64(result.previewDataUrl)
        if (coverB64) {
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

        {/* Square preview window — shows quantized canvas or server portrait preview */}
        <div
          className="relative w-full bg-stone-100 rounded-2xl overflow-hidden border border-stone-200 flex items-center justify-center"
          style={{ aspectRatio: prepMode === 'portrait_color' && file ? '2/1' : '1/1' }}
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
          ) : prepMode === 'portrait_color' ? (
            <div className="w-full h-full grid grid-cols-2">
              {/* Left: original */}
              <div className="relative flex items-center justify-center bg-stone-200 border-r border-stone-300">
                {fileObjectUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fileObjectUrl}
                    alt="Original"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                )}
                <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] text-stone-400">
                  Original
                </span>
              </div>
              {/* Right: server-quantized */}
              <div className="relative flex items-center justify-center bg-stone-100">
                {portraitPreviewLoading && !portraitPreview && (
                  <span className="text-[10px] text-stone-400">Laster…</span>
                )}
                {portraitPreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={portraitPreview.url}
                    alt="Kvantisert"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                             imageRendering: 'pixelated', opacity: portraitPreviewLoading ? 0.5 : 1 }}
                  />
                )}
                <span className="absolute bottom-1 left-0 right-0 text-center text-[10px] text-stone-400">
                  Kvantisert
                </span>
              </div>
            </div>
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

          {/* Preprocessing mode selector */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-stone-700">Forsystem</label>
            <div className="flex gap-1">
              {([
                { value: 'standard',          label: 'Standard' },
                { value: 'portrait_color',    label: 'Portrett (farger)' },
                { value: 'portrait_stencil',  label: 'Portrett (stensil)' },
              ] as const).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setPrepMode(value)}
                  className={`flex-1 py-2 px-1 rounded-xl border text-xs transition-colors ${
                    prepMode === value
                      ? 'bg-[#C9A57A] text-white border-[#C9A57A] font-medium'
                      : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {prepMode !== 'standard' && (
              <p className="text-xs text-stone-400 leading-snug">
                Fungerer best med godt opplyste, kontrastrike bilder der ansiktet fyller mye av bildet.
              </p>
            )}
          </div>

          {/* Portrait (colour) — smoothing control */}
          {prepMode === 'portrait_color' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-stone-700">Glatting</label>
              <div className="flex gap-2">
                {([0, 1, 2] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setSmoothing(v)}
                    className={`flex-1 py-2 px-3 rounded-xl border text-sm transition-colors ${
                      smoothing === v
                        ? 'bg-[#C9A57A] text-white border-[#C9A57A] font-medium'
                        : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                    }`}
                  >
                    {['Lav', 'Middels', 'Høy'][v]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Portrait (stencil) — detail level + line thickness */}
          {prepMode === 'portrait_stencil' && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-stone-700">Detaljnivå</label>
                  <span className="text-sm text-stone-500 tabular-nums">{detailLevel}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={detailLevel}
                  onChange={e => setDetailLevel(Number(e.target.value))}
                  className="w-full accent-[#C9A57A]"
                />
                <div className="flex justify-between text-xs text-stone-400">
                  <span>Mer svart</span>
                  <span>Mer detaljer</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-stone-700">Linjetykkelse</label>
                  <span className="text-sm text-stone-500 tabular-nums">{lineThickness.toFixed(1)} mm</span>
                </div>
                <input
                  type="range"
                  min={1.2}
                  max={2.5}
                  step={0.1}
                  value={lineThickness}
                  onChange={e => setLineThickness(Number(e.target.value))}
                  className="w-full accent-[#C9A57A]"
                />
                <div className="flex justify-between text-xs text-stone-400">
                  <span>1.2 mm</span>
                  <span>2.5 mm</span>
                </div>
              </div>
            </>
          )}

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

          {/* Number of colours — hidden in stencil mode (locked to 1) */}
          {prepMode !== 'portrait_stencil' && (
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
          )}

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
            <div className="space-y-2">
              {/* Fabric colour picker — only affects the preview, not the PES file */}
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-stone-500 flex-shrink-0">Stoff:</span>
                <div className="flex items-center gap-1.5">
                  {FABRIC_COLORS.map(fc => (
                    <button
                      key={fc.hex}
                      onClick={() => setFabricColor(fc.hex)}
                      className={`w-5 h-5 rounded-full border-2 transition-transform flex-shrink-0 ${
                        fabricColor === fc.hex
                          ? 'border-stone-600 scale-110'
                          : 'border-stone-300 hover:border-stone-400'
                      }`}
                      style={{ backgroundColor: fc.hex }}
                      title={fc.label}
                    />
                  ))}
                  <input
                    type="color"
                    value={fabricColor}
                    onChange={e => setFabricColor(e.target.value)}
                    className="w-5 h-5 rounded-full cursor-pointer border border-stone-300 p-0"
                    title="Egendefinert stoff"
                  />
                </div>
              </div>
              <div
                className="w-full aspect-square rounded-2xl overflow-hidden border border-stone-200 flex items-center justify-center"
                style={{ backgroundColor: fabricColor }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.previewDataUrl}
                  alt="Broderiforhåndsvisning"
                  className="w-full h-full object-contain"
                />
              </div>
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

            {/* Thread colour swatches + fill-angle selectors (fill only) */}
            {result.meta.colors.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {result.meta.colors.map((c, i) => {
                  const autoAngle = result.meta.auto_angles?.[i] ?? 0
                  const override  = angleOverrides[i] ?? null
                  const current   = override ?? autoAngle
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className="w-5 h-5 rounded-full border border-stone-300 shadow-sm flex-shrink-0"
                        style={{ backgroundColor: `rgb(${c.r},${c.g},${c.b})` }}
                        title={`Farge ${i + 1}: rgb(${c.r},${c.g},${c.b})`}
                      />
                      {stitchType === 'fill' && (
                        <div className="flex gap-1">
                          {([null, 0, 45, 90, 135] as (number | null)[]).map(val => {
                            const label = val === null ? 'Auto' : `${val}°`
                            const active = val === null ? override === null : override === val
                            return (
                              <button
                                key={String(val)}
                                onClick={() => {
                                  setAngleOverrides(prev => {
                                    const next = [...prev]
                                    while (next.length <= i) next.push(null)
                                    next[i] = val
                                    return next
                                  })
                                }}
                                className={`px-1.5 py-0.5 rounded text-xs transition-colors ${
                                  active
                                    ? 'bg-[#C9A57A] text-white font-medium'
                                    : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                                }`}
                                title={val === null ? `Auto (${autoAngle}°)` : `${val}°`}
                              >
                                {label}
                              </button>
                            )
                          })}
                          <span className="text-xs text-stone-400 self-center ml-0.5">{current}°</span>
                        </div>
                      )}
                    </div>
                  )
                })}
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

            {/* Info (neutral, for intentional small-detail colours) */}
            {result.meta.info?.map((msg, i) => (
              <div
                key={i}
                className="flex items-start gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700"
              >
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {msg}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {angleOverrides.some(a => a !== null) && (
              <button
                onClick={handleConvert}
                disabled={converting}
                className="w-full py-2.5 bg-[#C9A57A] hover:bg-[#b8926a] disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {converting ? (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : null}
                {converting ? 'Konverterer…' : 'Re-konverter med nye vinkler'}
              </button>
            )}
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
