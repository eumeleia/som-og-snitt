/**
 * FLAT KROPPSBLOKK — baby og småbarn, str. 56–92 cm høyde
 *
 * Kilder: Aldrich, barneboka
 *   bokside 24–25  jerseyblokken
 *   bokside 26–27  vevd variant (modifikasjoner av jerseyblokken)
 *   bokside 38     vid hals med skulderklaff
 *
 * Status: VERIFISERT mot tekst og diagram for begge stofftyper.
 * Punktrekkefølgen nedover midtlinjen er 0, 5, 15, 4, 3, 1, 2 — bekreftet
 * mot diagrammet på s.25.
 *
 * Ingen høydegrupper. To varianter i jersey (hovedtall / parentes).
 * Vevd bygger på basisvarianten med egne modifikasjoner.
 *
 * Forskjellen mellom stofftypene er strukturell, ikke bare tall:
 * jerseyblokken deler form mellom for- og bakstykke, mens den vevde
 * har eget forstykke med egen skulderlinje (punkt 17) og eget
 * ærmegab (gjennom 16).
 */

import type { Punkt, Del } from './generator'
import { lengde } from './generator'

export type BabyVariant = 'basis' | 'romslig'
export type Stoff = 'jersey' | 'vevd'
export type Side = 'bak' | 'front'

export interface BabyMaal {
  bryst: number
  ryggbredde: number
  halsvidde: number
  skulder: number
  aermegabDybde: number
  nakkeTilMidje: number
  ermelengde: number
  haandledd: number
  ferdigLengde: number
}

interface BVar {
  p03: number; p06: number; p38: number; p312: number
  p015: number; p02erm: number; p24: number; kule9: number
}

const V: Record<BabyVariant, BVar> = {
  basis:   { p03: 2, p06: 0.2, p38: 2, p312: 3, p015: 1.5, p02erm: 1, p24: 2, kule9: 1.0 },
  romslig: { p03: 3, p06: 0.7, p38: 3, p312: 5, p015: 1.0, p02erm: 2, p24: 3, kule9: 1.5 },
}

/** Vid hals, bokside 38. Nødvendig for plagg uten åpning. */
export interface VidHals { utvid: number; senk: number }
export const VID_HALS: VidHals = { utvid: 2, senk: 1 }

export interface BabyKonstruksjon {
  P: Record<number, Punkt>
  erm: Record<number, Punkt>
  variant: BabyVariant
  stoff: Stoff
  maal: BabyMaal
  vidHals: VidHals | null
  skulderklaff: boolean
}

