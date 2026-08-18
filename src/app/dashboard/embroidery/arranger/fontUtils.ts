import type { Embroidery, FontMetrikk, VirtuelMotiv } from './types'

// Bokstavklassifisering for grunnlinjeplassering — IKKE det samme som Karakter.type i
// tomme.ts (stor/liten/tall/symbol, brukt til fontrad-gjenkjenning). Denne styrer hvor
// grunnlinjen ligger i tegnets EGEN bbox, se buildFontData under.
//
// x-høyde: tegn uten over- eller underlengde — grunnlinjen er tegnets egen bunn (offset 0),
// OG disse er referansen buildFormData måler xHeight fra (se lenger ned). Rettet mot
// docs/fontmaling-2026-08-13.md: «z» har INGEN underlengde (fjernet fra underlengder,
// lagt i x-høyde), og r/u/v/w/x manglet i den gamle lista.
const X_HEIGHT_REF = new Set(['a', 'c', 'e', 'm', 'n', 'o', 'r', 's', 'u', 'v', 'w', 'x', 'z'])

// Overlengde: stikker OVER x-høyden, ingen underlengde — grunnlinjen er tegnets egen bunn
// (offset 0), akkurat som x-høyde-bokstaver.
const OVERLENGDE_REF = new Set(['b', 'd', 'h', 'k', 'l', 't'])

// Underlengde: stikker UNDER grunnlinjen — grunnlinjen er MÅLT xHeight fra toppen (når
// xHeight faktisk er målt, se xHeightMalt), ikke tegnets egen bunn.
// «f» og «j» kan ha BÅDE over- og underlengde i skriveskrift (f: løkke over x-høyden OG en
// hale under i enkelte fonter; j: prikk over x-høyden OG en hale under). Behandlet som
// underlengde her per instruks — USIKKERT til de er sett visuelt i en ekte, digitalisert
// font. Stemmer det ikke for en gitt font, hører de heller til overlengde eller x-høyde der.
const UNDERLENGDE_REF = new Set(['g', 'j', 'p', 'q', 'y', 'f'])

export type Bokstavtype = 'versal' | 'tall' | 'x-hoyde' | 'overlengde' | 'underlengde' | 'symbol'

// Klassifiserer ETT tegn for grunnlinjeplassering. Rekkefølgen er bevisst: stor bokstav og
// siffer sjekkes FØR bokstavlistene, siden lister som X_HEIGHT_REF kun inneholder små
// bokstaver — en stor «O» skal aldri kunne treffe dem ved en feil.
export function klassifiser(tegn: string): Bokstavtype {
  if (/[A-ZÆØÅ]/.test(tegn)) return 'versal'
  if (/\d/.test(tegn)) return 'tall'
  if (UNDERLENGDE_REF.has(tegn)) return 'underlengde'
  if (OVERLENGDE_REF.has(tegn)) return 'overlengde'
  if (X_HEIGHT_REF.has(tegn)) return 'x-hoyde'
  return 'symbol'
}

// Reserveverdi BARE for mellomrom-bredde når ingen x-høyde-bokstav finnes å måle — den skal
// ALDRI brukes til å plassere en underlengde (se xHeightMalt), siden den ikke er målt mot
// den aktuelle fonten/størrelsen i det hele tatt.
const XHEIGHT_RESERVE_MM = 1.6

export interface FontTegn {
  embroideryId: string
  sizeId: string
  widthMm: number
  heightMm: number
  // Distanse fra toppen av fila til grunnlinjen, i mm. Standard er heightMm (tegnets egen
  // bunn — riktig per definisjon for tegn uten underlengde, se "Beslutning etter steg A" i
  // docs/plan-og-prompter-2026-08-13.md). For et underlengde-klassifisert tegn, når xHeight
  // faktisk er MÅLT (xHeightMalt), er bifMm i stedet den målte xHeight-en — grunnlinjen
  // ligger da der x-høyde-bokstavene faktisk står, ikke ved bunnen av tegnets egen hale.
  // En manuell fontMetrikk.tegn[tegn].underlengdeAndel (kalibrert med øyet) overstyrer alltid
  // begge deler, uansett klassifisering.
  bifMm: number
}

