// «Hva vil du strikke?» in Strikk › Garnlager: which recipes, in which sizes, the yarn
// Maria has can knit. Pure, so every rule is tested without a database.
//
// Rules:
// - Only approved stash rows not set aside for a project count. One row is one colour.
// - Everything is compared in metres. Stash: skeins × metres per skein, plus a leftover's
//   grams. Pattern: grams or skeins turned into metres with the yarn's own skein weight
//   and length. A row or a yarn line whose metres cannot be worked out is never enough.
// - A size can be knitted when every yarn line gets a stash row of its own with enough
//   metres. A shared amount where the pattern lets Maria choose between yarns is one
//   requirement any of those yarns can meet.
// - A recipe without sizes is one size.
// - Besides the pattern's own yarn, a line can be knitted in the pattern's own alternatives
//   or in stash yarn with the same gauge and main fibre (only the gauge for a line that
//   names no yarn). Those need a swatch first.
// - Rows of the same yarn and colour number are one colour.
import { amountForCalc, type ExtractionData } from './extraction'
import { amountForLine } from './project-amounts'
import { mainFibre, type Fiber } from './yarns'

export interface MatchYarn {
  id: string
  brand: string
  name: string
  meterage_m: number | null
  skein_weight_g: number | null
  gauge_stitches_min: number | null
  gauge_stitches_max: number | null
  fibers: Fiber[]
}

export interface MatchStashRow {
  id: string
  yarn_id: string | null
  color_number: string | null
  color_name: string | null
  skein_count: number
  leftover_g: number | null
  status: string
  project_id: string | null
}

export interface MatchRecipe {
  id: string
  title: string
  designer: string | null
  mentions_leftover: boolean | null
  data: Pick<ExtractionData, 'sizes' | 'yarn_lines' | 'amounts' | 'alternatives' | 'gauge_stitches_10cm'>
}

export interface MatchSlotText { label: string; choices: string[] }

export interface MatchGroup {
  // «Med Tynn Merinoull 1013 Hvit og 2052 Lys brun kan du strikke 1–3 mnd til 2 år»
  text: string
  slots: MatchSlotText[]
  sizes: number[]
  // Another yarn than the pattern's for at least one line: knit a swatch first.
  alternative: boolean
  // The stash rows of one combination that knits these sizes, for «Planlegg prosjekt».
  rowIds: string[]
}

export interface MatchMissing { size: string; lines: string[] }

export interface RecipeMatch {
  id: string
  title: string
  designer: string | null
  sizeLabels: string[]
  groups: MatchGroup[]
  // Sizes no shown combination knits, and what each one lacks.
  missing: MatchMissing[]
  available: boolean
  fromLeftovers: boolean
}

export const ONE_SIZE = 'Én størrelse'
const MAX_CANDIDATES = 8
const MAX_COMBINATIONS = 5000
const MAX_GROUPS = 3

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// Metres of yarn in a stash row; null when it cannot be known.
export function rowMetres(row: Pick<MatchStashRow, 'skein_count' | 'leftover_g'>, yarn: Pick<MatchYarn, 'meterage_m' | 'skein_weight_g'> | undefined): number | null {
  const m = num(yarn?.meterage_m), w = num(yarn?.skein_weight_g)
  const skeins = num(row.skein_count) ?? 0
  const left = num(row.leftover_g) ?? 0
  if (skeins <= 0 && left <= 0) return null
  if (!m) return null
  if (left > 0 && !w) return skeins > 0 ? skeins * m : null
  return skeins * m + (left > 0 ? (left / w!) * m : 0)
}

export function isFree(row: Pick<MatchStashRow, 'status' | 'project_id'>): boolean {
  return row.status === 'godkjent' && !row.project_id
}

// One row per colour: rows with the same yarn and colour number (registered from two piles)
// are added together. Rows without a colour number stay apart.
interface ColourRow extends MatchStashRow { ids: string[] }
export function mergeColours(rows: MatchStashRow[]): ColourRow[] {
  const out = new Map<string, ColourRow>()
  for (const r of rows) {
    const nr = r.color_number?.trim().toLowerCase()
    const k = r.yarn_id && nr ? `${r.yarn_id}|${nr}` : `row|${r.id}`
    const prev = out.get(k)
    if (!prev) { out.set(k, { ...r, ids: [r.id] }); continue }
    prev.ids.push(r.id)
    prev.skein_count = (num(prev.skein_count) ?? 0) + (num(r.skein_count) ?? 0)
    const left = (num(prev.leftover_g) ?? 0) + (num(r.leftover_g) ?? 0)
    prev.leftover_g = left > 0 ? left : null
    prev.color_name ||= r.color_name
  }
  return [...out.values()]
}

