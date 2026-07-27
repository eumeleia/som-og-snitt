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
 * Bruker vinkelhalveringslinjen i hvert hjørne, med et tak på
 * forlengelsen så spisse hjørner ikke skyter ut i det uendelige.
 */
export function sommonn(poly: Punkt[], d: number): Punkt[] {
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
    const cosHalv = Math.max(0.35, n1.x * mx + n1.y * my)  // tak på spisse hjørner
    ut.push({ x: p1.x + (mx * d) / cosHalv, y: p1.y + (my * d) / cosHalv })
  }
  return ut
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
}

export interface SvgValg {
  sommonnCm?: number      // 0 = ingen
  visRutenett?: boolean
  kalibreringCm?: number  // størrelse på kontrollruta, standard 5
  undertekst?: string
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
  const X0 = Math.min(...alle.map(p => p.x)) - pad
  const Y0 = Math.min(...alle.map(p => p.y)) - pad
  const W = Math.max(...alle.map(p => p.x)) - X0 + pad
  const H = Math.max(...alle.map(p => p.y)) - Y0 + pad

  const rut: string[] = []
  if (valg.visRutenett !== false) {
    for (let x = Math.ceil(X0 / 5) * 5; x <= X0 + W; x += 5)
      rut.push(`<line x1="${f(x)}" y1="${f(Y0)}" x2="${f(x)}" y2="${f(Y0 + H)}"/>`)
    for (let y = Math.ceil(Y0 / 5) * 5; y <= Y0 + H; y += 5)
      rut.push(`<line x1="${f(X0)}" y1="${f(y)}" x2="${f(X0 + W)}" y2="${f(y)}"/>`)
  }

  const pil = (x: number, y1: number, y2: number) => `
<line x1="${f(x)}" y1="${f(y1)}" x2="${f(x)}" y2="${f(y2)}" stroke="#1a3a5c" stroke-width="0.4"/>
<path d="M ${f(x - 0.8)},${f(y1 + 1.6)} L ${f(x)},${f(y1)} L ${f(x + 0.8)},${f(y1 + 1.6)}" fill="none" stroke="#1a3a5c" stroke-width="0.4"/>
<path d="M ${f(x - 0.8)},${f(y2 - 1.6)} L ${f(x)},${f(y2)} L ${f(x + 0.8)},${f(y2 - 1.6)}" fill="none" stroke="#1a3a5c" stroke-width="0.4"/>
<text x="${f(x + 1.4)}" y="${f((y1 + y2) / 2)}" font-size="2.2" fill="#1a3a5c">trådretning</text>`

  const deltegn = medSa.map(({ del, ytre }) => {
    const h = (del.hakk ?? []).map(k =>
      `<line x1="${f(k.punkt.x)}" y1="${f(k.punkt.y)}" x2="${f(k.punkt.x + k.retning * 0.9)}" y2="${f(k.punkt.y)}" stroke="#1a3a5c" stroke-width="0.45"/>`).join('')
    const br = del.brettelinje
      ? `<line x1="${f(del.brettelinje.x)}" y1="${f(del.brettelinje.y1)}" x2="${f(del.brettelinje.x)}" y2="${f(del.brettelinje.y2)}" stroke="#8a8580" stroke-width="0.25" stroke-dasharray="3,2"/>` : ''
    const tr = del.tradretning ? pil(del.tradretning.x, del.tradretning.y1, del.tradretning.y2) : ''
    return `${ytre ? `<path d="${bane(ytre)}" fill="none" stroke="#1a3a5c" stroke-width="0.45" stroke-dasharray="2.5,1.5"/>` : ''}
<path d="${bane(del.kontur)}" fill="none" stroke="#1a3a5c" stroke-width="0.6"/>${br}${tr}${h}`
  }).join('\n')

  const navnelinje = deler.map(d => `${d.navn.toUpperCase()} · klipp ${d.klippAntall ?? 2}`).join('  ·  ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W * 10)}mm" height="${f(H * 10)}mm" viewBox="${f(X0)} ${f(Y0)} ${f(W)} ${f(H)}">
<g stroke="#e6e2dc" stroke-width="0.1" fill="none">${rut.join('')}</g>
<rect x="${f(X0 + 1.5)}" y="${f(Y0 + 1.5)}" width="${kal}" height="${kal}" fill="none" stroke="#c1121f" stroke-width="0.3"/>
<text x="${f(X0 + kal + 2.2)}" y="${f(Y0 + kal * 0.72)}" font-size="2.2" fill="#c1121f">${kal} cm — mål denne</text>
${deltegn}
<text x="${f(X0 + 1.5)}" y="${f(Y0 + H - 6)}" font-size="2.8" fill="#1a3a5c">${navnelinje}</text>
<text x="${f(X0 + 1.5)}" y="${f(Y0 + H - 2.8)}" font-size="2.1" fill="#555">${valg.undertekst ?? ''}${sa > 0 ? ` · sømmonn ${sa} cm (stiplet)` : ' · uten sømmonn'}</text>
</svg>`
}

/**
 * Forskyver deler langs x-aksen slik at de ligger ved siden av hverandre
 * uten overlapp. Flytter kontur, brettelinje, tradretning og hakk samlet.
 */
export function plasser(deler: Del[], mellomrom = 4): Del[] {
  let offset = 0
  return deler.map(d => {
    const xs = d.kontur.map(p => p.x)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const dx = offset - minX
    const skift = (p: Punkt): Punkt => ({ x: p.x + dx, y: p.y })
    offset += maxX - minX + mellomrom
    return {
      ...d,
      kontur: d.kontur.map(skift),
      hakk: d.hakk?.map(h => ({ ...h, punkt: skift(h.punkt) })),
      tradretning: d.tradretning ? { ...d.tradretning, x: d.tradretning.x + dx } : undefined,
      brettelinje: d.brettelinje ? { ...d.brettelinje, x: d.brettelinje.x + dx } : undefined,
    }
  })
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
