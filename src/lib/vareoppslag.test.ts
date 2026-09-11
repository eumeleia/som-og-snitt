import { describe, it, expect } from 'vitest'
import {
  sammenlignNavn,
  erSammeVare,
  velgKandidat,
  utledVariantHale,
  avgjorEnhetsfelt,
  formaterMengdeAntall,
  tolkBrodsmulesti,
  unikeProduktnumre,
} from './vareoppslag'

describe('navnesammenligning', () => {
  it('«Vævet hvid med blomster» treffer «Vevet hvit med blomster»', () => {
    expect(erSammeVare('Vævet hvid med blomster', 'Vevet hvit med blomster')).toBe(true)
  })

  it('bruker bare de første 29 tegnene av produktnavnet', () => {
    // Kvitteringens kuttede navn matcher starten av et mye lengre, urelatert-i-halen
    // produktnavn — sammenligningen skal ikke straffes av det som kommer etter tegn 29.
    const kvitteringsnavn = 'Vevet jacquard med stretch og' // nøyaktig 29 tegn, kuttet
    const produktnavn = 'Vevet jacquard med stretch og lurex sand, helt annen hale her'
    expect(sammenlignNavn(kvitteringsnavn, produktnavn)).toBeGreaterThan(0.95)
  })

  it('avviser et klart urelatert navn', () => {
    expect(erSammeVare('Gütermann sew all sytråd 200m', 'YKK glidelås usynlig spiral')).toBe(false)
  })
})

describe('velgKandidat — fire Gütermann-tråder holdes fra hverandre på nummer', () => {
  it('unikeProduktnumre grupperer IKKE de fire trådfargene sammen selv om navnet er likt', () => {
    const linjer = [
      { produktnummer: '19246', navn: 'Gütermann sew all sytråd 200m' },
      { produktnummer: '19386', navn: 'Gütermann sew all sytråd 200m' },
      { produktnummer: '19132', navn: 'Gütermann sew all sytråd 200m' },
      { produktnummer: '19351', navn: 'Gütermann sew all sytråd 200m' },
    ]
    expect(unikeProduktnumre(linjer)).toEqual(['19246', '19386', '19132', '19351'])
  })

  it('samme produktnummer to ganger slås bare opp én gang', () => {
    const linjer = [
      { produktnummer: '9001', navn: 'Lerret m lim hvit 90x100cm' },
      { produktnummer: '9001', navn: 'Lerret m lim hvit 90x100cm' },
    ]
    expect(unikeProduktnumre(linjer)).toEqual(['9001'])
  })

  it('velger direkte når det bare er én kandidat', () => {
    const valg = velgKandidat('Gütermann sew all sytråd 200m', [{ url: 'x', navn: 'Gütermann sew all sytråd 200m frg. 000' }])
    expect(valg.utfall).toBe('valgt')
  })

  it('overlater til brukeren når to kandidater ligger nær hverandre i likhet', () => {
    const valg = velgKandidat('Skråbånd sateng 18 mm', [
      { url: 'a', navn: 'Skråbånd sateng 18 mm sort' },
      { url: 'b', navn: 'Skråbånd sateng 18 mm hvit' },
    ])
    expect(valg.utfall).toBe('flereTreff')
  })
})

describe('variantutledning', () => {
  it('4074320 mot basis 4074355 gir variant «20»', () => {
    expect(utledVariantHale('4074320', '4074355')).toBe('20')
  })

  it('ingen hale når numrene er like', () => {
    expect(utledVariantHale('400388', '400388')).toBeNull()
  })

  it('ingen hale når numrene ikke deler noen prefiks', () => {
    expect(utledVariantHale('4074320', '999999')).toBeNull()
  })
})

describe('enhet avgjør mengde eller antall', () => {
  it('«kr/m» gir mengde', () => {
    expect(avgjorEnhetsfelt('225,00 kr/m')).toBe('mengde')
  })

  it('«Pris pr meter» gir mengde', () => {
    expect(avgjorEnhetsfelt('Pris pr meter 129,95 kr')).toBe('mengde')
  })

  it('«per stk»/«Pris pr stk» gir antall', () => {
    expect(avgjorEnhetsfelt('per stk')).toBe('antall')
    expect(avgjorEnhetsfelt('Pris pr stk 34,95 kr')).toBe('antall')
  })
})

describe('formaterMengdeAntall', () => {
  it('metervare med desimal', () => {
    expect(formaterMengdeAntall(1.8, 'mengde')).toBe('1,8 m')
  })

  it('stykkvare med helt tall', () => {
    expect(formaterMengdeAntall(1, 'antall')).toBe('1')
  })
})

describe('tolkBrodsmulesti', () => {
  it('Metervarer gir kategori Stoff', () => {
    expect(tolkBrodsmulesti(['Metervarer', 'Handle etter kategori', 'Garnfarget'])).toEqual({ kategori: 'Stoff' })
  })

  it('Sytilbehør gir kategori Tilbehør med underkategori fra bladet', () => {
    expect(tolkBrodsmulesti(['Sytilbehør', 'Handle etter kategori', 'Glidelåser', 'Usynlige glidelåser']))
      .toEqual({ kategori: 'Tilbehør', underkategori: 'Usynlige glidelåser' })
  })

  it('ukjent toppnivå faller tilbake til Utstyr', () => {
    expect(tolkBrodsmulesti(['Garn', 'Ullgarn'])).toEqual({ kategori: 'Utstyr', utstyrstype: 'Ullgarn' })
  })
})
