// Øke/felle-kalkulatoren: how to go from one stitch count to another in one round or row,
// with the increases or decreases spread evenly. Pure, so every rule is tested.
//
// Laid out the way Knit and Note does it (Maria's choice): the gaps between the changes come
// in two sizes, q and q+1. When they all have the same size, the answer is one repeat. If
// not, the work starts and ends with half an ordinary gap, so no change sits at the very start
// or end, and the gaps in between come as three blocks: one size split at both ends, the
// other in the middle. That gives at most five short lines. The longer gaps go at the ends
// when there is an even number of them, otherwise the shorter ones do (as in Knit and Note's
// 221 → 200). Checked against five answers from Knit and Note in stitch-spread.test.ts.

export type Direction = 'increase' | 'decrease'

// «Strikk {knit} masker, øk 1 maske» (or «strikk 2 sammen»), {times} times; change false is
// plain knitting at the end of the round.
export interface Line { knit: number; change: boolean; times: number }

export type Spread =
  | { ok: true; direction: Direction; before: number; after: number; changes: number; lines: Line[] }
  | { ok: false; error: string }

// Maria's rule: at most half the stitches on the needle per round, both ways. Knitting 2
// together uses two stitches per decrease, so more than half is not possible with k2tog.
export const maxChanges = (stitches: number) => Math.floor(stitches / 2)

export function spreadStitches(before: number, after: number): Spread {
  if (!Number.isInteger(before) || before < 1) return { ok: false, error: 'Skriv inn antall masker på pinnen.' }
  if (!Number.isInteger(after) || after < 1) return { ok: false, error: 'Skriv inn antall masker du skal ha etterpå.' }
  if (after === before) return { ok: false, error: 'Masketallet er det samme før og etter.' }
  const direction: Direction = after > before ? 'increase' : 'decrease'
  const k = Math.abs(after - before)
  const max = maxChanges(before)
  if (k > max) {
    return direction === 'increase'
      ? { ok: false, error: `Du kan øke høyst ${max} masker når du har ${before} på pinnen, altså til ${before + max} masker.` }
      : { ok: false, error: `Du kan felle høyst ${max} masker når du har ${before} på pinnen, altså til ${before - max} masker.` }
  }
  // Stitches knitted plainly between the changes: all of them when increasing; when
  // decreasing, two go into each «2 sammen».
  const plain = direction === 'increase' ? before : before - 2 * k
  const q = Math.floor(plain / k), r = plain % k
  let lines: Line[]
  if (r === 0) {
    lines = [{ knit: q, change: true, times: k }]
  } else {
    // Half an ordinary gap at each edge; the k−1 gaps in between hold the r longer ones.
    const start = Math.floor(q / 2), end = q - start
    const long = r, short = k - 1 - r
    const [edgeSize, edgeCount, midSize, midCount] = long % 2 === 0 ? [q + 1, long, q, short] : [q, short, q + 1, long]
    const first = Math.ceil(edgeCount / 2), last = edgeCount - first
    lines = [
      { knit: start, change: true, times: 1 },
      { knit: edgeSize, change: true, times: first },
      { knit: midSize, change: true, times: midCount },
      { knit: edgeSize, change: true, times: last },
      { knit: end, change: false, times: 1 },
    ]
  }
  return { ok: true, direction, before, after, changes: k, lines: tidy(lines) }
}

// Drops empty lines and joins neighbours that say the same thing.
function tidy(lines: Line[]): Line[] {
  const out: Line[] = []
  for (const l of lines) {
    if (l.times === 0 || (!l.change && l.knit === 0)) continue
    const prev = out[out.length - 1]
    if (prev && prev.knit === l.knit && prev.change === l.change) prev.times += l.times
    else out.push({ ...l })
  }
  return out
}

// Counts the instructions back up: how many stitches they use and leave on the needle.
export function tally(lines: Line[], direction: Direction): { used: number; result: number; changes: number } {
  let used = 0, result = 0, changes = 0
  for (const l of lines) {
    used += l.times * l.knit; result += l.times * l.knit
    if (l.change) {
      changes += l.times
      result += l.times
      if (direction === 'decrease') used += 2 * l.times
    }
  }
  return { used, result, changes }
}

// The line in parts, so the numbers can be shown in colour: «*Strikk 6 masker, øk 1 maske* 3 ganger».
export type Part = { text: string } | { number: number }

export function lineParts(line: Line, direction: Direction): Part[] {
  const parts: Part[] = []
  const repeat = line.times > 1
  const word = (n: number, one: string, many: string) => (n === 1 ? one : many)
  if (line.knit > 0) parts.push({ text: `${repeat ? '*' : ''}Strikk ` }, { number: line.knit }, { text: ` ${word(line.knit, 'maske', 'masker')}` })
  if (line.change) {
    const lead = line.knit > 0 ? ', ' : repeat ? '*' : ''
    if (direction === 'increase') parts.push({ text: `${lead}${line.knit > 0 ? 'øk' : 'Øk'} ` }, { number: 1 }, { text: ' maske' })
    else parts.push({ text: `${lead}${line.knit > 0 ? 'strikk' : 'Strikk'} ` }, { number: 2 }, { text: ' sammen' })
  }
  if (repeat) parts.push({ text: '* ' }, { number: line.times }, { text: ' ganger' })
  return parts
}

export const lineText = (line: Line, direction: Direction) =>
  lineParts(line, direction).map(p => ('text' in p ? p.text : String(p.number))).join('')