interface Candidate { row: ColourRow; line: number; alternative: boolean; metres: number | null }
interface Slot { lines: number[]; label: string; needs: (number | null)[][]; candidates: Candidate[] }

function gaugeRange(y: MatchYarn | undefined): [number, number] | null {
  const lo = num(y?.gauge_stitches_min), hi = num(y?.gauge_stitches_max)
  if (lo === null && hi === null) return null
  return [lo ?? hi!, hi ?? lo!]
}

const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1]

export function rowLabel(row: MatchStashRow, yarns: Map<string, MatchYarn>): string {
  const y = row.yarn_id ? yarns.get(row.yarn_id) : undefined
  const colour = [row.color_number, row.color_name].filter(Boolean).join(' ')
  return [y?.name ?? 'Garn', colour].filter(Boolean).join(' ')
}

// «1–3 mnd til 2 år», or a list when the sizes are not next to each other.
export function sizeRangeText(sizes: number[], labels: string[]): string {
  const sorted = [...sizes].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const s of sorted) {
    const last = runs[runs.length - 1]
    if (last && s === last[1] + 1) last[1] = s
    else runs.push([s, s])
  }
  return runs.map(([a, b]) => (a === b ? labels[a] : `${labels[a]} til ${labels[b]}`)).join(', ')
}

// «Klompelompe Tynn Merinoull 1013 Hvit eller 2052 Lys brun»: the yarn name once per yarn.
export function choicesText(rows: MatchStashRow[], yarns: Map<string, MatchYarn>): string {
  const byYarn = new Map<string, string[]>()
  for (const row of rows) {
    const name = (row.yarn_id ? yarns.get(row.yarn_id)?.name : undefined) ?? 'Garn'
    const colour = [row.color_number, row.color_name].filter(Boolean).join(' ')
    const list = byYarn.get(name) ?? []
    if (!list.includes(colour)) list.push(colour)
    byYarn.set(name, list)
  }
  return [...byYarn].map(([name, colours]) => [name, colours.filter(Boolean).join(' eller ')].filter(Boolean).join(' ')).join(' eller ')
}

