import { describe, it, expect } from 'vitest'
import { lineText, maxChanges, spreadStitches, tally, type Spread } from './stitch-spread'

const text = (s: Spread) => (s.ok ? s.lines.map(l => lineText(l, s.direction)) : s.error)

describe('spreadStitches gives the same answers as Knit and Note', () => {
  // Read from Maria's screenshots of Knit and Note, 2026-11-22.
  it('156 + 30', () => {
    expect(text(spreadStitches(156, 186))).toEqual([
      'Strikk 2 masker, øk 1 maske', '*Strikk 6 masker, øk 1 maske* 3 ganger', '*Strikk 5 masker, øk 1 maske* 23 ganger',
      '*Strikk 6 masker, øk 1 maske* 3 ganger', 'Strikk 3 masker',
    ])
  })
  it('88 + 12', () => {
    expect(text(spreadStitches(88, 100))).toEqual([
      'Strikk 3 masker, øk 1 maske', '*Strikk 8 masker, øk 1 maske* 2 ganger', '*Strikk 7 masker, øk 1 maske* 7 ganger',
      '*Strikk 8 masker, øk 1 maske* 2 ganger', 'Strikk 4 masker',
    ])
  })
  it('200 + 23', () => {
    expect(text(spreadStitches(200, 223))).toEqual([
      'Strikk 4 masker, øk 1 maske', '*Strikk 9 masker, øk 1 maske* 8 ganger', '*Strikk 8 masker, øk 1 maske* 6 ganger',
      '*Strikk 9 masker, øk 1 maske* 8 ganger', 'Strikk 4 masker',
    ])
  })
  it('100 − 16', () => {
    expect(text(spreadStitches(100, 84))).toEqual([
      'Strikk 2 masker, strikk 2 sammen', '*Strikk 5 masker, strikk 2 sammen* 2 ganger', '*Strikk 4 masker, strikk 2 sammen* 11 ganger',
      '*Strikk 5 masker, strikk 2 sammen* 2 ganger', 'Strikk 2 masker',
    ])
  })
  it('221 − 21', () => {
    expect(text(spreadStitches(221, 200))).toEqual([
      'Strikk 4 masker, strikk 2 sammen', '*Strikk 8 masker, strikk 2 sammen* 5 ganger', '*Strikk 9 masker, strikk 2 sammen* 11 ganger',
      '*Strikk 8 masker, strikk 2 sammen* 4 ganger', 'Strikk 4 masker',
    ])
  })
  it('140 + 4 and 150 − 10 go up evenly: one repeat', () => {
    expect(text(spreadStitches(140, 144))).toEqual(['*Strikk 35 masker, øk 1 maske* 4 ganger'])
    expect(text(spreadStitches(150, 140))).toEqual(['*Strikk 13 masker, strikk 2 sammen* 10 ganger'])
  })
})

describe('limits and wording', () => {
  it('refuses more than half the stitches, both ways', () => {
    expect(spreadStitches(150, 10)).toEqual({ ok: false, error: 'Du kan felle høyst 75 masker når du har 150 på pinnen, altså til 75 masker.' })
    expect(spreadStitches(150, 226).ok).toBe(false)
    expect(spreadStitches(150, 225).ok).toBe(true)
    expect(spreadStitches(150, 75).ok).toBe(true)
    expect(maxChanges(151)).toBe(75)
  })
  it('never says «strikk 0 masker»', () => {
    expect(text(spreadStitches(20, 10))).toEqual(['*Strikk 2 sammen* 10 ganger'])
    for (const t of text(spreadStitches(21, 11)) as string[]) expect(t).not.toMatch(/Strikk 0|strikk 0/)
  })
  it('refuses empty and equal counts', () => {
    expect(spreadStitches(0, 10).ok).toBe(false)
    expect(spreadStitches(40, 40).ok).toBe(false)
  })
})

describe('every combination adds up (self-check)', () => {
  it('for 1–300 stitches and every allowed change, both ways, in at most five lines', () => {
    let checked = 0
    for (let n = 1; n <= 300; n++) {
      for (let k = 1; k <= maxChanges(n); k++) {
        for (const after of [n + k, n - k]) {
          const s = spreadStitches(n, after)
          if (!s.ok) throw new Error(`${n}→${after}: ${s.error}`)
          const t = tally(s.lines, s.direction)
          if (t.used !== n || t.result !== after || t.changes !== k || s.lines.length > 5) throw new Error(`${n}→${after}: ${JSON.stringify(t)}, ${s.lines.length} linjer`)
          if (s.lines.some(l => l.times < 1 || l.knit < 0)) throw new Error(`${n}→${after}: tom linje`)
          checked++
        }
      }
    }
    expect(checked).toBe(45000)
  })
})
