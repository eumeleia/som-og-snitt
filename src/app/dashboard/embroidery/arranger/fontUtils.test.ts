import { describe, it, expect } from 'vitest'
import {
  buildFontData, layoutTekst, klassifiser, malSporingFraPosisjoner, omplasserTekstgruppe,
  trekkFraFellesForskyvning,
} from './fontUtils'
import type { BxGlyf, BxMetrikk, Embroidery, FontMetrikk, VirtuelMotiv } from './types'

// Ekte, målte bbokser fra Seraphine 2" (docs/fontmaling-2026-08-13.md), bredde×høyde i mm.
const SERAPHINE_2IN: Record<string, { widthMm: number; heightMm: number }> = {
  H: { widthMm: 72.2, heightMm: 51.6 },
  A: { widthMm: 65.8, heightMm: 51.6 },
  O: { widthMm: 45.2, heightMm: 51.6 },
  o: { widthMm: 16.6, heightMm: 16.7 },
  c: { widthMm: 18.0, heightMm: 16.4 },
  e: { widthMm: 18.1, heightMm: 15.8 },
  g: { widthMm: 22.1, heightMm: 27.3 },
  p: { widthMm: 29.9, heightMm: 42.3 },
  y: { widthMm: 27.5, heightMm: 30.9 },
}

function vm(tegn: string): VirtuelMotiv {
  return {
    key: tegn, bundleId: 'b-sera', identitet: tegn, navn: tegn,
    coverImage: '', kats: [], katArvet: false,
    karakter: { tegn, type: /[A-ZÆØÅ]/.test(tegn) ? 'stor' : 'liten' },
    sizes: [{ embroideryId: `e-${tegn}`, sizeId: 's', tommeLabel: '2', sizeLabel: '2"' }],
  }
}

function emb(tegn: string): Embroidery {
  const { widthMm, heightMm } = SERAPHINE_2IN[tegn]
  return {
    id: `e-${tegn}`, created_at: '',
    data: {
      navn: tegn, coverImage: '', bmpPreview: '', customImage: '', useCustomImage: false,
      sizes: [{ id: 's', sizeLabel: '2"', pesUrl: '', pesFilename: `${tegn}.pes`, widthMm, heightMm }],
    },
  }
}

const ALLE_TEGN = Object.keys(SERAPHINE_2IN)
const vms = ALLE_TEGN.map(vm)
const biblioteket = ALLE_TEGN.map(emb)

// Verner Steg 3 i fontarbeidet — grunnlinje for underlengder MÅLT fra xHeight, ikke gjettet.
describe('klassifiser', () => {
  it('z har INGEN underlengde — feilen dokumentert i docs/fontmaling-2026-08-13.md', () => {
    expect(klassifiser('z')).toBe('x-hoyde')
  })

  it('r u v w x er x-høyde — manglet i den gamle X_HEIGHT_REF-lista', () => {
    for (const tegn of ['r', 'u', 'v', 'w', 'x']) expect(klassifiser(tegn)).toBe('x-hoyde')
  })

  it('f og j behandles som underlengde (usikkert til sett visuelt, se kommentar i fontUtils.ts)', () => {
    expect(klassifiser('f')).toBe('underlengde')
    expect(klassifiser('j')).toBe('underlengde')
  })

  it('g p q y er underlengde, b d h k l t er overlengde', () => {
    for (const tegn of ['g', 'p', 'q', 'y']) expect(klassifiser(tegn)).toBe('underlengde')
    for (const tegn of ['b', 'd', 'h', 'k', 'l', 't']) expect(klassifiser(tegn)).toBe('overlengde')
  })

  it('store bokstaver og siffer klassifiseres uavhengig av bokstavlistene', () => {
    expect(klassifiser('O')).toBe('versal')
    expect(klassifiser('5')).toBe('tall')
  })
})

