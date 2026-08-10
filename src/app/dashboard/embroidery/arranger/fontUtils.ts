import type { Embroidery, VirtuelMotiv } from './types'

// Standard Latin descenders for satin/script fonts — baseline is at x-height,
// not at the bottom of the file.
export const DESCENDER_LETTERS = new Set(['g', 'j', 'p', 'q', 'y', 'z'])

// Pure x-height reference letters: no ascenders or descenders.
const X_HEIGHT_REF = new Set(['a', 'c', 'e', 'm', 'n', 'o', 's'])

export interface FontTegn {
  embroideryId: string
  sizeId: string
  widthMm: number
  heightMm: number
}

export interface FontMetrics {
  xHeight: number    // mm — median of x-height reference letters
  capHeight: number  // mm — median of uppercase letters
}

export interface FontData {
  metrics: FontMetrics
  tegn: Record<string, FontTegn>  // actual character → file info
}

// Distance from the top of the PES file's own coordinate system to the baseline, in mm.
// For descenders the body sits on the baseline at xHeight; the rest hangs below.
// For all other characters the bottom of the file IS the baseline.
export function baselineInFileMm(ch: string, heightMm: number, metrics: FontMetrics): number {
  if (/[a-zæøå]/.test(ch) && DESCENDER_LETTERS.has(ch)) return metrics.xHeight
  return heightMm
}

// Build font data for a specific inch size from virtual motifs and the embroidery library.
// Returns null if the requested size has no characters with measured dimensions.
export function buildFontData(
  vms: VirtuelMotiv[],
  tomme: string,
  biblioteket: Embroidery[],
): FontData {
  const embMap = new Map(biblioteket.map(m => [m.id, m]))
  const tegn: Record<string, FontTegn> = {}
  const xRefHeights: number[] = []
  const capHeights: number[] = []

  for (const vm of vms) {
    if (!vm.karakter) continue
    const sz = vm.sizes.find(s => s.tommeLabel === tomme)
    if (!sz) continue
    const emb = embMap.get(sz.embroideryId)
    const eSize = emb?.data.sizes.find(s => s.id === sz.sizeId)
    if (!eSize?.widthMm || !eSize?.heightMm) continue

    tegn[vm.karakter.tegn] = {
      embroideryId: sz.embroideryId,
      sizeId: sz.sizeId,
      widthMm: eSize.widthMm,
      heightMm: eSize.heightMm,
    }

    if (vm.karakter.type === 'liten' && X_HEIGHT_REF.has(vm.karakter.tegn)) {
      xRefHeights.push(eSize.heightMm)
    }
    if (vm.karakter.type === 'stor') {
      capHeights.push(eSize.heightMm)
    }
  }

  xRefHeights.sort((a, b) => a - b)
  capHeights.sort((a, b) => a - b)
  const xHeight = xRefHeights.length ? xRefHeights[Math.floor(xRefHeights.length / 2)] : 16
  const capHeight = capHeights.length ? capHeights[Math.floor(capHeights.length / 2)] : 52

  return { metrics: { xHeight, capHeight }, tegn }
}

export interface LayoutBokstav {
  tegn: string
  info: FontTegn
  posXTiendedelMm: number  // center of bbox, in 1/10mm from canvas origin
  posYTiendedelMm: number  // center of bbox, in 1/10mm from canvas origin (baseline at y=0)
}

export interface TextLayout {
  bokstaver: LayoutBokstav[]
  mangler: string[]         // characters in tekst with no PES file
  totalBreddeMm: number     // total width including tracking but not trailing tracking
  totalHøydeMm: number      // actual vertical extent of the characters used
}

// Lay out tekst centered on canvas origin (0,0) with baseline at y=0.
// tracking: extra mm between character bboxes (0 = touching).
// mellomromFaktor: space width as a multiple of xHeight (0.6 ≈ narrow, 1.0 ≈ wide).
export function layoutTekst(
  tekst: string,
  fontData: FontData,
  opts: { tracking: number; mellomromFaktor: number },
): TextLayout {
  const { tegn, metrics } = fontData
  const mellomromMm = opts.mellomromFaktor * metrics.xHeight
  const mangler: string[] = []

  // Pass 1: total width (without leading/trailing tracking, with space widths)
  let totalWidth = 0
  let prevWasChar = false
  for (const ch of tekst) {
    if (ch === ' ') { totalWidth += mellomromMm; prevWasChar = false; continue }
    const info = tegn[ch]
    if (!info) { if (!mangler.includes(ch)) mangler.push(ch); continue }
    if (prevWasChar) totalWidth += opts.tracking
    totalWidth += info.widthMm
    prevWasChar = true
  }

  // Pass 2: place characters centered on x=0
  let cursor = -totalWidth / 2
  const bokstaver: LayoutBokstav[] = []
  prevWasChar = false

  for (const ch of tekst) {
    if (ch === ' ') { cursor += mellomromMm; prevWasChar = false; continue }
    const info = tegn[ch]
    if (!info) continue
    if (prevWasChar) cursor += opts.tracking

    const bif = baselineInFileMm(ch, info.heightMm, metrics)
    // Top of file is at (baseline_y - bif) = (0 - bif) = -bif in canvas coords.
    // Center of file is at -bif + heightMm/2 in canvas coords.
    bokstaver.push({
      tegn: ch,
      info,
      posXTiendedelMm: Math.round((cursor + info.widthMm / 2) * 10),
      posYTiendedelMm: Math.round((info.heightMm / 2 - bif) * 10),
    })
    cursor += info.widthMm
    prevWasChar = true
  }

  // Vertical extent based on actual characters used, not theoretical maximum
  let topExtentMm = 0
  let bottomExtentMm = 0
  for (const b of bokstaver) {
    const bif = baselineInFileMm(b.tegn, b.info.heightMm, metrics)
    topExtentMm = Math.max(topExtentMm, bif)
    bottomExtentMm = Math.max(bottomExtentMm, b.info.heightMm - bif)
  }

  return {
    bokstaver,
    mangler,
    totalBreddeMm: totalWidth,
    totalHøydeMm: topExtentMm + bottomExtentMm,
  }
}
