import { describe, it, expect } from 'vitest'
import { parsePositionPatch, startPosition } from './projects'

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
