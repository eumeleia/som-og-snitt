'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmbroiderySize {
  id: string
  sizeLabel: string
  pesUrl: string
  pesFilename: string
  widthMm?: number
  heightMm?: number
}

interface EmbroideryData {
  navn: string
  designer: string
  kategori: string
  coverImage: string
  bmpPreview: string
  customImage: string
  useCustomImage: boolean
  sizes: EmbroiderySize[]
  notater: string
  rating?: number
  sortOrder?: number
  bundleId?: string
}

interface Embroidery {
  id: string
  created_at: string
  data: EmbroideryData
}

interface EmbroideryBundleData {
  navn: string
  designer: string
  kategori: string
  coverImage: string
  customImage: string
  useCustomImage: boolean
  notater: string
  rating?: number
  sortOrder?: number
}

interface EmbroideryBundle {
  id: string
  created_at: string
  data: EmbroideryBundleData
}

type GalleryItem =
  | { type: 'bundle'; bundle: EmbroideryBundle; motifCount: number }
  | { type: 'motif'; item: Embroidery }

type SortOrder = 'newest' | 'oldest' | 'name'
type SaveStatus = 'idle' | 'saving' | 'saved'
type View = 'gallery' | 'bundle' | 'motif'

const KATEGORIER = ['Frukt', 'Dyr', 'Blomster', 'Bokstaver', 'Monogram', 'Annet']

const STAR_PATH =
  'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z'

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function splitCamelCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

function parseSizeFromFilename(filename: string): { baseName: string; sizeLabel: string } {
  const nameNoExt = filename.replace(/\.[^.]+$/, '')
  let baseName = nameNoExt
  let sizeLabel = 'Standard'

  const sizeN = nameNoExt.match(/^(.+?)(Size\d+)$/i)
  if (sizeN) {
    baseName = sizeN[1]
    sizeLabel = sizeN[2]
    return { baseName: splitCamelCase(baseName), sizeLabel }
  }
  const nxn = nameNoExt.match(/^(.+?)(\d+x\d+)$/i)
  if (nxn) {
    baseName = nxn[1]
    sizeLabel = nxn[2]
    return { baseName: splitCamelCase(baseName), sizeLabel }
  }
  const sml = nameNoExt.match(/^(.+?)_([SML]|XL)$/i)
  if (sml) {
    baseName = sml[1]
    sizeLabel = sml[2].toUpperCase()
    return { baseName: splitCamelCase(baseName), sizeLabel }
  }
  const numSuffix = nameNoExt.match(/^(.+?)_(\d+)$/)
  if (numSuffix) {
    baseName = numSuffix[1]
    sizeLabel = numSuffix[2]
    return { baseName: splitCamelCase(baseName), sizeLabel }
  }
  return { baseName: splitCamelCase(nameNoExt), sizeLabel: 'Standard' }
}

function bmpToDataUrl(data: Uint8Array<ArrayBuffer>): Promise<string | null> {
  return new Promise(resolve => {
    const blob = new Blob([data], { type: 'image/bmp' })
    const url = URL.createObjectURL(blob)
    const img = new window.Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) { URL.revokeObjectURL(url); resolve(null); return }
        ctx.drawImage(img, 0, 0)
        canvas.toBlob(blob2 => {
          URL.revokeObjectURL(url)
          if (!blob2) { resolve(null); return }
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob2)
        }, 'image/png')
      } catch { URL.revokeObjectURL(url); resolve(null) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

// ── Shared UI ──────────────────────────────────────────────────────────────────

function StarRating({
  rating,
  onRate,
  size = 'md',
}: {
  rating?: number
  onRate?: (r: number) => void
  size?: 'sm' | 'md'
}) {
  const sz = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5'
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onRate?.(n)}
          className={`${onRate ? 'cursor-pointer' : 'cursor-default'} focus:outline-none`}
          tabIndex={onRate ? 0 : -1}
        >
          <svg className={sz} viewBox="0 0 18 18" fill={n <= (rating ?? 0) ? '#C9A57A' : 'none'}
            stroke={n <= (rating ?? 0) ? '#C9A57A' : '#d6cfc8'} strokeWidth={1}>
            <path d={STAR_PATH} />
          </svg>
        </button>
      ))}
    </div>
  )
}

