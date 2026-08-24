import { describe, it, expect } from 'vitest'
import { lesKoblinger, skrivKoblinger } from './stoffProsjektKobling'

describe('lesKoblinger', () => {
  it('nytt felt vinner over de gamle enkeltfeltene når begge er satt', () => {
    const koblinger = lesKoblinger({
      tiltenktProsjekter: [{ id: 'p1', navn: 'Sommerkjole' }],
      tiltenktProsjektId: 'gammel-id',
      tiltenktProsjektNavn: 'Gammelt navn',
    })
    expect(koblinger).toEqual([{ id: 'p1', navn: 'Sommerkjole' }])
  })

  it('utleder én kobling fra de gamle enkeltfeltene når det nye ikke er satt', () => {
    const koblinger = lesKoblinger({
      tiltenktProsjektId: 'p2',
      tiltenktProsjektNavn: 'Vinterjakke',
    })
    expect(koblinger).toEqual([{ id: 'p2', navn: 'Vinterjakke' }])
  })

  it('tomt objekt gir tom liste', () => {
    expect(lesKoblinger({})).toEqual([])
    expect(lesKoblinger(undefined)).toEqual([])
    expect(lesKoblinger(null)).toEqual([])
  })
})

describe('skrivKoblinger', () => {
  it('skriver duplikat-id én gang', () => {
    const next = skrivKoblinger({}, [
      { id: 'p1', navn: 'Sommerkjole' },
      { id: 'p1', navn: 'Sommerkjole (duplikat)' },
      { id: 'p2', navn: 'Vinterjakke' },
    ])
    expect(next.tiltenktProsjekter).toEqual([
      { id: 'p1', navn: 'Sommerkjole' },
      { id: 'p2', navn: 'Vinterjakke' },
    ])
  })

  it('fjerner de gamle enkeltfeltene etter skriving', () => {
    const next = skrivKoblinger(
      { tiltenktProsjektId: 'gammel-id', tiltenktProsjektNavn: 'Gammelt navn' },
      [{ id: 'p1', navn: 'Sommerkjole' }],
    )
    expect((next as Record<string, unknown>).tiltenktProsjektId).toBeUndefined()
    expect((next as Record<string, unknown>).tiltenktProsjektNavn).toBeUndefined()
    expect(next.tiltenktProsjekter).toEqual([{ id: 'p1', navn: 'Sommerkjole' }])
  })
})
