import { describe, it, expect } from 'vitest'
import { coverPhoto, frontPosition, isMissingTable, nextPosition, photoUrl, sortPhotos } from './project-photos'

const p = (id: string, position: number, created_at = '2026-11-15T10:00:00Z') => ({ id, position, created_at })

describe('project photos', () => {
  it('puts the lowest position first, and the older photo first on a tie', () => {
    const list = [p('b', 1), p('c', 0, '2026-11-15T12:00:00Z'), p('a', 0, '2026-11-15T09:00:00Z')]
    expect(sortPhotos(list).map(x => x.id)).toEqual(['a', 'c', 'b'])
    expect(coverPhoto(list)?.id).toBe('a')
    expect(coverPhoto([])).toBeNull()
  })
  it('adds a new photo last and moves a chosen cover before all the others', () => {
    expect(nextPosition([])).toBe(0)
    expect(nextPosition([p('a', 0), p('b', 3)])).toBe(4)
    expect(frontPosition([p('a', -2), p('b', 3)])).toBe(-3)
    const after = sortPhotos([p('a', 0), p('b', 1), { ...p('c', 2), position: frontPosition([p('a', 0), p('b', 1), p('c', 2)]) }])
    expect(after[0].id).toBe('c')
  })
  it('knows the table is missing before migration 030', () => {
    expect(isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.strikk_project_photo' in the schema cache" })).toBe(true)
    expect(isMissingTable({ code: '42P01', message: 'relation "strikk_project_photo" does not exist' })).toBe(true)
    expect(isMissingTable({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingTable(null)).toBe(false)
  })
  it('builds the public URL with the folder kept as a path', () => {
    expect(photoUrl('p1/x y.jpg', 'https://s.test')).toBe('https://s.test/storage/v1/object/public/strikk-covers/p1/x%20y.jpg')
  })
})
