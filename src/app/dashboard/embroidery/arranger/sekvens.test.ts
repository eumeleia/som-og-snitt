import { describe, it, expect } from 'vitest'
import { byggFargePerBlokk, finnSammenslaingsforslag, finnLagkonflikter, effektivTradfarge, tellSting, type SekvensKontekst } from './sekvens'
import { snappTilPalett } from './broderPalett'
import { byggPecTilEkteMap, type MinTrad } from './minTraadpalett'
import type { BroderiBbox, BroderiMotivData, BroderiStingblokk, PlassertMotiv, SekvensElement, SekvensKjoring } from './types'

function blokk(overrides: Partial<BroderiStingblokk> & { farge_hex: string; sting: [number, number][]; bbox: BroderiBbox }): BroderiStingblokk {
  return { tradnavn_auto: null, antall_sting: overrides.sting.length, ...overrides }
}

function motivData(overrides: Partial<BroderiMotivData> & { bbox: BroderiBbox | null; stingblokker: BroderiStingblokk[] }): BroderiMotivData {
  return { enhet: 'mm', total_sting: 0, fargekjoringer: [], ...overrides }
}

function plassert(id: string, embroideryId: string, sizeId: string): PlassertMotiv {
  return { id, embroideryId, sizeId, navn: id, posisjonXTiendedelMm: 0, posisjonYTiendedelMm: 0, rotasjonGrader: 0 }
}

// Verner 36cfb7a («…Broderimodul: snappTilPalett/effektivTradfarge, interpolerSting,
// byggFargePerBlokk…»), som skrev om overlappsjekken til å interpolere og rasterisere
// HVER STINGBLOKK FOR SEG (aldri hele fargekjøringens flate stingliste), nettopp for at
// et klipp mellom to blokker ikke skal gi en falsk forbindelseslinje i rasteret.
describe('finnSammenslaingsforslag — overlapptest per blokk (ikke over klipp)', () => {
  // Satengkolonne 8 mm bred (x fra -40 til 40 tiendedels mm), i to blokker med et 8 mm
  // klipp mellom seg (blokk0 slutter på y=-40, blokk1 starter på y=40). Hver blokk er en
  // ekte satengsone: sting-punktene sveiper hele bredden på hver rad (venstre/høyre kant
  // alternerende), så interpolerSting fyller innsiden — se kommentaren i geometri.ts.
  function byggSatengkolonne(): { block0: BroderiStingblokk; block1: BroderiStingblokk; motivBbox: BroderiBbox } {
    const rader0 = [-200, -180, -160, -140, -120, -100, -80, -60, -40]
    const rader1 = [40, 60, 80, 100, 120, 140, 160, 180, 200]
    const sting0: [number, number][] = rader0.flatMap(y => [[-40, y], [40, y]] as [number, number][])
    const sting1: [number, number][] = rader1.flatMap(y => [[-40, y], [40, y]] as [number, number][])
    return {
      block0: blokk({ farge_hex: '#111111', sting: sting0, bbox: { min_x: -40, max_x: 40, min_y: -200, max_y: -40 } }),
      block1: blokk({ farge_hex: '#111111', sting: sting1, bbox: { min_x: -40, max_x: 40, min_y: 40, max_y: 200 } }),
      motivBbox: { min_x: -40, max_x: 40, min_y: -200, max_y: 200 },
    }
  }

  // detaljSting/detaljBbox er ALLTID lokale, sentrert på (0,0) — selve plasseringen på
  // lerretet styres av pmM sin posisjonYTiendedelMm, IKKE av bbox-en. plassertPunkter
  // trekker fra motivets EGEN bbox-senter før den legger på posisjonen (se
  // roterLokalePunkter/plassertUnderBbox i geometri.ts); en detalj-bbox som ikke er
  // sentrert på (0,0) ville derfor blitt forskjøvet TO ganger, ikke én.
  function byggKontekst(posisjonYTiendedelMm: number): SekvensKontekst {
    const { block0, block1, motivBbox } = byggSatengkolonne()
    const pmJ = plassert('pm-j', 'e-j', 's-j')
    const pmM = { ...plassert('pm-m', 'e-m', 's-m'), posisjonYTiendedelMm }
    const dataJ = motivData({
      bbox: motivBbox,
      stingblokker: [block0, block1],
      fargekjoringer: [
        { farge_hex: '#111111', tradnavn_auto: null, fra_index: 0, til_index: 1, antall_blokker: 2, antall_sting: 18 },
        { farge_hex: '#111111', tradnavn_auto: null, fra_index: 0, til_index: 1, antall_blokker: 2, antall_sting: 18 },
      ],
    })
    const detaljSting: [number, number][] = [[-15, -15], [15, -15], [15, 15], [-15, 15], [-15, -15]]
    const detaljBbox: BroderiBbox = { min_x: -15, max_x: 15, min_y: -15, max_y: 15 }
    const dataM = motivData({
      bbox: detaljBbox,
      stingblokker: [blokk({ farge_hex: '#222222', sting: detaljSting, bbox: detaljBbox })],
      fargekjoringer: [{ farge_hex: '#222222', tradnavn_auto: null, fra_index: 0, til_index: 0, antall_blokker: 1, antall_sting: detaljSting.length }],
    })
    return {
      motiver: [pmJ, pmM],
      resolved: { 'e-j:s-j': dataJ, 'e-m:s-m': dataM },
    }
  }

  const sekvens: SekvensKjoring[] = [
    { id: 'el0', type: 'kjoring', plassertMotivId: 'pm-j', fargekjoringIndex: 0 },
    { id: 'el1', type: 'kjoring', plassertMotivId: 'pm-m', fargekjoringIndex: 0 },
    { id: 'el2', type: 'kjoring', plassertMotivId: 'pm-j', fargekjoringIndex: 1 },
  ]

  it('3 mm detalj FYSISK INNI satengkolonnen: endrerLagrekkefolge er true', () => {
    // Detaljen plassert på y=-150 — midt i blokk0 sitt sveipede område (rader ved -160 og
    // -140 sveiper hele bredden der), godt inni satengkolonnen.
    const ctx = byggKontekst(-150)

    const { forslag } = finnSammenslaingsforslag(sekvens, ctx)

    expect(forslag).toHaveLength(1)
    expect(forslag[0].endrerLagrekkefolge).toBe(true)
    expect(forslag[0].overlappendeFarger).toContain(snappTilPalett('#222222').hex)
  })

  it('3 mm detalj MIDT I GAPET mellom blokk0 og blokk1: endrerLagrekkefolge er false', () => {
    // Detaljen plassert på y=0 — midt i klippet (blokk0 slutter -40, blokk1 starter 40).
    // Uten per-blokk-interpolering ville en flatet-ut linje fra blokk0 sitt siste sting
    // til blokk1 sitt første trukket en falsk diagonal rett gjennom denne.
    const ctx = byggKontekst(0)

    const { forslag } = finnSammenslaingsforslag(sekvens, ctx)

    expect(forslag).toHaveLength(1)
    expect(forslag[0].endrerLagrekkefolge).toBe(false)
    expect(forslag[0].overlappendeFarger).toEqual([])
  })
})

