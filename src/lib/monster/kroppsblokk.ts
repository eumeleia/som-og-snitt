/**
 * FLAT KROPPSBLOKK OG SKJORTEBLOKK — barn, str. 80–170 cm høyde
 *
 * Kilde: Aldrich, barneboka, bokside 40–41.
 * Status: VERIFISERT mot tekst og diagram.
 * Punktrekkefølgen nedover midtlinjen er 0, 6, 10, 16, 9, 7, 1, 2 —
 * bekreftet mot diagrammet.
 *
 * Én konstruksjon, to blokker: hovedtall gir kroppsblokk, parentes gir
 * skjorteblokk. Ermene er forskjellige — kroppsermet deles i seks
 * seksjoner, skjorteermet i fem og har lavere ermkule.
 *
 * Egnet for vevd og jersey. Boka: kort ermelengden 2–4 cm ved jersey.
 *
 * Forstykket har egen skulderlinje (18) og eget ermegap (gjennom 17),
 * som i den vevde babyblokken.
 */

import type { Punkt, Del } from './generator'
import { lengde } from './generator'

export type Blokktype = 'kropp' | 'skjorte'
export type Side = 'bak' | 'front'

export interface KroppMaal {
  hoydeCm: number
  bryst: number
  ryggbredde: number
  halsvidde: number
  skulder: number
  ermegapDybde: number
  nakkeTilMidje: number
  midjeTilHofte: number
  ermelengde: number
  jersey?: boolean      // korter ermet 3 cm, jf. bokas 2–4 cm
}

type G = 0 | 1 | 2
const gruppe = (h: number): G => (h <= 116 ? 0 : h <= 140 ? 1 : 2)

// [kroppsblokk, skjorteblokk] per høydegruppe
const P03: [number, number][] = [[3, 4.5], [3.25, 5], [3.5, 5.5]]        // ¼ bryst +
const P67: [number, number][] = [[1.5, 2.5], [1.75, 3], [2, 3.5]]        // ermegapdybde +
const P712: [number, number][] = [[1.25, 2.5], [1.5, 3], [1.75, 3.5]]    // ½ ryggbredde +
const P1415 = [0.9, 1.1, 1.3]      // skulderpunktets forlengelse
const P1317 = [0.6, 0.8, 1.0]      // forstykkets innrykk ved 13
const LINJE10 = [0.4, 0.6, 0.8]    // ny linje under linjen fra 10
const KULE_KROPP = [1.2, 1.4, 1.6] // heving av ermkulen ved punkt 8
const KULE_SKJORTE = [0.9, 1.1, 1.3]

export interface KroppKonstruksjon {
  P: Record<number, Punkt>
  type: Blokktype
  maal: KroppMaal
  g: G
}

export function konstruer(m: KroppMaal, type: Blokktype = 'kropp'): KroppKonstruksjon {
  const g = gruppe(m.hoydeCm)
  const i = type === 'kropp' ? 0 : 1
  const P: Record<number, Punkt> = {}

  P[0] = { x: 0, y: 0 }
  P[6] = { x: 0, y: 1.25 }                                        // midt bak i halsen
  P[3] = { x: m.bryst / 4 + P03[g][i], y: 0 }                     // ¼ bryst +
  P[7] = { x: 0, y: P[6].y + m.ermegapDybde + P67[g][i] }        // ermegapdybdelinje
  P[8] = { x: P[3].x, y: P[7].y }
  P[9] = { x: 0, y: P[6].y + (P[7].y - P[6].y) / 2 }              // ½ av 6–7
  P[10] = { x: 0, y: P[6].y + m.ermegapDybde / 4 - 2 }           // ¼ ermegapdybde − 2
  P[11] = { x: m.halsvidde / 5, y: 0 }                            // halspunkt, delt
  P[16] = { x: 0, y: m.halsvidde / 5 }                            // midt foran i halsen

  P[12] = { x: m.ryggbredde / 2 + P712[g][i], y: P[7].y }
  P[13] = { x: P[12].x, y: P[9].y }
  P[14] = { x: P[12].x, y: P[10].y }
  P[15] = { x: P[14].x + P1415[g], y: P[10].y }                   // bakre skulderpunkt

  // forstykket
  P[17] = { x: P[13].x - P1317[g], y: P[13].y }
  const yNy = P[10].y + LINJE10[g]
  const skulderL = Math.hypot(P[15].x - P[11].x, P[15].y - P[11].y)
  const dy = yNy - P[11].y
  if (skulderL <= Math.abs(dy)) throw new Error('Skulderlengden er for kort for fremre skulderlinje')
  P[18] = { x: P[11].x + Math.sqrt(skulderL * skulderL - dy * dy), y: yNy }

  P[1] = { x: 0, y: m.nakkeTilMidje + 1.25 }                      // midjelinje
  P[2] = { x: 0, y: P[1].y + m.midjeTilHofte }                    // hoftelinje
  P[4] = { x: P[3].x, y: P[1].y }
  P[5] = { x: P[3].x, y: P[2].y }

  return { P, type, maal: m, g }
}

