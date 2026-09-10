import { describe, it, expect } from 'vitest'
import { erUtlopt, delKomposisjoner, DAGER_I_KURVEN } from './soppelkurv'

const DOGN_MS = 24 * 60 * 60 * 1000

describe('erUtlopt', () => {
  it('nøyaktig 30 døgn er IKKE utløpt — løftet er "minst 30 dager"', () => {
    const slettetTid = '2026-01-01T00:00:00.000Z'
    const naa = new Date(Date.parse(slettetTid) + DAGER_I_KURVEN * DOGN_MS)
    expect(erUtlopt(slettetTid, naa)).toBe(false)
  })

  it('30 døgn + 1 sekund ER utløpt', () => {
    const slettetTid = '2026-01-01T00:00:00.000Z'
    const naa = new Date(Date.parse(slettetTid) + DAGER_I_KURVEN * DOGN_MS + 1000)
    expect(erUtlopt(slettetTid, naa)).toBe(true)
  })

  it('29 døgn er ikke utløpt', () => {
    const slettetTid = '2026-01-01T00:00:00.000Z'
    const naa = new Date(Date.parse(slettetTid) + 29 * DOGN_MS)
    expect(erUtlopt(slettetTid, naa)).toBe(false)
  })
})

describe('delKomposisjoner', () => {
  it('deler i aktive og iKurven, iKurven sortert nyest først', () => {
    const rader = [
      { id: 'a', slettet_tid: null },
      { id: 'b', slettet_tid: '2026-01-01T00:00:00.000Z' },
      { id: 'c', slettet_tid: '2026-01-05T00:00:00.000Z' },
      { id: 'd', slettet_tid: null },
    ]
    const { aktive, iKurven } = delKomposisjoner(rader)
    expect(aktive.map(r => r.id)).toEqual(['a', 'd'])
    expect(iKurven.map(r => r.id)).toEqual(['c', 'b'])
  })

  it('en rad med ugyldig datostreng i slettet_tid havner i aktive, ikke forsvinner stille', () => {
    const rader = [
      { id: 'ugyldig', slettet_tid: 'ikke-en-dato' },
      { id: 'gyldig', slettet_tid: '2026-01-01T00:00:00.000Z' },
    ]
    const { aktive, iKurven } = delKomposisjoner(rader)
    expect(aktive.map(r => r.id)).toEqual(['ugyldig'])
    expect(iKurven.map(r => r.id)).toEqual(['gyldig'])
  })
})
