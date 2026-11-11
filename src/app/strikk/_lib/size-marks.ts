// Finds the numbers that belong to the chosen size in a pattern's text layer, so the
// project view can mark them. Pure: takes pdf.js text items, returns rectangles as
// fractions of the page (x from the left, y from the top), which stay in place at any zoom.
//
// A pattern writes one value per size in a row, in the order of its size list:
//   «250 (300) 300 (350) 350 (400) g», «350-400-450-500 g», «100 100 150» (table),
//   «4 (4 1/2, 5, 5 1/2, 6) in.». A row with exactly as many values as there are sizes
//   gets value k marked.

export interface TextItemLike {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
  fontName?: string
}

export interface PageText {
  items: TextItemLike[]
  // pdf.js viewport at scale 1: width, height and the PDF-to-viewport transform.
  viewport: { width: number; height: number; transform: number[] }
}

export interface Rect { x: number; y: number; w: number; h: number }

export type SizeMarkStatus = 'ok' | 'no-text' | 'none'

export interface SizeMarks {
  status: SizeMarkStatus
  pages: Map<number, Rect[]>
  // What was marked, with its line: «1: Materialer: 250 ([300]) 300 …».
  found: { page: number; text: string; line: string }[]
}

// Width of a string in any unit, used to place a value inside a longer text item.
export type Measure = (text: string, fontName: string | undefined) => number

const byLength: Measure = s => s.length

const MIN_TEXT_CHARS = 20
const PAD = 1.5
const MAX_LOOSE = 2
const UNITS = 'mnd|mdr|måneder|måned|months?|mos?|years?|yrs?|år|cm|str'

interface Built {
  text: string
  // Per character: index of the text item it came from and offset in it, or -1 for a
  // separator inserted between items.
  item: number[]
  offset: number[]
  items: TextItemLike[]
}

function normalizeChar(c: string): string {
  if (/[‐‑‒–—−]/.test(c)) return '-'
  if (c === ' ' || c === ' ' || c === ' ') return ' '
  return c
}

// Items in content-stream order, joined into lines. A big horizontal gap (another column)
// becomes « | », which no row crosses.
export function buildPageText(items: TextItemLike[]): Built {
  let text = ''
  const item: number[] = []
  const offset: number[] = []
  const push = (s: string, it = -1, off = -1) => {
    for (let i = 0; i < s.length; i++) {
      text += it >= 0 ? normalizeChar(s[i]) : s[i]
      item.push(it)
      offset.push(it >= 0 ? off + i : -1)
    }
  }
  let prev: { x: number; y: number; end: number; fs: number; eol: boolean } | null = null
  items.forEach((it, i) => {
    const [a, b, c, d, x, y] = it.transform
    // Rotated text (a margin note, a vertical label) is left out.
    if (Math.abs(b) > Math.abs(a) * 0.05 || Math.abs(c) > Math.abs(d) * 0.05) {
      if (prev) { push('\n|\n'); prev = null }
      return
    }
    if (!it.str) {
      if (it.hasEOL && prev) prev.eol = true
      return
    }
    const fs = Math.abs(d) || it.height || 10
    if (prev) {
      const gap = x - prev.end
      if (prev.eol || Math.abs(y - prev.y) > 0.5 * Math.min(fs, prev.fs) || gap < -fs) push('\n')
      else if (gap > 3 * fs) push(' | ')
      else if (gap > 0.15 * fs && !/\s$/.test(text) && !/^\s/.test(it.str)) push(' ')
    }
    push(it.str, i, 0)
    prev = { x, y, end: x + it.width, fs, eol: !!it.hasEOL }
  })
  return { text, item, offset, items }
}

// ---- Values ----

interface Token { start: number; end: number }
type Link = 'dash' | 'slash' | 'paren' | 'space' | 'nl'

const NUMBER = /(?<![\p{L}\p{N}.,])(?:\d+ [1-7]\/[248](?!\d)|[1-7]\/[248](?!\d)|\d*[½¼¾]|\d+(?:[.,]\d+)?)/gu

function linkOf(gap: string): Link | null {
  if (/^ *- *$/.test(gap)) return 'dash'
  if (/^ *\/ *$/.test(gap)) return 'slash'
  if (/^(?:\s|[()]|\/\/|,(?=\s))+$/.test(gap)) {
    if (/[()]|\/\/|,/.test(gap)) return 'paren'
    return gap.includes('\n') ? 'nl' : 'space'
  }
  return null
}

interface Chain { tokens: Token[]; links: Link[] }

