import { describe, it, expect } from 'vitest'
import { findLeftoverMention, hasSearchableText } from './leftover'

describe('findLeftoverMention', () => {
  it('finds restegarn, rester and leftover in Norwegian, Danish and English', () => {
    expect(findLeftoverMention('Perfekt prosjekt for å bruke opp restegarn fra skuffen')).toContain('restegarn')
    expect(findLeftoverMention('Strikk stripene i rester av ullgarn')).toContain('rester')
    expect(findLeftoverMention('Brug dine restgarner til huen')).toContain('restgarner')
    expect(findLeftoverMention('A great way to use up leftovers.')).toContain('leftovers')
    expect(findLeftoverMention('Use left-over yarn')).toContain('left-over')
    expect(findLeftoverMention('Garnrester i fire farger')).toContain('Garnrester')
  })
  it('does not count words that only start the same way', () => {
    expect(findLeftoverMention('Strikk resten av bolen i glattstrikk. Restaurant. Rest 2 m.')).toBeNull()
    expect(findLeftoverMention('Annet utstyr: en liten garnrest til broderi')).toBeNull()
  })
  it('gives the words around the mention', () => {
    expect(findLeftoverMention('a'.repeat(100) + ' bruk restegarn her ' + 'b'.repeat(100))).toMatch(/^….*bruk restegarn her.*…$/)
  })
  it('tells a scanned page from a page with text', () => {
    expect(hasSearchableText('Side 1 2 3')).toBe(false)
    expect(hasSearchableText('Genser '.repeat(40))).toBe(true)
  })
})
