import { describe, it, expect } from 'vitest'
import { lesBxFiler, slaaInnBx, tommerForSizes, type BxParseSvar } from './bxMetrikk'
import { bxTommeStemmer, utledTommeFraBxSti } from './tomme'
import type { FontMetrikk } from './types'

describe('utledTommeFraBxSti', () => {
  it('mappenavnet i StitchConcept-pakken', () => {
    expect(utledTommeFraBxSti("SERAPHINE_SATIN/1_5inches/BX/Seraphine_Satin_ 1_5''.bx")).toBe('1.5')
    expect(utledTommeFraBxSti("SERAPHINE_SATIN/2inches/BX/Seraphine_Satin_2''.bx")).toBe('2')
    expect(utledTommeFraBxSti('SERAPHINE_SATIN\\4_5inches\\BX\\x.bx')).toBe('4.5')
  })

  it('løs fil uten mappe: filnavnets tommer', () => {
    expect(utledTommeFraBxSti("Seraphine_Satin_ 1_5''.bx")).toBe('1.5')
    expect(utledTommeFraBxSti("Seraphine_Satin_5''.bx")).toBe('5')
    expect(utledTommeFraBxSti('Font_3_5inch.bx')).toBe('3.5')
  })

  it('ingen tomme i stien: null, ingen gjetning', () => {
    expect(utledTommeFraBxSti('Font/BX/Seraphine.bx')).toBeNull()
  })
})

describe('bxTommeStemmer', () => {
  it('alle åtte Seraphine-størrelsene stemmer med sin mHeight', () => {
    const maalt: Array<[string, number]> = [
      ['1.5', 390], ['2', 516], ['2.5', 644], ['3', 770], ['3.5', 898], ['4', 1024], ['4.5', 1152], ['5', 1278],
    ]
    for (const [t, m] of maalt) expect(bxTommeStemmer(t, m)).toBe(true)
  })

  it('nabostørrelsen stemmer ikke', () => {
    expect(bxTommeStemmer('2', 390)).toBe(false)
    expect(bxTommeStemmer('1.5', 516)).toBe(false)
  })
})

function svar(mHeight: number): BxParseSvar {
  return {
    fontName: 'F', ltrSpace: 0.03 * mHeight, wSpace: 0.04 * mHeight, intraRHS: 0, kern: 0,
    mHeight, defsz: mHeight, minsz: mHeight / 2, maxsz: mHeight * 2.5, availableChars: ['abc'],
    glyphs: [{ tegn: 'a', noekkel: 'a', bredde: 184, hoyde: 126, grunnlinjeY: -63, underlengdeAndel: 0, kildenavn: null }],
  }
}

const fil = (sti: string, innhold = sti) => ({ sti, getData: async () => new TextEncoder().encode(innhold) })

