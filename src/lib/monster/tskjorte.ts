/**
 * T-SKJORTEBLOKK — barn, str. 80–170 cm høyde
 *
 * Kilde: Aldrich, barneboka, bokside 48–49.
 * Status: VERIFISERT. Alle brøker, punkter og kurveformer er kryssjekket
 * mot bokas tekst (s. 48) og konstruksjonsdiagram (s. 49).
 *
 * Avklart mot diagrammet:
 *   punktrekkefølgen nedover midtlinjen er 0, 5, 14, 4, 3, 1, 2
 *   «1–2 finished length» er lengden målt fra 0, ikke fra 1
 *   bakre halsringning går 0 → 7, fremre går 14 → 6
 *   ærmegabet går 11 → 9 → 12, hult øverst, utsvingt mot 12
 *
 * Tre varianter. Boka: hovedtall = tettsittende ribbet t-skjorte,
 * første parentes = basis t-skjorte, andre parentes = romslig.
 *
 * Koordinatsystem: punkt 0 øverst ved midt bak/foran i halsen.
 * x øker utover mot sidesømmen, y øker nedover. Negativ y er over
 * halslinjen (punkt 7 ligger der).
 *
 * Merk: dette er en jerseyblokk. Ermelengdene i tabellen er allerede
 * for vevd — boka sier at de skal kortes 2–4 cm avhengig av hvor mye
 * stoffet strekker seg og hvor godt det henter seg inn igjen. Det er
 * lagt inn som `p02` per variant.
 */

import type { Punkt, Del } from './generator'
import { lengde } from './generator'

export type TVariant = 'ribbet' | 'basis' | 'romslig'

export interface TskjorteMaal {
  hoydeCm: number
  bryst: number
  ryggbredde: number
  halsvidde: number
  aermegabDybde: number
  nakkeTilMidje: number
  ermelengde: number
  haandledd: number
  ferdigLengde: number   // designvalg
}

/** Høydegruppene boka bruker: 80–116, 122–140, 146–170. */
type Gruppe = 0 | 1 | 2
function gruppe(h: number): Gruppe {
  if (h <= 116) return 0
  if (h <= 140) return 1
  return 2
}

/** Trippel per høydegruppe, én verdi per variant. */
type PerGruppe = [number, number, number]

interface TVar {
  /** 0–3: ærmegabdybde, justering per høydegruppe */
  p03: [PerGruppe, PerGruppe, PerGruppe]
  /** 0–6: ⅕ halsvidde − 0,5, med varianttillegg */
  p06: number
  /** 6–7: heving av bakre halspunkt, per høydegruppe */
  p67: PerGruppe
  /** 3–8: ½ ryggbredde, justering */
  p38: [PerGruppe, PerGruppe, PerGruppe]
  /** 3–12: ¼ brystvidde, justering */
  p312: [PerGruppe, PerGruppe, PerGruppe]
  /** 0–2 på ermet: fratrekk fra ermelengden */
  p02: number
  /** ermets 0–1: fratrekk etter «pluss 1 cm» */
  erm01: number
  /** 2–4 på ermet: ½ håndledd − 1,5, med varianttillegg */
  p24: number
  /** heving av ermkulen ved punkt 8, per høydegruppe */
  kule8: PerGruppe
}

// Rekkefølge i alle tripler: [ribbet, basis, romslig]
const JUST = {
  // 0–3 per høydegruppe
  p03: [[-1, 2.5, 5], [-1.5, 2.75, 5.25], [-2, 3, 5.5]] as [PerGruppe, PerGruppe, PerGruppe],
  // 3–8 per høydegruppe
  p38: [[-1, 1, 2.5], [-1.25, 1.25, 2.75], [-1.5, 1.5, 3]] as [PerGruppe, PerGruppe, PerGruppe],
  // 3–12 per høydegruppe
  p312: [[-1.5, 2, 4], [-1.75, 2.25, 4.25], [-2, 2.5, 4.5]] as [PerGruppe, PerGruppe, PerGruppe],
  // 6–7 og ermkulehevning: like verdier, per høydegruppe
  hev: [0.9, 1.1, 1.3] as PerGruppe,
}

