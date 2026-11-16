import { describe, it, expect } from 'vitest'
import { sizeGroups } from './size-groups'

const g = (label: string, garment?: string) => sizeGroups(label, garment)

describe('sizeGroups: children', () => {
  it('puts «1–2 år» in both 1 år and 2 år, however it is written', () => {
    for (const l of ['1–2 år', '1-2 år', '1/2 år', '1 - 2 år', '1-2 years']) expect(g(l)).toEqual(['1 år', '2 år'])
  })
  it('reads months up to the upper bound, and a single 12 or 24 months as a year', () => {
    expect(g('0-3 mnd')).toEqual(['0–12 mnd'])
    expect(g('6-12 mnd.')).toEqual(['0–12 mnd'])
    expect(g('3/6 mnd')).toEqual(['0–12 mnd'])
    expect(g('6mnd')).toEqual(['0–12 mnd'])
    expect(g('9-12 mdr.')).toEqual(['0–12 mnd'])
    expect(g('0-6 months')).toEqual(['0–12 mnd'])
    expect(g('12 mnd')).toEqual(['1 år'])
    expect(g('12–18 mnd')).toEqual(['1 år'])
    expect(g('24 måneder')).toEqual(['2 år'])
    expect(g('Prematur')).toEqual(['0–12 mnd'])
    expect(g('44 cm = prematur')).toEqual(['0–12 mnd'])
    expect(g('nyfødt')).toEqual(['0–12 mnd'])
  })
  it('reads years, ranges of years and bare child numbers', () => {
    expect(g('0-1 år')).toEqual(['0–12 mnd', '1 år'])
    expect(g('2år')).toEqual(['2 år'])
    expect(g('3/4 år')).toEqual(['3 år', '4 år'])
    expect(g('11-14 years')).toEqual(['11 år', '12 år', '13 år', '14 år'])
    expect(g('10')).toEqual(['10 år'])
    expect(g('7-8')).toEqual(['7 år', '8 år'])
  })
  it('turns children\'s cm sizes into age with the Babyverden table', () => {
    expect(g('56 cl')).toEqual(['0–12 mnd'])
    expect(g('86 cl')).toEqual(['1 år'])
    expect(g('92')).toEqual(['1 år', '2 år'])
  })
  it('leaves what is past 14 years or not in the table', () => {
    expect(g('Teen')).toEqual(['Annet'])
    expect(g('16 år')).toEqual(['Annet'])
    expect(g('122 cm')).toEqual(['Annet'])
  })
})

describe('sizeGroups: adults', () => {
  it('reads letters and letter ranges', () => {
    expect(g('M')).toEqual(['M'])
    expect(g('S/M')).toEqual(['S', 'M'])
    expect(g('XS-S')).toEqual(['XS', 'S'])
    expect(g('L-XL')).toEqual(['L', 'XL'])
    expect(g('2XL')).toEqual(['XXL'])
    expect(g('2XL/3XL')).toEqual(['XXL'])
    expect(g('XXS-XS')).toEqual(['XS'])
  })
  it('turns women\'s number sizes into letters with the s.Oliver table', () => {
    expect(g('36')).toEqual(['S'])
    expect(g('38/40')).toEqual(['M', 'L'])
    expect(g('42/44')).toEqual(['XL', 'XXL'])
    expect(g('32-34')).toEqual(['XS'])
  })
  it('leaves sizes outside XS–XXL, shoe sizes and words as «Annet»', () => {
    for (const l of ['XXS', '3XL', 'XXXL', '4XL', '5XL', '46', '48', '35/36', '39/40', '35-37', '20-22', 'Dame', 'One size', 'Onesize', 'Liten', '<0', '½', '45 x 45 cm', 'Ca. 15 cm', '118 x 200 cm + frynser']) {
      expect(g(l), l).toEqual(['Annet'])
    }
  })
  it('reads number sizes on socks and slippers as shoe sizes', () => {
    expect(g('36/38', 'sokker')).toEqual(['Annet'])
    expect(g('36/38', 'genser')).toEqual(['S', 'M'])
    expect(g('2 år', 'sokker')).toEqual(['2 år'])
  })
})