// ───────────────────── kurver ─────────────────────

function q(a: Punkt, c: Punkt, b: Punkt, n = 14): Punkt[] {
  const ut: Punkt[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t
    ut.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
              y: u * u * a.y + 2 * u * t * c.y + t * t * b.y })
  }
  return ut
}

/** Bakre halsringning 6 → 11. Fremre 16 → 11. */
function halsKurve(k: KroppKonstruksjon, side: Side): Punkt[] {
  const { P } = k
  return side === 'bak'
    ? [P[6], ...q(P[6], { x: P[11].x * 0.55, y: P[6].y * 0.9 }, P[11])]
    : [P[16], ...q(P[16], { x: P[11].x * 0.15, y: P[16].y * 0.15 }, P[11], 16)]
}

/** Ermegap. Bak 15 → 13 → 8. Foran 18 → 17 → 8. */
function ermegap(k: KroppKonstruksjon, side: Side): Punkt[] {
  const { P } = k
  const topp = side === 'bak' ? P[15] : P[18]
  const midt = side === 'bak' ? P[13] : P[17]
  return [
    ...q(topp, { x: topp.x, y: midt.y * 0.82 }, midt),
    ...q(midt, { x: P[12].x - 0.2, y: P[7].y * 0.9 }, P[8]),
  ]
}

export function del(k: KroppKonstruksjon, side: Side, tilHofte = true): Del {
  const { P } = k
  const bunnM = tilHofte ? P[2] : P[1]
  const bunnS = tilHofte ? P[5] : P[4]
  // Boka: forstykkets midjelinje kan senkes 1 cm på str. opp til 116
  const senk = side === 'front' && k.maal.hoydeCm <= 116 && !tilHofte ? 1 : 0
  const start = side === 'bak' ? P[6] : P[16]
  return {
    navn: side === 'bak' ? 'bakstykke' : 'forstykke',
    kontur: [
      ...halsKurve(k, side),
      ...ermegap(k, side),
      bunnS,
      { x: 0, y: bunnM.y + senk },
      start,
    ],
    klippAntall: 1,
    brettelinje: { x: 0, y1: 0, y2: bunnM.y + senk },
    tradretning: { x: P[11].x * 1.1, y1: P[7].y + 3, y2: P[7].y + 13 },
    hakk: [{ punkt: P[1], retning: 1 }],
  }
}

export const ermegapLengde = (k: KroppKonstruksjon, side: Side) => lengde(ermegap(k, side))

/** Samlet ermegap, bak pluss front. Ermets punkt 3 avhenger av det. */
export const ermegapTotal = (k: KroppKonstruksjon) =>
  ermegapLengde(k, 'bak') + ermegapLengde(k, 'front')

