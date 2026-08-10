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

// Bbox for en underboks (typisk én fargekjørings sting-bbox) etter at HELE motivet
// den hører til roteres om sitt eget senter og flyttes til posisjonen på lerretet.
// Roterer underBbox sine fire hjørner om motivBbox sitt senter (ikke underBbox sitt
// eget senter) — det er motivets pivot, ikke kjøringens egen, siden kjøringen sitter
// fast i motivet den er en del av.
export function plassertUnderBbox(
  underBbox: BroderiBbox,
  motivBbox: BroderiBbox,
  rotasjonGrader: number,
  posisjonXTiendedelMm: number,
  posisjonYTiendedelMm: number,
): BroderiBbox {
  const [mcx, mcy] = bboxSenter(motivBbox)
  const roter = lagRotasjon(rotasjonGrader)
  const hjorner = [
    [underBbox.min_x, underBbox.min_y], [underBbox.max_x, underBbox.min_y],
    [underBbox.min_x, underBbox.max_y], [underBbox.max_x, underBbox.max_y],
  ].map(([x, y]) => roter(x - mcx, y - mcy))
  const xs = hjorner.map(([x]) => x + posisjonXTiendedelMm)
  const ys = hjorner.map(([, y]) => y + posisjonYTiendedelMm)
  return {
    min_x: Math.min(...xs), max_x: Math.max(...xs),
    min_y: Math.min(...ys), max_y: Math.max(...ys),
  }
}

// Bbox for et helt plassert (rotert + forskjøvet) motiv — samme som å be om
// plassertUnderBbox for motivets egen bbox, siden det da roterer om sitt eget senter.
export function plassertBbox(
  motivBbox: BroderiBbox,
  rotasjonGrader: number,
  posisjonXTiendedelMm: number,
  posisjonYTiendedelMm: number,
): BroderiBbox {
  return plassertUnderBbox(motivBbox, motivBbox, rotasjonGrader, posisjonXTiendedelMm, posisjonYTiendedelMm)
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

export function bokserOverlapper(a: BroderiBbox, b: BroderiBbox): boolean {
  return !(a.max_x < b.min_x || b.max_x < a.min_x || a.max_y < b.min_y || b.max_y < a.min_y)
}
