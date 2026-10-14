// Perseptuell fargeavstand: sRGB-hex → CIELAB (D65) → CIEDE2000.
// ΔE2000-formelen følger Sharma, Wu & Dalal (2005) og er testet mot deres publiserte
// testpar i fargeavstand.test.ts.

export type Lab = [number, number, number]

function lineariser(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

// sRGB → XYZ-matrise og D65-hvitpunkt fra IEC 61966-2-1.
const XN = 0.95047, YN = 1.0, ZN = 1.08883
const EPS = 216 / 24389
const KAPPA = 24389 / 27

function f(t: number): number {
  return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116
}

export function hexTilLab(hex: string): Lab {
  const h = hex.replace('#', '')
  const r = lineariser(parseInt(h.slice(0, 2), 16))
  const g = lineariser(parseInt(h.slice(2, 4), 16))
  const b = lineariser(parseInt(h.slice(4, 6), 16))
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
  const z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
  const fx = f(x / XN), fy = f(y / YN), fz = f(z / ZN)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const RAD = Math.PI / 180
const P25_7 = Math.pow(25, 7)

function hueGrader(b: number, a: number): number {
  if (a === 0 && b === 0) return 0
  const h = Math.atan2(b, a) / RAD
  return h < 0 ? h + 360 : h
}

export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar7 = Math.pow((C1 + C2) / 2, 7)
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + P25_7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h1p = hueGrader(b1, a1p)
  const h2p = hueGrader(b2, a2p)

  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD)

  const Lbarp = (L1 + L2) / 2
  const Cbarp = (C1p + C2p) / 2
  let hbarp = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2
    else hbarp = (h1p + h2p - 360) / 2
  }

  const T = 1
    - 0.17 * Math.cos((hbarp - 30) * RAD)
    + 0.24 * Math.cos(2 * hbarp * RAD)
    + 0.32 * Math.cos((3 * hbarp + 6) * RAD)
    - 0.20 * Math.cos((4 * hbarp - 63) * RAD)
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2))
  const Cbarp7 = Math.pow(Cbarp, 7)
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + P25_7))
  const L50sq = (Lbarp - 50) * (Lbarp - 50)
  const SL = 1 + (0.015 * L50sq) / Math.sqrt(20 + L50sq)
  const SC = 1 + 0.045 * Cbarp
  const SH = 1 + 0.015 * Cbarp * T
  const RT = -Math.sin(2 * dTheta * RAD) * RC

  const l = dLp / SL, c = dCp / SC, hh = dHp / SH
  return Math.sqrt(l * l + c * c + hh * hh + RT * c * hh)
}

export function deltaE2000Hex(hex1: string, hex2: string): number {
  return deltaE2000(hexTilLab(hex1), hexTilLab(hex2))
}
