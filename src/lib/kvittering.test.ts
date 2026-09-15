import { describe, it, expect } from 'vitest'
import {
  parseKvitteringDato,
  sjekkSummering,
  normaliserBilagsnummer,
  byggKvitteringsfilnavn,
  beregnMaalstorrelse,
  velgKvitteringsstrategi,
  VERCEL_PAYLOAD_GRENSE_BYTES,
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

describe('byggKvitteringsfilnavn', () => {
  it('bygger dato-bilagsnummer.endelse fra originalfilens navn', () => {
    expect(byggKvitteringsfilnavn('2026-01-05', '02400100364815', 'IMG_1234.heic'))
      .toBe('2026-01-05-02400100364815.heic')
  })

  it('normaliserer endelsen til små bokstaver', () => {
    expect(byggKvitteringsfilnavn('2026-01-05', '02400100364815', 'IMG_1234.HEIC'))
      .toBe('2026-01-05-02400100364815.heic')
  })

  it('faller tilbake til jpg uten endelse i originalnavnet', () => {
    expect(byggKvitteringsfilnavn('2026-01-05', '02400100364815', 'kvittering'))
      .toBe('2026-01-05-02400100364815.jpg')
  })
})

describe('beregnMaalstorrelse', () => {
  it('skalerer ned et liggende bilde til 1568 på lengste side', () => {
    expect(beregnMaalstorrelse(4000, 2000)).toEqual({ bredde: 1568, hoyde: 784 })
  })

  it('skalerer ned et stående bilde til 1568 på lengste side', () => {
    expect(beregnMaalstorrelse(2000, 4000)).toEqual({ bredde: 784, hoyde: 1568 })
  })

  it('skalerer et kvadratisk bilde likt på begge kanter', () => {
    expect(beregnMaalstorrelse(3000, 3000)).toEqual({ bredde: 1568, hoyde: 1568 })
  })

  it('skalerer aldri OPP et bilde som alt er mindre enn maksSide', () => {
    expect(beregnMaalstorrelse(800, 600)).toEqual({ bredde: 800, hoyde: 600 })
  })

  it('lar et bilde nøyaktig på grensa stå urørt', () => {
    expect(beregnMaalstorrelse(1568, 1000)).toEqual({ bredde: 1568, hoyde: 1000 })
  })
})

describe('velgKvitteringsstrategi', () => {
  it('skalerer når nettleseren kan dekode, uansett størrelse', () => {
    expect(velgKvitteringsstrategi(true, 1)).toBe('skaler')
    expect(velgKvitteringsstrategi(true, 50 * 1024 * 1024)).toBe('skaler')
  })

  it('sender originalen når den ikke kan dekodes, men er under Vercel-grensa', () => {
    expect(velgKvitteringsstrategi(false, VERCEL_PAYLOAD_GRENSE_BYTES - 1)).toBe('send-original')
  })

  it('sender originalen nøyaktig PÅ grensa', () => {
    expect(velgKvitteringsstrategi(false, VERCEL_PAYLOAD_GRENSE_BYTES)).toBe('send-original')
  })

  it('avviser når den verken kan dekodes eller er under grensa', () => {
    expect(velgKvitteringsstrategi(false, VERCEL_PAYLOAD_GRENSE_BYTES + 1)).toBe('avvis')
  })
})
