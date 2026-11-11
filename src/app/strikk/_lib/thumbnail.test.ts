import { describe, it, expect } from 'vitest'
import { encodeUnder } from './thumbnail'

const blobOf = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' })

describe('encodeUnder', () => {
  it('keeps the first quality that fits', async () => {
    const tried: number[] = []
    const blob = await encodeUnder(1000, async q => { tried.push(q); return blobOf(800) })
    expect(blob.size).toBe(800)
    expect(tried).toEqual([0.75])
  })
  it('lowers the quality until the picture is small enough', async () => {
    const tried: number[] = []
    const blob = await encodeUnder(1000, async q => { tried.push(q); return blobOf(Math.round(q * 2000)) })
    expect(blob.size).toBeLessThanOrEqual(1000)
    expect(tried).toEqual([0.75, 0.65, 0.55, 0.45])
  })
  it('gives up with the size when even the lowest quality is too big', async () => {
    await expect(encodeUnder(1000, async () => blobOf(5000))).rejects.toThrow('5 kB')
  })
  it('fails when the browser could not encode', async () => {
    await expect(encodeUnder(1000, async () => null)).rejects.toThrow('Klarte ikke lage bildet')
  })
})
