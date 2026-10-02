import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { fraMock } = vi.hoisted(() => ({ fraMock: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: fraMock } }))

import { hentPalett, lesSistBrukte, registrerBrukt, MAKS_SIST_BRUKTE } from './fargepalett'

const NOKKEL = 'som-og-snitt:sist-brukte-farger'

function minneLager(start: Record<string, string> = {}) {
  const m = new Map(Object.entries(start))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('registrerBrukt', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', minneLager()) })

  it('legger nyeste først', () => {
    registrerBrukt('#111111')
    expect(registrerBrukt('#222222')).toEqual(['#222222', '#111111'])
    expect(lesSistBrukte()).toEqual(['#222222', '#111111'])
  })

  it('fjerner duplikat uavhengig av store/små bokstaver', () => {
    registrerBrukt('#AABBCC')
    registrerBrukt('#111111')
    expect(registrerBrukt('#aabbcc')).toEqual(['#aabbcc', '#111111'])
  })

  it(`kutter ved ${MAKS_SIST_BRUKTE}`, () => {
    for (let i = 0; i < 9; i++) registrerBrukt(`#00000${i}`)
    const ut = lesSistBrukte()
    expect(ut).toHaveLength(MAKS_SIST_BRUKTE)
    expect(ut[0]).toBe('#000008')
  })
})

describe('lesSistBrukte', () => {
  it('localStorage som kaster → [], ingen exception ut', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('SecurityError') },
    })
    expect(lesSistBrukte()).toEqual([])
    expect(() => registrerBrukt('#123456')).not.toThrow()
  })

  it('ugyldig JSON → []', () => {
    vi.stubGlobal('localStorage', minneLager({ [NOKKEL]: '{ikke json' }))
    expect(lesSistBrukte()).toEqual([])
  })

  it('gyldig JSON som ikke er et array → []', () => {
    vi.stubGlobal('localStorage', minneLager({ [NOKKEL]: '{"a":1}' }))
    expect(lesSistBrukte()).toEqual([])
  })
})

describe('hentPalett', () => {
  it('hopper over rader med ugyldig hex og beholder resten', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        { id: '1', data: { hex: '#0e1f7c', navn: 'Prussian Blue', tradkode: '', merke: '', kilde: 'brother' } },
        { id: '2', data: { hex: 'blå', navn: 'Ugyldig', tradkode: '', merke: '', kilde: 'brother' } },
        { id: '3', data: { navn: 'Uten hex' } },
        { id: '4', data: { hex: '#AABBCC', navn: 'Min tråd', tradkode: '1234', merke: 'Madeira', kilde: 'lager' } },
      ],
      error: null,
    })
    fraMock.mockReturnValue({ select: () => ({ order }) })

    const ut = await hentPalett()

    expect(fraMock).toHaveBeenCalledWith('broderi_fargepalett')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true })
    expect(ut.map(f => f.id)).toEqual(['1', '4'])
    expect(ut[1]).toEqual({ id: '4', hex: '#AABBCC', navn: 'Min tråd', tradkode: '1234', merke: 'Madeira', kilde: 'lager' })
  })
})
