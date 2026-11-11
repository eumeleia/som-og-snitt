import { describe, it, expect } from 'vitest'
import { parseRecipePatch } from './recipe-patch'

const now = new Date('2026-11-11T12:00:00Z')

describe('parseRecipePatch', () => {
  it('saves stars, favourite and position without touching updated_at or the Drive name', () => {
    expect(parseRecipePatch({ rating: 4, favorite: true }, now)).toEqual({ patch: { rating: 4, favorite: true }, rename: false })
    expect(parseRecipePatch({ last_page: 3, last_offset: 0.42719 }, now)).toEqual({ patch: { last_page: 3, last_offset: 0.427 }, rename: false })
  })
  it('removes the stars with null', () => {
    expect(parseRecipePatch({ rating: null }, now)).toEqual({ patch: { rating: null }, rename: false })
  })
  it('refuses stars outside 1–5, a favourite that is not true or false, and a broken position', () => {
    for (const rating of [0, 6, 2.5, '3']) expect(parseRecipePatch({ rating }, now)).toEqual({ error: 'Stjerner må være 1–5' })
    expect(parseRecipePatch({ favorite: 'ja' }, now)).toEqual({ error: 'Favoritt må være ja eller nei' })
    expect(parseRecipePatch({ last_page: 0, last_offset: 0.5 }, now)).toEqual({ error: 'Ugyldig posisjon' })
    expect(parseRecipePatch({ last_page: 2 }, now)).toEqual({ error: 'Ugyldig posisjon' })
  })
  it('keeps the position inside the page', () => {
    expect(parseRecipePatch({ last_page: 1, last_offset: 1.7 }, now)).toEqual({ patch: { last_page: 1, last_offset: 1 }, rename: false })
  })
  it('treats title, designer and audience as edits, and renames for title and designer', () => {
    expect(parseRecipePatch({ title: ' Ny ' }, now)).toEqual({ patch: { title: 'Ny', updated_at: now.toISOString() }, rename: true })
    expect(parseRecipePatch({ audience: 'child' }, now)).toEqual({ patch: { audience: 'child', updated_at: now.toISOString() }, rename: false })
    expect(parseRecipePatch({ title: '  ' }, now)).toEqual({ error: 'Tittel kan ikke være tom' })
    expect(parseRecipePatch({ audience: 'baby' }, now)).toEqual({ error: 'Ukjent målgruppe' })
  })
  it('refuses an empty request', () => {
    expect(parseRecipePatch({}, now)).toEqual({ error: 'Ingenting å endre' })
    expect(parseRecipePatch(null, now)).toEqual({ error: 'Ugyldig forespørsel' })
  })
})
