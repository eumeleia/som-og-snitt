import type { Embroidery, FontMetrikk, VirtuelMotiv } from './types'

// Pure x-height reference letters: no ascenders or descenders.
const X_HEIGHT_REF = new Set(['a', 'c', 'e', 'm', 'n', 'o', 's'])

export interface FontTegn {
  embroideryId: string
  sizeId: string
  widthMm: number
  heightMm: number
  // Distanse fra toppen av fila til grunnlinjen, i mm. Standard er heightMm (tegnets egen
  // bunn — riktig per definisjon for tegn uten underlengde, se "Beslutning etter steg A" i
  // docs/plan-og-prompter-2026-08-13.md). Justert av fontMetrikk.tegn[tegn].underlengdeAndel
  // når den finnes: bifMm = heightMm × (1 − underlengdeAndel).
  bifMm: number
}

export interface FontMetrics {
  xHeight: number  // mm — median of x-height reference letters
}

export interface FontData {
  metrics: FontMetrics
  tegn: Record<string, FontTegn>  // actual character → file info
}

// Build font data for a specific inch size from virtual motifs and the embroidery library.
// Bygger ALLTID et resultat (aldri null) — tegn uten målte data er bare fraværende fra
// tegn-oppslaget, se fontData.tegn[ch] og TextLayout.mangler i layoutTekst.
export function buildFontData(
  vms: VirtuelMotiv[],
  tomme: string,
  biblioteket: Embroidery[],
  fontMetrikk?: FontMetrikk,
): FontData {
  const embMap = new Map(biblioteket.map(m => [m.id, m]))
  const tegn: Record<string, FontTegn> = {}
  const xRefHeights: number[] = []

  for (const vm of vms) {
    if (!vm.karakter) continue
    const sz = vm.sizes.find(s => s.tommeLabel === tomme)
    if (!sz) continue
    const emb = embMap.get(sz.embroideryId)
    const eSize = emb?.data.sizes.find(s => s.id === sz.sizeId)
    if (!eSize?.widthMm || !eSize?.heightMm) continue

    const andel = fontMetrikk?.tegn[vm.karakter.tegn]?.underlengdeAndel
    const bifMm = andel != null ? eSize.heightMm * (1 - andel) : eSize.heightMm

    tegn[vm.karakter.tegn] = {
      embroideryId: sz.embroideryId,
      sizeId: sz.sizeId,
      widthMm: eSize.widthMm,
      heightMm: eSize.heightMm,
      bifMm,
    }

    if (vm.karakter.type === 'liten' && X_HEIGHT_REF.has(vm.karakter.tegn)) {
      xRefHeights.push(eSize.heightMm)
    }
  }

  xRefHeights.sort((a, b) => a - b)
  const xHeight = xRefHeights.length ? xRefHeights[Math.floor(xRefHeights.length / 2)] : 16

  return { metrics: { xHeight }, tegn }
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

    // Top of file is at (baseline_y - bifMm) = (0 - bifMm) = -bifMm in canvas coords.
    // Center of file is at -bifMm + heightMm/2 in canvas coords.
    bokstaver.push({
      tegn: ch,
      info,
      posXTiendedelMm: Math.round((cursor + info.widthMm / 2) * 10),
      posYTiendedelMm: Math.round((info.heightMm / 2 - info.bifMm) * 10),
    })
    cursor += info.widthMm
    prevWasChar = true
  }

  // Vertical extent based on actual characters used, not theoretical maximum
  let topExtentMm = 0
  let bottomExtentMm = 0
  for (const b of bokstaver) {
    topExtentMm = Math.max(topExtentMm, b.info.bifMm)
    bottomExtentMm = Math.max(bottomExtentMm, b.info.heightMm - b.info.bifMm)
  }

  return {
    bokstaver,
    mangler,
    totalBreddeMm: totalWidth,
    totalHøydeMm: topExtentMm + bottomExtentMm,
  }
}
