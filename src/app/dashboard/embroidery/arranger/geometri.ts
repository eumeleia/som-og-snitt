import type { BroderiBbox } from './types'

// Alle funksjoner her jobber i 1/10 mm — samme enhet som stingkoordinatene og
// pyembroidery selv. Ingen skalering noe sted: rotasjon og translasjon er rigide
// transformasjoner som bevarer avstander, de endrer aldri stingtetthet.
// +y er nedover, som i SVG — vi flipper aldri y-aksen.

export function bboxSenter(bbox: BroderiBbox): [number, number] {
  return [(bbox.min_x + bbox.max_x) / 2, (bbox.min_y + bbox.max_y) / 2]
}

// Lager en rotasjonsfunksjon for én vinkel, så cos/sin regnes ut én gang og
// gjenbrukes for hvert punkt — viktig når et motiv har flere tusen sting.
export function lagRotasjon(grader: number): (x: number, y: number) => [number, number] {
  const rad = (grader * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return (x, y) => [x * cos - y * sin, x * sin + y * cos]
}

// Roterer stingpunktene til et motiv om sitt EGET bbox-senter. Returnerer punkter
// relativt til det senteret (ikke plassert på lerretet ennå) — plasseringen
// (posisjonX/Y) legges på separat, typisk via en SVG-translasjon, siden addisjon
// er eksakt uansett om den gjøres i koden eller av SVG-en.
export function roterLokalePunkter(
  sting: [number, number][],
  motivBbox: BroderiBbox,
  rotasjonGrader: number,
): [number, number][] {
  const [cx, cy] = bboxSenter(motivBbox)
  const roter = lagRotasjon(rotasjonGrader)
  return sting.map(([x, y]) => roter(x - cx, y - cy))
}

// Bbox for et plassert (rotert + forskjøvet) motiv. Roterer motivets fire
// bbox-hjørner om sitt eget senter og finner axis-aligned min/max av de roterte
// hjørnene — det gir eksakt bbox for det roterte motivet, uten å måtte rotere
// hvert enkelt stingpunkt.
export function plassertBbox(
  motivBbox: BroderiBbox,
  rotasjonGrader: number,
  posisjonXTiendedelMm: number,
  posisjonYTiendedelMm: number,
): BroderiBbox {
  const halvW = (motivBbox.max_x - motivBbox.min_x) / 2
  const halvH = (motivBbox.max_y - motivBbox.min_y) / 2
  const roter = lagRotasjon(rotasjonGrader)
  const hjorner = [
    roter(-halvW, -halvH), roter(halvW, -halvH),
    roter(-halvW, halvH), roter(halvW, halvH),
  ]
  const xs = hjorner.map(([x]) => x + posisjonXTiendedelMm)
  const ys = hjorner.map(([, y]) => y + posisjonYTiendedelMm)
  return {
    min_x: Math.min(...xs), max_x: Math.max(...xs),
    min_y: Math.min(...ys), max_y: Math.max(...ys),
  }
}

export function kombinerBbox(bokser: BroderiBbox[]): BroderiBbox | null {
  if (bokser.length === 0) return null
  return {
    min_x: Math.min(...bokser.map(b => b.min_x)),
    min_y: Math.min(...bokser.map(b => b.min_y)),
    max_x: Math.max(...bokser.map(b => b.max_x)),
    max_y: Math.max(...bokser.map(b => b.max_y)),
  }
}
