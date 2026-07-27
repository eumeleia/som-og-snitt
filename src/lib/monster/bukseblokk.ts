/**
 * FLAT BUKSEBLOKK I ETT STYKKE — barn, str. 80–170 cm høyde
 *
 * Kilde: Aldrich, barneboka, bokside 50–51.
 * Status: VERIFISERT. Alle 18 punktene er kryssjekket mot bokas tekst
 * og mot konstruksjonsdiagrammet på bokside 51.
 *
 * Rettelser gjort under verifiseringen:
 *   4–7    er ¼ av 4–5, ikke ½
 *   2–9    er ¾ av målet 1–4, ikke en justering fra punkt 4
 *   15–16  er variantavhengig (0,75 / 0,75 / 1,0), ikke fast 0,75
 *   15–16  går NEDOVER fra skrittlinjen, ikke oppover
 *
 * Koordinatsystem: punkt 0 i origo øverst, x øker utover mot skrittet,
 * y øker nedover. Linjen 0–1–2 er brettelinje i konstruksjonen og blir
 * sidesøm i det ferdige mønsteret — buksa har ingen sidesøm.
 */

import type { Punkt, Segment, Del } from './generator'
import { flat, dedup, speil, hjorne, bue } from './generator'

export type Passform = 'leggings' | 'basis' | 'romslig'

export interface BukseMaal {
  hoydeCm: number      // styrer hvilken breddekonstant som gjelder
  hofte: number        // hofte/setevidde, omkrets
  bodyRise: number     // midje til skrittnivå, sittende
  innsideBen: number   // skritt til ankel
}

/**
 * Variantavhengige verdier. Boka oppgir hovedtall = leggings,
 * første parentes = basis, andre parentes = romslig.
 */
interface Variant {
  rise: number       // 0–1: tillegg til body rise
  leg: number        // 1–2: tillegg
  kurve4: number     // fremre skrittkurve, avstand fra punkt 4
  bakKurve4: number  // bakre skrittkurve, avstand fra punkt 4
  inn811: number     // innbøying, fremre innsidesøm
  inn1618: number    // innbøying, bakre innsidesøm
  p29: number        // 2–9: justering på ¾ av målet 1–4
  p1011: number      // 10–11
  p917: number       // 9–17
  p1118: number      // 11–18
  p815: number       // 8–15: fratrekk fra målet 4–8
  p1516: number      // 15–16: fall under skrittlinjen
  p612: number       // 6–12, og samme verdi opp til 13
}

const V: Record<Passform, Variant> = {
  leggings: { rise: 0, leg: 0, kurve4: 1.75, bakKurve4: 3.75, inn811: 0.6, inn1618: 1.0,
              p29: -1.0, p1011: 1.0, p917: 1.0, p1118: 1.5, p815: 0.2, p1516: 0.75, p612: 2.5 },
  basis:    { rise: 1, leg: 1, kurve4: 2.0,  bakKurve4: 4.0,  inn811: 0.6, inn1618: 1.0,
              p29:  0.5, p1011: 1.5, p917: 1.5, p1118: 2.0, p815: 1.0, p1516: 0.75, p612: 2.5 },
  romslig:  { rise: 3, leg: 3, kurve4: 2.5,  bakKurve4: 4.5,  inn811: 0.8, inn1618: 1.2,
              p29:  0.5, p1011: 2.0, p917: 2.0, p1118: 2.5, p815: 0.5, p1516: 1.0,  p612: 3.0 },
}

/**
 * Punkt 1–4: ¼ hofte/sete med tillegg som avhenger av høyde og passform.
 * Boka: 80–116 cm minus 1 cm (+3,5) (+5,5) · 122–164 cm minus 1,5 cm (+4) (+6)
 */
function bredde14(m: BukseMaal, p: Passform): number {
  const kvart = m.hofte / 4
  const liten = m.hoydeCm <= 116
  if (p === 'leggings') return kvart - (liten ? 1.0 : 1.5)
  if (p === 'basis') return kvart + (liten ? 3.5 : 4.0)
  return kvart + (liten ? 5.5 : 6.0)
}

export interface Konstruksjon {
  P: Record<number, Punkt>
  v: Variant
  b: number
  passform: Passform
  maal: BukseMaal
}