const V: Record<TVariant, { i: 0 | 1 | 2; p06: number; p02: number; erm01: number; p24: number }> = {
  ribbet:  { i: 0, p06: 0,   p02: 2, erm01: 0, p24: 0 },
  basis:   { i: 1, p06: 0.2, p02: 4, erm01: 1, p24: 1 },
  romslig: { i: 2, p06: 0.2, p02: 4, erm01: 2, p24: 2 },
}

export interface TKonstruksjon {
  P: Record<number, Punkt>
  erm: Record<number, Punkt>
  variant: TVariant
  maal: TskjorteMaal
}

export function konstruer(m: TskjorteMaal, variant: TVariant = 'basis'): TKonstruksjon {
  const v = V[variant]
  const g = gruppe(m.hoydeCm)
  const P: Record<number, Punkt> = {}

  P[0] = { x: 0, y: 0 }
  P[1] = { x: 0, y: m.nakkeTilMidje + 3 }                      // midjelinje

  // Ferdig lengde måles fra 0. Bekreftet mot diagrammet: 0→2 er ca. 37 cm
  // på str. 104, mens 1→2 bare er ca. 12 cm.
  P[2] = { x: 0, y: m.ferdigLengde }

  P[3] = { x: 0, y: m.aermegabDybde + JUST.p03[g][v.i] }       // ærmegabdybdelinje
  P[4] = { x: 0, y: P[3].y / 2 }                                // ½ av 0–3
  P[5] = { x: 0, y: P[4].y / 4 }                                // ¼ av 0–4

  const halsBredde = m.halsvidde / 5 - 0.5 + v.p06
  P[6] = { x: halsBredde, y: 0 }
  P[7] = { x: halsBredde, y: -JUST.hev[g] }                     // hevet bakre halspunkt

  P[8] = { x: m.ryggbredde / 2 + JUST.p38[g][v.i], y: P[3].y }
  P[9] = { x: P[8].x, y: P[4].y }                               // loddrett opp til linje 4
  P[10] = { x: P[8].x, y: P[5].y }                              // og videre til linje 5
  P[11] = { x: P[10].x + 0.5, y: P[5].y }                       // skulderpunkt

  P[12] = { x: m.bryst / 4 + JUST.p312[g][v.i], y: P[3].y }
  P[13] = { x: P[12].x, y: P[2].y }                             // sidesøm ved fald
  P[14] = { x: 0, y: m.halsvidde / 5 - 1 }                      // fremre halsdybde

  // ── ERM ──
  const erm: Record<number, Punkt> = {}
  erm[0] = { x: 0, y: 0 }
  erm[1] = { x: 0, y: P[3].y / 2 + 1 - v.erm01 }                // ½ av 0–3, +1, minus variant
  erm[2] = { x: 0, y: m.ermelengde - v.p02 }
  // erm[3] settes av kalleren: lengden av ærmegabkurven 11→12.
  erm[4] = { x: m.haandledd / 2 - 1.5 + v.p24, y: erm[2].y }

  return { P, erm, variant, maal: m }
}

// ───────────────────────── kurver og deler ─────────────────────────

/** Perpendikulær forskyvning fra korden 3→0 på ermkulen. */
function kuleOffset(t: number, hev: number): number {
  // Bekreftet mot diagram s.49: hult 0,4 cm ved punkt 5 (t=1/6),
  // rører korden ved 6 (t=2/6), hevet ved 8 (t=4/6), i 0 ved endene.
  const pkt: [number, number][] = [[0, 0], [1 / 6, -0.4], [2 / 6, 0], [4 / 6, hev], [1, 0]]
  for (let i = 1; i < pkt.length; i++) {
    if (t <= pkt[i][0]) {
      const [t0, v0] = pkt[i - 1], [t1, v1] = pkt[i]
      const u = (t - t0) / (t1 - t0)
      const s = u * u * (3 - 2 * u)          // glatt overgang
      return v0 + (v1 - v0) * s
    }
  }
  return 0
}

