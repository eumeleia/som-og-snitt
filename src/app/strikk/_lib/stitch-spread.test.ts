import { describe, it, expect } from 'vitest'
import { lineText, maxChanges, spreadStitches, tally, type Spread } from './stitch-spread'

const text = (s: Spread) => (s.ok ? s.lines.map(l => lineText(l, s.direction)) : s.error)

describe('spreadStitches: the examples from the reference app', () => {
  it('140 → 144 in the round', () => {
    expect(text(spreadStitches(140, 144))).toEqual(['*Strikk 35 masker, øk 1 maske* 4 ganger'])
  })
  it('150 → 140 in the round', () => {
    expect(text(spreadStitches(150, 140))).toEqual(['*Strikk 13 masker, strikk 2 sammen* 10 ganger'])
  })
  it('156 → 186 spreads the six longer gaps evenly instead of in blocks', () => {
    expect(text(spreadStitches(156, 186))).toEqual(['Gjenta 6 ganger: *strikk 5 masker, øk 1 maske* 4 ganger, så strikk 6 masker, øk 1 maske'])
  })
  it('refuses more than half the stitches, both ways', () => {
    expect(spreadStitches(150, 10)).toEqual({ ok: false, error: 'Du kan felle høyst 75 masker når du har 150 på pinnen, altså til 75 masker.' })
    expect(spreadStitches(150, 226).ok).toBe(false)
    expect(spreadStitches(150, 225).ok).toBe(true)
    expect(spreadStitches(150, 75).ok).toBe(true)
    expect(maxChanges(151)).toBe(75)
  })
  it('felling exactly half never says «strikk 0 masker»', () => {
    expect(text(spreadStitches(20, 10))).toEqual(['*Strikk 2 sammen* 10 ganger'])
  })
  it('refuses empty and equal counts', () => {
    expect(spreadStitches(0, 10).ok).toBe(false)
    expect(spreadStitches(40, 40).ok).toBe(false)
  })
})

describe('flat (frem og tilbake): the edges share one gap', () => {
  it('150 → 140 starts and ends with half a gap', () => {
    expect(text(spreadStitches(150, 140, 'flat'))).toEqual([
      'Strikk 6 masker, strikk 2 sammen',
      '*Strikk 13 masker, strikk 2 sammen* 9 ganger',
      'Strikk 7 masker',
    ])
  })
  it('one change sits in the middle', () => {
    expect(text(spreadStitches(40, 41, 'flat'))).toEqual(['Strikk 20 masker, øk 1 maske', 'Strikk 20 masker'])
  })
})

describe('every combination adds up (self-check)', () => {
  it('for 1–300 stitches and every allowed change, both ways and both modes', () => {
    let checked = 0
    for (let n = 1; n <= 300; n++) {
      for (let k = 1; k <= maxChanges(n); k++) {
        for (const after of [n + k, n - k]) for (const mode of ['round', 'flat'] as const) {
          const s = spreadStitches(n, after, mode)
          if (!s.ok) throw new Error(`${n}→${after} ${mode}: ${s.error}`)
          const t = tally(s.lines, s.direction)
          if (t.used !== n || t.result !== after || t.changes !== k || s.lines.length > 5) throw new Error(`${n}→${after} ${mode}: ${JSON.stringify(t)} linjer ${s.lines.length}`)
          checked++
        }
      }
    }
    expect(checked).toBe(90000)
  })
  it('round instructions never need more than three lines', () => {
    let worst = 0
    for (let n = 2; n <= 300; n++) for (let k = 1; k <= maxChanges(n); k++) {
      const s = spreadStitches(n, n + k); if (s.ok) worst = Math.max(worst, s.lines.length)
    }
    expect(worst).toBe(3)
  })
})