describe('lesBxFiler', () => {
  const parse = async (d: Uint8Array) => {
    const sti = new TextDecoder().decode(d)
    if (sti.includes('odelagt')) throw new Error('Fant ingen font-metrikkpost')
    return svar(sti.includes('2inches') ? 516 : 390)
  }

  it('én BX per tomme, nøklet på tommen fra stien', async () => {
    const r = await lesBxFiler(
      [fil("P/1_5inches/BX/S_ 1_5''.bx"), fil("P/2inches/BX/S_2''.bx")], parse, new Set(['1.5', '2']), 'T',
    )
    expect(Object.keys(r.perTomme).sort()).toEqual(['1.5', '2'])
    expect(r.perTomme['2'].mHeight).toBe(516)
    expect(r.perTomme['1.5'].filnavn).toBe("S_ 1_5''.bx")
    expect(r.meldinger).toEqual([])
  })

  it('fil som ikke lar seg tolke: melding, ingen kastet feil, de andre brukes', async () => {
    const r = await lesBxFiler(
      [fil("P/1_5inches/BX/odelagt.bx"), fil("P/2inches/BX/S_2''.bx")], parse, new Set(['1.5', '2']),
    )
    expect(Object.keys(r.perTomme)).toEqual(['2'])
    expect(r.meldinger).toHaveLength(1)
    expect(r.meldinger[0]).toContain('kunne ikke tolkes')
  })

  it('tomme fra stien som ikke stemmer med mHeight: ikke brukt', async () => {
    const r = await lesBxFiler([fil("P/3inches/BX/S_3''.bx")], parse, new Set(['3']))
    expect(r.perTomme).toEqual({})
    expect(r.meldinger[0]).toContain('fonthøyden')
  })

  it('tomme bundelen ikke har PES-filer for: ikke brukt', async () => {
    const r = await lesBxFiler([fil("P/2inches/BX/S_2''.bx")], parse, new Set(['1.5']))
    expect(r.perTomme).toEqual({})
    expect(r.meldinger[0]).toContain('ingen PES-filer')
  })

  it('svar med ukjent form: ikke brukt', async () => {
    const r = await lesBxFiler(
      [fil("P/2inches/BX/S_2''.bx")], async () => ({ mHeight: 516 }) as unknown as BxParseSvar, new Set(['2']),
    )
    expect(r.perTomme).toEqual({})
    expect(r.meldinger[0]).toContain('ukjent form')
  })
})

describe('tommerForSizes', () => {
  it('filnavnet først, så sizeLabel', () => {
    expect([...tommerForSizes([
      { pesFilename: 'SCSeraphine_Satin_1_5inch_lower_a.PES', sizeLabel: 'x' },
      { pesFilename: 'A.PES', sizeLabel: '2"' },
    ])].sort()).toEqual(['1.5', '2'])
  })
})

describe('slaaInnBx', () => {
  type Bundle = { navn: string; kategori?: string; kategorier?: string[]; fontMetrikk?: FontMetrikk }
  const manuell: FontMetrikk = {
    sporingAndel: 0.1, mellomromAndel: 0.8,
    tegn: { p: { underlengdeAndel: 0.4, kilde: 'manuell', oppdatert: 'x' } },
  }

  it('manuell kalibrering og mellomrom overlever, font legges til som kategori', async () => {
    const { perTomme } = await lesBxFiler([fil("P/2inches/BX/S_2''.bx")], async () => svar(516), new Set(['2']))
    const ny = slaaInnBx<Bundle>({ navn: 'S', kategori: 'Alfabet', fontMetrikk: manuell }, perTomme)
    expect(ny.fontMetrikk?.tegn).toEqual(manuell.tegn)
    expect(ny.fontMetrikk?.sporingAndel).toBe(0.1)
    expect(ny.fontMetrikk?.mellomromAndel).toBe(0.8)
    expect(ny.fontMetrikk?.bx?.['2'].mHeight).toBe(516)
    expect(ny.kategorier).toEqual(['Alfabet', 'font'])
  })

  it('ny innlesing erstatter samme tomme og beholder de andre', async () => {
    const a = await lesBxFiler([fil("P/2inches/BX/S_2''.bx")], async () => svar(516), new Set(['2']), 'første')
    const b = await lesBxFiler([fil("P/1_5inches/BX/S.bx")], async () => svar(390), new Set(['1.5']))
    const c = await lesBxFiler([fil("P/2inches/BX/S_2''.bx")], async () => svar(516), new Set(['2']), 'andre')
    const ny = slaaInnBx(slaaInnBx(slaaInnBx<Bundle>({ navn: 'S', kategorier: ['Font'] }, a.perTomme), b.perTomme), c.perTomme)
    expect(Object.keys(ny.fontMetrikk!.bx!).sort()).toEqual(['1.5', '2'])
    expect(ny.fontMetrikk!.bx!['2'].lastInn).toBe('andre')
    expect(ny.kategorier).toEqual(['Font'])
  })

  it('ingenting lest inn: data uendret', () => {
    const d: Bundle = { navn: 'S' }
    expect(slaaInnBx(d, {})).toBe(d)
  })
})