describe('buildFontData — målt xHeight fra Seraphine 2"', () => {
  it('xHeight = median(o, c, e) = 164 (1/10 mm), og er markert MÅLT', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    expect(Math.round(fd.metrics.xHeight * 10)).toBe(164)
    expect(fd.metrics.xHeightMalt).toBe(true)
  })

  it('H, A, O, o, c, e står på egen bunn — bifMm = heightMm, offset 0', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    for (const tegn of ['H', 'A', 'O', 'o', 'c', 'e']) {
      const t = fd.tegn[tegn]
      expect(Math.round(t.bifMm * 10)).toBe(Math.round(SERAPHINE_2IN[tegn].heightMm * 10))
    }
  })

  it('g p y får grunnlinjen ved MÅLT xHeight — offset 109/259/145 (1/10 mm)', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    const xHeightTiendedel = Math.round(fd.metrics.xHeight * 10) // 164

    for (const [tegn, forventetOffsetTiendedel] of [['g', 109], ['p', 259], ['y', 145]] as const) {
      const t = fd.tegn[tegn]
      const offsetTiendedel = Math.round(t.heightMm * 10) - Math.round(t.bifMm * 10)
      expect(offsetTiendedel).toBe(forventetOffsetTiendedel)
      expect(Math.round(t.bifMm * 10)).toBe(xHeightTiendedel) // grunnlinjen er selve xHeight
    }
  })

  it('ingen x-høyde-bokstaver i alfabetet → xHeightMalt false, underlengder faller til egen bunn', () => {
    const kunUnderlengder = ['g', 'p', 'y'].map(vm)
    const kunUnderlengderBibl = ['g', 'p', 'y'].map(emb)
    const fd = buildFontData(kunUnderlengder, '2', kunUnderlengderBibl)
    expect(fd.metrics.xHeightMalt).toBe(false)
    for (const tegn of ['g', 'p', 'y']) {
      expect(Math.round(fd.tegn[tegn].bifMm * 10)).toBe(Math.round(SERAPHINE_2IN[tegn].heightMm * 10))
    }
  })
})

describe('layoutTekst — «Hoppy»: H og o på samme grunnlinje, p og y stikker under', () => {
  it('H og o har offset 0 (samme bbox-bunn), p og y stikker 259/145 (1/10 mm) under', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    const layout = layoutTekst('Hoppy', fd, { tracking: 0, mellomromFaktor: 0.6 })

    expect(layout.bokstaver.map(b => b.tegn)).toEqual(['H', 'o', 'p', 'p', 'y'])

    function offsetTiendedel(tegn: string) {
      const b = layout.bokstaver.find(x => x.tegn === tegn)!
      return Math.round(b.info.heightMm * 10) - Math.round(b.info.bifMm * 10)
    }

    expect(offsetTiendedel('H')).toBe(0)
    expect(offsetTiendedel('o')).toBe(0)
    expect(offsetTiendedel('p')).toBe(259)
    expect(offsetTiendedel('y')).toBe(145)
  })

  it('indeksITekst er posisjonen i den ORIGINALE strengen, mellomrom talt med — «Ho py» hopper fra 1 til 3 over mellomrommet', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    const layout = layoutTekst('Ho py', fd, { tracking: 0, mellomromFaktor: 0.6 })
    expect(layout.bokstaver.map(b => b.indeksITekst)).toEqual([0, 1, 3, 4])
  })
})

// Punkt E i docs/onsker-2026-09-08.md — mellomrom-glideren PÅ LERRETET. To rene funksjoner:
// mål det som står der (ingen gjetning), regn nye posisjoner fra en valgt verdi (ekte
// re-plassering, senteret holdes fast).
describe('malSporingFraPosisjoner', () => {
  it('jevnt fordelte bokstaver i ETT ord: sporingMm er gapet, mellomromMm er null (ingen ordgrense)', () => {
    // Tre 10 mm brede bokstaver med 2 mm gap: senteravstand = bredde+gap = 12mm, sentre på 50, 170, 290 (tiendedels mm).
    const ledd = [
      { posisjonXTiendedelMm: 50, widthMm: 10, indeks: 0 },
      { posisjonXTiendedelMm: 170, widthMm: 10, indeks: 1 },
      { posisjonXTiendedelMm: 290, widthMm: 10, indeks: 2 },
    ]
    const { sporingMm, mellomromMm } = malSporingFraPosisjoner(ledd)
    expect(sporingMm).toBeCloseTo(2, 5)
    expect(mellomromMm).toBeNull()
  })

  it('to ord («Ab Cd», indeks-hopp 1→3): ordgapet havner i mellomromMm, ikke i sporingMm', () => {
    // A(w10) B(w10) tett i bokstavmellomrom 2mm, så et ordmellomrom på 8mm, så C(w10) D(w10).
    const ledd = [
      { posisjonXTiendedelMm: 50, widthMm: 10, indeks: 0 },   // A, senter 5mm
      { posisjonXTiendedelMm: 170, widthMm: 10, indeks: 1 },  // B, senter 17mm (gap 2mm)
      { posisjonXTiendedelMm: 350, widthMm: 10, indeks: 3 },  // C, senter 35mm (gap 8mm, ordgrense — indeks hopper 1→3)
      { posisjonXTiendedelMm: 470, widthMm: 10, indeks: 4 },  // D, senter 47mm (gap 2mm)
    ]
    const { sporingMm, mellomromMm } = malSporingFraPosisjoner(ledd)
    expect(sporingMm).toBeCloseTo(2, 5)
    expect(mellomromMm).toBeCloseTo(8, 5)
  })

  it('ukjent rekkefølge (indeks null for alle, eldre komposisjon): ALDRI ordgrense, alt teller som bokstavgap', () => {
    const ledd = [
      { posisjonXTiendedelMm: 50, widthMm: 10, indeks: null },
      { posisjonXTiendedelMm: 400, widthMm: 10, indeks: null }, // stort gap, men kan ikke vite at det er et ord
    ]
    const { sporingMm, mellomromMm } = malSporingFraPosisjoner(ledd)
    expect(sporingMm).toBeCloseTo(25, 5) // (400-50)/10 - 10mm (halve bredder på hver side)
    expect(mellomromMm).toBeNull()
  })

  it('ett tegn eller tomt: begge null, ingenting å måle', () => {
    expect(malSporingFraPosisjoner([{ posisjonXTiendedelMm: 0, widthMm: 10, indeks: 0 }])).toEqual({ sporingMm: null, mellomromMm: null })
    expect(malSporingFraPosisjoner([])).toEqual({ sporingMm: null, mellomromMm: null })
  })
})