function chains(text: string): Chain[] {
  const out: Chain[] = []
  let cur: Chain | null = null
  for (const m of text.matchAll(NUMBER)) {
    const t = { start: m.index!, end: m.index! + m[0].length }
    const link = cur ? linkOf(text.slice(cur.tokens[cur.tokens.length - 1].end, t.start)) : null
    if (cur && link) {
      cur.tokens.push(t)
      cur.links.push(link)
    } else {
      if (cur) out.push(cur)
      cur = { tokens: [t], links: [] }
    }
  }
  if (cur) out.push(cur)
  return out
}

// The values of a chain, or null when it is not a row of n values. Dash and slash bind
// two numbers into one value («20-22», «38/40») in a row that also uses parentheses.
function valuesOf(c: Chain, n: number, allowSpaced: boolean): Token[] | null {
  const set = new Set(c.links)
  let groups: Token[]
  if (set.has('paren')) {
    groups = [{ ...c.tokens[0] }]
    c.links.forEach((l, i) => {
      const t = c.tokens[i + 1]
      if (l === 'dash' || l === 'slash') groups[groups.length - 1].end = t.end
      else groups.push({ ...t })
    })
  } else if (c.links.length > 0 && c.links.every(l => l === 'dash')) {
    if (n < 3) return null
    groups = c.tokens
  } else if (c.links.length > 0 && c.links.every(l => l === 'slash')) {
    if (n < 3) return null
    groups = c.tokens
  } else if (c.links.length > 0 && c.links.every(l => l === 'space')) {
    if (n < 3 || !allowSpaced) return null
    groups = c.tokens
  } else {
    return null
  }
  return groups.length === n ? groups : null
}

function sub(c: Chain, from: number, to: number): Chain {
  return { tokens: c.tokens.slice(from, to), links: c.links.slice(from, to - 1) }
}

// A row can be preceded or followed by a loose number on the same line («Farge 1 7 (8) 8
// (9) 9 (10) nøster», «Hvit 902 9 (10) 11 (12)»): up to two of those are dropped while
// they are joined by a plain space only. More would cut rows out of a run of diagram row
// numbers («16 15 14 13 …»). Rows in a table sit on separate lines, so a chain is also
// tried line by line.
function rowsIn(c: Chain, n: number, allowSpaced: boolean): Token[][] {
  const parts: Chain[] = [c]
  if (c.links.includes('nl')) {
    let from = 0
    c.links.forEach((l, i) => {
      if (l === 'nl') { parts.push(sub(c, from, i + 1)); from = i + 1 }
    })
    parts.push(sub(c, from, c.tokens.length))
  }
  const rows: Token[][] = []
  for (const p of parts) {
    const len = p.tokens.length
    let found: Token[] | null = null
    for (let lead = 0; lead <= MAX_LOOSE && lead < len && !found; lead++) {
      if (lead > 0 && p.links[lead - 1] !== 'space') break
      for (let trail = 0; lead + trail <= MAX_LOOSE && lead + trail < len && !found; trail++) {
        if (trail > 0 && p.links[len - 1 - trail] !== 'space') break
        found = valuesOf(sub(p, lead, len - trail), n, allowSpaced)
      }
    }
    if (found) rows.push(found)
  }
  return rows
}

function lineAt(text: string, pos: number): string {
  const s = text.lastIndexOf('\n', pos - 1) + 1
  const e = text.indexOf('\n', pos)
  return text.slice(s, e < 0 ? text.length : e)
}

