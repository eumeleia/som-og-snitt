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
  kategori: string        // legacy single-category field (read only for backward compat)
  kategorier?: string[]   // new multi-category field
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
  kategori: string        // legacy
  kategorier?: string[]   // new multi-category field
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

const KATEGORIER = [
  'Frukt', 'Bær', 'Dyr', 'Blomster', 'Natur', 'Rosemaling',
  'Høytider', 'Rammer', 'Figurer', 'Bunad', 'Baby', 'Bokstaver', 'Monogram', 'Annet',
]

// Returns the categories for a motif/bundle, handling both old string and new array format
function getKats(data: EmbroideryData | EmbroideryBundleData): string[] {
  if (data.kategorier && data.kategorier.length > 0) return data.kategorier
  if (data.kategori) return [data.kategori]
  return []
}

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
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

const SIZE_WORDS_ORDERED = ['smallest', 'small', 'medium', 'large', 'largest']
const SIZE_ABBREVS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl']

function isSizeFolder(s: string): boolean {
  const lower = s.toLowerCase()
  if (SIZE_WORDS_ORDERED.includes(lower)) return true
  if (SIZE_ABBREVS.includes(lower)) return true
  if (/^\d+x\d+$/i.test(s)) return true
  return false
}

function sizeOrder(label: string): number {
  const lower = label.toLowerCase()
  const wordIdx = SIZE_WORDS_ORDERED.indexOf(lower)
  if (wordIdx >= 0) return wordIdx
  const abbrevIdx = SIZE_ABBREVS.indexOf(lower)
  if (abbrevIdx >= 0) return abbrevIdx + 10
  const sizeNum = lower.match(/^size(\d+)$/)
  if (sizeNum) return 20 + parseInt(sizeNum[1])
  const pureNum = lower.match(/^\d+$/)
  if (pureNum) return 30 + parseInt(lower)
  if (lower === 'standard') return 3
  // inch labels e.g. 2", 2.5"
  const inchLbl = lower.match(/^(\d+(?:\.\d+)?)"$/)
  if (inchLbl) return 40 + parseFloat(inchLbl[1])
  // metric labels e.g. 10cm, 15mm
  const cmLbl = lower.match(/^(\d+(?:\.\d+)?)cm$/)
  if (cmLbl) return 50 + parseFloat(cmLbl[1])
  const mmLbl = lower.match(/^(\d+(?:\.\d+)?)mm$/)
  if (mmLbl) return 55 + parseFloat(mmLbl[1])
  return 99
}

// Sort bundle motifs: paired by letter (A stor, a liten, B stor, b liten…), numbers last.
function sortBundleMotifs(motifs: Embroidery[]): Embroidery[] {
  return [...motifs].sort((a, b) => {
    const aName = a.data.navn || ''
    const bName = b.data.navn || ''
    const charA = aName.replace(/ \(.*?\)$/, '').trim()
    const charB = bName.replace(/ \(.*?\)$/, '').trim()
    const isNumA = /^\d+$/.test(charA)
    const isNumB = /^\d+$/.test(charB)
    if (isNumA && !isNumB) return 1
    if (!isNumA && isNumB) return -1
    if (isNumA && isNumB) return parseInt(charA) - parseInt(charB)
    const letterCmp = charA.localeCompare(charB, 'nb', { sensitivity: 'base' })
    if (letterCmp !== 0) return letterCmp
    const rankA = / \(stor\)$/.test(aName) ? 0 : / \(liten\)$/.test(aName) ? 1 : 2
    const rankB = / \(stor\)$/.test(bName) ? 0 : / \(liten\)$/.test(bName) ? 1 : 2
    return rankA - rankB
  })
}

// Sort sizes smallest-to-largest at render time (does not mutate state).
// Priority: (1) physical area when both have mm data, (2) sizeOrder label heuristic, (3) alphabetical.
function sortedSizes(sizes: EmbroiderySize[]): EmbroiderySize[] {
  return [...sizes].sort((a, b) => {
    const aArea = (a.widthMm && a.heightMm) ? a.widthMm * a.heightMm : null
    const bArea = (b.widthMm && b.heightMm) ? b.widthMm * b.heightMm : null
    if (aArea !== null && bArea !== null) return aArea - bArea
    const aOrd = sizeOrder(a.sizeLabel)
    const bOrd = sizeOrder(b.sizeLabel)
    if (aOrd !== bOrd) return aOrd - bOrd
    return a.sizeLabel.localeCompare(b.sizeLabel, 'nb')
  })
}

// Adds "(stor)"/"(liten)" to single-letter names so uppercase A and lowercase a
// are visually distinct on small gallery cards.
function displayMotifName(navn: string): string {
  if (/^[A-ZÆØÅ]$/.test(navn)) return `${navn} (stor)`
  if (/^[a-zæøå]$/.test(navn)) return `${navn} (liten)`
  return navn
}

function normaliseSizeLabel(raw: string): string {
  const lower = raw.toLowerCase()
  if (SIZE_WORDS_ORDERED.includes(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1)
  if (SIZE_ABBREVS.includes(lower)) return raw.toUpperCase()
  return raw
}

// Returns 'capital' | 'small' | 'numbers' | null based on which category folder appears in a path.
// Used to prevent cross-category image matching (e.g. CAPITAL/A.PNG matching motif 'a (liten)').
function pathCategory(p: string): string | null {
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (/^(capitals?|uppercase)$/i.test(seg)) return 'capital'
    if (/^(small|lowercase)$/i.test(seg)) return 'small'
    if (/^(numbers?|tall)$/i.test(seg)) return 'numbers'
  }
  return null
}

function parsePesPath(relativePath: string): { motifName: string; sizeLabel: string } {
  const parts = relativePath.replace(/\\/g, '/').split('/')
  const filename = parts[parts.length - 1]
  const nameNoExt = filename.replace(/\.pes$/i, '')

  // ── SIZES X / "Size X and Y" intermediate folder (alphabet packs)
  // Matches: "SIZES 2.5", "Size 1.5 and 2", "SIZES 3.5 and 4", etc.
  // Trust CAPITAL/SMALL/NUMBERS folder for char-type, not filename case —
  // e.g. "A.PES" under SMALL becomes "a (liten)", misfiled "w.PES" under CAPITAL → "w (stor)".
  const SIZES_RE = /^sizes?\s+(\d+(?:\.\d+)?)(?:\s+and\s+(\d+(?:\.\d+)?))?$/i
  const sizesIdx = parts.findIndex(p => SIZES_RE.test(p))
  if (sizesIdx >= 0) {
    const sm = parts[sizesIdx].match(SIZES_RE)!
    const sizeLabel = sm[2] ? `${sm[1]}-${sm[2]}"` : `${sm[1]}"`
    let suffix = ''
    for (const part of parts) {
      if (/^(capitals?|uppercase)$/i.test(part)) { suffix = ' (stor)'; break }
      if (/^(small|lowercase)$/i.test(part)) { suffix = ' (liten)'; break }
      if (/^(numbers?|tall)$/i.test(part)) break
    }
    const letter = suffix === ' (liten)' ? nameNoExt.toLowerCase() : nameNoExt
    return { motifName: `${letter}${suffix}`, sizeLabel }
  }

  // ── Inch/metric size FOLDER — use the motif folder name directly, ignore filename
  // Pattern: <pack>/<motif>/<Xin|Xinch|Xcm|Xmm>/<file.PES>
  // e.g. IN HOA/A/2in/A_2in.PES or IN HOA/B/3in/B3in.PES → motif="A"/"B", size=2"/3"
  // Takes priority over filename parsing because filenames in such packs are inconsistent.
  if (parts.length >= 3) {
    const sf2 = parts[parts.length - 2]
    const mf2 = parts[parts.length - 3]
    const inchCmM = sf2.match(/^(\d+(?:\.\d+)?)\s*(in(?:ch(?:es)?)?|cm|mm)$/i)
    if (inchCmM && mf2 && !/^\d+$/.test(mf2)) {
      const num = inchCmM[1]
      const unit = inchCmM[2].toLowerCase()
      const sizeLabel = unit.startsWith('in') ? `${num}"` : `${num}${unit}`
      return { motifName: splitCamelCase(mf2).trim(), sizeLabel }
    }
  }

  // ── Folder-structure heuristic (e.g. 6 Summer Bouquets/1/medium/Design1 medium.PES)
  if (parts.length >= 3) {
    const sizeFolder = parts[parts.length - 2]
    const motifFolder = parts[parts.length - 3]
    if (isSizeFolder(sizeFolder)) {
      const sizeLabel = normaliseSizeLabel(sizeFolder)
      let motifName: string
      // motifFolder is a bare number → derive name from filename
      if (/^\d+$/.test(motifFolder)) {
        const sizeLower = sizeFolder.toLowerCase()
        const stripped = nameNoExt.replace(new RegExp('[\\s_]' + sizeLower + '$', 'i'), '').trim()
        motifName = stripped ? splitCamelCase(stripped) : `Design ${motifFolder}`
      } else {
        // Derive motif name from filename (strip pack-name prefix and size suffix) so that
        // Pack/4x4/A.pes and Pack/4x4/a.pes become separate motifs "A" and "a" instead
        // of both collapsing to the pack name.
        const sfEsc = sizeFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const packRegex = motifFolder.split(/\s+/).filter(Boolean)
          .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[\\s_-]*')
        const fileBase = nameNoExt
          .replace(new RegExp('[\\s_-]+' + sfEsc + '$', 'i'), '')   // strip size from end
          .replace(new RegExp('^' + packRegex + '[\\s_-]*', 'i'), '') // strip pack from start
          .replace(/^[\s_-]+|[\s_-]+$/g, '')                          // trim separators
          .trim()
        motifName = splitCamelCase(fileBase || motifFolder)
      }
      return { motifName: motifName.trim(), sizeLabel }
    }
  }

  // ── General subfolder: parent folder = motif, filename remainder = size hint
  // Fires when the file is in a subfolder that is not a recognised size/alphabet folder.
  // e.g. Flowers/Aster/Aster_1.54x2.77in.PES → motif="Aster", size="1.54x2.77""
  // e.g. Pack/Rose/Rose_Medium.PES → motif="Rose", size="Medium"
  if (parts.length >= 3) {
    const parentFolder = parts[parts.length - 2]
    const motifName = splitCamelCase(parentFolder).trim()
    const escapedParent = parentFolder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rest = nameNoExt.replace(new RegExp('^' + escapedParent + '[\\s_-]*', 'i'), '').trim()
    // WxH dimension: 1.54x2.77in, 5x7, 3x5cm
    const dimM = rest.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(in(?:ch(?:es)?)?|cm|mm)?$/i)
    if (dimM) {
      const unit = (dimM[3] || '').toLowerCase()
      const sz = unit.startsWith('in') || !unit ? `${dimM[1]}x${dimM[2]}"` : `${dimM[1]}x${dimM[2]}${unit}`
      return { motifName, sizeLabel: sz }
    }
    const inM = rest.match(/^(\d+(?:\.\d+)?)\s*(in(?:ch(?:es)?)?|")$/i)
    if (inM) return { motifName, sizeLabel: `${inM[1]}"` }
    const metM = rest.match(/^(\d+(?:\.\d+)?)\s*(cm|mm)$/i)
    if (metM) return { motifName, sizeLabel: `${metM[1]}${metM[2].toLowerCase()}` }
    for (const sw of SIZE_WORDS_ORDERED) {
      if (rest.toLowerCase() === sw) return { motifName, sizeLabel: normaliseSizeLabel(sw) }
    }
    const snM = rest.match(/^size(\d+)$/i)
    if (snM) return { motifName, sizeLabel: `Size${snM[1]}` }
    if (/^\d+$/.test(rest)) return { motifName, sizeLabel: rest }
    return { motifName, sizeLabel: rest || 'Standard' }
  }

  // ── Flat file: motif = full filename (no merging by name similarity).
  // Size label extracted from filename for display (loose-mode) only — never affects grouping.
  const flatMotifName = splitCamelCase(nameNoExt).trim()

  const sizeN = nameNoExt.match(/^(.+?)(Size\d+)$/i)
  if (sizeN) return { motifName: flatMotifName, sizeLabel: sizeN[2] }

  const nxn = nameNoExt.match(/^(.+?)(\d+x\d+)$/i)
  if (nxn) return { motifName: flatMotifName, sizeLabel: nxn[2] }

  const inchMatch = nameNoExt.match(/^(.+?)[ _](\d+(?:\.\d+)?)[ _]*(inc\w*|in(?![a-z])|")$/i)
  if (inchMatch) return { motifName: flatMotifName, sizeLabel: `${inchMatch[2]}"` }

  const metricMatch = nameNoExt.match(/^(.+?)[ _](\d+(?:\.\d+)?)[ _]*(cm|mm)$/i)
  if (metricMatch) return { motifName: flatMotifName, sizeLabel: `${metricMatch[2]}${metricMatch[3].toLowerCase()}` }

  const sml = nameNoExt.match(/^(.+?)[ _]([SML]|X[SL]|XXL|XXS)$/i)
  if (sml) return { motifName: flatMotifName, sizeLabel: sml[2].toUpperCase() }

  for (const sw of SIZE_WORDS_ORDERED) {
    if (nameNoExt.match(new RegExp(`^(.+?)[ _]${sw}$`, 'i')))
      return { motifName: flatMotifName, sizeLabel: normaliseSizeLabel(sw) }
  }

  return { motifName: flatMotifName, sizeLabel: 'Standard' }
}

// ── PES rendering helpers ──────────────────────────────────────────────────────

interface RenderResult {
  png_base64: string
  width_mm?: number
  height_mm?: number
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

async function renderPesPreview(pesData: Uint8Array): Promise<RenderResult | null> {
  try {
    const b64 = uint8ToBase64(pesData)
    const res = await fetch('/api/render-pes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pes_data: b64 }),
    })
    if (!res.ok) return null
    const result = await res.json()
    if (result.error || !result.png_base64) return null
    return result as RenderResult
  } catch {
    return null
  }
}

async function fetchPesBounds(pesData: Uint8Array): Promise<{ widthMm: number; heightMm: number } | null> {
  try {
    const b64 = uint8ToBase64(pesData)
    const res = await fetch('/api/render-pes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pes_data: b64, bounds_only: true }),
    })
    if (!res.ok) return null
    const result = await res.json()
    if (result.width_mm && result.height_mm) {
      return { widthMm: result.width_mm, heightMm: result.height_mm }
    }
    return null
  } catch {
    return null
  }
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

function DeleteDialog({ onConfirm, onCancel }: { onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [isDeleting, setIsDeleting] = useState(false)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
        <p className="text-stone-700 font-medium mb-1">Slett broderi?</p>
        <p className="text-stone-400 text-sm mb-6">Dette kan ikke angres. Alle tilhørende filer slettes.</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
          >
            Avbryt
          </button>
          <button
            onClick={async () => { setIsDeleting(true); await onConfirm() }}
            disabled={isDeleting}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-1.5"
          >
            {isDeleting ? <><Spinner /> Sletter…</> : 'Slett'}
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
  onConfirm: (detachOnly: boolean) => Promise<void>
  onCancel: () => void
}) {
  const [detachOnly, setDetachOnly] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)

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
              disabled={isDeleting}
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
              disabled={isDeleting}
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
            disabled={isDeleting}
            className="flex-1 py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
          >
            Avbryt
          </button>
          <button
            onClick={async () => { setIsDeleting(true); await onConfirm(detachOnly) }}
            disabled={isDeleting}
            className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-1.5"
          >
            {isDeleting ? <><Spinner /> Sletter…</> : 'Slett bundle'}
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

// ── Merge Bundles Modal ────────────────────────────────────────────────────────

function MergeBundlesModal({
  suggestedName,
  bundleCount,
  onConfirm,
  onCancel,
}: {
  suggestedName?: string
  bundleCount: number
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(suggestedName || '')

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="font-serif text-xl text-stone-700 mb-1">Slå sammen bundles</h2>
        <p className="text-stone-400 text-sm mb-5">
          {bundleCount} bundles og alle motivene deres samles til én flat bundle.
        </p>
        <div className="mb-5">
          <label className="block text-xs text-stone-500 mb-1">Navn på sammenslått bundle</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()) }}
            placeholder="F.eks. BX Floral Alphabet"
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
            Slå sammen
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Kategori Editor ────────────────────────────────────────────────────────────

function KategoriEditor({ kategorier, onChange }: {
  kategorier: string[]
  onChange: (ks: string[]) => void
}) {
  const [customInput, setCustomInput] = useState('')

  function toggle(k: string) {
    onChange(kategorier.includes(k) ? kategorier.filter(x => x !== k) : [...kategorier, k])
  }

  function addCustom() {
    const trimmed = customInput.trim()
    if (trimmed && !kategorier.includes(trimmed)) onChange([...kategorier, trimmed])
    setCustomInput('')
  }

  const customKats = kategorier.filter(k => !KATEGORIER.includes(k))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {KATEGORIER.map(k => (
          <button key={k} type="button" onClick={() => toggle(k)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              kategorier.includes(k)
                ? 'bg-stone-800 text-white border-stone-800'
                : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
            }`}>
            {k}
          </button>
        ))}
      </div>
      {customKats.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {customKats.map(k => (
            <span key={k} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1 bg-stone-100 text-stone-700 rounded-lg text-xs border border-stone-200">
              {k}
              <button type="button" onClick={() => onChange(kategorier.filter(x => x !== k))}
                className="hover:text-red-400 transition-colors">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          placeholder="Legg til egen kategori…"
          className="flex-1 px-3 py-1.5 border border-stone-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-stone-200"
        />
        <button type="button" onClick={addCustom} disabled={!customInput.trim()}
          className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg hover:bg-stone-50 text-stone-600 transition-colors disabled:opacity-40">
          Legg til
        </button>
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
  const [dragOver, setDragOver] = useState(false)
  const zipRef = useRef<HTMLInputElement>(null)
  const pesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (folderRef.current) folderRef.current.setAttribute('webkitdirectory', '')
  }, [])

  async function handleFiles(files: File[]) {
    setUploading(true)
    setError(null)
    try {
      type PesEntry = { name: string; path: string; getData: () => Promise<Uint8Array> }
      type ImgEntry = { name: string; path: string; ext: string; getData: () => Promise<Uint8Array> }

      function fileBytes(file: File): Promise<Uint8Array> {
        return file.arrayBuffer().then(b => new Uint8Array(b))
      }

      const results: Embroidery[] = []
      let failedFiles = 0

      async function processBatch(
        pesFiles: PesEntry[],
        imageFiles: ImgEntry[],
        batchName: string
      ) {
        if (pesFiles.length === 0) return
        const zipBundleName = bundleName.trim() || batchName

        const motifMap = new Map<string, { sizeLabel: string; pesFile: PesEntry }[]>()

        if (uploadMode === 'loose') {
          // All PES files in this batch belong to ONE motif — the user said so.
          // Use the batch name as the motif name; derive a per-file size label
          // from the filename heuristic (falls back to a running counter).
          const looseName = batchName.trim()
          const sizes: { sizeLabel: string; pesFile: PesEntry }[] = []
          let counter = 1
          for (const pf of pesFiles) {
            const { sizeLabel: guessed } = parsePesPath(pf.path)
            // Only use the guessed label if it looks like a real size (not fallback 'Standard')
            const sizeLabel = guessed === 'Standard'
              ? (pesFiles.length === 1 ? 'Standard' : String(counter))
              : guessed
            counter++
            sizes.push({ sizeLabel, pesFile: pf })
          }
          sizes.sort((a, b) => sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel))
          if (sizes.length > 0) motifMap.set(looseName, sizes)
        } else {
          // Bundle mode: group by motif name derived from path/filename (existing logic)
          let dbgCount = 0
          for (const pf of pesFiles) {
            const parsed = parsePesPath(pf.path)
            if (dbgCount < 5) {
              console.log('[Embroidery] parsePesPath input:', pf.path)
              console.log('[Embroidery] parsePesPath result:', parsed.motifName, parsed.sizeLabel)
              dbgCount++
            }
            const { motifName, sizeLabel } = parsed
            if (!motifMap.has(motifName)) motifMap.set(motifName, [])
            motifMap.get(motifName)!.push({ sizeLabel, pesFile: pf })
          }
          for (const sizes of motifMap.values()) {
            sizes.sort((a, b) => sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel))
          }
        }

        let motifIdx = 0
        const totalMotifs = motifMap.size
        const batchResults: Embroidery[] = []

        for (const [motifName, sizes] of motifMap) {
          motifIdx++
          setProgress(`Laster opp ${motifName} (${motifIdx}/${totalMotifs})…`)

          const embSizes: EmbroiderySize[] = []
          // Keep raw PES bytes for the representative size so we can render if no BMP
          const pesDataCache = new Map<string, Uint8Array>()

          for (const { sizeLabel, pesFile } of sizes) {
            const pesData = await pesFile.getData()
            pesDataCache.set(sizeLabel, pesData)
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
            let widthMm: number | undefined
            let heightMm: number | undefined
            try {
              const bounds = await fetchPesBounds(pesData)
              if (bounds) { widthMm = bounds.widthMm; heightMm = bounds.heightMm }
            } catch { /* ignore per-file failure */ }
            embSizes.push({ id: uid(), sizeLabel, pesUrl: urlData.publicUrl, pesFilename: pesFile.name, widthMm, heightMm })
          }

          if (embSizes.length === 0) {
            console.warn('[Embroidery] Ingen PES-filer ble lastet opp for motiv', motifName)
            continue
          }

          let coverImage = ''
          let bmpPreview = ''

          // Bare letter/char from motif name — strip " (stor)" / " (liten)" suffix for filename comparison
          const motifChar = motifName.replace(/ \(.*?\)$/, '').trim().toLowerCase().replace(/\s+/g, '')
          // Category folder of this motif's PES files — used to restrict image matching to same folder
          const motifCat = pathCategory(sizes[0]?.pesFile.path || '')

          // Find matching image file: .jpg/.jpeg/.png/.bmp
          // If PES files are in a category folder (CAPITAL/SMALL/NUMBERS), the image must be too.
          // This prevents CAPITAL/A.PNG from being used as cover for motif 'a (liten)'.
          const matchedImg = imageFiles.find(img => {
            if (motifCat && pathCategory(img.path) !== motifCat) return false
            const imgNameLower = img.name.toLowerCase()
              .replace(/\.(bmp|jpg|jpeg|png)$/i, '')
              .replace(/\s+/g, '')
            if (imgNameLower === motifChar) return true
            if (imgNameLower.startsWith(motifChar) && motifChar.length > 0) return true
            const firstPes = sizes[0]?.pesFile.name.replace(/\.pes$/i, '').toLowerCase().replace(/\s+/g, '')
            if (firstPes && imgNameLower === firstPes) return true
            return false
          })

          if (matchedImg) {
            console.log('[Embroidery] Cover for motiv', motifName, 'hentet fra', matchedImg.path)
            const imgData = await matchedImg.getData()
            let imgBlob: Blob | null = null
            let uploadFilename = ''

            if (matchedImg.ext === 'bmp') {
              const dataUrl = await bmpToDataUrl(imgData as Uint8Array<ArrayBuffer>)
              if (dataUrl) {
                const res2 = await fetch(dataUrl)
                imgBlob = await res2.blob()
                uploadFilename = `embroidery-bmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
              }
            } else {
              const mime = matchedImg.ext === 'png' ? 'image/png' : 'image/jpeg'
              imgBlob = new Blob([imgData.buffer as ArrayBuffer], { type: mime })
              const outExt = matchedImg.ext === 'jpeg' ? 'jpg' : matchedImg.ext
              uploadFilename = `embroidery-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${outExt}`
            }

            if (imgBlob) {
              const { error: imgErr } = await supabase.storage
                .from('embroidery-files')
                .upload(uploadFilename, imgBlob, { contentType: imgBlob.type })
              if (!imgErr) {
                const { data: imgUrlData } = supabase.storage.from('embroidery-files').getPublicUrl(uploadFilename)
                coverImage = imgUrlData.publicUrl
                bmpPreview = imgUrlData.publicUrl
              }
            }
          } else {
            // PES rendering path — pick the representative (middle) size
            const repIdx = Math.floor(sizes.length / 2)
            const repSize = sizes[repIdx]
            console.log('[Embroidery] Cover for motiv', motifName, 'hentet fra', repSize.pesFile.name)
            const repPesData = pesDataCache.get(repSize.sizeLabel)
            if (repPesData) {
              setProgress(`Rendrer forhåndsvisning for ${motifName}…`)
              try {
                const renderResult = await renderPesPreview(repPesData)
                if (renderResult?.png_base64) {
                  const pngBlob = base64ToBlob(renderResult.png_base64, 'image/png')
                  const pngFilename = `embroidery-rendered-${Date.now()}-${uid()}.png`
                  const { error: renderErr } = await supabase.storage
                    .from('embroidery-files')
                    .upload(pngFilename, pngBlob, { contentType: 'image/png' })
                  if (!renderErr) {
                    const { data: renderUrl } = supabase.storage.from('embroidery-files').getPublicUrl(pngFilename)
                    coverImage = renderUrl.publicUrl
                    bmpPreview = renderUrl.publicUrl
                  }
                }
              } catch (renderErr) {
                console.warn('[Embroidery] PES rendering feilet for', motifName, renderErr)
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
            batchResults.push(rows[0] as Embroidery)
          }
        }

        // If bundle mode: create bundle and link motifs
        if (uploadMode === 'bundle' && batchResults.length > 0) {
          setProgress(`Oppretter bundle «${zipBundleName}»…`)
          const firstCover = batchResults[0]?.data.coverImage || ''
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
            for (const motif of batchResults) {
              await supabase
                .from('embroidery')
                .update({ data: { ...motif.data, bundleId: bundle.id } })
                .eq('id', motif.id)
            }
          }
        }

        results.push(...batchResults)
      }

      // Separate files by type
      const zipFiles = files.filter(f => /\.zip$/i.test(f.name))
      const pesRawFiles = files.filter(f => /\.pes$/i.test(f.name))
      const imgRawFiles = files.filter(f => /\.(bmp|jpg|jpeg|png)$/i.test(f.name))

      // Process each ZIP file
      const JSZip = (await import('jszip')).default
      for (const zipFile of zipFiles) {
        setProgress(`Pakker ut ${zipFile.name}…`)
        const zip = await JSZip.loadAsync(zipFile)

        const zipPes: { name: string; path: string; getData: () => Promise<Uint8Array> }[] = []
        const zipImg: { name: string; path: string; ext: string; getData: () => Promise<Uint8Array> }[] = []

        // JSZip reads entry names directly from ZIP binary headers — original case is preserved.
        zip.forEach((relativePath, zipEntry) => {
          if (zipEntry.dir) return
          const lower = relativePath.toLowerCase()
          const name = relativePath.split('/').pop() ?? relativePath
          if (lower.endsWith('.pes')) {
            zipPes.push({ name, path: relativePath, getData: () => zipEntry.async('uint8array') })
          } else if (/\.(bmp|jpg|jpeg|png)$/.test(lower)) {
            const ext = lower.split('.').pop()!
            zipImg.push({ name, path: relativePath, ext, getData: () => zipEntry.async('uint8array') })
          }
        })

        const batchName = bundleName.trim() ||
          zipFile.name.replace(/\.zip$/i, '').replace(/[-_]/g, ' ')
        await processBatch(zipPes, zipImg, batchName)
      }

      // Process loose PES files
      if (pesRawFiles.length > 0) {
        const pesBatch: { name: string; path: string; getData: () => Promise<Uint8Array> }[] =
          pesRawFiles.map(f => ({
            name: f.name,
            path: f.webkitRelativePath || f.name,
            getData: () => fileBytes(f),
          }))
        const imgBatch: { name: string; path: string; ext: string; getData: () => Promise<Uint8Array> }[] =
          imgRawFiles.map(f => {
            const ext = f.name.toLowerCase().split('.').pop()!
            return {
              name: f.name,
              path: f.webkitRelativePath || f.name,
              ext,
              getData: () => fileBytes(f),
            }
          })
        const firstRelative = pesRawFiles[0].webkitRelativePath
        const looseDefaultName = firstRelative
          ? firstRelative.split('/')[0]
          : pesRawFiles[0].name.replace(/\.pes$/i, '')
        const looseBatchName = bundleName.trim() || looseDefaultName
        await processBatch(pesBatch, imgBatch, looseBatchName)
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

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f =>
      /\.(zip|pes|bmp|jpg|jpeg|png)$/i.test(f.name)
    )
    if (files.length > 0) handleFiles(files)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-serif text-2xl text-stone-700">Last opp broderifiler</h2>
          {!uploading && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

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
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
                dragOver
                  ? 'border-[#C9A57A] bg-amber-50'
                  : 'border-stone-200 bg-stone-50'
              }`}
            >
              <p className="text-sm text-stone-500 mb-4">Dra inn ZIP- eller PES-filer her</p>
              <div className="space-y-2">
                <button
                  onClick={() => zipRef.current?.click()}
                  className="w-full py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 bg-white hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Velg ZIP-filer
                </button>
                <button
                  onClick={() => pesRef.current?.click()}
                  className="w-full py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 bg-white hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Velg PES-filer
                </button>
                <button
                  onClick={() => folderRef.current?.click()}
                  className="w-full py-2.5 border border-stone-200 rounded-xl text-sm text-stone-600 bg-white hover:border-[#C9A57A] hover:text-[#8B6340] transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  Velg mappe
                  <span className="text-xs text-stone-400">(best på desktop)</span>
                </button>
              </div>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={zipRef}
              type="file"
              accept=".zip"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(Array.from(e.target.files)) }}
            />
            <input
              ref={pesRef}
              type="file"
              accept=".pes"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(Array.from(e.target.files)) }}
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files?.length) handleFiles(Array.from(e.target.files)) }}
            />

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
            {d.navn ? displayMotifName(d.navn) : <span className="italic font-light opacity-70">Uten navn</span>}
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
          {getKats(d).length > 0 && (
            <span className="text-xs text-stone-400 truncate">
              {getKats(d)[0]}{getKats(d).length > 1 ? ` +${getKats(d).length - 1}` : ''}
            </span>
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

function BundleCard({ bundle, motifCount, onClick, selectionMode = false, selected = false, onToggleSelect }: {
  bundle: EmbroideryBundle
  motifCount: number
  onClick: () => void
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const d = bundle.data
  const imgSrc = d.useCustomImage ? d.customImage : d.coverImage

  function handleClick() {
    if (selectionMode) onToggleSelect?.()
    else onClick()
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
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
        )}

        {selectionMode && (
          <div className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected ? 'bg-[#C9A57A] border-[#C9A57A]' : 'bg-white/80 border-stone-300'
          }`}>
            {selected && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
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
          {getKats(d).length > 0 && (
            <span className="text-xs text-stone-400 truncate">
              {getKats(d)[0]}{getKats(d).length > 1 ? ` +${getKats(d).length - 1}` : ''}
            </span>
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
            <h3 className="font-serif text-xs font-semibold text-white leading-tight truncate">{d.navn ? displayMotifName(d.navn) : 'Uten navn'}</h3>
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

  async function splitSize(sizeId: string) {
    const size = form.sizes.find(s => s.id === sizeId)
    if (!size || form.sizes.length <= 1) return
    const newData: EmbroideryData = {
      ...form,
      navn: `${form.navn} (${size.sizeLabel})`,
      sizes: [size],
    }
    const { error: insErr } = await supabase.from('embroidery').insert({ data: newData })
    if (insErr) { console.error('[Embroidery] Split-feil:', insErr); return }
    removeSize(sizeId)
    onSaved()
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
          <h2 className="font-serif text-xl text-stone-700 truncate">{d.navn ? displayMotifName(d.navn) : 'Uten navn'}</h2>
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
            <label className="block text-xs text-stone-500 mb-2">Kategorier</label>
            <KategoriEditor
              kategorier={getKats(d)}
              onChange={ks => update({ kategorier: ks })}
            />
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
              {sortedSizes(d.sizes).map(size => (
                <div key={size.id} className="flex items-center gap-3 py-2 border-b border-stone-50 last:border-0 min-w-0">
                  <input value={size.sizeLabel} onChange={e => updateSize(size.id, { sizeLabel: e.target.value })}
                    className="w-24 flex-shrink-0 px-2.5 py-1.5 border border-stone-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-stone-200"
                    placeholder="Størrelse" />
                  <span className="flex-1 text-xs text-stone-400 truncate min-w-0">
                    {size.pesFilename}
                    {size.widthMm && size.heightMm && (
                      <span className="ml-1.5 text-stone-300">{size.widthMm} × {size.heightMm} mm</span>
                    )}
                  </span>
                  <a href={size.pesUrl} download={size.pesFilename} onClick={e => e.stopPropagation()}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#F5EFE6] text-[#8B6340] rounded-lg hover:bg-[#e8d5c0] border border-[#D4A574] transition-colors whitespace-nowrap">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Last ned
                  </a>
                  {d.sizes.length > 1 && (
                    <button onClick={() => splitSize(size.id)}
                      className="flex-shrink-0 p-1.5 rounded-lg hover:bg-amber-50 text-stone-300 hover:text-amber-500 transition-colors"
                      title="Skill ut som eget motiv">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M8 7h4m0 0l-2-2m2 2l-2 2M16 17h-4m0 0l2 2m-2-2l2-2M3 12h18" />
                      </svg>
                    </button>
                  )}
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
            <label className="block text-xs text-stone-500 mb-2">Kategorier</label>
            <KategoriEditor
              kategorier={getKats(d)}
              onChange={ks => update({ kategorier: ks })}
            />
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
              {sortBundleMotifs(motifs).map(motif => (
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
  const [bundleSelectionMode, setBundleSelectionMode] = useState(false)
  const [selectedBundleIds, setSelectedBundleIds] = useState<Set<string>>(new Set())
  const [showMergeBundles, setShowMergeBundles] = useState(false)
  const [katDropdownOpen, setKatDropdownOpen] = useState(false)
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const [uploadSummary, setUploadSummary] = useState<string | null>(null)
  const katDropdownRef = useRef<HTMLDivElement>(null)
  const sortDropdownRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View>('gallery')
  const prevViewRef = useRef<View>('gallery')
  const currentBundleRef = useRef<EmbroideryBundle | null>(null)
  const bundlesRef = useRef<EmbroideryBundle[]>([])

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

  // Keep refs in sync so the popstate handler can read latest state without stale closure
  useEffect(() => { viewRef.current = view }, [view])
  useEffect(() => { prevViewRef.current = prevView }, [prevView])
  useEffect(() => { currentBundleRef.current = currentBundle }, [currentBundle])
  useEffect(() => { bundlesRef.current = bundles }, [bundles])

  useEffect(() => {
    window.history.replaceState({ emb: 'gallery' }, '')
    function handlePopState(e: PopStateEvent) {
      const state = e.state as { emb?: string; bid?: string } | null
      if (!state?.emb) return
      if (state.emb === 'gallery') {
        setView('gallery')
        setCurrentItem(null)
        setCurrentBundle(null)
      } else if (state.emb === 'bundle') {
        // browser back from motif → bundle; restore bundle by bid in case state is stale
        const bundle = (state.bid ? bundlesRef.current.find(b => b.id === state.bid) : null)
          || currentBundleRef.current
        if (bundle) {
          setCurrentBundle(bundle)
          setView('bundle')
          setCurrentItem(null)
        } else {
          setView('gallery')
          setCurrentItem(null)
          setCurrentBundle(null)
        }
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

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

  async function mergeMotifs() {
    const selected = items.filter(i => selectedIds.has(i.id))
    if (selected.length < 2) return
    const base = selected[0]
    const allSizes = selected.flatMap(m => m.data.sizes)
    allSizes.sort((a, b) => sizeOrder(a.sizeLabel) - sizeOrder(b.sizeLabel))
    const withCover = selected.find(m => m.data.coverImage || m.data.bmpPreview)
    const newData: EmbroideryData = {
      ...base.data,
      sizes: allSizes,
      coverImage: withCover?.data.coverImage || base.data.coverImage,
      bmpPreview: withCover?.data.bmpPreview || base.data.bmpPreview,
    }
    await supabase.from('embroidery').update({ data: newData }).eq('id', base.id)
    for (const motif of selected.slice(1)) {
      await supabase.from('embroidery').delete().eq('id', motif.id)
    }
    setSelectionMode(false)
    setSelectedIds(new Set())
    load()
    setUploadSummary(`${selected.length} motiver slått sammen til «${base.data.navn}»`)
  }

  function handleUploadDone(_results: Embroidery[], summary: string) {
    setShowUpload(false)
    load()
    if (summary) setUploadSummary(summary)
  }

  function openBundle(bundle: EmbroideryBundle) {
    window.history.pushState({ emb: 'bundle', bid: bundle.id }, '')
    setCurrentBundle(bundle)
    setView('bundle')
  }

  function openMotifFromGallery(item: Embroidery) {
    window.history.pushState({ emb: 'motif', mid: item.id, from: 'gallery' }, '')
    setCurrentItem(item)
    setPrevView('gallery')
    setView('motif')
  }

  function openMotifFromBundle(item: Embroidery) {
    window.history.pushState({ emb: 'motif', mid: item.id, from: 'bundle' }, '')
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

  function toggleBundleSelection(id: string) {
    setSelectedBundleIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function mergeBundles(name: string) {
    const toBeMerged = bundles.filter(b => selectedBundleIds.has(b.id))
    if (toBeMerged.length < 2) return
    const firstCover = toBeMerged.find(b => b.data.coverImage)?.data.coverImage || ''
    const bundleData: EmbroideryBundleData = {
      navn: name,
      designer: toBeMerged[0].data.designer || '',
      kategori: '',
      coverImage: firstCover,
      customImage: '',
      useCustomImage: false,
      notater: '',
    }
    const { data: newRows, error: newErr } = await supabase
      .from('embroidery_bundles')
      .insert({ data: bundleData })
      .select()
    if (newErr || !newRows?.[0]) return
    const newBundle = newRows[0] as EmbroideryBundle
    for (const b of toBeMerged) {
      const motifsInBundle = items.filter(i => i.data.bundleId === b.id)
      for (const motif of motifsInBundle) {
        await supabase
          .from('embroidery')
          .update({ data: { ...motif.data, bundleId: newBundle.id } })
          .eq('id', motif.id)
      }
      await supabase.from('embroidery_bundles').delete().eq('id', b.id)
    }
    setBundleSelectionMode(false)
    setSelectedBundleIds(new Set())
    setShowMergeBundles(false)
    await load()
    setUploadSummary(`${toBeMerged.length} bundles slått sammen til «${name}»`)
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
          const kats = gi.type === 'bundle' ? getKats(gi.bundle.data) : getKats(gi.item.data)
          if (!kats.includes(katFilter)) return false
        }
        if (!search.trim()) return true
        const q = search.toLowerCase()
        if (gi.type === 'bundle') {
          const bd = gi.bundle.data
          const bundleMatch = bd.navn.toLowerCase().includes(q)
            || bd.designer.toLowerCase().includes(q)
            || getKats(bd).some(k => k.toLowerCase().includes(q))
          const motifMatch = items
            .filter(i => i.data.bundleId === gi.bundle.id)
            .some(i =>
              i.data.navn.toLowerCase().includes(q) ||
              i.data.designer.toLowerCase().includes(q) ||
              getKats(i.data).some(k => k.toLowerCase().includes(q))
            )
          return bundleMatch || motifMatch
        }
        const id = gi.item.data
        return (
          id.navn.toLowerCase().includes(q) ||
          id.designer.toLowerCase().includes(q) ||
          getKats(id).some(k => k.toLowerCase().includes(q))
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
              setCurrentItem(null)
            } else {
              setCurrentItem(null)
              setView('gallery')
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
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 mb-0 space-y-3">
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
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-30 min-w-[160px] py-1 max-h-72 overflow-y-auto">
                <button
                  onClick={() => { setKatFilter('Alle'); setKatDropdownOpen(false) }}
                  className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-stone-50 ${katFilter === 'Alle' ? 'text-stone-800 font-medium' : 'text-stone-600'}`}
                >
                  Alle
                </button>
                {Array.from(new Set([
                  ...KATEGORIER,
                  ...items.flatMap(i => getKats(i.data)),
                  ...bundles.flatMap(b => getKats(b.data)),
                ].filter(Boolean))).map(k => (
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
              <div className="absolute top-full left-0 mt-1 bg-white border border-stone-200 rounded-xl shadow-lg z-30 min-w-[160px] py-1">
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

          {/* Motif selection mode toggle — hidden when bundle selection is active */}
          {!bundleSelectionMode && (items.filter(i => !i.data.bundleId).length > 0) && (
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

          {/* Bundle selection mode toggle — hidden when motif selection is active */}
          {!selectionMode && bundles.length >= 2 && (
            <button
              onClick={() => {
                if (bundleSelectionMode) {
                  setBundleSelectionMode(false)
                  setSelectedBundleIds(new Set())
                } else {
                  setBundleSelectionMode(true)
                }
              }}
              className={`h-9 px-3 flex items-center gap-1.5 rounded-xl border text-sm transition-colors ${
                bundleSelectionMode
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
            >
              {bundleSelectionMode ? (
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
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Velg bundles
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
                    selectionMode={bundleSelectionMode}
                    selected={selectedBundleIds.has(gi.bundle.id)}
                    onToggleSelect={() => toggleBundleSelection(gi.bundle.id)}
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
          <span className="text-stone-300 whitespace-nowrap">
            {selectedIds.size} {selectedIds.size === 1 ? 'valgt' : 'valgte'}
          </span>
          <button
            onClick={() => { if (selectedIds.size > 0) setShowCreateBundle(true) }}
            disabled={selectedIds.size === 0}
            className="px-4 py-1.5 bg-[#C9A57A] text-white rounded-xl text-sm font-medium hover:bg-[#b8925f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            Lag bundle
          </button>
          <button
            onClick={() => { if (selectedIds.size >= 2) mergeMotifs() }}
            disabled={selectedIds.size < 2}
            className="px-4 py-1.5 bg-stone-600 text-white rounded-xl text-sm font-medium hover:bg-stone-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            title="Slå sammen til ett motiv med flere størrelser"
          >
            Slå sammen
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

      {/* Bundle selection floating bar */}
      {bundleSelectionMode && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-stone-800 text-white text-sm rounded-2xl shadow-xl">
          <span className="text-stone-300 whitespace-nowrap">
            {selectedBundleIds.size} {selectedBundleIds.size === 1 ? 'bundle valgt' : 'bundles valgt'}
          </span>
          <button
            onClick={() => { if (selectedBundleIds.size >= 2) setShowMergeBundles(true) }}
            disabled={selectedBundleIds.size < 2}
            className="px-4 py-1.5 bg-[#C9A57A] text-white rounded-xl text-sm font-medium hover:bg-[#b8925f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            Slå sammen bundles
          </button>
        </div>
      )}

      {showMergeBundles && (() => {
        const selectedBundles = bundles.filter(b => selectedBundleIds.has(b.id))
        const suggested = selectedBundles[0]?.data.navn || ''
        return (
          <MergeBundlesModal
            suggestedName={suggested}
            bundleCount={selectedBundles.length}
            onConfirm={mergeBundles}
            onCancel={() => setShowMergeBundles(false)}
          />
        )
      })()}

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
