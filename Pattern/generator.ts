/**
 * GENERATOR — fra punkter til ferdig SVG-mønster.
 *
 * Rene funksjoner, ingen React, ingen nettverkskall. Kan kjøres i nettleser
 * eller i node. Alle interne mål i cm; SVG-en skrives ut i mm.
 */

export interface Punkt { x: number; y: number }

// ─────────────────────────── kurver ───────────────────────────

/** Punkt på kvadratisk Bézier ved parameter t. */
export function bezier(a: Punkt, c: Punkt, b: Punkt, t: number): Punkt {
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  }
}

export type Segment =
  | { type: 'L'; to: Punkt }
  | { type: 'Q'; from: Punkt; ctrl: Punkt; to: Punkt }

/** Gjør segmentliste om til polylinje. */
export function flat(segs: Segment[], oppl = 24): Punkt[] {
  const ut: Punkt[] = []
  for (const s of segs) {
    if (s.type === 'L') ut.push(s.to)
    else for (let i = 1; i <= oppl; i++) ut.push(bezier(s.from, s.ctrl, s.to, i / oppl))
  }
  return ut
}

export function dedup(p: Punkt[], eps = 1e-4): Punkt[] {
  const ut: Punkt[] = []
  for (const q of p) {
    const l = ut[ut.length - 1]
    if (!l || Math.hypot(q.x - l.x, q.y - l.y) > eps) ut.push(q)
  }
  return ut
}

/** Lengden av en polylinje. Brukes til å sjekke at sømmer matcher. */
export function lengde(p: Punkt[]): number {
  let s = 0
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)
  return s
}

/** Speil om y-aksen. */
export const speil = (p: Punkt): Punkt => ({ x: -p.x, y: p.y })

/** Kontrollpunkt for en kurve som skal berøre et punkt d fra hjørnet, på 45°. */
export function hjorne(hj: Punkt, d: number, retning: 1 | -1 = 1): Punkt {
  const k = d / Math.SQRT2
  return { x: hj.x + k * retning, y: hj.y - k }
}

/** Bøy en rett linje innover med gitt beløp på midtpunktet. */
export function bue(a: Punkt, b: Punkt, beløp: number): Punkt {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const dx = b.x - a.x, dy = b.y - a.y
  const L = Math.hypot(dx, dy) || 1
  return { x: mx + (-dy / L) * beløp * 2, y: my + (dx / L) * beløp * 2 }
}

// ───────────────────────── sømmonn ─────────────────────────

/**
 * Forskyv et lukket polygon utover med d cm.
 * Bruker vinkelhalveringslinjen i hvert hjørne, med avfasing i stedet for
 * skarp miter der hjørnet er spisst, så sømmonnet ikke skyter ut over
 * naboverkanten og krysser seg selv.
 *
 * To ting normaliseres før forskyvningen:
 * - Duplikatpunkt der en del er tegnet med samme start- og sluttpunkt
 *   fjernes. Et nullengde-hjørne der gir en udefinert normal.
 * - Omløpsretningen. normal()-formelen peker utover kun for én retning;
 *   uten normalisering vender sømmonnet innover for enhver del som
 *   (tilfeldig, ut fra rekkefølgen punktene ble bygget i) er viklet
 *   motsatt vei. Dette rammet ermet: sømmonnet der lå inni konturen,
 *   ikke utenpå.
 */
export function sommonn(polyInn: Punkt[], d: number): Punkt[] {
  let poly = dedup(polyInn)
  if (poly.length > 1) {
    const first = poly[0], last = poly[poly.length - 1]
    if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-4) poly.pop()
  }
  const arealX2 = poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length]
    return s + (p.x * q.y - q.x * p.y)
  }, 0)
  if (arealX2 < 0) poly = [...poly].reverse()

  const n = poly.length
  const normal = (a: Punkt, b: Punkt): Punkt => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1
    return { x: dy / L, y: -dx / L }
  }
  const ut: Punkt[] = []
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n]
    const n1 = normal(p0, p1), n2 = normal(p1, p2)
    let mx = n1.x + n2.x, my = n1.y + n2.y
    const L = Math.hypot(mx, my) || 1
    mx /= L; my /= L
    const cosHalv = n1.x * mx + n1.y * my
    if (cosHalv < 0.5) {
      // Spisst hjørne: rent miter-punkt (skalert med 1/cosHalv) kan skyte
      // langt utover polygonet og krysse egen naboside. Avfaset hjørne
      // (ett punkt per tilstøtende side) ligger alltid nøyaktig d unna kanten.
      ut.push({ x: p1.x + n1.x * d, y: p1.y + n1.y * d })
      ut.push({ x: p1.x + n2.x * d, y: p1.y + n2.y * d })
    } else {
      ut.push({ x: p1.x + (mx * d) / cosHalv, y: p1.y + (my * d) / cosHalv })
    }
  }
  return fjernLokker(ut)
}

