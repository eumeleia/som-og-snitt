import { describe, it, expect } from 'vitest'
import { visningsnavn, sammenlignFargetone, sokTreffer } from './tradvisning'

// Ekte navn fra Lageret (2026-10-14), ett per navneformat.
describe('visningsnavn', () => {
  it.each([
    ['Brother Country Embroidery Thread, 255 Light Brown', 'Brother', '255 Light Brown'],
    ['Click to expand Brother Country Embroidery Thread, 126 Red', 'Brother', '126 Red'],
    ['331 Cream Brown (Brother Country Embroidery Thread)', 'Brother', '331 Cream Brown'],
    ['CYT-624 - Violet', 'Brother', 'CYT-624 - Violet'],
    ['PF635 - Blackberry', 'FUFU', 'PF635 - Blackberry'],
    ['PF1011 - Desert Bloom - FUFU', 'FUFU', 'PF1011 - Desert Bloom'],
    ['Sulky rayon 40 - 200 m, fv. 1067', 'Gütermann Sulky', '1067'],
    ['Sulky rayon 40 - 200 m, fv. 1005 - sort', 'Gütermann Sulky', '1005 - sort'],
    ['61391 Poly No40 Polyester - 1000m på pappspoler (ikke miniking)', 'Gunold', '61391 Poly No40 Polyester - 1000m på pappspoler'],
  ])('%s → %s', (navn, merke, forventet) => {
    expect(visningsnavn(navn, merke)).toBe(forventet)
  })

  it('faller tilbake til hele navnet når reglene ville gitt tom tekst', () => {
    expect(visningsnavn('(bare parentes)', '')).toBe('(bare parentes)')
  })
})

describe('sammenlignFargetone', () => {
  it('legger like farger ved siden av hverandre og gråtoner til slutt, lys før mørk', () => {
    const farger = ['#000000', '#0a55a3', '#ed171f', '#f0f0f0', '#e70268', '#2584bb', '#878787']
    expect([...farger].sort(sammenlignFargetone)).toEqual(
      ['#e70268', '#ed171f', '#2584bb', '#0a55a3', '#f0f0f0', '#878787', '#000000'],
    )
  })
})

describe('sokTreffer', () => {
  const felter = ['Brother Country Embroidery Thread, 255 Light Brown', 'CYT-255', 'Brother', '#682408']
  it('treffer på nummer, navn og flere ord i vilkårlig rekkefølge', () => {
    expect(sokTreffer('255', felter)).toBe(true)
    expect(sokTreffer('brown light', felter)).toBe(true)
    expect(sokTreffer('cyt-255', felter)).toBe(true)
    expect(sokTreffer('blue', felter)).toBe(false)
  })
  it('ignorerer aksenter og tomt søk', () => {
    expect(sokTreffer('gutermann', ['Gütermann Sulky'])).toBe(true)
    expect(sokTreffer('  ', felter)).toBe(true)
  })
})
