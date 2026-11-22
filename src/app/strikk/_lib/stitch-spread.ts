// Øke/felle-kalkulatoren: how to go from one stitch count to another in one round or row,
// with the increases or decreases spread evenly. Pure, so every rule is tested.
//
// The gaps between the changes come in two sizes (q and q+1). The less common size is spread
// among the more common one as a repeat inside a repeat («Gjenta 6 ganger: *strikk 5, øk 1*
// 4 ganger, så strikk 6, øk 1»), with at most three lines. Measured over every count up to
// 300 and every change up to half, the change lands on average 1 stitch (at most 3.2) from
// its ideal place, against 4.2 (at most 15.4) for plain blocks at each end.
// Flat work (frem og tilbake): the two edges share one gap, so no change lands at the edge.

export type Direction = 'increase' | 'decrease'
export type Mode = 'round' | 'flat'

export interface Item { knit: number; change: boolean; times: number }
export interface Line { times: number; items: Item[] }

export type Spread =
  | { ok: true; direction: Direction; before: number; after: number; changes: number; lines: Line[] }
  | { ok: false; error: string }

// Maria's rule: at most half the stitches on the needle per round, both ways. Knitting 2
// together uses two stitches per decrease, so more than half is not possible with k2tog.
export const maxChanges = (stitches: number) => Math.floor(stitches / 2)

function gapsInGroups(sum: number, count: number): Line[] {
  // `count` gaps adding up to `sum`, each followed by a change.
  const q = Math.floor(sum / count), r = sum % count
  if (r === 0) return [{ times: 1, items: [{ knit: q, change: true, times: count }] }]
  const big = r, small = count - r
  const [minor, major, p, m] = big <= small ? [q + 1, q, big, small] : [q, q + 1, small, big]
  const a = Math.floor(m / p), c = m % p
  const group = (n: number): Line => ({
    times: 1,
    items: [...(n > 0 ? [{ knit: major, change: true, times: n }] : []), { knit: minor, change: true, times: 1 }],
  })
  const lines: Line[] = []
  const half = Math.floor(c / 2)
  if (half > 0) lines.push({ ...group(a + 1), times: half })
  if (p - c > 0) lines.push({ ...group(a), times: p - c })
  if (c - half > 0) lines.push({ ...group(a + 1), times: c - half })
  return lines
}

export function spreadStitches(before: number, after: number, mode: Mode = 'round'): Spread {
  if (!Number.isInteger(before) || before < 1) return { ok: false, error: 'Skriv inn antall masker på pinnen.' }
  if (!Number.isInteger(after) || after < 1) return { ok: false, error: 'Skriv inn antall masker du skal ha etterpå.' }
  if (after === before) return { ok: false, error: 'Masketallet er det samme før og etter.' }
  const direction: Direction = after > before ? 'increase' : 'decrease'
  const changes = Math.abs(after - before)
  const max = maxChanges(before)
  if (changes > max) {
    return direction === 'increase'
      ? { ok: false, error: `Du kan øke høyst ${max} masker når du har ${before} på pinnen, altså til ${before + max} masker.` }
      : { ok: false, error: `Du kan felle høyst ${max} masker når du har ${before} på pinnen, altså til ${before - max} masker.` }
  }
  // Stitches knitted plainly between the changes: all of them when increasing; when
  // decreasing, two go into each «2 sammen».
  const plain = direction === 'increase' ? before : before - 2 * changes
  let lines: Line[]
  if (mode === 'round') {
    lines = gapsInGroups(plain, changes)
  } else {
    // Edges share one ordinary gap; the k−1 gaps inside take the rest.
    const edge = Math.floor(plain / changes)
    const start = Math.floor(edge / 2), end = edge - start
    const first: Line = { times: 1, items: [{ knit: start, change: true, times: 1 }] }
    const inner = changes > 1 ? gapsInGroups(plain - edge, changes - 1) : []
    const last: Line = { times: 1, items: [{ knit: end, change: false, times: 1 }] }
    lines = [first, ...inner, ...(end > 0 ? [last] : [])]
  }
  return { ok: true, direction, before, after, changes, lines }
}

// Counts the instructions back up: how many stitches they use and leave on the needle.
export function tally(lines: Line[], direction: Direction): { used: number; result: number; changes: number } {
  let used = 0, result = 0, changes = 0
  for (const l of lines) for (const it of l.items) {
    const n = l.times * it.times
    used += n * it.knit; result += n * it.knit
    if (it.change) {
      changes += n
      if (direction === 'increase') result += n
      else { used += 2 * n; result += n }
    }
  }
  return { used, result, changes }
}

const masker = (n: number) => `${n} ${n === 1 ? 'maske' : 'masker'}`
const capital = (t: string) => t.replace(/\p{L}/u, c => c.toUpperCase())

function itemText(it: Item, direction: Direction): string {
  const change = direction === 'increase' ? 'øk 1 maske' : 'strikk 2 sammen'
  const text = [it.knit > 0 ? `strikk ${masker(it.knit)}` : null, it.change ? change : null].filter(Boolean).join(', ')
  return it.times > 1 ? `*${text}* ${it.times} ganger` : text
}

// One line of the instructions, e.g. «*Strikk 13 masker, strikk 2 sammen* 10 ganger».
export function lineText(line: Line, direction: Direction): string {
  const body = line.items.map(it => itemText(it, direction)).join(', så ')
  return capital(line.times === 1 ? body : `gjenta ${line.times} ganger: ${body}`)
}