describe('omplasserTekstgruppe', () => {
  it('reproduserer posisjonene malSporingFraPosisjoner målte — rundtur uten drift', () => {
    const opprinnelig = [
      { posisjonXTiendedelMm: 50, widthMm: 10, indeks: 0 },
      { posisjonXTiendedelMm: 170, widthMm: 10, indeks: 1 },
      { posisjonXTiendedelMm: 400, widthMm: 10, indeks: 3 },
      { posisjonXTiendedelMm: 520, widthMm: 10, indeks: 4 },
    ]
    const { sporingMm, mellomromMm } = malSporingFraPosisjoner(opprinnelig)
    const sentrum = Math.round((opprinnelig[0].posisjonXTiendedelMm + opprinnelig[3].posisjonXTiendedelMm) / 2)
    const ledd = opprinnelig.map((l, i) => ({ id: `m${i}`, widthMm: l.widthMm, indeks: l.indeks }))

    const nye = omplasserTekstgruppe(ledd, sporingMm!, mellomromMm!, sentrum)

    for (let i = 0; i < opprinnelig.length; i++) {
      expect(nye[i].posisjonXTiendedelMm).toBeCloseTo(opprinnelig[i].posisjonXTiendedelMm, -1) // ±~1 tiendedel avrunding
    }
  })

  it('senteret står stille når sporingen endres — midtpunktet mellom første og siste er likt før og etter', () => {
    const ledd = [
      { id: 'a', widthMm: 10, indeks: 0 },
      { id: 'b', widthMm: 10, indeks: 1 },
      { id: 'c', widthMm: 10, indeks: 2 },
    ]
    const sentrum = 500
    const tett = omplasserTekstgruppe(ledd, 0, 6, sentrum)
    const glissen = omplasserTekstgruppe(ledd, 5, 6, sentrum)

    const midtpunkt = (r: typeof tett) => (r[0].posisjonXTiendedelMm + r[2].posisjonXTiendedelMm) / 2
    expect(Math.round(midtpunkt(tett))).toBe(sentrum)
    expect(Math.round(midtpunkt(glissen))).toBe(sentrum)
    expect(glissen[2].posisjonXTiendedelMm - glissen[0].posisjonXTiendedelMm)
      .toBeGreaterThan(tett[2].posisjonXTiendedelMm - tett[0].posisjonXTiendedelMm)
  })

  it('ordgrense bruker mellomromMm, bokstavgrense bruker sporingMm — de to skal kunne gi ULIKE gap', () => {
    const ledd = [
      { id: 'a', widthMm: 10, indeks: 0 },
      { id: 'b', widthMm: 10, indeks: 1 },   // bokstavgrense mot a
      { id: 'c', widthMm: 10, indeks: 3 },   // ordgrense mot b (hopp 1→3)
    ]
    const res = omplasserTekstgruppe(ledd, 2, 9, 0)
    const bokstavGap = res[1].posisjonXTiendedelMm - res[0].posisjonXTiendedelMm - 100 // 100 = 10mm bredde i tiendedeler
    const ordGap = res[2].posisjonXTiendedelMm - res[1].posisjonXTiendedelMm - 100
    expect(Math.round(bokstavGap)).toBe(20) // 2 mm
    expect(Math.round(ordGap)).toBe(90) // 9 mm
  })

  it('tomt utvalg gir tom liste, krasjer ikke', () => {
    expect(omplasserTekstgruppe([], 0, 0, 0)).toEqual([])
  })
})

