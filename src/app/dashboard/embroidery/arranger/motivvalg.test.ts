import { describe, it, expect } from 'vitest'
import {
  byggVirtuelleMotiver, velgStandardStorrelse, beregnRutenettPosisjoner, beregnRutenettCelle,
  RAMME_GRENSE_MM, type BboxMm,
} from './motivvalg'
import type { Embroidery, EmbroideryBundle, EmbroiderySize, VirtuelMotiv, VirtuelStorrelse } from './types'

function size(overrides: Partial<EmbroiderySize> & { id: string; pesFilename: string }): EmbroiderySize {
  return { sizeLabel: '', pesUrl: '', ...overrides }
}

function rad(id: string, navn: string, sizes: EmbroiderySize[], bundleId?: string): Embroidery {
  return {
    id, created_at: '', data: {
      navn, bundleId, coverImage: '', bmpPreview: '', customImage: '', useCustomImage: false, sizes,
    },
  }
}

function bundle(id: string, navn: string): EmbroideryBundle {
  return { id, created_at: '', data: { navn, coverImage: '', customImage: '', useCustomImage: false } }
}

// Verner e206b2a, som skrev byggVirtuelleMotiver om fra filnavn-basert gruppering
// (feilen) til rad-basert identitet med et fontrad-unntak — se kommentaren over selve
// funksjonen for hva de fire formene under hver representerer.
describe('byggVirtuelleMotiver', () => {
  it('12Berries: 12 rader med 5 størrelser hver splittes IKKE opp i 60 enkeltkort', () => {
    const bd = bundle('b-berries', '12Berries')
    const bundlerMap = new Map([[bd.id, bd]])
    const STORRELSER = ['smallest', 'small', 'medium', 'large', 'largest']
    const biblioteket = Array.from({ length: 12 }, (_, i) =>
      rad(`design-${i}`, `Design ${i}`, STORRELSER.map((s, j) =>
        size({ id: `design-${i}-${j}`, sizeLabel: s[0].toUpperCase() + s.slice(1), pesFilename: `Design${i} ${s}.PES` }),
      ), bd.id),
    )

    const vms = byggVirtuelleMotiver(biblioteket, bundlerMap)

    expect(vms).toHaveLength(12)
    for (const vm of vms) expect(vm.sizes).toHaveLength(5)
  })

  it('Seraphine: fontrad splittes PER TEGN og grupperes PÅ TVERS av tommestørrelser', () => {
    const bd = bundle('b-sera', 'SERAPHINE SATIN FONT')
    const bundlerMap = new Map([[bd.id, bd]])
    const rad2Tomme = rad('row-2in', 'Seraphine 2"', [
      size({ id: 's2a', pesFilename: 'Seraphine_2inch_Lower_a.pes' }),
      size({ id: 's2b', pesFilename: 'Seraphine_2inch_Lower_b.pes' }),
    ], bd.id)
    const rad3Tomme = rad('row-3in', 'Seraphine 3"', [
      size({ id: 's3a', pesFilename: 'Seraphine_3inch_Lower_a.pes' }),
      size({ id: 's3b', pesFilename: 'Seraphine_3inch_Lower_b.pes' }),
    ], bd.id)

    const vms = byggVirtuelleMotiver([rad2Tomme, rad3Tomme], bundlerMap)

    expect(vms).toHaveLength(2)
    const a = vms.find(vm => vm.karakter?.tegn === 'a')
    const b = vms.find(vm => vm.karakter?.tegn === 'b')
    expect(a?.sizes.map(s => s.tommeLabel).sort()).toEqual(['2', '3'])
    expect(b?.sizes.map(s => s.tommeLabel).sort()).toEqual(['2', '3'])
  })

  it('BX Floral: «A (stor)» og «a (liten)» forblir TO kort, tross identisk filnavn A.PES', () => {
    const bd = bundle('b-bx', 'BX FLORAL ALPHABET PINK')
    const bundlerMap = new Map([[bd.id, bd]])
    const stor = rad('row-A-stor', 'A (stor)', [size({ id: 'a1', sizeLabel: '1.5"', pesFilename: 'A.PES' })], bd.id)
    const liten = rad('row-a-liten', 'a (liten)', [size({ id: 'a2', sizeLabel: '1.5"', pesFilename: 'A.PES' })], bd.id)

    const vms = byggVirtuelleMotiver([stor, liten], bundlerMap)

    expect(vms).toHaveLength(2)
    expect(vms.map(vm => vm.navn).sort()).toEqual(['A', 'a'])
  })

  it('blandet filnavnsstil i samme rad: ETT og samme tegn utledet på to ulike måter splitter IKKE raden', () => {
    const bd = bundle('b-mixed', 'Blandet bundle')
    const bundlerMap = new Map([[bd.id, bd]])
    const enRad = rad('row-mixed', 'Mixed Motif', [
      size({ id: 'm1', sizeLabel: 'Small', pesFilename: 'X.pes' }), // direkte enkelt-tegn
      size({ id: 'm2', sizeLabel: 'Large', pesFilename: 'SomeFont_Upper_X.pes' }), // Seraphine-stil
    ], bd.id)

    const vms = byggVirtuelleMotiver([enRad], bundlerMap)

    expect(vms).toHaveLength(1)
    expect(vms[0].navn).toBe('X')
    expect(vms[0].sizes).toHaveLength(2)
  })
})