/** To linjestykker (a1–a2 og b1–b2) sitt indre skjæringspunkt, eller null. */
function skjaeringspunkt(a1: Punkt, a2: Punkt, b1: Punkt, b2: Punkt): Punkt | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-9) return null
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom
  const eps = 1e-6
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps)
    return { x: a1.x + t * d1x, y: a1.y + t * d1y }
  return null
}

/**
 * Fjerner små løkker der offsetten krysser seg selv. Skjer der grunnkonturen
 * har en konkav sving med krappere krumningsradius enn selve sømmonnet — for
 * eksempel Aldrichs avrundede hjørnekutt i buksens skritt (se bukseblokk.ts),
 * der en 2 cm-avrunding møter et 1 cm sømmonn. Chamfing over løser bare
 * spisse (konvekse) hjørner; en konkav sving med for liten radius folder
 * offsetlinja over seg selv over flere punkter, ikke bare ett — funnet ved
 * shapely-selvkryssjekk på den genererte bukseblokka.
 */
function fjernLokker(poly: Punkt[]): Punkt[] {
  let p = poly
  for (let iter = 0; iter < 200; iter++) {
    const n = p.length
    let funnet = false
    for (let i = 0; i < n && !funnet; i++) {
      const a1 = p[i], a2 = p[(i + 1) % n]
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue // tilstøtende over "sømmen" i lista
        const b1 = p[j], b2 = p[(j + 1) % n]
        const x = skjaeringspunkt(a1, a2, b1, b2)
        if (x) {
          p = [...p.slice(0, i + 1), x, ...p.slice(j + 1)]
          funnet = true
          break
        }
      }
    }
    if (!funnet) break
  }
  return p
}

// ───────────────────────── SVG ─────────────────────────

export interface Hakk { punkt: Punkt; retning: 1 | -1 }

export interface Del {
  navn: string
  kontur: Punkt[]
  hakk?: Hakk[]
  tradretning?: { x: number; y1: number; y2: number }
  klippAntall?: number
  brettelinje?: { x: number; y1: number; y2: number }
  /**
   * Aldrichs egne konstruksjonspunkter (0, 1, 2 … slik de er nummerert i
   * boka), til bruk ved verifisering — så en punktliste kan slås opp mot
   * diagrammet og måles med målebånd på det projiserte bildet, i stedet for
   * bare å stole på den ferdige konturen.
   */
  punkter?: { navn: string; punkt: Punkt }[]
}

export interface SvgValg {
  sommonnCm?: number      // 0 = ingen
  visRutenett?: boolean
  kalibreringCm?: number  // størrelse på kontrollruta, standard 5
  undertekst?: string
  visPunkter?: boolean    // vis Aldrichs nummererte konstruksjonspunkter, til verifisering
}

const f = (n: number) => n.toFixed(2)
const bane = (p: Punkt[]) =>
  'M ' + p.map(q => `${f(q.x)},${f(q.y)}`).join(' L ') + ' Z'