// Verner e206b2a, som fjernet fargePerBlokk sin rå-fallback (`?? b.farge_hex`) — den
// siste kodeveien der en usnappet farge kunne nå skjermen.
describe('byggFargePerBlokk', () => {
  it('en overstyring dekker ALLE blokker i fra_index..til_index; blokker uten kjøring får snappet (aldri rå) farge', () => {
    const pm = plassert('pm-5', 'e5', 's5')
    const bbox: BroderiBbox = { min_x: 0, max_x: 10, min_y: 0, max_y: 10 }
    const data = motivData({
      bbox,
      stingblokker: [
        blokk({ farge_hex: '#123456', sting: [[0, 0], [1, 1]], bbox }),
        blokk({ farge_hex: '#654321', sting: [[0, 0], [1, 1]], bbox }),
        blokk({ farge_hex: '#abcdef', sting: [[0, 0], [1, 1]], bbox }),
      ],
      fargekjoringer: [{ farge_hex: '#000001', tradnavn_auto: null, fra_index: 0, til_index: 1, antall_blokker: 2, antall_sting: 4 }],
    })
    const ctx: SekvensKontekst = { motiver: [pm], resolved: { 'e5:s5': data } }
    const sekvens: SekvensKjoring[] = [
      { id: 'el', type: 'kjoring', plassertMotivId: 'pm-5', fargekjoringIndex: 0, fargeOverrideHex: '#111111' },
    ]

    const ut = byggFargePerBlokk(sekvens, ctx)

    const overstyrtSnappet = snappTilPalett('#111111').hex
    const egenSnappet = snappTilPalett('#abcdef').hex
    expect(ut['pm-5']).toEqual([overstyrtSnappet, overstyrtSnappet, egenSnappet])
    expect(ut['pm-5'][2]).not.toBe('#abcdef') // aldri rå
  })
})