// Verner 36cfb7a, som byttet "ingenting passer"-fallbacken fra maks areal til minst
// største dimensjon, og la til undefined-returen for en rad uten størrelser i det hele
// tatt (kallstedet, leggTilValgte, filtrerer disse bort).
describe('velgStandardStorrelse', () => {
  const bboxCache = new Map<string, BboxMm | null>()
  function leggBbox(embroideryId: string, sizeId: string, widthMm: number, heightMm: number) {
    bboxCache.set(`${embroideryId}:${sizeId}`, { widthMm, heightMm, miniatyrSvg: null })
  }
  function vm(sizes: VirtuelStorrelse[]): VirtuelMotiv {
    return { key: 'k', bundleId: null, identitet: 'k', navn: 'Test', coverImage: '', kats: [], katArvet: false, sizes }
  }
  function storrelse(id: string): VirtuelStorrelse {
    return { embroideryId: 'e', sizeId: id, tommeLabel: null, sizeLabel: id }
  }

  it('velger MAKS AREAL når minst én størrelse passer i rammen', () => {
    leggBbox('e', 'liten', 50, 50) // areal 2500, passer
    leggBbox('e', 'stor', 90, 90) // areal 8100, passer (begge < 98)
    const motiv = vm([storrelse('liten'), storrelse('stor')])
    expect(velgStandardStorrelse(motiv, bboxCache)?.sizeId).toBe('stor')
  })

  it('velger MINST STØRSTE DIMENSJON (ikke areal) når ingenting passer: 99×99 slår 200×10 og 120×120', () => {
    leggBbox('e', 'a', 99, 99) // størst dim 99
    leggBbox('e', 'b', 200, 10) // størst dim 200
    leggBbox('e', 'c', 120, 120) // størst dim 120
    const motiv = vm([storrelse('a'), storrelse('b'), storrelse('c')])
    expect(velgStandardStorrelse(motiv, bboxCache)?.sizeId).toBe('a')
  })

  it('98,0 mm regnes IKKE som passer — en 98×50 taper mot en faktisk passende 60×60', () => {
    leggBbox('e', 'grense', RAMME_GRENSE_MM, 50) // akkurat 98 — skal IKKE telle som passer
    leggBbox('e', 'passer', 60, 60)
    const motiv = vm([storrelse('grense'), storrelse('passer')])
    expect(velgStandardStorrelse(motiv, bboxCache)?.sizeId).toBe('passer')
  })

  it('returnerer undefined når raden ikke har noen størrelser', () => {
    const motiv = vm([])
    expect(velgStandardStorrelse(motiv, bboxCache)).toBeUndefined()
  })
})

// Verner e206b2a, som byttet maxCelleForAkse fra RAMME_MM (100) til RAMME_GRENSE_MM (98) —
// uten fiksen kunne to motiver havne flush mot rammekanten uten klaring.
describe('rutenett-invarianten (beregnRutenettCelle + beregnRutenettPosisjoner)', () => {
  it('2 × 45 mm: begge helt innenfor ±490 tiendedeler (98 mm-grensen)', () => {
    const { celleMm, umulig } = beregnRutenettCelle(2, 45)
    expect(umulig).toBe(false)
    const celleTiendedelMm = Math.round(celleMm * 10)
    const posisjoner = beregnRutenettPosisjoner(2, celleTiendedelMm)
    const halvTiendedel = 45 / 2 * 10
    for (const { x } of posisjoner) {
      expect(x - halvTiendedel).toBeGreaterThanOrEqual(-490)
      expect(x + halvTiendedel).toBeLessThanOrEqual(490)
    }
  })

  it('2 × 76 mm: umulig er true', () => {
    const { umulig } = beregnRutenettCelle(2, 76)
    expect(umulig).toBe(true)
  })
})
