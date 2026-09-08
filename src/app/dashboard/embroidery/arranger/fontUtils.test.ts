import { describe, it, expect } from 'vitest'
import { buildFontData, layoutTekst, klassifiser, malSporingFraPosisjoner, omplasserTekstgruppe } from './fontUtils'
import type { Embroidery, VirtuelMotiv } from './types'

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