/** Kroppsdelen: halv bak/front, brettelinje på midten. */
export function kroppsDel(k: TKonstruksjon): Del {
  const { P } = k
  const g = gruppe(k.maal.hoydeCm)
  const nW = P[6].x
  const pts: Punkt[] = []

  // bakre halsringning 0 → 7
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, u = 1 - t
    const c = { x: nW * 0.55, y: 0.15 }
    pts.push({ x: u * u * P[0].x + 2 * u * t * c.x + t * t * P[7].x,
               y: u * u * P[0].y + 2 * u * t * c.y + t * t * P[7].y })
  }
  // skulderlinje 7 → 11
  pts.push(P[11])
  // ærmegab 11 → 9 → 12
  for (const [a, c, b] of [
    [P[11], { x: P[11].x, y: P[9].y * 0.78 }, P[9]],
    [P[9], { x: P[8].x - 0.15, y: P[3].y * 0.84 }, P[12]],
  ] as [Punkt, Punkt, Punkt][]) {
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, u = 1 - t
      pts.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
                 y: u * u * a.y + 2 * u * t * c.y + t * t * b.y })
    }
  }
  // sidesøm og fald
  pts.push(P[13], P[2])
  void g
  return {
    navn: 'overdel',
    kontur: pts,
    klippAntall: 2,
    brettelinje: { x: 0, y1: P[0].y, y2: P[2].y },
    tradretning: { x: nW * 0.9, y1: P[3].y + 4, y2: P[3].y + 16 },
    hakk: [{ punkt: P[1], retning: 1 }, { punkt: P[9], retning: -1 }],
  }
}

/** Fremre halsringning, tegnes som egen linje inne i delen. */
export function fremreHals(k: TKonstruksjon): Punkt[] {
  const { P } = k
  const c = { x: P[6].x * 0.15, y: P[14].y * 0.15 }
  const ut: Punkt[] = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, u = 1 - t
    ut.push({ x: u * u * P[14].x + 2 * u * t * c.x + t * t * P[6].x,
              y: u * u * P[14].y + 2 * u * t * c.y + t * t * P[6].y })
  }
  return ut
}

/** Ærmegabkurvens lengde. Ermets punkt 3 avhenger av den. */
export function aermegabLengde(k: TKonstruksjon): number {
  const d = kroppsDel(k).kontur
  // ærmegabet er segmentet fra P[11] til P[12] i konturen
  const i0 = d.findIndex(p => Math.abs(p.x - k.P[11].x) < 1e-6 && Math.abs(p.y - k.P[11].y) < 1e-6)
  const i1 = d.findIndex(p => Math.abs(p.x - k.P[12].x) < 1e-6 && Math.abs(p.y - k.P[12].y) < 1e-6)
  if (i0 < 0 || i1 < 0) return NaN
  let L = 0
  for (let i = i0 + 1; i <= i1; i++) L += Math.hypot(d[i].x - d[i - 1].x, d[i].y - d[i - 1].y)
  return L
}