// ---- The size line ----

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function labelCore(label: string): string {
  return label
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(new RegExp(`(?<![\\p{L}])(?:${UNITS})\\.?(?![\\p{L}])`, 'giu'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Where the pattern lists its sizes, e.g. «1-2 (2-3) 3-4 (4-5) 5-6 (6-7) år» or the head
// of a table. Returns the span of label k in each such line, and whether the labels are
// separated by spaces only (then table rows of plain numbers are rows too).
function findSizeLines(text: string, labels: string[], k: number): { spans: Token[]; spaced: boolean } {
  const cores = labels.map(labelCore)
  if (cores.some(c => !c)) return { spans: [], spaced: false }
  const unit = `(?<![\\p{L}])(?:${UNITS})\\.?(?![\\p{L}])`
  const sep = `((?:[^\\p{L}\\p{N}]|${unit})+)`
  const core = (c: string) => '(' + escapeRe(c).replace(/-/g, '\\s*-\\s*').replace(/\//g, '\\s*/\\s*').replace(/ /g, '\\s+') + ')'
  const end = `(?!\\p{N})(?!(?!(?:${UNITS}))\\p{L})`
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${cores.map(core).join(sep)}${end}`, 'giud')
  const spans: Token[] = []
  let spaced = false
  for (const m of text.matchAll(re)) {
    const idx = m.indices!
    // Groups alternate: core 0, sep 0, core 1, ... so core k is group 2k + 1.
    const [s, e] = idx[2 * k + 1]
    spans.push({ start: s, end: e })
    const seps = Array.from({ length: cores.length - 1 }, (_, i) => m[2 * i + 2])
    if (seps.every(g => !g.replace(new RegExp(unit, 'giu'), '').replace(/\s/g, ''))) spaced = true
  }
  return { spans, spaced }
}

// ---- Rectangles ----

function rectsFor(b: Built, span: Token, page: PageText, measure: Measure): Rect[] {
  const byItem = new Map<number, { from: number; to: number }>()
  for (let i = span.start; i < span.end; i++) {
    const it = b.item[i]
    if (it < 0) continue
    const r = byItem.get(it)
    if (r) r.to = b.offset[i] + 1
    else byItem.set(it, { from: b.offset[i], to: b.offset[i] + 1 })
  }
  const [t0, t1, t2, t3, t4, t5] = page.viewport.transform
  const toView = (x: number, y: number) => [t0 * x + t2 * y + t4, t1 * x + t3 * y + t5]
  const out: Rect[] = []
  for (const [it, { from, to }] of byItem) {
    const item = b.items[it]
    const full = measure(item.str, item.fontName) || item.str.length || 1
    const a = measure(item.str.slice(0, from), item.fontName) / full
    const z = measure(item.str.slice(0, to), item.fontName) / full
    const [, , , d, x, y] = item.transform
    const fs = Math.abs(d) || item.height || 10
    const x0 = x + item.width * a - PAD
    const x1 = x + item.width * z + PAD
    const y0 = y - 0.25 * fs - PAD
    const y1 = y + 0.85 * fs + PAD
    const [ax, ay] = toView(x0, y0)
    const [bx, by] = toView(x1, y1)
    const W = page.viewport.width
    const H = page.viewport.height
    out.push({
      x: Math.min(ax, bx) / W,
      y: Math.min(ay, by) / H,
      w: Math.abs(bx - ax) / W,
      h: Math.abs(by - ay) / H,
    })
  }
  return out
}

// ---- All together ----

export function findSizeMarks(pages: PageText[], labels: string[], k: number, measure: Measure = byLength): SizeMarks {
  const result: SizeMarks = { status: 'none', pages: new Map(), found: [] }
  const built = pages.map(p => buildPageText(p.items))
  const chars = built.reduce((sum, b) => sum + b.text.replace(/[\s|]/g, '').length, 0)
  if (chars < MIN_TEXT_CHARS) return { ...result, status: 'no-text' }
  const n = labels.length
  if (n < 2 || k < 0 || k >= n) return result

  const sizeLines = built.map(b => findSizeLines(b.text, labels, k))
  const spaced = sizeLines.some(s => s.spaced)

  built.forEach((b, i) => {
    const spans = new Map<string, Token>()
    for (const s of sizeLines[i].spans) spans.set(`${s.start}:${s.end}`, s)
    for (const c of chains(b.text)) {
      // Page numbers in URLs («cid=1 1/11»), phone numbers and e-mail lines are not rows.
      const lines = lineAt(b.text, c.tokens[0].start) + lineAt(b.text, c.tokens[c.tokens.length - 1].start)
      if (/https?:|www\.|@/i.test(lines)) continue
      for (const row of rowsIn(c, n, spaced)) spans.set(`${row[k].start}:${row[k].end}`, row[k])
    }
    const sorted = [...spans.values()].sort((a, z) => a.start - z.start)
    for (const s of sorted) {
      const ls = b.text.lastIndexOf('\n', s.start - 1) + 1
      const le = b.text.indexOf('\n', s.end)
      const line = b.text.slice(ls, s.start) + '[' + b.text.slice(s.start, s.end) + ']' + b.text.slice(s.end, le < 0 ? b.text.length : le)
      result.found.push({ page: i + 1, text: b.text.slice(s.start, s.end), line })
    }
    const rects = sorted.flatMap(s => rectsFor(b, s, pages[i], measure))
    if (rects.length) result.pages.set(i + 1, rects)
  })
  return { ...result, status: result.pages.size ? 'ok' : 'none' }
}