/** Setter alle 18 punktene. */
export function konstruer(m: BukseMaal, passform: Passform = 'basis'): Konstruksjon {
  const v = V[passform]
  const b = bredde14(m, passform)
  const P: Record<number, Punkt> = {}

  // ── FORSTYKKE ──
  P[0] = { x: 0, y: 0 }
  P[1] = { x: 0, y: m.bodyRise + 1 + v.rise }                // skrittlinje
  P[2] = { x: 0, y: P[1].y + (m.innsideBen - 1 + v.leg) }    // ankel
  P[3] = { x: 0, y: P[1].y + (P[2].y - P[1].y) / 2 }         // knelinje, ½ av 1–2
  P[4] = { x: b, y: P[1].y }
  P[5] = { x: b, y: 0 }
  P[6] = { x: b - 1, y: 0 }                                   // 5–6 = 1 cm
  P[7] = { x: b, y: P[4].y - (P[4].y - P[5].y) / 4 }          // ¼ av 4–5
  P[8] = { x: b + (b / 4 - 0.5), y: P[1].y }                  // ¼ av 1–4, minus 0,5
  P[9] = { x: (b * 3) / 4 + v.p29, y: P[2].y }                // ¾ av 1–4
  P[10] = { x: P[9].x, y: P[3].y }                            // loddrett opp til knelinjen
  P[11] = { x: P[10].x + v.p1011, y: P[3].y }

  // ── BAKSTYKKE ──
  P[12] = { x: P[6].x - v.p612, y: 0 }                        // innover mot midten
  P[13] = { x: P[12].x, y: -v.p612 }                          // og like langt opp
  P[14] = { x: b, y: P[4].y - (P[4].y - P[5].y) / 2 }         // ½ av 4–5
  P[15] = { x: P[8].x + ((P[8].x - b) - v.p815), y: P[1].y }  // videre ut fra 8
  P[16] = { x: P[15].x, y: P[1].y + v.p1516 }                 // NED under skrittlinjen
  P[17] = { x: P[9].x + v.p917, y: P[2].y }
  P[18] = { x: P[11].x + v.p1118, y: P[3].y }

  return { P, v, b, passform, maal: m }
}

/**
 * Ferdig endel: bakstykke pluss speilet forstykke, sammenføyd på 0–1–2.
 * Resultatet kan sendes rett inn i tilSvg().
 */
export function tilDel(k: Konstruksjon): Del {
  const { P, v } = k
  const t4f = hjorne(P[4], v.kurve4)
  const t4b = hjorne(P[4], v.bakKurve4)
  const S = speil

  const bak: Segment[] = [
    { type: 'Q', from: P[13], ctrl: P[14], to: t4b },
    { type: 'Q', from: t4b, ctrl: { x: P[16].x - 0.5, y: P[16].y - 0.5 }, to: P[16] },
    { type: 'Q', from: P[16], ctrl: bue(P[16], P[18], -v.inn1618), to: P[18] },
    { type: 'L', to: P[17] },
    { type: 'L', to: P[2] },
  ]
  const front: Segment[] = [
    { type: 'L', to: S(P[9]) },
    { type: 'Q', from: S(P[9]), ctrl: S(bue(P[8], P[11], -v.inn811)), to: S(P[8]) },
    { type: 'Q', from: S(P[8]), ctrl: S({ x: P[8].x - 0.5, y: P[8].y - 0.5 }), to: S(t4f) },
    { type: 'Q', from: S(t4f), ctrl: S(P[7]), to: S(P[6]) },
    { type: 'L', to: P[0] },
  ]

  return {
    navn: 'bukse',
    kontur: dedup([P[13], ...flat(bak), ...flat(front)]),
    klippAntall: 2,
    tradretning: { x: 0, y1: P[1].y + 3, y2: P[3].y + 6 },
    hakk: [
      { punkt: P[16], retning: 1 },
      { punkt: S(P[8]), retning: -1 },
      { punkt: P[18], retning: 1 },
      { punkt: S(P[11]), retning: -1 },
    ],
  }
}

/** Sjekker som må gå gjennom før mønsteret vises. */
export function valider(k: Konstruksjon): string[] {
  const feil: string[] = []
  const { P, b } = k
  if (P[8].x <= b) feil.push('Fremre skrittutlegg er null eller negativt')
  if (P[15].x <= P[8].x) feil.push('Bakre skrittutlegg er ikke større enn fremre')
  if (P[2].y <= P[1].y) feil.push('Benlengden er null eller negativ')
  if (P[9].x <= 0) feil.push('Ankelbredden er null eller negativ')
  if (P[3].y <= P[1].y || P[3].y >= P[2].y) feil.push('Knelinjen ligger utenfor benet')
  return feil
}