// Stingtelleren mot Skitch PP1 sin 30 000-grense (prompt 4, docs/plan-og-prompter-2026-08-13.md).
describe('tellSting', () => {
  it('summerer antall_sting for kjøringene i sekvensen, ikke for hele biblioteket', () => {
    const pm = plassert('pm-t', 'et', 'st')
    const bbox: BroderiBbox = { min_x: 0, max_x: 10, min_y: 0, max_y: 10 }
    const data = motivData({
      bbox,
      stingblokker: [
        blokk({ farge_hex: '#111111', sting: [[0, 0], [1, 1]], bbox }),
        blokk({ farge_hex: '#222222', sting: [[0, 0], [1, 1], [2, 2]], bbox }),
      ],
      fargekjoringer: [
        { farge_hex: '#111111', tradnavn_auto: null, fra_index: 0, til_index: 0, antall_blokker: 1, antall_sting: 250 },
        { farge_hex: '#222222', tradnavn_auto: null, fra_index: 1, til_index: 1, antall_blokker: 1, antall_sting: 400 },
      ],
    })
    const ctx: SekvensKontekst = { motiver: [pm], resolved: { 'et:st': data } }

    // Bare den første kjøringen er med i sekvensen — den andre skal IKKE telles med.
    const sekvens: SekvensKjoring[] = [
      { id: 'el0', type: 'kjoring', plassertMotivId: 'pm-t', fargekjoringIndex: 0 },
    ]

    expect(tellSting(sekvens, ctx)).toBe(250)
  })

  it('teller pauser og manglende motivdata som 0, krasjer ikke', () => {
    const ctx: SekvensKontekst = { motiver: [], resolved: {} }
    const sekvens: SekvensElement[] = [
      { id: 'p', type: 'pause' },
      { id: 'el0', type: 'kjoring', plassertMotivId: 'ukjent', fargekjoringIndex: 0 },
    ]
    expect(tellSting(sekvens, ctx)).toBe(0)
  })
})

// NY test (ikke en verifisert runde ennå) — dekker to-stegs-koblingen i eksport.ts:
// byggEksportSegmenter sender effektivTradfarge(...).hex, som kan være brukerens EGEN
// trådfarge, ikke palettfargen. Det er bare riktig fordi byggPecTilEkteMap nøkler
// akkurat på snappTilPalett(trad.hex) — samme snap Python selv kommer til å gjøre ved
// skriving. Denne testen slår ut hvis den koblingen brytes (f.eks. om map-nøkkelen
// endres til å bruke trad.hex urørt).
describe('effektivTradfarge — to-stegs-koblingen mot brukerens egen trådpalett', () => {
  it('brukerens egne trådfarge vises, men snapper TILBAKE til samme PEC-bøtte som rå-fargen selv', () => {
    const pecFasit = '#0a55a3' // Brother "Blue" — den rå/PEC-fargen kjøringen faktisk er sydd i
    const minEgenTrad: MinTrad = { id: 't1', hex: '#0a55a4', navn: 'Min blå', merke: 'DMC', tradkode: '123' }
    // Forutsetning for testen: min egen tråd snapper faktisk til pecFasit — ellers tester
    // vi ingenting reelt (se kryssjekken i broderPalett.test.ts for selve snap-algoritmen).
    expect(snappTilPalett(minEgenTrad.hex).hex).toBe(pecFasit)

    const pecTilEkte = byggPecTilEkteMap([minEgenTrad])

    const pm = plassert('pm-t', 'et', 'st')
    const bbox: BroderiBbox = { min_x: 0, max_x: 10, min_y: 0, max_y: 10 }
    const data = motivData({
      bbox,
      stingblokker: [blokk({ farge_hex: pecFasit, sting: [[0, 0], [1, 1]], bbox })],
      fargekjoringer: [{ farge_hex: pecFasit, tradnavn_auto: null, fra_index: 0, til_index: 0, antall_blokker: 1, antall_sting: 2 }],
    })
    const ctx: SekvensKontekst = { motiver: [pm], resolved: { 'et:st': data }, pecTilEkte }
    const el: SekvensKjoring = { id: 'el', type: 'kjoring', plassertMotivId: 'pm-t', fargekjoringIndex: 0 }

    const vist = effektivTradfarge(ctx, el)

    expect(vist?.ekte).toBe(true)
    expect(vist?.hex).toBe(minEgenTrad.hex) // det VISTE er brukerens egen farge, ikke pecFasit
    expect(snappTilPalett(vist!.hex).hex).toBe(pecFasit) // men snapper TILBAKE til samme bøtte
  })
})