// Punkt A i docs/onsker-2026-09-08.md — feilen var at draggedDiffMm ble målt mot y = 0
// (rammens midtlinje), så en flytting av HELE ordet ble lest som manglende grunnlinje på
// alle bokstavene. Medianen av gruppens diffMm ER ordets plassering; det som står igjen
// etter fratrekk er den ekte grunnlinjefeilen.
describe('trekkFraFellesForskyvning', () => {
  it('ord flyttet 40 mm samlet: alle avvik ≈ 0 etter fratrekk', () => {
    const rader = [
      { tegn: 'a', heightMm: 20, diffMm: 40 },
      { tegn: 'b', heightMm: 20, diffMm: 40 },
      { tegn: 'c', heightMm: 20, diffMm: 40 },
    ]
    const { rader: nye, fellesForskyvningMm, advarselTegn } = trekkFraFellesForskyvning(rader)
    expect(fellesForskyvningMm).toBe(40)
    for (const r of nye) expect(r.diffMm).toBeCloseTo(0, 10)
    expect(advarselTegn.size).toBe(0)
  })

  it('ord med én ekte underlengde: bare det tegnet avviker etter fratrekk', () => {
    // Fem bokstaver flyttet 40 mm samlet (med litt naturlig støy), én bokstav («p») har i
    // tillegg en EKTE grunnlinjefeil på 2,5 mm oven på den samme flyttingen.
    const rader = [
      { tegn: 'a', heightMm: 20, diffMm: 40.1 },
      { tegn: 'e', heightMm: 20, diffMm: 39.9 },
      { tegn: 'o', heightMm: 20, diffMm: 40.0 },
      { tegn: 'n', heightMm: 20, diffMm: 40.0 },
      { tegn: 'p', heightMm: 20, diffMm: 42.5 },
    ]
    const { rader: nye } = trekkFraFellesForskyvning(rader)
    const p = nye.find(r => r.tegn === 'p')!
    for (const r of nye) if (r.tegn !== 'p') expect(Math.abs(r.diffMm)).toBeLessThan(0.2)
    expect(p.diffMm).toBeCloseTo(2.5, 5)
  })

  it('gjenskaper det oppgitte «Ellinor»-eksemplet nøyaktig', () => {
    // E · i · l · n · o · r (alfabetisk, som kalibreringsGrupper sorterer radene).
    const rader = [
      { tegn: 'E', heightMm: 100, diffMm: 40.9 },
      { tegn: 'i', heightMm: 100, diffMm: 40.3 },
      { tegn: 'l', heightMm: 100, diffMm: 40.4 },
      { tegn: 'n', heightMm: 100, diffMm: 39.9 },
      { tegn: 'o', heightMm: 100, diffMm: 40.3 },
      { tegn: 'r', heightMm: 100, diffMm: 40.0 },
    ]
    const { rader: nye, fellesForskyvningMm } = trekkFraFellesForskyvning(rader)
    expect(fellesForskyvningMm).toBeCloseTo(40.3, 5)
    const ved = (tegn: string) => nye.find(r => r.tegn === tegn)!.diffMm
    expect(ved('E')).toBeCloseTo(0.6, 5)
    expect(ved('i')).toBeCloseTo(0.0, 5)
    expect(ved('l')).toBeCloseTo(0.1, 5)
    expect(ved('n')).toBeCloseTo(-0.4, 5)
    expect(ved('o')).toBeCloseTo(0.0, 5)
    expect(ved('r')).toBeCloseTo(-0.3, 5)
  })

  it('bare ETT tegn i gruppen: plassering og grunnlinje kan ikke skilles — ingen fratrekk', () => {
    const rader = [{ tegn: 'a', heightMm: 20, diffMm: 40 }]
    const resultat = trekkFraFellesForskyvning(rader)
    expect(resultat.fellesForskyvningMm).toBeNull()
    expect(resultat.rader).toEqual(rader)
  })

  it('advarer ved avvik over 30 % av tegnets egen høyde, etter fratrekk', () => {
    const rader = [
      { tegn: 'a', heightMm: 20, diffMm: 40 },   // felles, ingen reell feil
      { tegn: 'b', heightMm: 20, diffMm: 40 },
      { tegn: 'p', heightMm: 20, diffMm: 47 },   // 7 mm avvik = 35 % av 20 mm → advarsel
    ]
    const { advarselTegn } = trekkFraFellesForskyvning(rader)
    expect(advarselTegn).toEqual(new Set(['p']))
  })
})

