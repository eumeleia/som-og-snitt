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

// Roterer OG plasserer stingpunkter — samme to steg som rendringen gjør (roterLokalePunkter,
// deretter en SVG-translasjon), bare at addisjonen her gjøres i koden i stedet for av SVG-en.
// Addisjon er eksakt uansett hvem som gjør den, så dette er IKKE en ny transformasjon — det
// er de samme to primitivene brukt av rendringen og bbox-utregningen, satt sammen én gang.
// Brukes til PES-eksport, som må ha de faktiske absolutte stingkoordinatene.
export function plassertPunkter(
  sting: [number, number][],
  motivBbox: BroderiBbox,
  rotasjonGrader: number,
  posisjonXTiendedelMm: number,
  posisjonYTiendedelMm: number,
): [number, number][] {
  const roterte = roterLokalePunkter(sting, motivBbox, rotasjonGrader)
  return roterte.map(([x, y]) => [x + posisjonXTiendedelMm, y + posisjonYTiendedelMm])
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

// Sampler jevnt fordelte punkter langs hver STREK mellom to påfølgende sting i lista — ikke
// bare endepunktene. En satengkolonne har nålestikk bare langs de to kantene, med hele
// innsiden tom; rasterCeller under ser bare punktene den får inn, så uten denne
// interpoleringen blir hele midten av en satengsydd form et hull i rasteret.
// Dette er en SAMPLING langs stinget, ikke en eksakt linjerasterisering: med et steg på en
// halv rastercelle kan en diagonal strek i sjeldne tilfeller fortsatt hoppe over en
// hjørnecelle av rasteret den til slutt brukes med. Det er et bevisst valg — å miste en
// hjørnecelle er ubetydelig sammenlignet med å miste hele innsiden av en satengkolonne, som
// var den opprinnelige feilen.
export function interpolerSting(sting: [number, number][], stegTiendedelMm: number): [number, number][] {
  const ut: [number, number][] = []
  for (let i = 0; i < sting.length; i++) {
    if (i > 0) {
      const [x0, y0] = sting[i - 1]
      const [x1, y1] = sting[i]
      const lengde = Math.hypot(x1 - x0, y1 - y0)
      const antallSteg = Math.floor(lengde / stegTiendedelMm)
      for (let s = 1; s <= antallSteg; s++) {
        const t = (s * stegTiendedelMm) / lengde
        ut.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
      }
    }
    ut.push(sting[i])
  }
  return ut
}

// Rasteriserer et sett punkter (allerede plassert på lerretet, i 1/10 mm) til hvilke celler i
// et rutenett de faller i — celleTiendedelMm er cellesiden i 1/10 mm (10 ≈ 1 mm). Dekker KUN
// cellene punktene selv faller i — funksjonen trekker ingen streker mellom dem. Sparsomme
// punkter (f.eks. nålestikkene langs kantene av en satengkolonne, der hele innsiden er tom
// for sting) gir derfor et raster med hull midt i formen, med mindre kalleren har interpolert
// punkter langs hvert sting FØR de sendes inn hit (se interpolerSting over, og bruken i
// sekvens.ts sin plassertFargekjoringRaster). Brukes til en overlapptest som er mer treffsikker
// enn bounding-bokser — to omsluttende bokser kan krysse hverandre uten at et enkelt sting fra
// de to formene faktisk møtes (f.eks. to L-former som griper inn i hverandres "hjørne" uten å
// røre) — men er ikke i seg selv en eksakt linjerasterisering, se forbeholdet over.
export function rasterCeller(punkter: [number, number][], celleTiendedelMm: number): Set<string> {
  const celler = new Set<string>()
  for (const [x, y] of punkter) {
    celler.add(`${Math.floor(x / celleTiendedelMm)},${Math.floor(y / celleTiendedelMm)}`)
  }
  return celler
}

// Sant hvis minst én celle finnes i begge settene. Løper over det minste settet — begge
// veier gir samme svar, men rekkefølgen påvirker hvor mange oppslag som gjøres.
export function cellerKolliderer(a: Set<string>, b: Set<string>): boolean {
  const [minst, størst] = a.size <= b.size ? [a, b] : [b, a]
  for (const celle of minst) if (størst.has(celle)) return true
  return false
}