/**
 * Ermkulens forskyvning fra korden 3→0.
 * Kroppserm: seks seksjoner, hult 0,3 ved punkt 5 (t=1/6),
 * rører korden ved 6 (t=2/6), hevet ved 8 (t=4/6).
 * Skjorteerm: fem seksjoner, hult 0,3 ved 5 (t=1/5),
 * rører ved 6 (t=2/5), hevet mellom 7 og 8 (t=3,5/5).
 */
function kuleOffset(t: number, type: Blokktype, hev: number): number {
  const pkt: [number, number][] = type === 'kropp'
    ? [[0, 0], [1 / 6, -0.3], [2 / 6, 0], [4 / 6, hev], [1, 0]]
    : [[0, 0], [1 / 5, -0.3], [2 / 5, 0], [3.5 / 5, hev], [1, 0]]
  for (let i = 1; i < pkt.length; i++) {
    if (t <= pkt[i][0]) {
      const [t0, v0] = pkt[i - 1], [t1, v1] = pkt[i]
      const u = (t - t0) / (t1 - t0)
      return v0 + (v1 - v0) * (u * u * (3 - 2 * u))
    }
  }
  return 0
}

export function ermDel(k: KroppKonstruksjon): Del {
  const { P, maal, type, g } = k
  const sekshoyde = P[7].y - P[6].y
  // 0–1: kroppserm ½ av 6–7 pluss 1 cm · skjorteerm ⅓ av 6–7
  const y1 = type === 'kropp' ? sekshoyde / 2 + 1 : sekshoyde / 3
  const y2 = maal.ermelengde - 1 - (maal.jersey ? 3 : 0)
  const A = ermegapLengde(k, 'bak')            // halve ermkulen matcher bakre ermegap
  if (A <= y1) throw new Error('Ermegapet er kortere enn ermkulehøyden')
  const P3: Punkt = { x: Math.sqrt(A * A - y1 * y1), y: y1 }
  // 2–4: ⅔ av målet 1–3, kroppserm pluss 0,5 cm
  const x4 = (P3.x * 2) / 3 + (type === 'kropp' ? 0.5 : 0)

  const hev = (type === 'kropp' ? KULE_KROPP : KULE_SKJORTE)[g]
  const vx = -P3.x, vy = -P3.y
  const L = Math.hypot(vx, vy), nx = -vy / L, ny = vx / L
  const kule: Punkt[] = []
  const n = 42
  for (let i = 0; i <= n; i++) {
    const t = i / n, o = kuleOffset(t, type, hev)
    kule.push({ x: P3.x + vx * t + nx * o, y: P3.y + vy * t + ny * o })
  }
  // pitch point: punkt 6 på ermet
  const tPitch = type === 'kropp' ? 2 / 6 : 2 / 5
  const pitch = kule[Math.round(tPitch * n)]

  return {
    navn: type === 'kropp' ? 'erm' : 'skjorteerm',
    kontur: [...kule, { x: 0, y: y2 }, { x: x4, y: y2 }, P3],
    klippAntall: 2,
    brettelinje: { x: 0, y1: 0, y2 },
    tradretning: { x: P3.x * 0.45, y1: y1 + 3, y2: y1 + 12 },
    hakk: [{ punkt: pitch, retning: -1 }],
  }
}

export function valider(k: KroppKonstruksjon): string[] {
  const feil: string[] = []
  const { P } = k
  if (P[3].x <= P[12].x) feil.push('Brystlinjen er ikke bredere enn ryggbredden')
  if (P[10].y >= P[9].y) feil.push('Skulderlinjen ligger under brystlinjen')
  if (P[16].y <= P[6].y) feil.push('Fremre halsdybde er ikke dypere enn bakre')
  if (P[2].y <= P[7].y) feil.push('Hoftelinjen ligger over ermegapet')
  const b = ermegapLengde(k, 'bak'), f = ermegapLengde(k, 'front')
  if (Math.abs(b - f) > b * 0.15)
    feil.push(`Ermegapene avviker mye: bak ${b.toFixed(1)}, foran ${f.toFixed(1)}`)
  return feil
}