export function tilSvg(deler: Del[], valg: SvgValg = {}): string {
  const sa = valg.sommonnCm ?? 1
  const kal = valg.kalibreringCm ?? 5

  const medSa = deler.map(d => ({ del: d, ytre: sa > 0 ? sommonn(d.kontur, sa) : null }))
  const alle = medSa.flatMap(x => [...x.del.kontur, ...(x.ytre ?? [])])
  const pad = 2.5
  // Egen stripe nederst til de to tekstlinjene (navn og undertekst), i tillegg
  // til vanlig marg. Uten denne havner teksten oppå selve mønsterets fald/søm
  // i stedet for i ledig plass under det — det var det som så rotete ut.
  const tekstbaand = 6.5
  // Egen stripe øverst til kalibreringsruta. Ruta lå før på en fast posisjon
  // (X0+1.5, Y0+1.5) uansett hvor mønsteret faktisk startet — for et bak- eller
  // forstykke, som alltid begynner nær x=0 rett ved halsen, landet ruta oppå
  // halskurven i stedet for ved siden av den.
  const kalBaand = kal + 3
  const X0 = Math.min(...alle.map(p => p.x)) - pad
  const monsterTopp = Math.min(...alle.map(p => p.y)) - pad
  const Y0 = monsterTopp - kalBaand
  const W = Math.max(...alle.map(p => p.x)) - X0 + pad
  const monsterBunn = Math.max(...alle.map(p => p.y)) + pad
  const H = monsterBunn - Y0 + tekstbaand

  const rut: string[] = []
  if (valg.visRutenett !== false) {
    // Rutenettet dekker bare mønsterets eget område, ikke kalibrerings- og
    // tekststripene — ellers fyller det opp den ledige plassen med
    // unødvendige linjer.
    for (let x = Math.ceil(X0 / 5) * 5; x <= X0 + W; x += 5)
      rut.push(`<line x1="${f(x)}" y1="${f(monsterTopp)}" x2="${f(x)}" y2="${f(monsterBunn)}"/>`)
    for (let y = Math.ceil(monsterTopp / 5) * 5; y <= monsterBunn; y += 5)
      rut.push(`<line x1="${f(X0)}" y1="${f(y)}" x2="${f(X0 + W)}" y2="${f(y)}"/>`)
  }

  const pil = (x: number, y1: number, y2: number) => `
<line x1="${f(x)}" y1="${f(y1)}" x2="${f(x)}" y2="${f(y2)}" stroke="#1a3a5c" stroke-width="0.4"/>
<path d="M ${f(x - 0.8)},${f(y1 + 1.6)} L ${f(x)},${f(y1)} L ${f(x + 0.8)},${f(y1 + 1.6)}" fill="none" stroke="#1a3a5c" stroke-width="0.4"/>
<path d="M ${f(x - 0.8)},${f(y2 - 1.6)} L ${f(x)},${f(y2)} L ${f(x + 0.8)},${f(y2 - 1.6)}" fill="none" stroke="#1a3a5c" stroke-width="0.4"/>
<text x="${f(x + 1.5)}" y="${f((y1 + y2) / 2 + 1.6)}" font-size="1.6" fill="#1a3a5c" transform="rotate(-90 ${f(x + 1.5)} ${f((y1 + y2) / 2 + 1.6)})">trådretning</text>`

  const punkt = (navn: string, p: Punkt) => `
<circle cx="${f(p.x)}" cy="${f(p.y)}" r="0.35" fill="#c1121f" stroke="none"/>
<text x="${f(p.x + 0.55)}" y="${f(p.y - 0.45)}" font-size="1.8" fill="#c1121f" font-weight="bold">${navn}</text>`

  const deltegn = medSa.map(({ del, ytre }) => {
    const h = (del.hakk ?? []).map(k =>
      `<line x1="${f(k.punkt.x)}" y1="${f(k.punkt.y)}" x2="${f(k.punkt.x + k.retning * 0.9)}" y2="${f(k.punkt.y)}" stroke="#1a3a5c" stroke-width="0.45"/>`).join('')
    const br = del.brettelinje
      ? `<line x1="${f(del.brettelinje.x)}" y1="${f(del.brettelinje.y1)}" x2="${f(del.brettelinje.x)}" y2="${f(del.brettelinje.y2)}" stroke="#8a8580" stroke-width="0.25" stroke-dasharray="3,2"/>` : ''
    const tr = del.tradretning ? pil(del.tradretning.x, del.tradretning.y1, del.tradretning.y2) : ''
    const pk = valg.visPunkter && del.punkter ? del.punkter.map(({ navn, punkt: p }) => punkt(navn, p)).join('') : ''
    return `${ytre ? `<path d="${bane(ytre)}" fill="none" stroke="#1a3a5c" stroke-width="0.45" stroke-dasharray="2.5,1.5"/>` : ''}
<path d="${bane(del.kontur)}" fill="none" stroke="#1a3a5c" stroke-width="0.6"/>${br}${tr}${h}${pk}`
  }).join('\n')

  const navnelinje = deler.map(d => `${d.navn.toUpperCase()} · klipp ${d.klippAntall ?? 2}`).join('  ·  ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W * 10)}mm" height="${f(H * 10)}mm" viewBox="${f(X0)} ${f(Y0)} ${f(W)} ${f(H)}">
<g stroke="#e6e2dc" stroke-width="0.1" fill="none">${rut.join('')}</g>
<rect x="${f(X0 + 1.5)}" y="${f(Y0 + 1.5)}" width="${kal}" height="${kal}" fill="none" stroke="#c1121f" stroke-width="0.3"/>
<text x="${f(X0 + kal + 2.2)}" y="${f(Y0 + kal * 0.72)}" font-size="2.2" fill="#c1121f">${kal} cm — mål denne</text>
${deltegn}
<line x1="${f(X0)}" y1="${f(monsterBunn)}" x2="${f(X0 + W)}" y2="${f(monsterBunn)}" stroke="#e6e2dc" stroke-width="0.15"/>
<text x="${f(X0 + 1.5)}" y="${f(monsterBunn + 2.9)}" font-size="2.8" fill="#1a3a5c">${navnelinje}</text>
<text x="${f(X0 + 1.5)}" y="${f(monsterBunn + 5.3)}" font-size="2.1" fill="#555">${valg.undertekst ?? ''}${sa > 0 ? ` · sømmonn ${sa} cm (stiplet)` : ' · uten sømmonn'}</text>
</svg>`
}

/** Last ned i nettleseren. */
export function lastNed(svg: string, filnavn: string): void {
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filnavn
  a.click()
  URL.revokeObjectURL(url)
}