export function konstruer(
  m: BabyMaal,
  variant: BabyVariant = 'basis',
  stoff: Stoff = 'jersey',
  vidHals: VidHals | null = null,
  // Skulderklaffen (bok s.38) bygger videre på vid hals-geometrien — uten
  // utvidet/senket hals er det ingen ny halskurve å feste klaffen til.
  // Faller derfor tilbake på VID_HALS hvis vidHals ikke er satt eksplisitt.
  skulderklaff = false,
): BabyKonstruksjon {
  const v = V[variant]
  const effektivVidHals = skulderklaff ? (vidHals ?? VID_HALS) : vidHals
  const h = effektivVidHals ?? { utvid: 0, senk: 0 }
  const P: Record<number, Punkt> = {}

  // Vevd: 3–8 er ½ ryggbredde pluss 1 cm, uansett variant (bok s.26)
  const p38 = stoff === 'vevd' ? 1 : v.p38

  P[0] = { x: 0, y: 0 }
  P[1] = { x: 0, y: m.nakkeTilMidje }
  P[2] = { x: 0, y: m.ferdigLengde }
  P[3] = { x: 0, y: m.aermegabDybde + v.p03 }
  P[4] = { x: 0, y: P[3].y / 2 }
  P[5] = { x: 0, y: m.aermegabDybde / 4 - 1.75 }

  const halsB = m.halsvidde / 5 + v.p06 + h.utvid
  P[6] = { x: halsB, y: 0 }
  P[7] = { x: halsB, y: -1.5 + h.senk }

  P[8] = { x: m.ryggbredde / 2 + p38, y: P[3].y }
  P[9] = { x: P[8].x, y: P[4].y }
  P[10] = { x: P[8].x, y: P[5].y }
  P[11] = { x: P[10].x + 0.5, y: P[5].y }

  P[12] = { x: m.bryst / 4 + v.p312, y: P[3].y }
  P[13] = { x: P[12].x, y: P[1].y }
  P[14] = { x: P[12].x, y: P[2].y }
  P[15] = { x: 0, y: m.halsvidde / 5 - v.p015 + h.senk }

  if (stoff === 'vevd') {
    // 9–16 = 0,5 cm innover. Forstykkets ærmegab er smalere.
    P[16] = { x: P[9].x - 0.5, y: P[9].y }
    // 7–17 = lengden 7–11, men endepunktet ligger 0,4 cm under
    // linjen som er kvadrert ut fra punkt 5.
    const skulderL = Math.hypot(P[11].x - P[7].x, P[11].y - P[7].y)
    const yMaal = P[5].y + 0.4
    const dy = yMaal - P[7].y
    if (skulderL <= Math.abs(dy)) throw new Error('Skulderlengden er for kort for fremre skulderlinje')
    P[17] = { x: P[7].x + Math.sqrt(skulderL * skulderL - dy * dy), y: yMaal }
  }

  const erm: Record<number, Punkt> = {}
  erm[0] = { x: 0, y: 0 }
  erm[1] = { x: 0, y: P[3].y / 2 - 1 }
  // Vevd: full ermelengde, ingen fratrekk (bok s.26)
  erm[2] = { x: 0, y: m.ermelengde - (stoff === 'vevd' ? 0 : v.p02erm) }
  erm[4] = { x: m.haandledd / 2 + v.p24, y: erm[2].y }

  return { P, erm, variant, stoff, maal: m, vidHals: effektivVidHals, skulderklaff }
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

/** Bakre halsringning, 0 → 7. Flat fra midten, stiger mot skulderen. */
function bakHals(k: BabyKonstruksjon): Punkt[] {
  return [k.P[0], ...q(k.P[0], { x: k.P[6].x * 0.55, y: 0.2 }, k.P[7])]
}

/** Fremre halsringning, 15 → 6. */
export function fremreHals(k: BabyKonstruksjon): Punkt[] {
  const { P } = k
  return [P[15], ...q(P[15], { x: P[6].x * 0.15, y: P[15].y * 0.15 }, P[6], 16)]
}

/** Ærmegab. Bak går 11 → 9 → 12. Vevd forstykke går 17 → 16 → 12. */
function aermegab(k: BabyKonstruksjon, side: Side): Punkt[] {
  const { P } = k
  const vevdFront = k.stoff === 'vevd' && side === 'front'
  const topp = vevdFront ? P[17] : P[11]
  const midt = vevdFront ? P[16] : P[9]
  return [
    ...q(topp, { x: topp.x, y: midt.y * 0.78 }, midt),
    ...q(midt, { x: P[8].x - 0.2, y: P[3].y * 0.85 }, P[12]),
  ]
}

/** Skulderens endepunkt: bak alltid 11, vevd forstykke 17. */
function skulderPunkt(k: BabyKonstruksjon, side: Side): Punkt {
  return k.stoff === 'vevd' && side === 'front' ? k.P[17] : k.P[11]
}

/**
 * Skulderklaffen, bokside 38 («9 Tee shirts»). Bokstavene A–G er Aldrichs
 * egne, fra kapittel 9, ikke fra kroppsblokkens numre 0–17.
 *
 * A = nytt halspunkt (7 bak, 6 foran — enden på vid hals-halskurven).
 * B = skulderpunkt (samme punkt som skulderPunkt() returnerer).
 * C = kvadrert ut fra A, kvadrert opp fra B — møtes rett over B, i høyde med A.
 * D = halve B–C.
 * E = punkt på ermegapkurven, ca. 2,5 cm fra B (langs selve kurven, ikke rett linje).
 * F = E speilet om D (D–F = D–E).
 * G = F forlenget 0,5 cm videre langs D–F-linja.
 *
 * Klaffen tegnes A–G og B–G — rette linjer, boka sier ikke noe om kurveform
 * her (i motsetning til f.eks. «draw new neck curves» andre steder), så det
 * er ikke gjettet på en krumning som ikke står i teksten.
 */
function skulderklaffPunkter(k: BabyKonstruksjon, side: Side) {
  const A = side === 'bak' ? k.P[7] : k.P[6]
  const B = skulderPunkt(k, side)
  const C: Punkt = { x: B.x, y: A.y }
  const D: Punkt = { x: B.x, y: (A.y + B.y) / 2 }

  const kjede = [B, ...aermegab(k, side)]
  let akk = 0
  let E = kjede[kjede.length - 1]
  for (let i = 1; i < kjede.length; i++) {
    const seg = Math.hypot(kjede[i].x - kjede[i - 1].x, kjede[i].y - kjede[i - 1].y)
    if (akk + seg >= 2.5) {
      const t = (2.5 - akk) / seg
      E = { x: kjede[i - 1].x + (kjede[i].x - kjede[i - 1].x) * t,
            y: kjede[i - 1].y + (kjede[i].y - kjede[i - 1].y) * t }
      break
    }
    akk += seg
  }

  const F: Punkt = { x: 2 * D.x - E.x, y: 2 * D.y - E.y }
  const fdx = F.x - D.x, fdy = F.y - D.y
  const fdL = Math.hypot(fdx, fdy) || 1
  const G: Punkt = { x: F.x + (fdx / fdL) * 0.5, y: F.y + (fdy / fdL) * 0.5 }

  return { A, B, C, D, E, F, G }
}

/**
 * Aldrichs egne konstruksjonspunkter, til verifisering mot boka. Viser alle
 * punktene i `P` (også de som ikke ligger på selve klippelinja, som 6, 8, 9,
 * 10), pluss `vidHals`-punktene når de er i bruk — så avstanden mellom to
 * hvilke som helst punkter kan måles på det projiserte bildet og
 * sammenlignes direkte med boka.
 */
function konstruksjonspunkter(k: BabyKonstruksjon): { navn: string; punkt: Punkt }[] {
  return Object.entries(k.P).map(([navn, punkt]) => ({ navn, punkt }))
}

export function del(k: BabyKonstruksjon, side: Side): Del {
  const { P } = k
  const hals = side === 'bak' ? bakHals(k) : fremreHals(k)
  const start = side === 'bak' ? P[0] : P[15]
  const klaff = k.skulderklaff ? skulderklaffPunkter(k, side) : null
  const pts: Punkt[] = [
    ...hals,
    ...(klaff ? [klaff.G] : []),
    skulderPunkt(k, side),
    ...aermegab(k, side),
    P[14], P[2], start,
  ]
  return {
    navn: side === 'bak' ? 'bakstykke' : 'forstykke',
    kontur: pts,
    klippAntall: 1,
    brettelinje: { x: 0, y1: Math.min(0, P[7].y), y2: P[2].y },
    tradretning: { x: P[6].x * 0.9, y1: P[3].y + 3, y2: P[3].y + 11 },
    hakk: [{ punkt: P[13], retning: 1 }],
    punkter: [
      ...konstruksjonspunkter(k),
      ...(klaff ? Object.entries(klaff).map(([navn, punkt]) => ({ navn, punkt })) : []),
    ],
  }
}

// ───────────────────── mål og sjekker ─────────────────────

export function halsaapning(k: BabyKonstruksjon): number {
  return 2 * (lengde(bakHals(k)) + lengde(fremreHals(k)))
}

export function aermegabLengde(k: BabyKonstruksjon): number {
  return lengde(aermegab(k, 'bak')) + lengde(aermegab(k, 'front'))
}

/**
 * Går plagget over hodet uten åpning?
 * Strekkfaktoren er et anslag, ikke fra boka: ca. 1,35 for vanlig jersey,
 * 1,6–2,0 for ribb, 1,0 for vevd. Behandle svaret som en pekepinn.
 */
export function sjekkHode(k: BabyKonstruksjon, hodeomkrets: number, strekk?: number) {
  const s = strekk ?? (k.stoff === 'vevd' ? 1.0 : 1.35)
  const a = halsaapning(k)
  const maks = a * s
  // Denne sjekken måler bare halsåpningens egen strekk — den vet ikke at en
  // skulderklaff (bok s.38) løser samme problem på en annen måte, ved å åpne
  // et gap ved skulderen i stedet for at halskurven selv strekker seg. Uten
  // dette unntaket ville meldingen foreslå å legge inn en klaff som allerede
  // er lagt inn (k.skulderklaff), i alle stoff-varianter.
  const rad = k.skulderklaff
    ? 'Skulderklaffen (bok s.38) er allerede lagt inn — den åpner et gap ved skulderen når plagget dras over hodet, uavhengig av halsåpningens egen strekk. Sjekk at gapet (E–F–G-punktene) faktisk er stort nok.'
    : k.stoff === 'vevd'
      ? 'Vevd stoff gir ikke etter. Plagget må ha knapper, splitt eller skulderklaff (bok s.38).'
      : 'Bruk vid hals (bok s.38) eller legg inn skulderklaff.'
  return {
    ok: maks > hodeomkrets, aapning: a, strukket: maks,
    melding: maks > hodeomkrets
      ? `Halsåpning ${a.toFixed(1)} cm, strukket ca. ${maks.toFixed(1)} cm mot hode ${hodeomkrets} cm.`
      : `Halsåpning ${a.toFixed(1)} cm, strukket ca. ${maks.toFixed(1)} cm — mindre enn hodet på ${hodeomkrets} cm. ${rad}`,
  }
}

function kuleOffset(t: number, hev9: number): number {
  const pkt: [number, number][] = [[0, 0], [2 / 7, 0.2], [5 / 7, hev9], [1, 0]]
  for (let i = 1; i < pkt.length; i++) {
    if (t <= pkt[i][0]) {
      const [t0, v0] = pkt[i - 1], [t1, v1] = pkt[i]
      const u = (t - t0) / (t1 - t0)
      return v0 + (v1 - v0) * (u * u * (3 - 2 * u))
    }
  }
  return 0
}

export function ermDel(k: BabyKonstruksjon): Del {
  const { erm } = k
  const A = aermegabLengde(k) / 2      // ermet matcher halve ærmegabet per side
  const dy = erm[1].y
  if (A <= dy) throw new Error('Ærmegabet er kortere enn ermkulehøyden')
  const P3: Punkt = { x: Math.sqrt(A * A - dy * dy), y: dy }
  const vx = -P3.x, vy = -P3.y
  const L = Math.hypot(vx, vy), nx = -vy / L, ny = vx / L
  const kule: Punkt[] = []
  for (let i = 0; i <= 42; i++) {
    const t = i / 42, o = kuleOffset(t, V[k.variant].kule9)
    kule.push({ x: P3.x + vx * t + nx * o, y: P3.y + vy * t + ny * o })
  }
  return {
    navn: 'erm',
    kontur: [...kule, { x: 0, y: erm[2].y }, erm[4], P3],
    klippAntall: 2,
    brettelinje: { x: 0, y1: erm[0].y, y2: erm[2].y },
    tradretning: { x: P3.x * 0.45, y1: erm[1].y + 2, y2: erm[1].y + 9 },
    hakk: [{ punkt: kule[12], retning: -1 }],
    punkter: [
      { navn: '0', punkt: erm[0] }, { navn: '1', punkt: erm[1] },
      { navn: '2', punkt: erm[2] }, { navn: '3', punkt: P3 }, { navn: '4', punkt: erm[4] },
    ],
  }
}

export function valider(k: BabyKonstruksjon): string[] {
  const feil: string[] = []
  const { P } = k
  if (P[12].x <= P[8].x) feil.push('Brystlinjen er ikke bredere enn ryggbredden')
  if (P[2].y <= P[3].y) feil.push('Ferdig lengde er kortere enn ærmegabdybden')
  if (P[5].y >= P[4].y) feil.push('Skulderlinjen ligger under brystlinjen')
  if (P[15].y <= 0) feil.push('Fremre halsdybde er null eller negativ')
  if (k.stoff === 'vevd' && !P[17]) feil.push('Vevd blokk mangler fremre skulderpunkt')
  // sømlengdene som skal møtes
  const bak = lengde(aermegab(k, 'bak')), fram = lengde(aermegab(k, 'front'))
  if (Math.abs(bak - fram) > bak * 0.15)
    feil.push(`Ærmegabene avviker mye: bak ${bak.toFixed(1)} cm, foran ${fram.toFixed(1)} cm`)
  return feil
}
