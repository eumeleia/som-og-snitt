import { describe, it, expect } from 'vitest'
import { coverUrl, fitInside, shrinkUnder } from './cover'

const blobOf = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' })

describe('fitInside', () => {
  it('scales the longest side down and keeps the shape', () => {
    expect(fitInside(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitInside(3024, 4032, 1200)).toEqual({ width: 900, height: 1200 })
  })
  it('never makes a small picture larger', () => {
    expect(fitInside(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })
})

describe('shrinkUnder', () => {
  it('lowers the quality first, then the size, until the picture fits', async () => {
    const tried: string[] = []
    // Size grows with the side and the quality, like a real photo.
    const blob = await shrinkUnder(200_000, async (side, q) => { tried.push(`${side}@${q}`); return blobOf(Math.round(side * side * q * 0.4)) })
    expect(blob.size).toBeLessThanOrEqual(200_000)
    expect(tried[0]).toBe('1600@0.75')
    expect(tried).toContain('1600@0.25')
    expect(tried.at(-1)).toBe('1200@0.25')
  })
  it('gives up with a message when nothing fits', async () => {
    await expect(shrinkUnder(1000, async () => blobOf(5000), [600])).rejects.toThrow('over grensen')
  })
})

describe('coverUrl', () => {
  const base = 'https://x.supabase.co'
  it('uses the own picture first, with its time so a new one is not cached', () => {
    expect(coverUrl({ cover_path: 'p1.jpg', cover_at: '2026-11-11T10:00:00Z', strikk_oppskrift: { title: 'A', thumbnail_path: 'r1.jpg', thumbnail_at: null } }, base))
      .toBe(`${base}/storage/v1/object/public/strikk-covers/p1.jpg?v=${Date.parse('2026-11-11T10:00:00Z')}`)
  })
  it('falls back to the recipe first page, and to nothing for a project without either', () => {
    expect(coverUrl({ cover_path: null, cover_at: null, strikk_oppskrift: { title: 'A', thumbnail_path: 'r1.jpg', thumbnail_at: null } }, base))
      .toBe(`${base}/storage/v1/object/public/strikk-thumbnails/r1.jpg`)
    expect(coverUrl({ cover_path: null, cover_at: null, strikk_oppskrift: null }, base)).toBeNull()
  })
})
