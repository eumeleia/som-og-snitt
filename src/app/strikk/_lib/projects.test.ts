import { describe, it, expect } from 'vitest'
import { parsePositionPatch, sortByLastOpened, startPosition } from './projects'

describe('startPosition', () => {
  it('opens at the top of «Gjeldende side» when it is set', () => {
    expect(startPosition({ current_page: 4, last_page: 7, last_offset: 0.6 })).toEqual({ page: 4, offset: 0 })
  })
  it('keeps the saved height when the last position is on «Gjeldende side»', () => {
    expect(startPosition({ current_page: 4, last_page: 4, last_offset: 0.6 })).toEqual({ page: 4, offset: 0.6 })
  })
  it('opens at the last position, or at the start', () => {
    expect(startPosition({ current_page: null, last_page: 7, last_offset: 0.25 })).toEqual({ page: 7, offset: 0.25 })
    expect(startPosition({ current_page: null, last_page: 3, last_offset: null })).toEqual({ page: 3, offset: 0 })
    expect(startPosition({ current_page: null, last_page: null, last_offset: null })).toBeNull()
  })
})

describe('parsePositionPatch', () => {
  it('reads the position and «Gjeldende side», and clearing it', () => {
    expect(parsePositionPatch({ last_page: 2, last_offset: 0.12345 })).toEqual({ patch: { last_page: 2, last_offset: 0.123 } })
    expect(parsePositionPatch({ current_page: 5 })).toEqual({ patch: { current_page: 5 } })
    expect(parsePositionPatch({ current_page: null })).toEqual({ patch: { current_page: null } })
  })
  it('is not there for other changes', () => {
    expect(parsePositionPatch({ name: 'Genser' })).toBeUndefined()
  })
  it('refuses a broken position or page', () => {
    expect(parsePositionPatch({ last_page: 0, last_offset: 0.1 })).toEqual({ error: 'Ugyldig posisjon' })
    expect(parsePositionPatch({ last_offset: 0.1 })).toEqual({ error: 'Ugyldig posisjon' })
    expect(parsePositionPatch({ current_page: 1.5 })).toEqual({ error: 'Ugyldig side' })
    expect(parsePositionPatch({ last_page: 1, last_offset: 4 })).toEqual({ patch: { last_page: 1, last_offset: 1 } })
  })
})

describe('sortByLastOpened', () => {
  const p = (id: string, last_opened_at: string | null, created_at: string, updated_at = created_at) => ({ id, last_opened_at, created_at, updated_at })
  it('puts the most recently opened first, and projects never opened after them', () => {
    const list = [p('gammel', null, '2026-11-10'), p('i går', '2026-11-11T10:00', '2026-01-01'), p('nå', '2026-11-12T09:00', '2026-02-01')]
    expect(sortByLastOpened(list).map(x => x.id)).toEqual(['nå', 'i går', 'gammel'])
  })
  it('orders projects never opened by the fallback, or else by when they were made', () => {
    const list = [p('a', null, '2026-11-01', '2026-11-01'), p('b', null, '2026-10-01', '2026-11-11'), p('c', null, '2026-11-05')]
    expect(sortByLastOpened(list, x => x.updated_at).map(x => x.id)).toEqual(['b', 'c', 'a'])
    expect(sortByLastOpened(list).map(x => x.id)).toEqual(['c', 'a', 'b'])
  })
})