export interface FontMetrics {
  xHeight: number       // mm — MÅLT median av x-høyde-bokstavene som finnes i denne
                        // (bundle, tomme), eller XHEIGHT_RESERVE_MM hvis ingen finnes.
                        // Brukes til mellomrom-bredde uansett — se xHeightMalt for om den
                        // er til å stole på for GRUNNLINJEPLASSERING.
  xHeightMalt: boolean  // true når xHeight er målt fra ekte x-høyde-bokstaver i denne
                        // (bundle, tomme) — false betyr xHeight er reserveverdien over, og
                        // underlengder (g j p q y f) faller tilbake til tegnets egen bunn
                        // (som alt annet) i stedet for en beregnet forskyvning. Kalleren
                        // (TextVerktoy) skal si fra om dette i UI-et, aldri gjette stille.
}

export interface FontData {
  metrics: FontMetrics
  tegn: Record<string, FontTegn>  // actual character → file info
}

// Build font data for a specific inch size from virtual motifs and the embroidery library.
// Bygger ALLTID et resultat (aldri null) — tegn uten målte data er bare fraværende fra
// tegn-oppslaget, se fontData.tegn[ch] og TextLayout.mangler i layoutTekst.
//
// xHeight måles FERSK her, per kall — ett kall dekker allerede nøyaktig én (bundle, tomme)
// (vms er filtrert til én bundle av kalleren, tomme er en parameter), så det finnes ingen
// fare for å gjenbruke en offset målt ved 2" på en 3"-fil: hvert kall til buildFontData
// starter helt på nytt. KomposisjonEditor sin useMemo (nøklet på [vms, tomme, biblioteket,
// fontMetrikk]) er cachen på tvers av rendringer — denne funksjonen trenger ingen egen.
export function buildFontData(
  vms: VirtuelMotiv[],
  tomme: string,
  biblioteket: Embroidery[],
  fontMetrikk?: FontMetrikk,
): FontData {
  const embMap = new Map(biblioteket.map(m => [m.id, m]))

  // Første passering: mål xHeight fra x-høyde-bokstavene som FAKTISK finnes i dette
  // alfabetet ved denne tommestørrelsen — aldri en antatt konstant.
  const xRefHeights: number[] = []
  for (const vm of vms) {
    if (!vm.karakter || klassifiser(vm.karakter.tegn) !== 'x-hoyde') continue
    const sz = vm.sizes.find(s => s.tommeLabel === tomme)
    if (!sz) continue
    const eSize = embMap.get(sz.embroideryId)?.data.sizes.find(s => s.id === sz.sizeId)
    if (eSize?.heightMm) xRefHeights.push(eSize.heightMm)
  }
  xRefHeights.sort((a, b) => a - b)
  const xHeightMalt = xRefHeights.length > 0
  const xHeight = xHeightMalt ? xRefHeights[Math.floor(xRefHeights.length / 2)] : XHEIGHT_RESERVE_MM

  // Andre passering: bygg tegn-oppslaget, med grunnlinjen for underlengder utledet fra den
  // MÅLTE xHeight-en over (aldri fra reserveverdien — se xHeightMalt-sjekken).
  const tegn: Record<string, FontTegn> = {}
  for (const vm of vms) {
    if (!vm.karakter) continue
    const sz = vm.sizes.find(s => s.tommeLabel === tomme)
    if (!sz) continue
    const emb = embMap.get(sz.embroideryId)
    const eSize = emb?.data.sizes.find(s => s.id === sz.sizeId)
    if (!eSize?.widthMm || !eSize?.heightMm) continue

    const manuellAndel = fontMetrikk?.tegn[vm.karakter.tegn]?.underlengdeAndel
    let bifMm: number
    if (manuellAndel != null) {
      bifMm = eSize.heightMm * (1 - manuellAndel) // kalibrert med øyet — vinner alltid
    } else if (xHeightMalt && klassifiser(vm.karakter.tegn) === 'underlengde') {
      bifMm = xHeight // grunnlinjen er den målte x-høyden — resten av tegnet er halen
    } else {
      bifMm = eSize.heightMm // tegnets egen bunn — standard for alt annet, og reserve
                             // for underlengder når xHeight ikke er målt
    }

    tegn[vm.karakter.tegn] = {
      embroideryId: sz.embroideryId,
      sizeId: sz.sizeId,
      widthMm: eSize.widthMm,
      heightMm: eSize.heightMm,
      bifMm,
    }
  }

  return { metrics: { xHeight, xHeightMalt }, tegn }
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
