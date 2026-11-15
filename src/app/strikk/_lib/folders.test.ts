import { describe, it, expect } from 'vitest'
import { autoFolders, cleanFolderName, folderLabel, formatPrice, inFolder, membership, parseWish } from './folders'

const R = [
  { id: 'r1', garment_type: 'genser', audience: 'child' as const, favorite: true },
  { id: 'r2', garment_type: 'Genser ', audience: 'woman' as const, favorite: false },
  { id: 'r3', garment_type: 'lue', audience: 'child' as const, favorite: false },
  { id: 'r4', garment_type: null, audience: null, favorite: true },
]
const ID = '4bfc1ee0-e979-43c0-bded-e82335b1f019'

describe('automatic folders', () => {
  it('makes one folder per garment type and audience that exists, and counts favourites', () => {
    const a = autoFolders(R)
    expect(a.favorites).toBe(2)
    expect(a.garments).toEqual([{ key: 'g:genser', label: 'Genser', count: 2 }, { key: 'g:lue', label: 'Lue', count: 1 }])
    expect(a.audiences.map(x => [x.key, x.count])).toEqual([['a:child', 2], ['a:woman', 1]])
  })
  it('puts a recipe in its garment type, audience, favourites and every own folder it is in', () => {
    const m = membership([{ folder_id: 'ellinor', oppskrift_id: 'r1' }, { folder_id: 'theodor', oppskrift_id: 'r1' }, { folder_id: 'theodor', oppskrift_id: 'r3' }])
    expect(inFolder('g:genser', R[1], m)).toBe(true)
    expect(inFolder('a:child', R[0], m)).toBe(true)
    expect(inFolder('fav', R[1], m)).toBe(false)
    expect(inFolder('f:ellinor', R[0], m)).toBe(true)
    expect(inFolder('f:theodor', R[0], m)).toBe(true)
    expect(inFolder('f:ellinor', R[2], m)).toBe(false)
    expect(inFolder('all', R[3], m)).toBe(true)
  })
  it('names a folder from its key', () => {
    expect(folderLabel('a:child', [])).toBe('Barn')
    expect(folderLabel('f:x', [{ id: 'x', name: 'Til Ellinor', created_at: '' }])).toBe('Til Ellinor')
  })
})

describe('own folder names', () => {
  it('trims and refuses empty or very long names', () => {
    expect(cleanFolderName('  Til   Ellinor ')).toBe('Til Ellinor')
    expect(cleanFolderName('   ')).toBeNull()
    expect(cleanFolderName('x'.repeat(61))).toBeNull()
    expect(cleanFolderName(5)).toBeNull()
  })
})

describe('wishes', () => {
  it('takes a recipe from the library with nothing else', () => {
    expect(parseWish({ oppskrift_id: ID })).toEqual({ ok: true, value: { oppskrift_id: ID } })
  })
  it('needs a name for a recipe Maria does not have, and reads the rest', () => {
    expect(parseWish({ title: '  ', designer: 'X' })).toEqual({ ok: false, error: 'Skriv navnet på oppskriften' })
    const w = parseWish({ title: 'Fluffy Cable', designer: 'Lene', url: 'petiteknit.com/products/x', price_nok: 'ca. 89,50 kr', note: ' Til jul ' })
    expect(w).toEqual({ ok: true, value: { title: 'Fluffy Cable', designer: 'Lene', url: 'https://petiteknit.com/products/x', price_nok: 89.5, note: 'Til jul' } })
  })
  it('refuses a link that is not a web address and a price that is not a number', () => {
    expect(parseWish({ title: 'A', url: 'ikke en lenke' }).ok).toBe(false)
    expect(parseWish({ title: 'A', price_nok: 'gratis' }).ok).toBe(false)
    expect(parseWish({ title: 'A', price_nok: -5 }).ok).toBe(false)
    expect(parseWish({ oppskrift_id: 'abc' }).ok).toBe(false)
  })
  it('lets a change leave out the name', () => {
    expect(parseWish({ note: 'ny' }, true)).toEqual({ ok: true, value: { note: 'ny' } })
  })
  it('shows the price as an estimate', () => {
    expect(formatPrice(250)).toBe('ca. 250 kr')
    expect(formatPrice(null)).toBeNull()
  })
})
