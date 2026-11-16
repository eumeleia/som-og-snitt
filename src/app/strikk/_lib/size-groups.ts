// Size groups for «Hva vil du strikke nå»: the many ways patterns write a size, folded into
// Barn (0–12 mnd, 1 år … 14 år), Voksne (XS … XXL) and Annet. A size lands in every group it
// overlaps, so «1–2 år» is in both 1 år and 2 år. Pure, so every rule is tested.
//
// Tables, looked up 2026-11-15:
// - Women's number sizes to letters (tops and dresses), s.Oliver:
//   https://soliver.eu/fitting-guide/size-table-women — 32 XXS, 34 XS, 36 S, 38 M, 40 L,
//   42 XL, 44 XXL, 46 XXXL, 48 4XL. XXS and XXXL and up have no group here: «Annet».
// - Children's sizes in cm to age, Babyverden:
//   https://www.babyverden.no/baby/storrelser-pa-babyklar/ — 50 to 116 cm. Larger cm sizes
//   are not in the table: «Annet».

export const CHILD_GROUPS = ['0–12 mnd', ...Array.from({ length: 14 }, (_, i) => `${i + 1} år`)]
export const ADULT_GROUPS = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const
export const OTHER = 'Annet'
export const SIZE_GROUPS = [...CHILD_GROUPS, ...ADULT_GROUPS, OTHER]

const WOMEN_NUMBER: Record<number, string> = { 34: 'XS', 36: 'S', 38: 'M', 40: 'L', 42: 'XL', 44: 'XXL' }

// Age in months [from, to] for each cm size (Babyverden). «1-2 måneder» is up to two months;
// «1 1/2-2 år» is up to and including two years.
const CM_MONTHS: Record<number, [number, number]> = {
  50: [0, 0.99], 56: [1, 1.99], 62: [2, 3.99], 68: [4, 5.99], 74: [6, 8.99], 80: [9, 11.99],
  86: [12, 17.99], 92: [18, 35.99], 98: [30, 47.99], 104: [42, 59.99], 110: [54, 71.99], 116: [66, 83.99],
}

// Garments whose number sizes are shoe sizes, not clothes: those go to «Annet».
const SHOE_GARMENTS = /sokk|tøff|tøfl|slipper/

const groupRange = (g: string): [number, number] => {
  if (g === CHILD_GROUPS[0]) return [0, 12]
  const years = Number(g.split(' ')[0])
  return [years * 12, years * 12 + 12]
}

// Months [from, to] to the child groups it overlaps.
function childGroups(from: number, to: number): string[] {
  return CHILD_GROUPS.filter(g => { const [lo, hi] = groupRange(g); return from < hi && to >= lo })
}

const num = (s: string) => Number(s.replace(',', '.'))
const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`
const RANGE = new RegExp(String.raw`^${NUMBER}(?:\s*[-/]\s*${NUMBER})?\s*`)

function normalize(label: string): string {
  return label.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').replace(/[.]+$/, '').trim()
}

const LETTERS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl']
const letter = (t: string) => {
  const s = t.replace(/^2xl$/, 'xxl').replace(/^3xl$/, 'xxxl')
  return LETTERS.indexOf(s)
}

// Every group a size label belongs to; «Annet» when it cannot be read.
export function sizeGroups(label: string, garmentType?: string | null): string[] {
  const s = normalize(label)
  if (!s) return [OTHER]
  if (/prematur|nyfødt|newborn/.test(s)) return [CHILD_GROUPS[0]]

  // Letters: «M», «S/M», «XS-S», «L-XL», «2XL/3XL». A range takes every letter in between.
  if (/^(\d?x{0,3}[sml]|\d?xl)(\s*[-/]\s*(\d?x{0,3}[sml]|\d?xl))?$/.test(s)) {
    const [a, b] = s.split(/\s*[-/]\s*/).map(letter)
    if (a < 0 || (b !== undefined && b < 0)) return [OTHER]
    const lo = Math.min(a, b ?? a), hi = Math.max(a, b ?? a)
    const out = LETTERS.slice(lo, hi + 1).map(l => l.toUpperCase()).filter(l => (ADULT_GROUPS as readonly string[]).includes(l))
    return out.length ? out : [OTHER]
  }

  const m = s.match(RANGE)
  if (!m) return [OTHER]
  const a = num(m[1]), b = m[2] !== undefined ? num(m[2]) : null
  const unit = s.slice(m[0].length).trim()

  if (/^(mnd|mdr|måned|months?|mos?)\b/.test(unit) || /^(mnd|mdr|måned)/.test(unit)) {
    // «6-12 mnd» is up to twelve months; a single «12 mnd» is a one-year-old.
    const out = b === null ? childGroups(a, a) : childGroups(Math.min(a, b), Math.max(a, b) - 0.01)
    return out.length ? out : [OTHER]
  }
  if (/^(år|years?|yrs?)\b/.test(unit) || /^år/.test(unit)) {
    // «1–2 år» is one- and two-year-olds: the upper year is included.
    const lo = Math.min(a, b ?? a), hi = Math.max(a, b ?? a)
    const out = childGroups(lo * 12, hi * 12 + 11.99)
    return out.length ? out : [OTHER]
  }
  if (/^(cl|cm)$/.test(unit) || (unit === '' && b === null && CM_MONTHS[a])) {
    const cm = CM_MONTHS[a]
    return cm && b === null ? childGroups(cm[0], cm[1]) : [OTHER]
  }
  if (unit !== '') return [OTHER]

  // A bare number or range.
  const lo = Math.min(a, b ?? a), hi = Math.max(a, b ?? a)
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return [OTHER]
  if (hi <= 14 && lo >= 0) return childGroups(lo * 12, hi * 12 + 11.99)
  if (garmentType && SHOE_GARMENTS.test(garmentType.toLowerCase())) return [OTHER]
  // Women's sizes go in steps of two: «38/40». «39/40» or «35-37» are shoe sizes.
  if (lo % 2 === 0 && hi % 2 === 0 && lo >= 32 && hi <= 48) {
    const out: string[] = []
    for (let n = lo; n <= hi; n += 2) if (WOMEN_NUMBER[n]) out.push(WOMEN_NUMBER[n])
    return out.length ? out : [OTHER]
  }
  return [OTHER]
}

export const groupOrder = (g: string) => { const i = SIZE_GROUPS.indexOf(g); return i < 0 ? SIZE_GROUPS.length : i }
export const isChildGroup = (g: string) => CHILD_GROUPS.includes(g)
export const isAdultGroup = (g: string) => (ADULT_GROUPS as readonly string[]).includes(g)
