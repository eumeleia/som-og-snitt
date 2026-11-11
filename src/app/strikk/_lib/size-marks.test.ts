import { describe, it, expect } from 'vitest'
import { findSizeMarks, labelCore, type PageText, type TextItemLike } from './size-marks'

const FS = 10
// One text item per line, 0.5 em per character, as pdf.js gives them.
const item = (str: string, y: number, x = 50, extra: Partial<TextItemLike> = {}): TextItemLike => ({
  str, transform: [FS, 0, 0, FS, x, y], width: str.length * FS * 0.5, height: FS, hasEOL: true, ...extra,
})
const page = (lines: string[], scale = 1): PageText => ({
  items: lines.map((s, i) => item(s, 760 - i * 14)),
  viewport: { width: 600 * scale, height: 800 * scale, transform: [scale, 0, 0, -scale, 0, 800 * scale] },
})
const found = (pages: PageText[], labels: string[], k: number) =>
  findSizeMarks(pages, labels, k).found.map(f => f.text)

const MINI = ['1-2 år', '2-3 år', '3-4 år', '4-5 år', '5-6 år', '6-7 år']

describe('findSizeMarks', () => {
  it('marks the chosen size in the size line and in every row of as many values', () => {
    const p = page([
      'Størrelser: 1-2 (2-3) 3-4 (4-5) 5-6 (6-7) år',
      'Materialer: 250 (300) 300 (350) 350 (400) g Peer Gynt (50 g = 91 m)',
      'Strikkefasthet: 20 masker x 28 omganger på pinne 4 mm',
    ])
    expect(found([p], MINI, 1)).toEqual(['2-3', '300'])
    expect(found([p], MINI, 4)).toEqual(['5-6', '350'])
  })

  it('places the rectangle on the value, as a fraction of the page', () => {
    const line = 'Materialer: 250 (300) 300 (350) 350 (400) g'
    const res = findSizeMarks([page(['Størrelser: 1-2 (2-3) 3-4 (4-5) 5-6 (6-7) år', line])], MINI, 1)
    const r = res.pages.get(1)![1]
    const at = line.indexOf('300')
    expect(r.x).toBeCloseTo((50 + at * 5 - 1.5) / 600, 5)
    expect(r.w).toBeCloseTo((3 * 5 + 3) / 600, 5)
    // Baseline 746: from 0.85 em above to 0.25 em below, plus padding, measured from the top.
    expect(r.y).toBeCloseTo((800 - (746 + 8.5 + 1.5)) / 800, 5)
    expect(r.h).toBeCloseTo((11 + 3) / 800, 5)
  })

  it('gives the same rectangles at any zoom', () => {
    const lines = ['Størrelser: 1-2 (2-3) 3-4 (4-5) 5-6 (6-7) år', 'Materialer: 250 (300) 300 (350) 350 (400) g']
    const at1 = findSizeMarks([page(lines, 1)], MINI, 1).pages.get(1)!
    const at3 = findSizeMarks([page(lines, 3)], MINI, 1).pages.get(1)!
    at1.forEach((r, i) => {
      expect(at3[i].x).toBeCloseTo(r.x, 9)
      expect(at3[i].y).toBeCloseTo(r.y, 9)
      expect(at3[i].w).toBeCloseTo(r.w, 9)
      expect(at3[i].h).toBeCloseTo(r.h, 9)
    })
  })

  it('reads dash rows (DROPS) but not a two-number range', () => {
    const p = page([
      'Størrelse: S - M - L - XL',
      '350-400-450-500 g farge 0100',
      'Overvidde: 96 - 106 - 112 - 122 cm',
    ])
    expect(found([p], ['S', 'M', 'L', 'XL'], 2)).toEqual(['L', '450', '112'])
    expect(found([page(['Str S (M)', 'Hodeomkrets 43-48 cm'])], ['S', 'M'], 1)).toEqual(['M'])
  })

  it('keeps slashes and dashes inside a value when the row uses parentheses', () => {
    const p = page(['38/40 (40/42) 42/44 (44/46)', 'Delightful: 550 (600) 650 (700) g', '20-22 (23-25) 26-28 (29-31)'])
    expect(found([p], ['38/40', '40/42', '42/44', '44/46'], 2)).toEqual(['42/44', '650', '26-28'])
  })

  it('reads table rows only when the size line itself is a table head', () => {
    const rows = ['Overvidde (cm) 62 69 75 81', 'Bunn farge (g) 100 100 150 150']
    const labels = ['1 år', '2 år', '3-4 år', '5-6 år']
    expect(found([page(['Størrelse (år) 1 2 3-4 5-6', ...rows])], labels, 3)).toEqual(['5-6', '81', '150'])
    expect(found([page(['Størrelser: 1 (2) 3-4 (5-6) år', ...rows])], labels, 3)).toEqual(['5-6'])
  })

  it('reads comma lists with fractions', () => {
    const p = page(['0-6 months (6-12 months, 12-18 months, 2 years, 3 years)', 'until piece measures about 5 1/2 (6 1/2, 7, 7 1/2, 8) in.'])
    expect(found([p], ['0-6 months', '6-12 months', '12-18 months', '2 years', '3 years'], 3)).toEqual(['2', '7 1/2'])
  })

  it('follows a row onto the next line', () => {
    const p = page(['Størrelser: 1-2 (2-3) 3-4 (4-5) 5-6 (6-7) år', 'Legg opp 68 (68) 72', '(76) 80 (84) m på rundpinne 4 mm.'])
    const res = findSizeMarks([p], MINI, 4)
    expect(res.found.map(f => f.text)).toEqual(['5-6', '80'])
    expect(res.pages.get(1)![1].y).toBeGreaterThan(res.pages.get(1)![0].y)
  })

  it('drops up to two loose numbers in front of a row, but no more', () => {
    expect(found([page(['XS (S) M (L)', 'Farge 1 7 (8) 8 (9) nøster', 'Hvit 902 9 (10) 11 (12) nøster'])], ['XS', 'S', 'M', 'L'], 0))
      .toEqual(['XS', '7', '9'])
    const head = page(['Størrelse 2 4 6 8 år', '16 15 14 13 12 11 10 9 8 7'])
    expect(found([head], ['2 år', '4 år', '6 år', '8 år'], 1)).toEqual(['4'])
  })

  it('skips lines with a web address or e-mail', () => {
    const p = page(['S (M) L', 'https://www.garnstudio.com/pattern.php?id=8788 1 (2) 3', 'Legg opp 80 (88) 96 m'])
    expect(found([p], ['S', 'M', 'L'], 1)).toEqual(['M', '88'])
  })

  it('leaves out rotated text', () => {
    const p = page(['Størrelser: S (M) L, se plaggets mål'])
    p.items.push(item('80 (88) 96', 500, 50, { transform: [0, FS, -FS, 0, 20, 500] }))
    expect(found([p], ['S', 'M', 'L'], 1)).toEqual(['M'])
  })

  it('says when the PDF has no text layer', () => {
    const scanned: PageText = { items: [item('', 700), item('  ', 690)], viewport: page([]).viewport }
    expect(findSizeMarks([scanned, scanned], MINI, 1).status).toBe('no-text')
  })

  it('says when nothing matched, and marks nothing for a single size', () => {
    const p = page(['Dette er en oppskrift uten tall i rekker, bare tekst om strikking.'])
    expect(findSizeMarks([p], MINI, 1).status).toBe('none')
    expect(findSizeMarks([page(['Størrelse: Onesize', 'Garnmengde: 250 (300) g'])], ['Onesize'], 0).status).toBe('none')
  })

  it('places values with the measure it is given', () => {
    const line = 'Materialer: 250 (300) 300 (350) 350 (400) g'
    const narrowDigits = (s: string) => [...s].reduce((w, c) => w + (/\d/.test(c) ? 0.5 : 1), 0)
    const p = page(['Størrelser: 1-2 (2-3) 3-4 (4-5) 5-6 (6-7) år', line])
    const plain = findSizeMarks([p], MINI, 1).pages.get(1)![1]
    const measured = findSizeMarks([p], MINI, 1, narrowDigits).pages.get(1)![1]
    const at = line.indexOf('300')
    const share = (to: number) => narrowDigits(line.slice(0, to)) / narrowDigits(line)
    expect(measured.x).toBeCloseTo((50 + line.length * 5 * share(at) - 1.5) / 600, 5)
    expect(measured.x).not.toBeCloseTo(plain.x, 3)
  })
})

describe('labelCore', () => {
  it('takes units out of a size label', () => {
    expect(labelCore('2-3 år')).toBe('2-3')
    expect(labelCore('0-3mnd')).toBe('0-3')
    expect(labelCore('6 - 12 måneder')).toBe('6 - 12')
    expect(labelCore('12–18 mnd.')).toBe('12-18')
    expect(labelCore('XS/S')).toBe('XS/S')
  })
})