// Fester buildFontData/layoutTekst SLIK DE VAR før BX-metrikken kom inn. Skrevet og kjørt
// grønt mot den urørte funksjonen — skal aldri redigeres for å få en senere endring til å
// passere. Bare feltene som fantes da sammenlignes, så nye felt (grunnlinjeKilde o.l.)
// ikke bryter festingen.
describe('buildFontData uten BX — festet oppførsel fra før BX', () => {
  function gammelForm(fd: ReturnType<typeof buildFontData>) {
    return {
      metrics: { xHeight: fd.metrics.xHeight, xHeightMalt: fd.metrics.xHeightMalt },
      tegn: Object.fromEntries(Object.entries(fd.tegn).map(([k, t]) => [k, {
        embroideryId: t.embroideryId, sizeId: t.sizeId, widthMm: t.widthMm, heightMm: t.heightMm, bifMm: t.bifMm,
      }])),
    }
  }
  function layoutForm(l: ReturnType<typeof layoutTekst>) {
    return {
      bokstaver: l.bokstaver.map(b => [b.tegn, b.indeksITekst, b.posXTiendedelMm, b.posYTiendedelMm]),
      mangler: l.mangler, totalBreddeMm: l.totalBreddeMm, totalHøydeMm: l.totalHøydeMm,
    }
  }
  const manuell = {
    sporingAndel: 0.1, mellomromAndel: 0.8,
    tegn: {
      p: { underlengdeAndel: 0.4, kilde: 'manuell' as const, oppdatert: '2026-09-01' },
      H: { underlengdeAndel: -0.05, kilde: 'manuell' as const, oppdatert: '2026-09-01' },
    },
  }

  it('hele Seraphine 2"-settet, ingen fontMetrikk', () => {
    expect(gammelForm(buildFontData(vms, '2', biblioteket))).toMatchInlineSnapshot(`
      {
        "metrics": {
          "xHeight": 16.4,
          "xHeightMalt": true,
        },
        "tegn": {
          "A": {
            "bifMm": 51.6,
            "embroideryId": "e-A",
            "heightMm": 51.6,
            "sizeId": "s",
            "widthMm": 65.8,
          },
          "H": {
            "bifMm": 51.6,
            "embroideryId": "e-H",
            "heightMm": 51.6,
            "sizeId": "s",
            "widthMm": 72.2,
          },
          "O": {
            "bifMm": 51.6,
            "embroideryId": "e-O",
            "heightMm": 51.6,
            "sizeId": "s",
            "widthMm": 45.2,
          },
          "c": {
            "bifMm": 16.4,
            "embroideryId": "e-c",
            "heightMm": 16.4,
            "sizeId": "s",
            "widthMm": 18,
          },
          "e": {
            "bifMm": 15.8,
            "embroideryId": "e-e",
            "heightMm": 15.8,
            "sizeId": "s",
            "widthMm": 18.1,
          },
          "g": {
            "bifMm": 16.4,
            "embroideryId": "e-g",
            "heightMm": 27.3,
            "sizeId": "s",
            "widthMm": 22.1,
          },
          "o": {
            "bifMm": 16.7,
            "embroideryId": "e-o",
            "heightMm": 16.7,
            "sizeId": "s",
            "widthMm": 16.6,
          },
          "p": {
            "bifMm": 16.4,
            "embroideryId": "e-p",
            "heightMm": 42.3,
            "sizeId": "s",
            "widthMm": 29.9,
          },
          "y": {
            "bifMm": 16.4,
            "embroideryId": "e-y",
            "heightMm": 30.9,
            "sizeId": "s",
            "widthMm": 27.5,
          },
        },
      }
    `)
  })

  it('manuell kalibrering på p og H', () => {
    expect(gammelForm(buildFontData(vms, '2', biblioteket, manuell))).toMatchInlineSnapshot(`
      {
        "metrics": {
          "xHeight": 16.4,
          "xHeightMalt": true,
        },
        "tegn": {
          "A": {
            "bifMm": 51.6,
            "embroideryId": "e-A",
            "heightMm": 51.6,
            "sizeId": "s",
            "widthMm": 65.8,
          },
          "H": {
            "bifMm": 54.18000000000001,
            "embroideryId": "e-H",
            "heightMm": 51.6,
            "sizeId": "s",
            "widthMm": 72.2,
          },
          "O": {
            "bifMm": 51.6,
            "embroideryId": "e-O",
            "heightMm": 51.6,
            "sizeId": "s",
            "widthMm": 45.2,
          },
          "c": {
            "bifMm": 16.4,
            "embroideryId": "e-c",
            "heightMm": 16.4,
            "sizeId": "s",
            "widthMm": 18,
          },
          "e": {
            "bifMm": 15.8,
            "embroideryId": "e-e",
            "heightMm": 15.8,
            "sizeId": "s",
            "widthMm": 18.1,
          },
          "g": {
            "bifMm": 16.4,
            "embroideryId": "e-g",
            "heightMm": 27.3,
            "sizeId": "s",
            "widthMm": 22.1,
          },
          "o": {
            "bifMm": 16.7,
            "embroideryId": "e-o",
            "heightMm": 16.7,
            "sizeId": "s",
            "widthMm": 16.6,
          },
          "p": {
            "bifMm": 25.38,
            "embroideryId": "e-p",
            "heightMm": 42.3,
            "sizeId": "s",
            "widthMm": 29.9,
          },
          "y": {
            "bifMm": 16.4,
            "embroideryId": "e-y",
            "heightMm": 30.9,
            "sizeId": "s",
            "widthMm": 27.5,
          },
        },
      }
    `)
  })

  it('ingen x-høyde-bokstaver, og en tomme som ikke finnes', () => {
    const kun = ['g', 'p', 'y']
    expect(gammelForm(buildFontData(kun.map(vm), '2', kun.map(emb)))).toMatchInlineSnapshot(`
      {
        "metrics": {
          "xHeight": 1.6,
          "xHeightMalt": false,
        },
        "tegn": {
          "g": {
            "bifMm": 27.3,
            "embroideryId": "e-g",
            "heightMm": 27.3,
            "sizeId": "s",
            "widthMm": 22.1,
          },
          "p": {
            "bifMm": 42.3,
            "embroideryId": "e-p",
            "heightMm": 42.3,
            "sizeId": "s",
            "widthMm": 29.9,
          },
          "y": {
            "bifMm": 30.9,
            "embroideryId": "e-y",
            "heightMm": 30.9,
            "sizeId": "s",
            "widthMm": 27.5,
          },
        },
      }
    `)
    expect(gammelForm(buildFontData(vms, '3', biblioteket))).toMatchInlineSnapshot(`
      {
        "metrics": {
          "xHeight": 1.6,
          "xHeightMalt": false,
        },
        "tegn": {},
      }
    `)
  })

  it('layoutTekst «Hoppy gy» med og uten manuell kalibrering', () => {
    const opts = { tracking: 0.5, mellomromFaktor: 0.6 }
    expect(layoutForm(layoutTekst('Hoppy gy', buildFontData(vms, '2', biblioteket), opts))).toMatchInlineSnapshot(`
      {
        "bokstaver": [
          [
            "H",
            0,
            -829,
            -258,
          ],
          [
            "o",
            1,
            -380,
            -83,
          ],
          [
            "p",
            2,
            -143,
            48,
          ],
          [
            "p",
            3,
            161,
            48,
          ],
          [
            "y",
            4,
            453,
            -9,
          ],
          [
            "g",
            6,
            800,
            -27,
          ],
          [
            "y",
            7,
            1053,
            -9,
          ],
        ],
        "mangler": [],
        "totalBreddeMm": 238.04000000000002,
        "totalHøydeMm": 77.5,
      }
    `)
    expect(layoutForm(layoutTekst('Hoppy gy', buildFontData(vms, '2', biblioteket, manuell), opts))).toMatchInlineSnapshot(`
      {
        "bokstaver": [
          [
            "H",
            0,
            -829,
            -284,
          ],
          [
            "o",
            1,
            -380,
            -83,
          ],
          [
            "p",
            2,
            -143,
            -42,
          ],
          [
            "p",
            3,
            161,
            -42,
          ],
          [
            "y",
            4,
            453,
            -9,
          ],
          [
            "g",
            6,
            800,
            -27,
          ],
          [
            "y",
            7,
            1053,
            -9,
          ],
        ],
        "mangler": [],
        "totalBreddeMm": 238.04000000000002,
        "totalHøydeMm": 71.10000000000001,
      }
    `)
  })
})