function joinOg(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} og ${parts[parts.length - 1]}`
}

export function matchRecipe(recipe: MatchRecipe, stash: MatchStashRow[], yarns: Map<string, MatchYarn>): RecipeMatch {
  const d = recipe.data
  const sizeLabels = d.sizes.length ? d.sizes.map(s => s.label) : [ONE_SIZE]
  const free = mergeColours(stash.filter(isFree))
  const recipeGauge = num(d.gauge_stitches_10cm)

  // Metres one line needs in one size; null when the pattern does not say, or the amount
  // cannot be turned into metres.
  const needFor = (lineIndex: number, sizeIndex: number): number | null => {
    const line = d.yarn_lines[lineIndex]
    const a = amountForLine(d as ExtractionData, sizeIndex, lineIndex)
    const n = a ? amountForCalc(a) : null
    if (!a || n === null || n <= 0) return null
    const y = line.yarn_id ? yarns.get(line.yarn_id) : undefined
    const metres = num(line.meterage_m) ?? num(y?.meterage_m)
    const weight = num(line.skein_weight_g) ?? num(y?.skein_weight_g)
    if (!metres) return null
    if (a.unit === 'skeins') return n * metres
    return weight ? (n / weight) * metres : null
  }

  const candidatesFor = (lineIndex: number): Candidate[] => {
    const line = d.yarn_lines[lineIndex]
    const own = line.yarn_id ? yarns.get(line.yarn_id) : undefined
    const patternAlts = new Set(d.alternatives
      .filter(a => a.yarn_id && (a.yarn_line === lineIndex || (a.yarn_line === null && (a.color_group === null || a.color_group === line.color_group))))
      .map(a => a.yarn_id!))
    const target = gaugeRange(own) ?? (recipeGauge !== null ? [recipeGauge, recipeGauge] as [number, number] : null)
    // A line naming a yarn keeps its fibre: no Lima for a mohair line.
    const fibre = own ? mainFibre(own.fibers ?? []) : null
    const out: Candidate[] = []
    for (const row of free) {
      if (!row.yarn_id) continue
      const y = yarns.get(row.yarn_id)
      const original = !!line.yarn_id && row.yarn_id === line.yarn_id
      const r = gaugeRange(y)
      const sameFibre = fibre === null || mainFibre(y?.fibers ?? []) === fibre
      const alternative = !original && (patternAlts.has(row.yarn_id) || (!!target && !!r && overlaps(target, r) && sameFibre))
      if (!original && !alternative) continue
      out.push({ row, line: lineIndex, alternative, metres: rowMetres(row, y) })
    }
    return out
  }

  // One slot per yarn line, except that lines sharing an amount the pattern lets Maria
  // choose between form one slot.
  const slots: Slot[] = []
  const done = new Set<number>()
  const sizeCount = sizeLabels.length
  d.yarn_lines.forEach((line, i) => {
    if (done.has(i)) return
    const shared = d.amounts.some(a => a.needs_choice && a.yarn_line === null && a.color_group === line.color_group)
    const lines = shared ? d.yarn_lines.map((l, j) => (l.color_group === line.color_group ? j : -1)).filter(j => j >= 0) : [i]
    lines.forEach(j => done.add(j))
    // A bare colour number says little on its own: «Tynn Merinoull 3332».
    const label = line.color_label && !/^[\d\s#.-]+$/.test(line.color_label)
      ? line.color_label
      : [line.yarn_name, line.color_label].filter(Boolean).join(' ') || `Garn ${i + 1}`
    const needs = lines.map(j => Array.from({ length: sizeCount }, (_, s) => needFor(j, s)))
    const candidates = lines.flatMap(candidatesFor)
      .sort((a, b) => Number(a.alternative) - Number(b.alternative) || (b.metres ?? -1) - (a.metres ?? -1))
    slots.push({ lines, label, needs, candidates })
  })

  const need = (slot: Slot, c: Candidate, s: number) => slot.needs[slot.lines.indexOf(c.line)][s]
  const enough = (slot: Slot, c: Candidate, s: number) => {
    const n = need(slot, c, s)
    return n !== null && c.metres !== null && c.metres + 1e-6 >= n
  }

  // Every combination of one usable candidate per slot, each on a row of its own.
  const combos: { picks: Candidate[]; sizes: number[] }[] = []
  const usable = slots.map(slot => slot.candidates.filter(c => c.metres !== null).slice(0, MAX_CANDIDATES))
  if (slots.length > 0 && usable.every(u => u.length > 0)) {
    const picks: Candidate[] = []
    const walk = (k: number) => {
      if (combos.length >= MAX_COMBINATIONS) return
      if (k === slots.length) {
        const sizes = Array.from({ length: sizeCount }, (_, s) => s).filter(s => picks.every((c, i) => enough(slots[i], c, s)))
        if (sizes.length) combos.push({ picks: [...picks], sizes })
        return
      }
      for (const c of usable[k]) {
        if (picks.some(p => p.row.id === c.row.id)) continue
        picks.push(c)
        walk(k + 1)
        picks.pop()
      }
    }
    walk(0)
  }

  const isAlt = (picks: Candidate[]) => picks.some(c => c.alternative)
  const key = (sizes: number[]) => sizes.join(',')
  const originalSizes = new Set(combos.filter(c => !isAlt(c.picks)).flatMap(c => c.sizes))
  // Alternatives only where the pattern's own yarn does not reach.
  const shown = combos.filter(c => !isAlt(c.picks) || c.sizes.some(s => !originalSizes.has(s)))
  // Keep the combinations no other one of the same kind beats with more sizes. The pattern's
  // own yarn is never hidden behind an alternative that reaches further.
  const covers = (a: number[], b: number[]) => b.every(s => a.includes(s))
  const maximal = shown.filter(c => !shown.some(o => o !== c && isAlt(o.picks) === isAlt(c.picks) &&
    covers(o.sizes, c.sizes) && o.sizes.length > c.sizes.length))

  // Combinations knitting the same sizes become one line of text: «A eller B» for a slot
  // where only that slot differs; otherwise the first one, noting there are more.
  const byKey = new Map<string, typeof maximal>()
  for (const c of maximal) {
    const k = `${isAlt(c.picks) ? 'a' : 'o'}|${key(c.sizes)}`
    byKey.set(k, [...(byKey.get(k) ?? []), c])
  }
  const groups: MatchGroup[] = [...byKey.values()]
    .sort((a, b) => Number(isAlt(a[0].picks)) - Number(isAlt(b[0].picks)) || b[0].sizes.length - a[0].sizes.length)
    .slice(0, MAX_GROUPS)
    .map(list => {
      const first = list[0]
      const varying = slots.map((_, i) => new Set(list.map(c => c.picks[i].row.id)).size > 1)
      const mergeable = varying.filter(Boolean).length <= 1
      const used = mergeable ? list : [first]
      const slotRows = slots.map((_, i) => [...new Map(used.map(c => [c.picks[i].row.id, c.picks[i].row])).values()])
      const slotTexts: MatchSlotText[] = slots.map((slot, i) => ({
        label: slot.label,
        choices: slotRows[i].map(r => rowLabel(r, yarns)),
      }))
      const more = !mergeable ? ' (eller andre farger)' : ''
      const yarnText = joinOg(slotRows.map(rows => choicesText(rows, yarns)))
      const alternative = isAlt(first.picks)
      return {
        text: `Med ${yarnText}${more} kan du strikke ${sizeRangeText(first.sizes, sizeLabels)}`,
        slots: slotTexts,
        sizes: first.sizes,
        alternative,
        rowIds: first.picks.flatMap(c => c.row.ids),
      }
    })

  // What each size nobody can knit lacks, line by line, from the best row there is.
  const knit = new Set(groups.flatMap(g => g.sizes))
  const missing: MatchMissing[] = []
  for (let s = 0; s < sizeCount; s++) {
    if (knit.has(s)) continue
    const lines: string[] = []
    for (const slot of slots) {
      // The row that comes closest: one that is enough, or else the one with most metres.
      const best = slot.candidates.find(c => enough(slot, c, s))
        ?? [...slot.candidates].sort((a, b) => (b.metres ?? -1) - (a.metres ?? -1))[0]
      const needs = slot.needs.map(n => n[s])
      if (needs.every(n => n === null)) { lines.push(`${slot.label}: mengde ukjent i oppskriften`); continue }
      if (!best) { lines.push(`${slot.label}: ikke i lageret`); continue }
      if (enough(slot, best, s)) continue
      if (best.metres === null) { lines.push(`${slot.label}: ${rowLabel(best.row, yarns)} har mengde ukjent`); continue }
      const n = need(slot, best, s)
      if (n === null) { lines.push(`${slot.label}: mengde ukjent i oppskriften`); continue }
      const line = d.yarn_lines[best.line]
      const perSkein = num(line.meterage_m) ?? num(line.yarn_id ? yarns.get(line.yarn_id)?.meterage_m : null)
      const short = n - best.metres
      const skeins = perSkein ? ` (ca. ${Math.ceil(short / perSkein)} nøste${Math.ceil(short / perSkein) === 1 ? '' : 'r'})` : ''
      lines.push(`${slot.label}: mangler ca. ${Math.ceil(short)} m${skeins}`)
    }
    if (slots.length === 0) lines.push('Oppskriften oppgir ikke garn')
    // Each line has a row that is enough on its own, but not one each at the same time.
    else if (lines.length === 0) lines.push('Garnet som rekker, trengs til flere garnlinjer samtidig; det mangler én farge til')
    missing.push({ size: sizeLabels[s], lines })
  }

  const available = groups.length > 0
  // Small enough to knit from leftovers: the pattern says so, or in its smallest size each
  // line needs at most one skein of the yarn it is knitted in.
  const fromLeftovers = available && (!!recipe.mentions_leftover || groups.some(g => {
    const s = Math.min(...g.sizes)
    const combo = combos.find(c => c.picks.flatMap(p => p.row.ids).join() === g.rowIds.join())
    return !!combo && combo.picks.every((c, i) => {
      const n = need(slots[i], c, s)
      const perSkein = num(c.row.yarn_id ? yarns.get(c.row.yarn_id)?.meterage_m : null)
      return n !== null && !!perSkein && n <= perSkein + 1e-6
    })
  }))

  return { id: recipe.id, title: recipe.title, designer: recipe.designer, sizeLabels, groups, missing, available, fromLeftovers }
}

const nb = (a: string, b: string) => a.localeCompare(b, 'nb', { sensitivity: 'base' })

// Recipes with at least one size Maria can knit: the pattern's own yarn first, then those
// that need an alternative, each by title.
export function matchRecipes(recipes: MatchRecipe[], stash: MatchStashRow[], yarns: MatchYarn[]): RecipeMatch[] {
  const byId = new Map(yarns.map(y => [y.id, y]))
  return recipes
    .map(r => matchRecipe(r, stash, byId))
    .filter(m => m.available)
    .sort((a, b) => Number(a.groups[0].alternative) - Number(b.groups[0].alternative) || nb(a.title, b.title))
}
