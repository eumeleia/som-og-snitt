import { describe, it, expect } from 'vitest'
import { erEndret, type KomposisjonSnapshot } from './lagreSnapshot'
import type { BroderiKomposisjonData, PlassertMotiv, SekvensKjoring } from './types'

function motiv(overrides: Partial<PlassertMotiv> & { id: string; embroideryId: string; sizeId: string }): PlassertMotiv {
  return { navn: overrides.id, posisjonXTiendedelMm: 0, posisjonYTiendedelMm: 0, rotasjonGrader: 0, ...overrides }
}

function kjoring(overrides: Partial<SekvensKjoring> & { id: string; plassertMotivId: string }): SekvensKjoring {
  return { type: 'kjoring', fargekjoringIndex: 0, ...overrides }
}

function snapshot(overrides: Partial<KomposisjonSnapshot> = {}): KomposisjonSnapshot {
  return {
    navn: 'Sommerkjole',
    motiver: [motiv({ id: 'pm-1', embroideryId: 'e-1', sizeId: 's-1' })],
    sekvens: [kjoring({ id: 'k-1', plassertMotivId: 'pm-1' })],
    ...overrides,
  }
}

describe('erEndret', () => {
  it('uendret snapshot gir false', () => {
    const a = snapshot()
    const b = snapshot()
    expect(erEndret(a, b)).toBe(false)
  })

  it('flyttet motiv gir true', () => {
    const a = snapshot()
    const b = snapshot({
      motiver: [motiv({ id: 'pm-1', embroideryId: 'e-1', sizeId: 's-1', posisjonXTiendedelMm: 50 })],
    })
    expect(erEndret(a, b)).toBe(true)
  })

  it('endret navn gir true', () => {
    const a = snapshot()
    const b = snapshot({ navn: 'Vinterjakke' })
    expect(erEndret(a, b)).toBe(true)
  })

  it('endret sekvens gir true', () => {
    const a = snapshot()
    const b = snapshot({
      sekvens: [kjoring({ id: 'k-1', plassertMotivId: 'pm-1', fargeOverrideHex: '#ff0000' })],
    })
    expect(erEndret(a, b)).toBe(true)
  })

  it('miniatyrSvg alene teller ikke som en endring', () => {
    const felles = snapshot()
    // BroderiKomposisjonData har miniatyrSvg i tillegg til navn/motiver/sekvens — cast
    // via en variabel (ikke et objektlitteral rett i kallet) slipper unna TypeScripts
    // excess-property-sjekk, akkurat som et ekte kall fra KomposisjonEditor ville gjort
    // (den sender alltid et fullt BroderiKomposisjonData-objekt inn).
    const a: BroderiKomposisjonData = { ...felles, miniatyrSvg: '<svg>gammel</svg>' }
    const b: BroderiKomposisjonData = { ...felles, miniatyrSvg: '<svg>ny</svg>' }
    expect(erEndret(a, b)).toBe(false)
  })
})