/** Ermet. Brettelinje på x = 0, ermet strekker seg mot positiv x. */
export function ermDel(k: TKonstruksjon, langt = true): Del {
  const { erm, maal } = k
  const g = gruppe(maal.hoydeCm)
  const A = aermegabLengde(k)
  if (!Number.isFinite(A)) throw new Error('Kunne ikke måle ærmegabet')

  // punkt 3: på linjen gjennom erm[1], slik at rett avstand 0→3 er A
  const dy = erm[1].y
  if (A <= dy) throw new Error('Ærmegabet er kortere enn ermkulehøyden')
  const P3: Punkt = { x: Math.sqrt(A * A - dy * dy), y: dy }

  const hev = JUST.hev[g]
  const kule: Punkt[] = []
  const vx = erm[0].x - P3.x, vy = erm[0].y - P3.y
  const L = Math.hypot(vx, vy)
  const nx = -vy / L, ny = vx / L
  for (let i = 0; i <= 36; i++) {
    const t = i / 36
    const o = kuleOffset(t, hev)
    kule.push({ x: P3.x + vx * t + nx * o, y: P3.y + vy * t + ny * o })
  }

  const hem: Punkt = langt ? erm[4] : { x: P3.x - 1, y: erm[1].y + erm[1].y }
  const bunn: Punkt = langt ? { x: 0, y: erm[2].y } : { x: 0, y: hem.y }

  return {
    navn: langt ? 'erm langt' : 'erm kort',
    kontur: [...kule, { x: 0, y: erm[0].y }, bunn, hem, P3],
    klippAntall: 2,
    brettelinje: { x: 0, y1: erm[0].y, y2: bunn.y },
    tradretning: { x: P3.x * 0.45, y1: erm[1].y + 3, y2: erm[1].y + 12 },
    hakk: [{ punkt: kule[12], retning: -1 }],
  }
}

/**
 * Sjekker at halsåpningen faktisk går over hodet.
 *
 * Bindende for alle plagg uten åpning. Aldrich (s.38) er tydelig på at
 * t-skjorter til baby derfor tegnes fra jerseyblokkene på s.24, med vid
 * hals og skulderklaffer — ikke fra denne blokken.
 *
 * @param hodeomkrets  fra profilen eller størrelsestabellen
 * @param strekk       hvor mye halskanten gir etter. 1,6 for ribb,
 *                     1,35 for vanlig jersey, 1,0 for vevd.
 * @param harAapning   sett true hvis plagget har knapper, splitt eller klaff
 */
export function sjekkHodeaapning(
  k: TKonstruksjon,
  hodeomkrets: number,
  strekk = 1.35,
  harAapning = false,
): string | null {
  if (harAapning) return null
  const bak = kroppsDel(k).kontur.slice(0, 13)
  const aapning = 2 * (lengde(bak) + lengde(fremreHals(k)))
  const maks = aapning * strekk
  if (maks > hodeomkrets) return null
  return `Halsåpningen er ${aapning.toFixed(1)} cm, strukket ca. ${maks.toFixed(1)} cm. ` +
    `Hodeomkretsen er ${hodeomkrets} cm. Plagget går ikke over hodet uten åpning. ` +
    `Bruk babyblokken (bok s.24) med vid hals og skulderklaff, eller legg inn en åpning.`
}

export function valider(k: TKonstruksjon): string[] {
  const feil: string[] = []
  const { P } = k
  if (P[12].x <= P[8].x) feil.push('Brystlinjen er ikke bredere enn ryggbredden')
  if (P[2].y <= P[3].y) feil.push('Ferdig lengde er kortere enn ærmegabdybden')
  if (P[6].x <= 0) feil.push('Halsbredden er null eller negativ')
  if (P[5].y >= P[4].y) feil.push('Skulderlinjen ligger under brystlinjen')
  if (!Number.isFinite(aermegabLengde(k))) feil.push('Ærmegabet kunne ikke måles')
  return feil
}

/** Felles grensesnitt med babyblokk.sjekkHode. */
export function sjekkHode(
  k: TKonstruksjon,
  hodeomkrets: number,
  strekk = 1.35,
): { ok: boolean; aapning: number; strukket: number; melding: string } {
  const bak = kroppsDel(k).kontur.slice(0, 13)
  const aapning = 2 * (lengde(bak) + lengde(fremreHals(k)))
  const strukket = aapning * strekk
  const ok = strukket > hodeomkrets
  const melding =
    sjekkHodeaapning(k, hodeomkrets, strekk) ??
    `Halsåpning ${aapning.toFixed(1)} cm, strukket ca. ${strukket.toFixed(1)} cm mot hode ${hodeomkrets} cm.`
  return { ok, aapning, strukket, melding }
}