// Punkt A, docs/onsker-2026-10-02.md: omrokkering advarer bare når to kjøringer som bytter
// innbyrdes rekkefølge faktisk deler sting, og aldri ved samme tråd.
describe('finnLagkonflikter', () => {
  const BLÅ = '#0e1f7c' // Prussian Blue — eksakt palettfarge
  const GRØNN = '#008777' // Teal Green — eksakt palettfarge

  // Fylt kvadrat sentrert på (cx, cy): rader som sveiper hele bredden, så interpolerSting
  // fyller innsiden.
  function kvadrat(farge_hex: string, cx: number, cy: number, halv = 20): BroderiStingblokk {
    const sting: [number, number][] = []
    for (let y = cy - halv; y <= cy + halv; y += 5) sting.push([cx - halv, y], [cx + halv, y])
    return blokk({ farge_hex, sting, bbox: { min_x: cx - halv, max_x: cx + halv, min_y: cy - halv, max_y: cy + halv } })
  }

  function motivMedBlokker(blokker: BroderiStingblokk[]): BroderiMotivData {
    return motivData({
      bbox: {
        min_x: Math.min(...blokker.map(b => b.bbox.min_x)),
        max_x: Math.max(...blokker.map(b => b.bbox.max_x)),
        min_y: Math.min(...blokker.map(b => b.bbox.min_y)),
        max_y: Math.max(...blokker.map(b => b.bbox.max_y)),
      },
      stingblokker: blokker,
      fargekjoringer: blokker.map((b, i) => ({
        farge_hex: b.farge_hex, tradnavn_auto: null, fra_index: i, til_index: i, antall_blokker: 1, antall_sting: b.sting.length,
      })),
    })
  }

  function ettMotiv(blokker: BroderiStingblokk[]): SekvensKontekst {
    return { motiver: [plassert('pm', 'e', 's')], resolved: { 'e:s': motivMedBlokker(blokker) } }
  }

  const k0: SekvensKjoring = { id: 'k0', type: 'kjoring', plassertMotivId: 'pm', fargekjoringIndex: 0 }
  const k1: SekvensKjoring = { id: 'k1', type: 'kjoring', plassertMotivId: 'pm', fargekjoringIndex: 1 }

  it('samme motiv, ulik farge, disjunkt geometri, byttet rekkefølge → ingen konflikt', () => {
    const ctx = ettMotiv([kvadrat(BLÅ, -100, 0), kvadrat(GRØNN, 100, 0)])
    expect(finnLagkonflikter([k0, k1], [k1, k0], ctx, new Map())).toEqual([])
  })

  it('samme motiv, ulik farge, overlappende geometri, byttet rekkefølge → én konflikt med begge id-ene', () => {
    const ctx = ettMotiv([kvadrat(BLÅ, 0, 0), kvadrat(GRØNN, 5, 5)])
    const ut = finnLagkonflikter([k0, k1], [k1, k0], ctx, new Map())
    expect(ut).toHaveLength(1)
    // a er den som ligger først i ny.
    expect(ut[0]).toMatchObject({ aId: 'k1', bId: 'k0' })
    expect(ut[0].aFarge).toBe(effektivTradfarge(ctx, k1)?.hex)
    expect(ut[0].bFarge).toBe(effektivTradfarge(ctx, k0)?.hex)
  })

  it('overlappende geometri, men to rå hex-verdier som snapper til samme PEC-farge → ingen konflikt', () => {
    const raaA = BLÅ
    const raaB = '#0f207d'
    expect(raaA).not.toBe(raaB)
    expect(snappTilPalett(raaA).hex).toBe(snappTilPalett(raaB).hex)
    const ctx = ettMotiv([kvadrat(raaA, 0, 0), kvadrat(raaB, 5, 5)])
    expect(finnLagkonflikter([k0, k1], [k1, k0], ctx, new Map())).toEqual([])
  })

  it('gammel og ny identiske → ingen konflikt', () => {
    const ctx = ettMotiv([kvadrat(BLÅ, 0, 0), kvadrat(GRØNN, 5, 5)])
    expect(finnLagkonflikter([k0, k1], [k0, k1], ctx, new Map())).toEqual([])
  })

  it('bare en pause flyttet → ingen konflikt', () => {
    const ctx = ettMotiv([kvadrat(BLÅ, 0, 0), kvadrat(GRØNN, 5, 5)])
    const pause: SekvensElement = { id: 'p', type: 'pause' }
    expect(finnLagkonflikter([k0, pause, k1], [pause, k0, k1], ctx, new Map())).toEqual([])
  })

  it('ulike motiver med overlappende geometri, byttet rekkefølge → én konflikt (ny oppførsel)', () => {
    const ctx: SekvensKontekst = {
      motiver: [plassert('pm-a', 'ea', 'sa'), plassert('pm-b', 'eb', 'sb')],
      resolved: { 'ea:sa': motivMedBlokker([kvadrat(BLÅ, 0, 0)]), 'eb:sb': motivMedBlokker([kvadrat(GRØNN, 0, 0)]) },
    }
    const a: SekvensKjoring = { id: 'a', type: 'kjoring', plassertMotivId: 'pm-a', fargekjoringIndex: 0 }
    const b: SekvensKjoring = { id: 'b', type: 'kjoring', plassertMotivId: 'pm-b', fargekjoringIndex: 0 }
    const ut = finnLagkonflikter([a, b], [b, a], ctx, new Map())
    expect(ut).toHaveLength(1)
    expect(ut[0]).toMatchObject({ aId: 'b', bId: 'a' })
  })
})