function Spinner() {
  return (
    <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-70" />
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null
  return (
    <span className={`text-xs transition-opacity ${status === 'saving' ? 'text-stone-400' : 'text-green-600'}`}>
      {status === 'saving' ? <span className="flex items-center gap-1"><Spinner /> Lagrer…</span> : 'Lagret'}
    </span>
  )
}

// ── Delete Dialog (motiv) ──────────────────────────────────────────────────────

function DeleteDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <p className="text-stone-700 font-medium mb-1">Slett broderi?</p>
        <p className="text-stone-400 text-sm mb-6">Dette kan ikke angres. Alle tilhørende filer slettes.</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Slett
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Bundle Delete Dialog ───────────────────────────────────────────────────────

function BundleDeleteDialog({
  bundleName,
  onConfirm,
  onCancel,
}: {
  bundleName: string
  onConfirm: (detachOnly: boolean) => void
  onCancel: () => void
}) {
  const [detachOnly, setDetachOnly] = useState(true)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <p className="text-stone-700 font-medium mb-1">Slett bundle «{bundleName}»?</p>
        <p className="text-stone-400 text-sm mb-4">Hva skal skje med motivene?</p>
        <div className="space-y-3 mb-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              checked={detachOnly}
              onChange={() => setDetachOnly(true)}
              className="mt-0.5 accent-[#C9A57A]"
            />
            <div>
              <div className="text-sm font-medium text-stone-700">Løsriv motivene (anbefalt)</div>
              <div className="text-xs text-stone-400">Motivene beholdes som løse motiver i galleriet</div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              checked={!detachOnly}
              onChange={() => setDetachOnly(false)}
              className="mt-0.5 accent-red-500"
            />
            <div>
              <div className="text-sm font-medium text-stone-700">Slett motivene også</div>
              <div className="text-xs text-red-400">Dette kan ikke angres</div>
            </div>
          </label>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={() => onConfirm(detachOnly)}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors"
          >
            Slett bundle
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create Bundle Modal ────────────────────────────────────────────────────────

function CreateBundleModal({
  suggestedName,
  motifCount,
  onConfirm,
  onCancel,
}: {
  suggestedName?: string
  motifCount: number
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(suggestedName || '')

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="font-serif text-xl text-stone-700 mb-1">Lag bundle</h2>
        <p className="text-stone-400 text-sm mb-5">
          {motifCount} {motifCount === 1 ? 'motiv' : 'motiver'} samles i én bundle.
        </p>
        <div className="mb-5">
          <label className="block text-xs text-stone-500 mb-1">Bundle-navn</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()) }}
            placeholder="F.eks. Mini Fruits"
            className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={() => { if (name.trim()) onConfirm(name.trim()) }}
            disabled={!name.trim()}
            className="flex-1 py-2.5 bg-[#C9A57A] text-white rounded-xl text-sm font-medium hover:bg-[#b8925f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Lag bundle
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Upload Modal ───────────────────────────────────────────────────────────────

function UploadModal({ onDone, onClose }: {
  onDone: (results: Embroidery[], summary: string) => void
  onClose: () => void
}) {
  const [progress, setProgress] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadMode, setUploadMode] = useState<'loose' | 'bundle'>('loose')
  const [bundleName, setBundleName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList) {
    setUploading(true)
    setError(null)
    try {
      const JSZip = (await import('jszip')).default
      const results: Embroidery[] = []
      let failedFiles = 0

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi]
        const zipBundleName = bundleName.trim() ||
          file.name.replace(/\.zip$/i, '').replace(/[-_]/g, ' ')

        setProgress(`Pakker ut ${file.name}…`)
        const zip = await JSZip.loadAsync(file)

        type PesEntry = { name: string; path: string; getData: () => Promise<Uint8Array> }
        type BmpEntry = { name: string; path: string; getData: () => Promise<Uint8Array> }

        const pesFiles: PesEntry[] = []
        const bmpFiles: BmpEntry[] = []

        zip.forEach((relativePath, zipEntry) => {
          if (zipEntry.dir) return
          const lower = relativePath.toLowerCase()
          const name = relativePath.split('/').pop() ?? relativePath
          if (lower.endsWith('.pes')) {
            pesFiles.push({ name, path: relativePath, getData: () => zipEntry.async('uint8array') })
          } else if (lower.endsWith('.bmp')) {
            bmpFiles.push({ name, path: relativePath, getData: () => zipEntry.async('uint8array') })
          }
        })

        const motifMap = new Map<string, { sizeLabel: string; pesFile: PesEntry }[]>()
        for (const pf of pesFiles) {
          const nameNoExt = pf.name.replace(/\.pes$/i, '')
          const { baseName, sizeLabel } = parseSizeFromFilename(nameNoExt)
          if (!motifMap.has(baseName)) motifMap.set(baseName, [])
          motifMap.get(baseName)!.push({ sizeLabel, pesFile: pf })
        }

        let motifIdx = 0
        const totalMotifs = motifMap.size
        const zipResults: Embroidery[] = []

        for (const [motifName, sizes] of motifMap) {
          motifIdx++
          setProgress(`Laster opp ${motifName} (${motifIdx}/${totalMotifs})…`)

          const embSizes: EmbroiderySize[] = []
          for (const { sizeLabel, pesFile } of sizes) {
            const pesData = await pesFile.getData()
            const storageFilename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${pesFile.name}`
            const { error: upErr } = await supabase.storage
              .from('embroidery-files')
              .upload(storageFilename, pesData, { contentType: 'application/octet-stream' })
            if (upErr) {
              console.error('[Embroidery] Upload-feil for', storageFilename, upErr)
              failedFiles++
              continue
            }
            const { data: urlData } = supabase.storage.from('embroidery-files').getPublicUrl(storageFilename)
            embSizes.push({ id: uid(), sizeLabel, pesUrl: urlData.publicUrl, pesFilename: pesFile.name })
          }

          if (embSizes.length === 0) {
            console.warn('[Embroidery] Ingen PES-filer ble lastet opp for motiv', motifName)
            continue
          }

          let coverImage = ''
          let bmpPreview = ''
          const motifNameLower = motifName.toLowerCase().replace(/\s+/g, '')
          const matchedBmp = bmpFiles.find(b => {
            const bNameLower = b.name.toLowerCase().replace(/\.bmp$/i, '').replace(/\s+/g, '')
            if (bNameLower === motifNameLower) return true
            if (bNameLower.startsWith(motifNameLower)) return true
            const firstPes = sizes[0]?.pesFile.name.replace(/\.pes$/i, '').toLowerCase().replace(/\s+/g, '')
            if (firstPes && bNameLower === firstPes) return true
            return false
          })

          if (matchedBmp) {
            const bmpData = await matchedBmp.getData()
            const dataUrl = await bmpToDataUrl(bmpData as Uint8Array<ArrayBuffer>)
            if (dataUrl) {
              const res = await fetch(dataUrl)
              const pngBlob = await res.blob()
              const pngFilename = `embroidery-bmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
              const { error: bmpErr } = await supabase.storage
                .from('embroidery-files')
                .upload(pngFilename, pngBlob, { contentType: 'image/png' })
              if (!bmpErr) {
                const { data: bmpUrlData } = supabase.storage.from('embroidery-files').getPublicUrl(pngFilename)
                coverImage = bmpUrlData.publicUrl
                bmpPreview = bmpUrlData.publicUrl
              }
            }
          }

          const embData: EmbroideryData = {
            navn: motifName,
            designer: '',
            kategori: '',
            coverImage,
            bmpPreview,
            customImage: '',
            useCustomImage: false,
            sizes: embSizes,
            notater: '',
          }

          const { data: rows, error: insErr } = await supabase
            .from('embroidery')
            .insert({ data: embData })
            .select()
          if (insErr) {
            console.error('[Embroidery] DB insert-feil:', insErr)
          } else if (rows?.[0]) {
            zipResults.push(rows[0] as Embroidery)
          }
        }

        // If bundle mode: create bundle and link motifs
        if (uploadMode === 'bundle' && zipResults.length > 0) {
          setProgress(`Oppretter bundle «${zipBundleName}»…`)
          const firstCover = zipResults[0]?.data.coverImage || ''
          const bundleData: EmbroideryBundleData = {
            navn: zipBundleName,
            designer: '',
            kategori: '',
            coverImage: firstCover,
            customImage: '',
            useCustomImage: false,
            notater: '',
          }
          const { data: bundleRows, error: bundleErr } = await supabase
            .from('embroidery_bundles')
            .insert({ data: bundleData })
            .select()
          if (!bundleErr && bundleRows?.[0]) {
            const bundle = bundleRows[0] as EmbroideryBundle
            for (const motif of zipResults) {
              await supabase
                .from('embroidery')
                .update({ data: { ...motif.data, bundleId: bundle.id } })
                .eq('id', motif.id)
            }
          }
        }

        results.push(...zipResults)
      }

      setUploading(false)
      const summary = failedFiles > 0
        ? `${results.length} motiver lagt til, ${failedFiles} filer feilet`
        : `${results.length} motiver lagt til`
      onDone(results, summary)
    } catch (err) {
      setUploading(false)
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-serif text-2xl text-stone-700">Last opp broderipakke (ZIP)</h2>
          {!uploading && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <p className="text-sm text-stone-500 mb-4">
          ZIP-filen bør inneholde <span className="font-medium">.PES</span>-filer og eventuelt
          tilhørende <span className="font-medium">.BMP</span>-forhåndsvisninger.
        </p>

        {!uploading && (
          <>
            {/* Mode toggle */}
            <div className="mb-4">
              <p className="text-xs text-stone-500 mb-2">Legg til som:</p>
              <div className="flex rounded-xl border border-stone-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setUploadMode('loose')}
                  className={`flex-1 py-2 text-sm transition-colors ${
                    uploadMode === 'loose'
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-500 hover:bg-stone-50'
                  }`}
                >
                  Løse motiver
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('bundle')}
                  className={`flex-1 py-2 text-sm transition-colors ${
                    uploadMode === 'bundle'
                      ? 'bg-stone-800 text-white'
                      : 'bg-white text-stone-500 hover:bg-stone-50'
                  }`}
                >
                  Bundle
                </button>
              </div>
            </div>

            {uploadMode === 'bundle' && (
              <div className="mb-4">
                <label className="block text-xs text-stone-500 mb-1">Bundle-navn (valgfritt — hentes fra filnavn)</label>
                <input
                  value={bundleName}
                  onChange={e => setBundleName(e.target.value)}
                  placeholder="F.eks. Mini Fruits"
                  className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200"
                />
              </div>
            )}
          </>
        )}

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {uploading ? (
          <div className="flex items-center gap-3 py-4 text-stone-600 text-sm">
            <Spinner />
            <span>{progress || 'Behandler…'}</span>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(e.target.files) }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-3 border-2 border-dashed border-stone-200 rounded-xl text-sm text-stone-500 hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Velg ZIP-fil(er)
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Avbryt
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Embroidery Card ────────────────────────────────────────────────────────────

function EmbroideryCard({
  item,
  onEdit,
  onDelete,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: {
  item: Embroidery
  onEdit: () => void
  onDelete: () => void
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const d = item.data
  const imgSrc = d.useCustomImage ? d.customImage : (d.coverImage || d.bmpPreview)

  function handleClick() {
    if (selectionMode) {
      onToggleSelect?.()
    } else {
      onEdit()
    }
  }

  return (
    <article
      onClick={handleClick}
      className={`group bg-white rounded-xl border shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col relative min-w-0 ${
        selected ? 'border-[#C9A57A] ring-2 ring-[#C9A57A]/30' : 'border-stone-200'
      }`}
    >
      <div className="relative aspect-[5/4] overflow-hidden bg-stone-50">
        {imgSrc ? (
          <img src={imgSrc} alt={d.navn} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
            </svg>
          </div>
        )}

        {selectionMode && (
          <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected ? 'bg-[#C9A57A] border-[#C9A57A]' : 'bg-white/80 border-stone-300'
          }`}>
            {selected && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-3 py-2.5">
          <h3 className="font-serif text-sm font-semibold text-white leading-tight truncate">
            {d.navn || <span className="italic font-light opacity-70">Uten navn</span>}
          </h3>
          <p className="text-xs text-white/70">{d.sizes.length} {d.sizes.length === 1 ? 'størrelse' : 'størrelser'}</p>
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {d.rating ? (
            <StarRating rating={d.rating} size="sm" />
          ) : (
            <span className="text-xs text-stone-300">{d.sizes.length} {d.sizes.length === 1 ? 'størrelse' : 'størrelser'}</span>
          )}
          {d.kategori && (
            <span className="text-xs text-stone-400 truncate">{d.kategori}</span>
          )}
        </div>
        {!selectionMode && (
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="flex-shrink-0 p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </article>
  )
}

// ── Bundle Card ────────────────────────────────────────────────────────────────

function BundleCard({ bundle, motifCount, onClick }: {
  bundle: EmbroideryBundle
  motifCount: number
  onClick: () => void
}) {
  const d = bundle.data
  const imgSrc = d.useCustomImage ? d.customImage : d.coverImage

  return (
    <article
      onClick={onClick}
      className="group bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col relative min-w-0"
    >
      <div className="relative aspect-[5/4] overflow-hidden bg-stone-50">
        {imgSrc ? (
          <img src={imgSrc} alt={d.navn} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
        )}

        {/* Bundle badge */}
        <div className="absolute top-2 left-2 bg-black/55 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Bundle
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-3 py-2.5">
          <h3 className="font-serif text-sm font-semibold text-white leading-tight truncate">
            {d.navn || <span className="italic font-light opacity-70">Uten navn</span>}
          </h3>
          <p className="text-xs text-white/70">{motifCount} {motifCount === 1 ? 'motiv' : 'motiver'}</p>
        </div>
      </div>

      <div className="flex items-center px-3 py-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {d.rating ? (
            <StarRating rating={d.rating} size="sm" />
          ) : (
            <span className="text-xs text-stone-300">{motifCount} {motifCount === 1 ? 'motiv' : 'motiver'}</span>
          )}
          {d.kategori && (
            <span className="text-xs text-stone-400 truncate">{d.kategori}</span>
          )}
        </div>
      </div>
    </article>
  )
}

// ── Bundle Motif Card (used inside BundleDetail) ───────────────────────────────

function BundleMotifCard({ item, onClick, onRemove }: {
  item: Embroidery
  onClick: () => void
  onRemove: () => void
}) {
  const d = item.data
  const imgSrc = d.useCustomImage ? d.customImage : (d.coverImage || d.bmpPreview)

  return (
    <div className="relative">
      <article
        onClick={onClick}
        className="group bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden min-w-0"
      >
        <div className="relative aspect-[5/4] overflow-hidden bg-stone-50">
          {imgSrc ? (
            <img src={imgSrc} alt={d.navn} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg className="w-8 h-8 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
              </svg>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-2.5 py-2">
            <h3 className="font-serif text-xs font-semibold text-white leading-tight truncate">{d.navn || 'Uten navn'}</h3>
            <p className="text-[10px] text-white/70">{d.sizes.length} str.</p>
          </div>
        </div>
      </article>
      <button
        onClick={e => { e.stopPropagation(); onRemove() }}
        className="absolute top-1.5 right-1.5 p-1 bg-white/85 rounded-lg hover:bg-white text-stone-400 hover:text-orange-500 transition-colors shadow-sm"
        title="Fjern fra bundle"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ── Embroidery Detail ──────────────────────────────────────────────────────────

function EmbroideryDetail({ item, onBack, onSaved, onDelete }: {
  item: Embroidery
  onBack: () => void
  onSaved: () => void
  onDelete: () => void
}) {
  const [form, setForm] = useState<EmbroideryData>(item.data)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const pendingRef = useRef<EmbroideryData>(item.data)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(item.id)
  const customImgRef = useRef<HTMLInputElement>(null)

  function update(patch: Partial<EmbroideryData>) {
    setForm(f => {
      const next = { ...f, ...patch }
      pendingRef.current = next
      return next
    })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 1500)
  }

  function updateSize(sizeId: string, patch: Partial<EmbroiderySize>) {
    setForm(f => {
      const next = {
        ...f,
        sizes: f.sizes.map(s => s.id === sizeId ? { ...s, ...patch } : s),
      }
      pendingRef.current = next
      return next
    })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 1500)
  }

  function removeSize(sizeId: string) {
    setForm(f => {
      const next = { ...f, sizes: f.sizes.filter(s => s.id !== sizeId) }
      pendingRef.current = next
      return next
    })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 1500)
  }

  async function flush() {
    setSaveStatus('saving')
    await supabase.from('embroidery').update({ data: pendingRef.current }).eq('id', idRef.current)
    setSaveStatus('saved')
    onSaved()
    setTimeout(() => setSaveStatus('idle'), 2000)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        flush()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCustomImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const filename = `embroidery-custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage
      .from('embroidery-files')
      .upload(filename, file, { contentType: file.type })
    if (error) return
    const { data: urlData } = supabase.storage.from('embroidery-files').getPublicUrl(filename)
    update({ customImage: urlData.publicUrl, useCustomImage: true })
  }

  const d = form
  const displayImg = d.useCustomImage ? d.customImage : (d.coverImage || d.bmpPreview)

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => {
            if (timerRef.current) { clearTimeout(timerRef.current); flush() }
            onBack()
          }}
          className="p-2 rounded-xl hover:bg-stone-100 text-stone-500 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-xl text-stone-700 truncate">{d.navn || 'Uten navn'}</h2>
        </div>
        <SaveIndicator status={saveStatus} />
        <button
          onClick={onDelete}
          className="p-2 rounded-xl text-stone-300 hover:text-red-400 hover:bg-red-50 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-24 space-y-6">
        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
          <h3 className="font-serif text-lg text-stone-700 mb-4">Forsidebilde</h3>
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex-shrink-0">
              {displayImg ? (
                <img src={displayImg} alt={d.navn}
                  className="w-full sm:w-60 h-48 object-cover rounded-xl border border-stone-100" />
              ) : (
                <div className="w-full sm:w-60 h-48 rounded-xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center text-stone-300 gap-2">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs">Ingen forside ennå</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 justify-center">
              <input ref={customImgRef} type="file" accept="image/jpeg,image/png,image/webp"
                className="hidden" onChange={handleCustomImage} />
              <button onClick={() => customImgRef.current?.click()}
                className="px-4 py-2 text-sm border border-stone-200 rounded-xl hover:bg-stone-50 text-stone-600 transition-colors">
                Last opp eget bilde
              </button>
              {d.customImage && (
                <button onClick={() => update({ useCustomImage: !d.useCustomImage })}
                  className="px-4 py-2 text-sm border border-[#D4A574] rounded-xl bg-[#F5EFE6] text-[#8B6340] hover:bg-[#e8d5c0] transition-colors">
                  {d.useCustomImage ? 'Bruk original (BMP)' : 'Bruk eget bilde'}
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-4">
          <h3 className="font-serif text-lg text-stone-700">Grunninfo</h3>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Motivnavn</label>
            <input value={d.navn} onChange={e => update({ navn: e.target.value })}
              placeholder="Navn på motivet"
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200" />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Designer</label>
            <input value={d.designer} onChange={e => update({ designer: e.target.value })}
              placeholder="Navn på designer eller merkevare"
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200" />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-2">Kategori</label>
            <div className="flex flex-wrap gap-2">
              {KATEGORIER.map(k => (
                <button key={k} type="button" onClick={() => update({ kategori: d.kategori === k ? '' : k })}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    d.kategori === k
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                  }`}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1.5">Vurdering</label>
            <StarRating rating={d.rating} onRate={r => update({ rating: r })} />
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
          <h3 className="font-serif text-lg text-stone-700 mb-4">Størrelser</h3>
          {d.sizes.length === 0 ? (
            <p className="text-sm text-stone-400 italic">Ingen størrelser registrert.</p>
          ) : (
            <div className="space-y-2">
              {d.sizes.map(size => (
                <div key={size.id} className="flex items-center gap-3 py-2 border-b border-stone-50 last:border-0 min-w-0">
                  <input value={size.sizeLabel} onChange={e => updateSize(size.id, { sizeLabel: e.target.value })}
                    className="w-24 flex-shrink-0 px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-200"
                    placeholder="Størrelse" />
                  <span className="flex-1 text-xs text-stone-400 truncate min-w-0">{size.pesFilename}</span>
                  <a href={size.pesUrl} download={size.pesFilename} onClick={e => e.stopPropagation()}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#F5EFE6] text-[#8B6340] rounded-lg hover:bg-[#e8d5c0] border border-[#D4A574] transition-colors whitespace-nowrap">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Last ned
                  </a>
                  <button onClick={() => removeSize(size.id)}
                    className="flex-shrink-0 p-1.5 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors" title="Fjern størrelse">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
          <h3 className="font-serif text-lg text-stone-700 mb-3">Notater</h3>
          <textarea value={d.notater} onChange={e => update({ notater: e.target.value })}
            placeholder="Egne notater, tips, stoff som passer…"
            rows={5}
            className="w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200 resize-y leading-relaxed" />
        </section>
      </div>
    </>
  )
}

// ── Bundle Detail ──────────────────────────────────────────────────────────────

function BundleDetail({ bundle, motifs, onBack, onSaved, onDelete, onMotifClick, onRemoveMotif }: {
  bundle: EmbroideryBundle
  motifs: Embroidery[]
  onBack: () => void
  onSaved: () => void
  onDelete: () => void
  onMotifClick: (item: Embroidery) => void
  onRemoveMotif: (motifId: string) => void
}) {
  const [form, setForm] = useState<EmbroideryBundleData>(bundle.data)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const pendingRef = useRef<EmbroideryBundleData>(bundle.data)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(bundle.id)
  const customImgRef = useRef<HTMLInputElement>(null)

  function update(patch: Partial<EmbroideryBundleData>) {
    setForm(f => {
      const next = { ...f, ...patch }
      pendingRef.current = next
      return next
    })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 1500)
  }

  async function flush() {
    setSaveStatus('saving')
    await supabase.from('embroidery_bundles').update({ data: pendingRef.current }).eq('id', idRef.current)
    setSaveStatus('saved')
    onSaved()
    setTimeout(() => setSaveStatus('idle'), 2000)
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        flush()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCustomImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const filename = `embroidery-bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage
      .from('embroidery-files')
      .upload(filename, file, { contentType: file.type })
    if (error) return
    const { data: urlData } = supabase.storage.from('embroidery-files').getPublicUrl(filename)
    update({ customImage: urlData.publicUrl, useCustomImage: true })
  }

  const d = form
  const displayImg = d.useCustomImage ? d.customImage : d.coverImage

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => {
            if (timerRef.current) { clearTimeout(timerRef.current); flush() }
            onBack()
          }}
          className="p-2 rounded-xl hover:bg-stone-100 text-stone-500 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-xl text-stone-700 truncate">{d.navn || 'Uten navn'}</h2>
          <p className="text-xs text-stone-400">{motifs.length} {motifs.length === 1 ? 'motiv' : 'motiver'}</p>
        </div>
        <SaveIndicator status={saveStatus} />
        <button
          onClick={onDelete}
          className="p-2 rounded-xl text-stone-300 hover:text-red-400 hover:bg-red-50 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-24 space-y-6">
        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
          <h3 className="font-serif text-lg text-stone-700 mb-4">Forsidebilde</h3>
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex-shrink-0">
              {displayImg ? (
                <img src={displayImg} alt={d.navn}
                  className="w-full sm:w-60 h-48 object-cover rounded-xl border border-stone-100" />
              ) : (
                <div className="w-full sm:w-60 h-48 rounded-xl border-2 border-dashed border-stone-200 flex flex-col items-center justify-center text-stone-300 gap-2">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs">Ingen forside ennå</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 justify-center">
              <input ref={customImgRef} type="file" accept="image/jpeg,image/png,image/webp"
                className="hidden" onChange={handleCustomImage} />
              <button onClick={() => customImgRef.current?.click()}
                className="px-4 py-2 text-sm border border-stone-200 rounded-xl hover:bg-stone-50 text-stone-600 transition-colors">
                Last opp eget bilde
              </button>
              {d.customImage && (
                <button onClick={() => update({ useCustomImage: !d.useCustomImage })}
                  className="px-4 py-2 text-sm border border-[#D4A574] rounded-xl bg-[#F5EFE6] text-[#8B6340] hover:bg-[#e8d5c0] transition-colors">
                  {d.useCustomImage ? 'Bruk original' : 'Bruk eget bilde'}
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5 space-y-4">
          <h3 className="font-serif text-lg text-stone-700">Bundle-info</h3>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Bundle-navn</label>
            <input value={d.navn} onChange={e => update({ navn: e.target.value })}
              placeholder="Navn på bundelen"
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200" />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1">Designer</label>
            <input value={d.designer} onChange={e => update({ designer: e.target.value })}
              placeholder="Navn på designer eller merkevare"
              className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200" />
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-2">Kategori</label>
            <div className="flex flex-wrap gap-2">
              {KATEGORIER.map(k => (
                <button key={k} type="button" onClick={() => update({ kategori: d.kategori === k ? '' : k })}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    d.kategori === k
                      ? 'bg-stone-800 text-white border-stone-800'
                      : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
                  }`}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-stone-500 mb-1.5">Vurdering</label>
            <StarRating rating={d.rating} onRate={r => update({ rating: r })} />
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
          <h3 className="font-serif text-lg text-stone-700 mb-4">
            Motiver ({motifs.length})
          </h3>
          {motifs.length === 0 ? (
            <p className="text-sm text-stone-400 italic">Ingen motiver i denne bundelen ennå.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {motifs.map(motif => (
                <BundleMotifCard
                  key={motif.id}
                  item={motif}
                  onClick={() => onMotifClick(motif)}
                  onRemove={() => onRemoveMotif(motif.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-stone-100 shadow-sm p-5">
          <h3 className="font-serif text-lg text-stone-700 mb-3">Notater</h3>
          <textarea value={d.notater} onChange={e => update({ notater: e.target.value })}
            placeholder="Egne notater om bundelen…"
            rows={4}
            className="w-full px-3 py-2.5 border border-stone-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-stone-200 resize-y leading-relaxed" />
        </section>
      </div>
    </>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function EmbroideryPage() {
  const [items, setItems] = useState<Embroidery[]>([])
  const [bundles, setBundles] = useState<EmbroideryBundle[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [katFilter, setKatFilter] = useState('Alle')
  const [sort, setSort] = useState<SortOrder>('newest')
  const [showUpload, setShowUpload] = useState(false)
  const [view, setView] = useState<View>('gallery')
  const [prevView, setPrevView] = useState<View>('gallery')
  const [currentBundle, setCurrentBundle] = useState<EmbroideryBundle | null>(null)
  const [currentItem, setCurrentItem] = useState<Embroidery | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteBundleId, setDeleteBundleId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showCreateBundle, setShowCreateBundle] = useState(false)
  const [katDropdownOpen, setKatDropdownOpen] = useState(false)
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const [uploadSummary, setUploadSummary] = useState<string | null>(null)
  const katDropdownRef = useRef<HTMLDivElement>(null)
  const sortDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!katDropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (katDropdownRef.current && !katDropdownRef.current.contains(e.target as Node)) {
        setKatDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [katDropdownOpen])

  useEffect(() => {
    if (!sortDropdownOpen) return
    function handleClick(e: MouseEvent) {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [sortDropdownOpen])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [embRes, bundleRes] = await Promise.all([
        supabase.from('embroidery').select('*').order('created_at', { ascending: false }),
        supabase.from('embroidery_bundles').select('*').order('created_at', { ascending: false }),
      ])
      if (embRes.error) throw embRes.error
      if (bundleRes.error) throw bundleRes.error
      setItems((embRes.data as Embroidery[]) || [])
      setBundles((bundleRes.data as EmbroideryBundle[]) || [])
    } catch (err) {
      console.error('embroidery load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteItem(id: string) {
    const item = items.find(i => i.id === id)
    if (item) {
      const filesToDelete: string[] = []
      for (const size of item.data.sizes) {
        const filename = size.pesUrl.split('/').pop()
        if (filename) filesToDelete.push(filename)
      }
      if (item.data.coverImage) {
        const f = item.data.coverImage.split('/').pop()
        if (f) filesToDelete.push(f)
      }
      if (item.data.customImage) {
        const f = item.data.customImage.split('/').pop()
        if (f) filesToDelete.push(f)
      }
      if (filesToDelete.length > 0) {
        await supabase.storage.from('embroidery-files').remove(filesToDelete)
      }
    }
    await supabase.from('embroidery').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
    setDeleteId(null)
    setCurrentItem(null)
    if (view === 'motif') setView(prevView)
  }

  async function deleteBundle(bundleId: string, detachOnly: boolean) {
    const bundleMotifs = items.filter(i => i.data.bundleId === bundleId)
    if (detachOnly) {
      for (const motif of bundleMotifs) {
        const newData = { ...motif.data }
        delete newData.bundleId
        await supabase.from('embroidery').update({ data: newData }).eq('id', motif.id)
      }
    } else {
      for (const motif of bundleMotifs) {
        const filesToDelete: string[] = []
        for (const size of motif.data.sizes) {
          const filename = size.pesUrl.split('/').pop()
          if (filename) filesToDelete.push(filename)
        }
        if (motif.data.coverImage) {
          const f = motif.data.coverImage.split('/').pop()
          if (f) filesToDelete.push(f)
        }
        if (motif.data.customImage) {
          const f = motif.data.customImage.split('/').pop()
          if (f) filesToDelete.push(f)
        }
        if (filesToDelete.length > 0) {
          await supabase.storage.from('embroidery-files').remove(filesToDelete)
        }
        await supabase.from('embroidery').delete().eq('id', motif.id)
      }
    }
    await supabase.from('embroidery_bundles').delete().eq('id', bundleId)
    setDeleteBundleId(null)
    setCurrentBundle(null)
    setView('gallery')
    load()
  }

  async function removeMotifFromBundle(motifId: string) {
    const item = items.find(i => i.id === motifId)
    if (!item) return
    const newData = { ...item.data }
    delete newData.bundleId
    await supabase.from('embroidery').update({ data: newData }).eq('id', motifId)
    load()
  }

  async function createBundleFromSelection(bundleName: string) {
    const selected = items.filter(i => selectedIds.has(i.id))
    if (selected.length === 0) return
    const firstCover = selected[0]?.data.coverImage || ''
    const bundleData: EmbroideryBundleData = {
      navn: bundleName,
      designer: '',
      kategori: '',
      coverImage: firstCover,
      customImage: '',
      useCustomImage: false,
      notater: '',
    }
    const { data: bundleRows, error: bundleErr } = await supabase
      .from('embroidery_bundles')
      .insert({ data: bundleData })
      .select()
    if (bundleErr || !bundleRows?.[0]) return
    const bundle = bundleRows[0] as EmbroideryBundle
    for (const motif of selected) {
      await supabase
        .from('embroidery')
        .update({ data: { ...motif.data, bundleId: bundle.id } })
        .eq('id', motif.id)
    }
    setSelectionMode(false)
    setSelectedIds(new Set())
    setShowCreateBundle(false)
    load()
    setUploadSummary(`Bundle «${bundleName}» opprettet med ${selected.length} motiver`)
  }

  function handleUploadDone(_results: Embroidery[], summary: string) {
    setShowUpload(false)
    load()
    if (summary) setUploadSummary(summary)
  }

  function openBundle(bundle: EmbroideryBundle) {
    setCurrentBundle(bundle)
    setView('bundle')
  }

  function openMotifFromGallery(item: Embroidery) {
    setCurrentItem(item)
    setPrevView('gallery')
    setView('motif')
  }

  function openMotifFromBundle(item: Embroidery) {
    setCurrentItem(item)
    setPrevView('bundle')
    setView('motif')
  }

  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const galleryItems = useMemo((): GalleryItem[] => {
    const looseMotifs = items
      .filter(i => !i.data.bundleId)
      .map(i => ({ type: 'motif' as const, item: i }))

    const bundleItems = bundles.map(b => ({
      type: 'bundle' as const,
      bundle: b,
      motifCount: items.filter(i => i.data.bundleId === b.id).length,
    }))

    const combined: GalleryItem[] = [...bundleItems, ...looseMotifs]

    return combined
      .filter(gi => {
        if (katFilter !== 'Alle') {
          const kat = gi.type === 'bundle' ? gi.bundle.data.kategori : gi.item.data.kategori
          if (kat !== katFilter) return false
        }
        if (!search.trim()) return true
        const q = search.toLowerCase()
        if (gi.type === 'bundle') {
          const bundleMatch = gi.bundle.data.navn.toLowerCase().includes(q)
          const motifMatch = items
            .filter(i => i.data.bundleId === gi.bundle.id)
            .some(i => i.data.navn.toLowerCase().includes(q) || i.data.designer.toLowerCase().includes(q))
          return bundleMatch || motifMatch
        }
        return (
          gi.item.data.navn.toLowerCase().includes(q) ||
          gi.item.data.designer.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const aDate = a.type === 'bundle' ? a.bundle.created_at : a.item.created_at
        const bDate = b.type === 'bundle' ? b.bundle.created_at : b.item.created_at
        const aName = a.type === 'bundle' ? a.bundle.data.navn : a.item.data.navn
        const bName = b.type === 'bundle' ? b.bundle.data.navn : b.item.data.navn
        if (sort === 'name') return aName.localeCompare(bName, 'nb')
        if (sort === 'oldest') return new Date(aDate).getTime() - new Date(bDate).getTime()
        return new Date(bDate).getTime() - new Date(aDate).getTime()
      })
  }, [items, bundles, search, katFilter, sort])

  const bundleMotifs = useMemo(
    () => currentBundle ? items.filter(i => i.data.bundleId === currentBundle.id) : [],
    [items, currentBundle]
  )

  // ── Bundle detail view ───────────────────────────────────────────────────────

  if (view === 'bundle' && currentBundle) {
    return (
      <>
        <BundleDetail
          bundle={currentBundle}
          motifs={bundleMotifs}
          onBack={() => { setCurrentBundle(null); setView('gallery') }}
          onSaved={() => load()}
          onDelete={() => setDeleteBundleId(currentBundle.id)}
          onMotifClick={openMotifFromBundle}
          onRemoveMotif={removeMotifFromBundle}
        />
        {deleteBundleId && (
          <BundleDeleteDialog
            bundleName={currentBundle.data.navn}
            onConfirm={(detachOnly) => deleteBundle(deleteBundleId, detachOnly)}
            onCancel={() => setDeleteBundleId(null)}
          />
        )}
      </>
    )
  }

  // ── Motif detail view ────────────────────────────────────────────────────────

  if (view === 'motif' && currentItem) {
    return (
      <>
        <EmbroideryDetail
          item={currentItem}
          onBack={() => {
            if (prevView === 'bundle' && currentBundle) {
              setView('bundle')
            } else {
              setCurrentItem(null)
              setView('gallery')
              load()
            }
          }}
          onSaved={() => load()}
          onDelete={() => setDeleteId(currentItem.id)}
        />
        {deleteId && (
          <DeleteDialog
            onConfirm={() => deleteItem(deleteId)}
            onCancel={() => setDeleteId(null)}
          />
        )}
      </>
    )
  }

  // ── Gallery view ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Search + filters */}
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 mb-0 space-y-3 overflow-hidden">
        <div className="relative w-full min-w-0">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Søk i broderi…"
            className="w-full min-w-0 pl-9 pr-4 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Category filter */}
          <div className="relative" ref={katDropdownRef}>
            <button
              onClick={() => setKatDropdownOpen(o => !o)}
              className={`relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors ${
                katFilter !== 'Alle'
                  ? 'bg-stone-100 text-stone-800 border-stone-300'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
              title="Filter"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {katFilter !== 'Alle' && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#C9A57A] rounded-full" />
              )}
            </button>
            {katDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-20 min-w-[160px] py-1">
                <button
                  onClick={() => { setKatFilter('Alle'); setKatDropdownOpen(false) }}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${katFilter === 'Alle' ? 'text-stone-800 font-medium' : 'text-stone-600'}`}
                >
                  Alle
                </button>
                {KATEGORIER.map(k => (
                  <button
                    key={k}
                    onClick={() => { setKatFilter(k); setKatDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${katFilter === k ? 'text-stone-800 font-medium bg-stone-50' : 'text-stone-600'}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sort */}
          <div className="relative" ref={sortDropdownRef}>
            <button
              onClick={() => setSortDropdownOpen(o => !o)}
              className={`relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors ${
                sort !== 'newest'
                  ? 'bg-stone-100 text-stone-800 border-stone-300'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
              title="Sortering"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 7h18M6 12h12M9 17h6" />
              </svg>
              {sort !== 'newest' && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-stone-600 rounded-full" />
              )}
            </button>
            {sortDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-20 min-w-[160px] py-1">
                {([['newest', 'Nyeste'], ['oldest', 'Eldste'], ['name', 'Navn A-Å']] as [SortOrder, string][]).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => { setSort(v); setSortDropdownOpen(false) }}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${sort === v ? 'text-stone-800 font-medium bg-stone-50' : 'text-stone-600'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selection mode toggle */}
          {(items.filter(i => !i.data.bundleId).length > 0) && (
            <button
              onClick={() => {
                if (selectionMode) {
                  setSelectionMode(false)
                  setSelectedIds(new Set())
                } else {
                  setSelectionMode(true)
                }
              }}
              className={`h-9 px-3 flex items-center gap-1.5 rounded-xl border text-sm transition-colors ${
                selectionMode
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
            >
              {selectionMode ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Avbryt
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  Velg motiver
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 pb-24 overflow-x-hidden">
        {loading ? (
          <div className="flex justify-center py-32">
            <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
          </div>
        ) : galleryItems.length === 0 ? (
          <div className="text-center py-28">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-stone-100 mb-6">
              <svg className="w-8 h-8 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                  d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
              </svg>
            </div>
            <p className="font-serif text-2xl text-stone-400 font-light">
              {items.length === 0 && bundles.length === 0 ? 'Ingen broderi ennå.' : 'Ingen treff'}
            </p>
            {items.length === 0 && bundles.length === 0 && (
              <button
                onClick={() => setShowUpload(true)}
                className="mt-5 px-6 py-2.5 bg-[#C9A57A] text-white text-sm rounded-xl hover:bg-[#b8925f] transition-colors font-medium"
              >
                Last opp første broderi
              </button>
            )}
          </div>
        ) : (
          <div className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5 overflow-hidden">
            {galleryItems.map(gi => {
              if (gi.type === 'bundle') {
                return (
                  <BundleCard
                    key={`bundle-${gi.bundle.id}`}
                    bundle={gi.bundle}
                    motifCount={gi.motifCount}
                    onClick={() => openBundle(gi.bundle)}
                  />
                )
              }
              return (
                <EmbroideryCard
                  key={gi.item.id}
                  item={gi.item}
                  onEdit={() => openMotifFromGallery(gi.item)}
                  onDelete={() => setDeleteId(gi.item.id)}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(gi.item.id)}
                  onToggleSelect={() => toggleSelection(gi.item.id)}
                />
              )
            })}
          </div>
        )}
      </main>

      {/* Selection mode floating bar */}
      {selectionMode && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-stone-800 text-white text-sm rounded-2xl shadow-xl">
          <span className="text-stone-300">
            {selectedIds.size} {selectedIds.size === 1 ? 'valgt' : 'valgte'}
          </span>
          <button
            onClick={() => { if (selectedIds.size > 0) setShowCreateBundle(true) }}
            disabled={selectedIds.size === 0}
            className="px-4 py-1.5 bg-[#C9A57A] text-white rounded-xl text-sm font-medium hover:bg-[#b8925f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Lag bundle
          </button>
        </div>
      )}

      {showUpload && (
        <UploadModal onDone={handleUploadDone} onClose={() => setShowUpload(false)} />
      )}

      {deleteId && (
        <DeleteDialog
          onConfirm={() => deleteItem(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {deleteBundleId && (() => {
        const b = bundles.find(x => x.id === deleteBundleId)
        if (!b) return null
        return (
          <BundleDeleteDialog
            bundleName={b.data.navn}
            onConfirm={(detachOnly) => deleteBundle(deleteBundleId, detachOnly)}
            onCancel={() => setDeleteBundleId(null)}
          />
        )
      })()}

      {showCreateBundle && (
        <CreateBundleModal
          motifCount={selectedIds.size}
          onConfirm={createBundleFromSelection}
          onCancel={() => setShowCreateBundle(false)}
        />
      )}

      {/* Upload summary toast */}
      {uploadSummary && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 px-5 py-3 bg-stone-800 text-white text-sm rounded-2xl shadow-xl flex items-center gap-3 max-w-xs text-center">
          <span>{uploadSummary}</span>
          <button onClick={() => setUploadSummary(null)} className="text-stone-400 hover:text-white transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* FAB */}
      {!selectionMode && (
        <button
          onClick={() => setShowUpload(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-[#C9A57A] text-white rounded-full shadow-lg hover:bg-[#b8925f] transition-all flex items-center justify-center cursor-pointer z-30"
          aria-label="Last opp broderi"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}
    </>
  )
}