// BX-metrikk (api/parse-bx): tall fra Seraphine Satin 1,5" — BX-glyfene fra fila, PES-målene
// fra pyembroidery-kryssjekken (lower_a 184×125, Upper_A 495×389, lower_p 227×318).
describe('buildFontData med BX-metrikk', () => {
  const PES_1_5: Record<string, { fil: string; widthMm: number; heightMm: number }> = {
    a: { fil: 'SCSeraphine_Satin_1_5inch_lower_a.PES', widthMm: 18.4, heightMm: 12.5 },
    p: { fil: 'SCSeraphine_Satin_1_5inch_lower_p.PES', widthMm: 22.7, heightMm: 31.8 },
    A: { fil: 'SCSeraphine_Satin_1_5inch_Upper_A.PES', widthMm: 49.5, heightMm: 38.9 },
  }
  function vm15(tegn: string): VirtuelMotiv {
    return { ...vm(tegn), sizes: [{ embroideryId: `e15-${tegn}`, sizeId: 's', tommeLabel: '1.5', sizeLabel: '1.5"' }] }
  }
  function emb15(tegn: string): Embroidery {
    const { fil, widthMm, heightMm } = PES_1_5[tegn]
    return {
      id: `e15-${tegn}`, created_at: '',
      data: {
        navn: tegn, coverImage: '', bmpPreview: '', customImage: '', useCustomImage: false,
        sizes: [{ id: 's', sizeLabel: '1.5"', pesUrl: '', pesFilename: fil, widthMm, heightMm }],
      },
    }
  }
  function glyf(tegn: string, noekkel: string, bredde: number, hoyde: number, grunnlinjeY: number, kildenavn: string): BxGlyf {
    return { tegn, noekkel, bredde, hoyde, grunnlinjeY, underlengdeAndel: (grunnlinjeY + hoyde / 2) / hoyde, kildenavn }
  }
  const BX_1_5: BxMetrikk = {
    fontName: "Seraphine_Satin_ 1_5''", ltrSpace: 11.7, wSpace: 15.6, intraRHS: 0, kern: 0,
    mHeight: 390, defsz: 390, minsz: 195, maxsz: 975, availableChars: [],
    filnavn: "Seraphine_Satin_ 1_5''.bx", lastInn: '2026-09-30',
    glyphs: [
      glyf('a', 'a', 184, 126, -63, 'SCVintageLove_REG_1_5inch_lower_a.EMB'),
      glyf('p', 'p', 228, 318, -2.25, 'SCVintageLove_REG_1_5inch_lower_p.EMB'),
      glyf('g', 'g', 168, 208, -9.5, 'SCVintageLove_REG_1_5inch_lower_g.EMB'),
      glyf('A', 'AU', 496, 390, -195, 'SCVintageLove_REG_1_5inch_Upper_A.EMB'),
    ],
  }
  const tegn15 = ['a', 'p', 'A']
  const vms15 = tegn15.map(vm15)
  const bibl15 = tegn15.map(emb15)
  const medBx: FontMetrikk = { tegn: {}, bx: { '1.5': BX_1_5 } }

  it('p får digitaliserens grunnlinje: 31,8 × (1 − 0,4929) = 16,12 mm', () => {
    const fd = buildFontData(vms15, '1.5', bibl15, medBx)
    expect(fd.tegn.p.grunnlinjeKilde).toBe('bx')
    expect(fd.tegn.p.bifMm).toBeCloseTo(16.12, 2)
    // Heuristikken ville gitt x-høyden (a = 12,5 mm) — BX-en flytter p 3,6 mm ned.
    expect(buildFontData(vms15, '1.5', bibl15).tegn.p.bifMm).toBe(12.5)
  })

  it('a og A står på egen bunn også etter BX (andel 0)', () => {
    const fd = buildFontData(vms15, '1.5', bibl15, medBx)
    for (const t of ['a', 'A']) {
      expect(fd.tegn[t].grunnlinjeKilde).toBe('bx')
      expect(fd.tegn[t].bifMm).toBeCloseTo(PES_1_5[t].heightMm, 6)
    }
  })

  it('kobler på tegn, ikke pesname: kildenavn som peker på a sin PES-fil brukes ikke', () => {
    // En glyf for «o» med a sin PES-fil som kildenavn — ville vunnet en navnematching.
    const lokkeglyf = glyf('o', 'o', 184, 125, 0, 'SCSeraphine_Satin_1_5inch_lower_a.PES')
    const fm: FontMetrikk = { tegn: {}, bx: { '1.5': { ...BX_1_5, glyphs: [lokkeglyf, ...BX_1_5.glyphs] } } }
    const fd = buildFontData(vms15, '1.5', bibl15, fm)
    expect(fd.tegn.a.bifMm).toBeCloseTo(12.5, 6)            // glyf «a», andel 0
    expect(fd.tegn.p.bifMm).toBeCloseTo(31.8 * (1 - 156.75 / 318), 6)
    expect(fd.bx?.manglerFil).toContain('o')
  })

  it('mål som ikke stemmer: synlig avvik, ingen BX-metrikk, heuristikken som før', () => {
    const feilP = { ...BX_1_5, glyphs: BX_1_5.glyphs.map(g => g.tegn === 'p' ? { ...g, hoyde: 330 } : g) }
    const fd = buildFontData(vms15, '1.5', bibl15, { tegn: {}, bx: { '1.5': feilP } })
    expect(fd.tegn.p.grunnlinjeKilde).toBe('utledet')
    expect(fd.tegn.p.bifMm).toBe(12.5)
    expect(fd.bx?.avvik).toEqual([{ tegn: 'p', bxMal: { bredde: 228, hoyde: 330 }, pesMal: { bredde: 227, hoyde: 318 } }])
  })

  it('manuell kalibrering vinner over BX', () => {
    const fm: FontMetrikk = { ...medBx, tegn: { p: { underlengdeAndel: 0.3, kilde: 'manuell', oppdatert: '' } } }
    const fd = buildFontData(vms15, '1.5', bibl15, fm)
    expect(fd.tegn.p.grunnlinjeKilde).toBe('manuell')
    expect(fd.tegn.p.bifMm).toBeCloseTo(31.8 * 0.7, 6)
    expect(fd.tegn.a.grunnlinjeKilde).toBe('bx')
  })

  it('BX for en annen tomme brukes ikke', () => {
    const fd = buildFontData(vms15, '1.5', bibl15, { tegn: {}, bx: { '2': BX_1_5 } })
    expect(fd.bx).toBeNull()
    expect(Object.values(fd.tegn).every(t => t.grunnlinjeKilde === 'utledet')).toBe(true)
  })

  it('BX-data som ikke lar seg tolke gir heuristikken, ikke en kastet feil', () => {
    const uten = buildFontData(vms15, '1.5', bibl15)
    for (const odelagt of [
      { mHeight: '390', glyphs: [] },
      { mHeight: 390, glyphs: 'ingen' },
      { mHeight: 390, glyphs: [{ tegn: 'p', hoyde: 0 }] },
      null,
    ]) {
      const fm = { tegn: {}, bx: { '1.5': odelagt } } as unknown as FontMetrikk
      const fd = buildFontData(vms15, '1.5', bibl15, fm)
      expect(fd.bx).toBeNull()
      expect(fd).toEqual(uten)
    }
  })

  it('ltrSpace gis i mm som startverdi for sporing, og er 0,093 × x-høyde for Seraphine 1,5"', () => {
    const fd = buildFontData(vms15, '1.5', bibl15, medBx)
    expect(fd.bx?.ltrSpaceMm).toBeCloseTo(1.17, 6)
    expect(fd.bx!.ltrSpaceMm! / fd.metrics.xHeight).toBeCloseTo(0.093, 2)
  })

  it('grunnlinja er uavhengig av bokstav- og ordavstand', () => {
    const fd = buildFontData(vms15, '1.5', bibl15, medBx)
    const y = (tracking: number, mellomromFaktor: number) =>
      layoutTekst('Aa pa', fd, { tracking, mellomromFaktor }).bokstaver.map(b => b.posYTiendedelMm)
    expect(y(3, 1.2)).toEqual(y(0, 0.6))
    expect(y(-2, 0.3)).toEqual(y(0, 0.6))
  })
})
