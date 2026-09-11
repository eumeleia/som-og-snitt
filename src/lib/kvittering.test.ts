import { describe, it, expect } from 'vitest'
import {
  parseKvitteringDato,
  sjekkSummering,
  normaliserBilagsnummer,
  type KvitteringLinje,
  type KvitteringRabatt,
} from './kvittering'

describe('parseKvitteringDato', () => {
  it('30-05-2026 blir 2026-05-30', () => {
    expect(parseKvitteringDato('30-05-2026')).toBe('2026-05-30')
  })

  it('05-01-2026 blir 2026-01-05', () => {
    expect(parseKvitteringDato('05-01-2026')).toBe('2026-01-05')
  })

  it('kaster på ugyldig format', () => {
    expect(() => parseKvitteringDato('2026-05-30')).toThrow()
  })
})

describe('sjekkSummering', () => {
  const linjer: KvitteringLinje[] = [
    { produktnummer: '502164', navn: 'Musselin 2-lags støvet flaske', antall: 1.8, enhetspris: 79.20, linjesum: 142.56 },
  ]

  it('går opp med rabattlinje — eksempel fra 30.05.2026', () => {
    const varer: KvitteringLinje[] = [
      ...linjer,
      { produktnummer: '000000', navn: 'Fyllvare', antall: 1, enhetspris: 725.00, linjesum: 725.00 },
    ]
    const rabatter: KvitteringRabatt[] = [{ tekst: 'Line discount', belop: -26.40 }]
    const resultat = sjekkSummering(varer, rabatter, 841.16)
    expect(resultat.ok).toBe(true)
    expect(resultat.differanse).toBeCloseTo(0, 5)
  })

  it('går opp uten rabattlinje', () => {
    const resultat = sjekkSummering(linjer, [], 142.56)
    expect(resultat.ok).toBe(true)
  })

  it('slår varsku når det ikke stemmer', () => {
    const resultat = sjekkSummering(linjer, [], 200)
    expect(resultat.ok).toBe(false)
    expect(resultat.differanse).toBeCloseTo(142.56 - 200, 5)
  })

  it('tolererer inntil 0,05 i øreavrunding', () => {
    const resultat = sjekkSummering(linjer, [], 142.60)
    expect(resultat.ok).toBe(true)
  })
})

describe('normaliserBilagsnummer', () => {
  it('ledende null overlever gjennom hele veien', () => {
    expect(normaliserBilagsnummer('02400100381832')).toBe('02400100381832')
  })

  it('kaster hvis JSON.parse har gjort bilagsnummeret om til et tall', () => {
    // Simulerer at Claude glapp anførselstegnene, og JSON.parse('{"bilagsnummer": 02400100381832}')
    // ville uansett vært ugyldig JSON — men et gyldig, u-quotet tall uten ledende null
    // (f.eks. 2400100381832) er den reelle fellen: streng-typen er borte.
    expect(() => normaliserBilagsnummer(2400100381832)).toThrow()
  })

  it('kaster på tom streng', () => {
    expect(() => normaliserBilagsnummer('')).toThrow()
  })
})
