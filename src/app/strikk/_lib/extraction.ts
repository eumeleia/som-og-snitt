// Recipe data extraction for Strikk: the output schema Claude answers in, the prompt,
// which PDF pages to send, and normalising the answer into the shape that
// strikk_save_extraction (migration 014) stores. Pure, so it runs in tests, the browser
// and the route alike.

export const AUDIENCES = ['woman', 'man', 'unisex', 'child'] as const
export const ACCESSORY_KINDS = ['buttons', 'zipper', 'elastic', 'other'] as const
export const UNITS = ['g', 'skeins'] as const

export type Audience = typeof AUDIENCES[number]
export type AccessoryKind = typeof ACCESSORY_KINDS[number]
export type Unit = typeof UNITS[number]

export interface SizeData { label: string; uncertain: boolean }
export interface YarnLineData {
  color_group: number
  color_label: string | null
  yarn_name: string
  brand: string | null
  meterage_m: number | null
  skein_weight_g: number | null
  fiber: string | null
  strands: number
  uncertain_fields: string[]
}
export interface AmountData {
  size: number
  color_group: number
  yarn_line: number | null
  amount: number | null
  unit: Unit
  candidates: string[]
  needs_choice: boolean
  uncertain: boolean
}
export interface AlternativeData {
  color_group: number | null
  yarn_line: number | null
  yarn_name: string
  brand: string | null
  meterage_m: number | null
  skein_weight_g: number | null
  fiber: string | null
  uncertain: boolean
}
export interface AccessoryData {
  size: number | null
  kind: AccessoryKind
  description: string | null
  quantity: number | null
  dimension: string | null
  uncertain: boolean
}
export interface ExtractionData {
  title: string | null
  designer: string | null
  audience: Audience | null
  garment_type: string | null
  is_collection: boolean
  collection_titles: string[]
  variants: string[]
  sizes: SizeData[]
  yarn_lines: YarnLineData[]
  amounts: AmountData[]
  alternatives: AlternativeData[]
  gauge_stitches_10cm: number | null
  gauge_rows_10cm: number | null
  gauge_note: string | null
  needles: string[]
  accessories: AccessoryData[]
  uncertain_fields: string[]
}

// ── Output schema ───────────────────────────────────────────────────────────────────
// Structured-output subset: every object closed, every key required, null via anyOf.

const str = { type: 'string' }
const nullable = (s: object) => ({ anyOf: [s, { type: 'null' }] })
const strArr = { type: 'array', items: str }
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})

export const EXTRACTION_SCHEMA = obj({
  title: nullable(str),
  designer: nullable(str),
  audience: nullable({ type: 'string', enum: [...AUDIENCES] }),
  garment_type: nullable(str),
  is_collection: { type: 'boolean' },
  collection_titles: strArr,
  variants: strArr,
  sizes: { type: 'array', items: obj({ label: str, uncertain: { type: 'boolean' } }) },
  yarn_lines: {
    type: 'array',
    items: obj({
      color_group: { type: 'integer' },
      color_label: nullable(str),
      yarn_name: str,
      brand: nullable(str),
      meterage_m: nullable({ type: 'number' }),
      skein_weight_g: nullable({ type: 'number' }),
      fiber: nullable(str),
      strands: { type: 'integer' },
      uncertain_fields: strArr,
    }),
  },
  amounts: {
    type: 'array',
    items: obj({
      size: { type: 'integer' },
      color_group: { type: 'integer' },
      yarn_line: nullable({ type: 'integer' }),
      amount: nullable({ type: 'number' }),
      unit: { type: 'string', enum: [...UNITS] },
      candidates: strArr,
      needs_choice: { type: 'boolean' },
      uncertain: { type: 'boolean' },
    }),
  },
  alternatives: {
    type: 'array',
    items: obj({
      color_group: nullable({ type: 'integer' }),
      yarn_line: nullable({ type: 'integer' }),
      yarn_name: str,
      brand: nullable(str),
      meterage_m: nullable({ type: 'number' }),
      skein_weight_g: nullable({ type: 'number' }),
      fiber: nullable(str),
      uncertain: { type: 'boolean' },
    }),
  },
  gauge_stitches_10cm: nullable({ type: 'number' }),
  gauge_rows_10cm: nullable({ type: 'number' }),
  gauge_note: nullable(str),
  needles: strArr,
  accessories: {
    type: 'array',
    items: obj({
      size: nullable({ type: 'integer' }),
      kind: { type: 'string', enum: [...ACCESSORY_KINDS] },
      description: nullable(str),
      quantity: nullable({ type: 'number' }),
      dimension: nullable(str),
      uncertain: { type: 'boolean' },
    }),
  },
  uncertain_fields: strArr,
})

export const EXTRACTION_PROMPT = `You read knitting patterns (usually Norwegian, sometimes English or Danish) and extract the material and size data into the JSON schema. Read only what the pattern states. Never fill a field from general knitting knowledge; use null or an empty list when the pattern does not say.

Fields:
- title, designer: as written in the pattern, without model codes, article numbers or dates.
- audience: woman, man, unisex or child. Baby and child sizes are child. Use unisex only when the pattern says it or gives both women's and men's sizes.
- garment_type: one Norwegian word in lower case, e.g. genser, jakke, vest, lue, votter, sokker, skjerf, kjole, bukse, teppe, sett, kosedyr.
- variants: named variants of the same pattern (e.g. "med hette", "kort", "V-hals").
- is_collection: true when the PDF holds several separate patterns (a booklet, e-book or catalogue); collection_titles lists them. Then fill the other fields for the first pattern only and add "is_collection" to uncertain_fields.
- sizes: in the order the pattern lists them, labels as written ("2 år", "S", "86 cm").
- yarn_lines: one entry per yarn. color_group numbers each colour role from 0 (Farge 1 / hovedfarge / A = 0, the next = 1, ...). Different yarns knitted together in the same colour role share one color_group, e.g. Sunday held together with a strand of Tynn Silk Mohair Kid-Silk = two yarn_lines with the same color_group. Several strands of the same yarn are one yarn_line with strands = the number of strands. color_label is the pattern's name for the colour or role. meterage_m is metres per skein, skein_weight_g grams per skein, fiber the fibre content as written.
- amounts: for each size and colour role, the amount exactly as given, in g or skeins (nøster = skeins). Give one entry per yarn_line when the pattern gives an amount per yarn; then yarn_line is that line's index. When the pattern gives one amount for the colour role, yarn_line is null. When one amount is given for several yarns with different meterage (e.g. "300 g Sunday eller Peer Gynt"), set yarn_line null, needs_choice true and candidates to those yarn names. size is the index into sizes.
- alternatives: only the substitute yarns the pattern itself suggests, linked to the yarn_line or color_group they replace.
- gauge_stitches_10cm, gauge_rows_10cm: stitches and rows/rounds per 10 cm. Convert only exact ratios (e.g. 11 sts = 5 cm -> 22) and then add the field to uncertain_fields. gauge_note: the stitch pattern and needle the gauge is given for.
- needles: every needle size and type as written (e.g. "rundpinne 3,5 mm 80 cm").
- accessories: buttons, zippers, elastic and similar; quantity and dimension as written; size is the size index when it differs per size, null when it is the same for all.

Uncertainty: when a value is hard to read, inferred, conflicting, or you are not sure which size or colour it belongs to, still give your best reading and mark it: put the field name in uncertain_fields (top level, or on the yarn line) or set uncertain true on the size, amount, alternative or accessory.`

// ── Page choice ─────────────────────────────────────────────────────────────────────

export interface PageText { page: number; text: string }

export type PagePlan =
  | { mode: 'text'; pages: number[] }
  | { mode: 'images'; pages: number[] }

const KEYWORDS = [
  'garn', 'garnforbruk', 'garnmengde', 'garnalternativ', 'strikkefasthet', 'pinne', 'pinner',
  'rundpinne', 'strømpepinne', 'størrelse', 'størrelser', 'nøste', 'nøster', 'gram', 'meter',
  'løpelengde', 'knapp', 'knapper', 'glidelås', 'elastikk', 'tilbehør', 'materialer', 'overvidde',
  'farge', 'yarn', 'gauge', 'needle', 'needles', 'size', 'sizes', 'skein', 'skeins', 'button',
  'buttons', 'zipper', 'materials', 'garnkvalitet', 'kvalitet', 'mål',
]

export const MAX_TEXT_PAGES = 8
export const MAX_TEXT_CHARS = 60_000
export const MAX_IMAGE_PAGES = 4

// Enough real words that the text layer is the pattern, not just page numbers and stray
// glyphs from a scan. Words are counted before whitespace is stripped; stripped first,
// all the letters run together into one "word".
export function hasReadableText(text: string): boolean {
  const stripped = text.replace(/[0-9.,\s\-•·]/g, '')
  if (stripped.length < 100) return false
  return (text.match(/[a-zA-ZÀ-ÿ]{3,}/g) ?? []).length >= 5
}

export function scorePage(text: string): number {
  const words = text.toLowerCase().match(/[a-zæøåäöé]+/g) ?? []
  const set = new Set(KEYWORDS)
  let score = 0
  for (const w of words) if (set.has(w)) score++
  // A row of "50 g", "4 mm", "150 m" is the material block, even without the words.
  score += (text.match(/\d+\s?(g|gram|mm|m)\b/gi) ?? []).length
  return score
}

// Page 1 always (title, designer, often the material block). Then the pages that score
// highest, back in reading order, within the page and character caps.
export function planPages(pages: PageText[]): PagePlan {
  const all = pages.map(p => p.text).join('\n')
  if (!hasReadableText(all)) {
    return { mode: 'images', pages: pages.slice(0, MAX_IMAGE_PAGES).map(p => p.page) }
  }
  const rest = pages.slice(1)
    .map(p => ({ ...p, score: scorePage(p.text) }))
    .filter(p => p.score >= 3)
    .sort((a, b) => b.score - a.score || a.page - b.page)
  const chosen: number[] = []
  let chars = 0
  for (const p of [...pages.slice(0, 1), ...rest]) {
    if (chosen.length >= MAX_TEXT_PAGES) break
    if (chars + p.text.length > MAX_TEXT_CHARS && chosen.length > 0) continue
    chosen.push(p.page)
    chars += p.text.length
  }
  return { mode: 'text', pages: chosen.sort((a, b) => a - b) }
}

// ── Normalising ─────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>

const asObj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? v as Raw : {})
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t || null
}
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null
const int = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && Number.isInteger(n) ? n : null
}
const bool = (v: unknown) => v === true
const texts = (v: unknown) => [...new Set(asArr(v).map(text).filter((t): t is string => !!t))]
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : null

function unitOf(v: unknown): Unit | null {
  const u = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (['g', 'gram', 'grams', 'gr'].includes(u)) return 'g'
  if (['skeins', 'skein', 'nøster', 'nøste', 'balls', 'ball'].includes(u)) return 'skeins'
  return null
}

// Turns Claude's answer into what strikk_save_extraction stores. Anything that does not
// fit (a bad enum, an index that points nowhere) is dropped or nulled and the place is
// added to uncertain_fields, so the review shows it instead of the save failing.
export function normalizeExtraction(input: unknown): ExtractionData {
  const r = asObj(input)
  const uncertain = new Set(texts(r.uncertain_fields))
  const flag = (f: string) => uncertain.add(f)

  const sizes: SizeData[] = []
  for (const s of asArr(r.sizes)) {
    const label = text(asObj(s).label)
    if (label) sizes.push({ label, uncertain: bool(asObj(s).uncertain) })
  }

  const yarn_lines: YarnLineData[] = []
  const lineIndex = new Map<number, number>()
  asArr(r.yarn_lines).forEach((l, i) => {
    const o = asObj(l)
    const yarn_name = text(o.yarn_name)
    if (!yarn_name) { flag('yarn_lines'); return }
    const group = int(o.color_group)
    const strands = int(o.strands)
    const fields = new Set(texts(o.uncertain_fields))
    if (group === null || group < 0) fields.add('color_group')
    if (strands === null || strands < 1) fields.add('strands')
    lineIndex.set(i, yarn_lines.length)
    yarn_lines.push({
      color_group: group !== null && group >= 0 ? group : 0,
      color_label: text(o.color_label),
      yarn_name,
      brand: text(o.brand),
      meterage_m: num(o.meterage_m),
      skein_weight_g: num(o.skein_weight_g),
      fiber: text(o.fiber),
      strands: strands !== null && strands >= 1 ? strands : 1,
      uncertain_fields: [...fields],
    })
  })
  const line = (v: unknown): number | null | undefined => {
    if (v === null || v === undefined) return null
    const i = int(v)
    return i !== null && lineIndex.has(i) ? lineIndex.get(i)! : undefined
  }

  const amounts: AmountData[] = []
  for (const a of asArr(r.amounts)) {
    const o = asObj(a)
    const size = int(o.size)
    const unit = unitOf(o.unit)
    if (size === null || size < 0 || size >= sizes.length || !unit) { flag('amounts'); continue }
    let yarn_line = line(o.yarn_line)
    let uncertainAmount = bool(o.uncertain)
    if (yarn_line === undefined) { yarn_line = null; uncertainAmount = true }
    const group = yarn_line !== null ? yarn_lines[yarn_line].color_group : int(o.color_group) ?? 0
    const candidates = texts(o.candidates)
    amounts.push({
      size,
      color_group: group,
      yarn_line,
      amount: num(o.amount),
      unit,
      candidates,
      needs_choice: bool(o.needs_choice) || (yarn_line === null && candidates.length > 1),
      uncertain: uncertainAmount,
    })
  }

  const alternatives: AlternativeData[] = []
  for (const a of asArr(r.alternatives)) {
    const o = asObj(a)
    const yarn_name = text(o.yarn_name)
    if (!yarn_name) continue
    let yarn_line = line(o.yarn_line)
    let uncertainAlt = bool(o.uncertain)
    if (yarn_line === undefined) { yarn_line = null; uncertainAlt = true }
    alternatives.push({
      color_group: yarn_line !== null ? yarn_lines[yarn_line].color_group : int(o.color_group),
      yarn_line,
      yarn_name,
      brand: text(o.brand),
      meterage_m: num(o.meterage_m),
      skein_weight_g: num(o.skein_weight_g),
      fiber: text(o.fiber),
      uncertain: uncertainAlt,
    })
  }

  const accessories: AccessoryData[] = []
  for (const a of asArr(r.accessories)) {
    const o = asObj(a)
    const kind = pick(o.kind, ACCESSORY_KINDS) ?? 'other'
    let size = o.size === null || o.size === undefined ? null : int(o.size)
    let uncertainAcc = bool(o.uncertain) || kind !== o.kind
    if (size !== null && (size < 0 || size >= sizes.length)) { size = null; uncertainAcc = true }
    accessories.push({
      size,
      kind,
      description: text(o.description),
      quantity: num(o.quantity),
      dimension: text(o.dimension),
      uncertain: uncertainAcc,
    })
  }

  const audience = pick(r.audience, AUDIENCES)
  if (r.audience != null && !audience) flag('audience')

  return {
    title: text(r.title),
    designer: text(r.designer),
    audience,
    garment_type: text(r.garment_type)?.toLowerCase() ?? null,
    is_collection: bool(r.is_collection),
    collection_titles: texts(r.collection_titles),
    variants: texts(r.variants),
    sizes,
    yarn_lines,
    amounts,
    alternatives,
    gauge_stitches_10cm: num(r.gauge_stitches_10cm),
    gauge_rows_10cm: num(r.gauge_rows_10cm),
    gauge_note: text(r.gauge_note),
    needles: texts(r.needles),
    accessories,
    uncertain_fields: [...uncertain],
  }
}

// ── Stored rows back to the editable shape ──────────────────────────────────────────

export const EXTRACTION_SELECT =
  'id, title, designer, file_name, drive_file_id, created_at, extraction_status, extraction_error, ' +
  'extracted_at, approved_at, extracted_title, extracted_designer, audience, garment_type, ' +
  'gauge_stitches_10cm, gauge_rows_10cm, gauge_note, needles, variants, is_collection, ' +
  'collection_titles, uncertain_fields, ' +
  'strikk_size(*), strikk_yarn_line(*), strikk_yarn_amount(*), strikk_yarn_alternative(*), strikk_accessory(*)'

export interface StoredRecipe {
  id: string
  title: string
  designer: string | null
  file_name: string
  drive_file_id: string
  created_at: string
  extraction_status: 'pending' | 'extracted' | 'failed' | 'approved'
  extraction_error: string | null
  extracted_at: string | null
  approved_at: string | null
  extracted_title: string | null
  extracted_designer: string | null
  audience: Audience | null
  garment_type: string | null
  gauge_stitches_10cm: number | null
  gauge_rows_10cm: number | null
  gauge_note: string | null
  needles: string[] | null
  variants: string[] | null
  is_collection: boolean
  collection_titles: string[] | null
  uncertain_fields: string[] | null
  strikk_size: { id: string; position: number; label: string; uncertain: boolean }[]
  strikk_yarn_line: (Omit<YarnLineData, 'uncertain_fields'> & { id: string; position: number; uncertain_fields: string[] | null })[]
  strikk_yarn_amount: { size_id: string; color_group: number; yarn_line_id: string | null; amount: number | null; unit: Unit; candidates: string[] | null; needs_choice: boolean; uncertain: boolean }[]
  strikk_yarn_alternative: { yarn_line_id: string | null; color_group: number | null; yarn_name: string; brand: string | null; meterage_m: number | null; skein_weight_g: number | null; fiber: string | null; source: 'pattern' | 'app'; uncertain: boolean }[]
  strikk_accessory: { size_id: string | null; kind: AccessoryKind; description: string | null; quantity: number | null; dimension: string | null; uncertain: boolean }[]
}

// Title and designer start from the recipe row (the curated names), not from what
// Claude read; the review shows both when they differ.
export function storedToExtraction(r: StoredRecipe): ExtractionData {
  const sizes = [...(r.strikk_size ?? [])].sort((a, b) => a.position - b.position)
  const lines = [...(r.strikk_yarn_line ?? [])].sort((a, b) => a.position - b.position)
  const sizeIx = new Map(sizes.map((s, i) => [s.id, i]))
  const lineIx = new Map(lines.map((l, i) => [l.id, i]))
  const n = (v: number | string | null) => (v === null || v === undefined ? null : Number(v))
  return {
    title: r.title,
    designer: r.designer,
    audience: r.audience,
    garment_type: r.garment_type,
    is_collection: r.is_collection,
    collection_titles: r.collection_titles ?? [],
    variants: r.variants ?? [],
    sizes: sizes.map(s => ({ label: s.label, uncertain: s.uncertain })),
    yarn_lines: lines.map(l => ({
      color_group: l.color_group, color_label: l.color_label, yarn_name: l.yarn_name, brand: l.brand,
      meterage_m: n(l.meterage_m), skein_weight_g: n(l.skein_weight_g), fiber: l.fiber, strands: l.strands,
      uncertain_fields: l.uncertain_fields ?? [],
    })),
    amounts: (r.strikk_yarn_amount ?? [])
      .filter(a => sizeIx.has(a.size_id))
      .map(a => ({
        size: sizeIx.get(a.size_id)!, color_group: a.color_group,
        yarn_line: a.yarn_line_id && lineIx.has(a.yarn_line_id) ? lineIx.get(a.yarn_line_id)! : null,
        amount: n(a.amount), unit: a.unit, candidates: a.candidates ?? [], needs_choice: a.needs_choice, uncertain: a.uncertain,
      }))
      .sort((a, b) => a.size - b.size || a.color_group - b.color_group || (a.yarn_line ?? -1) - (b.yarn_line ?? -1)),
    alternatives: (r.strikk_yarn_alternative ?? [])
      .filter(a => a.source === 'pattern')
      .map(a => ({
        color_group: a.color_group, yarn_line: a.yarn_line_id && lineIx.has(a.yarn_line_id) ? lineIx.get(a.yarn_line_id)! : null,
        yarn_name: a.yarn_name, brand: a.brand, meterage_m: n(a.meterage_m), skein_weight_g: n(a.skein_weight_g), fiber: a.fiber, uncertain: a.uncertain,
      })),
    gauge_stitches_10cm: n(r.gauge_stitches_10cm),
    gauge_rows_10cm: n(r.gauge_rows_10cm),
    gauge_note: r.gauge_note,
    needles: r.needles ?? [],
    accessories: (r.strikk_accessory ?? []).map(a => ({
      size: a.size_id && sizeIx.has(a.size_id) ? sizeIx.get(a.size_id)! : null,
      kind: a.kind, description: a.description, quantity: n(a.quantity), dimension: a.dimension, uncertain: a.uncertain,
    })),
    uncertain_fields: r.uncertain_fields ?? [],
  }
}

// Approved data has been looked at, so nothing in it is uncertain any more. needs_choice
// stays: it is a fact about the pattern, cleared only by picking the yarn.
export function clearUncertain(d: ExtractionData): ExtractionData {
  return {
    ...d,
    uncertain_fields: [],
    sizes: d.sizes.map(s => ({ ...s, uncertain: false })),
    yarn_lines: d.yarn_lines.map(l => ({ ...l, uncertain_fields: [] })),
    amounts: d.amounts.map(a => ({ ...a, uncertain: false })),
    alternatives: d.alternatives.map(a => ({ ...a, uncertain: false })),
    accessories: d.accessories.map(a => ({ ...a, uncertain: false })),
  }
}

// Removing a size or a yarn line in the review shifts the indexes that point past it.
export function removeSize(d: ExtractionData, i: number): ExtractionData {
  const shift = (s: number) => (s > i ? s - 1 : s)
  return {
    ...d,
    sizes: d.sizes.filter((_, k) => k !== i),
    amounts: d.amounts.filter(a => a.size !== i).map(a => ({ ...a, size: shift(a.size) })),
    accessories: d.accessories.filter(a => a.size !== i).map(a => ({ ...a, size: a.size === null ? null : shift(a.size) })),
  }
}

export function removeYarnLine(d: ExtractionData, i: number): ExtractionData {
  const shift = (l: number | null) => (l === null || l === i ? null : l > i ? l - 1 : l)
  return {
    ...d,
    yarn_lines: d.yarn_lines.filter((_, k) => k !== i),
    amounts: d.amounts.map(a => ({ ...a, yarn_line: shift(a.yarn_line) })),
    alternatives: d.alternatives.map(a => ({ ...a, yarn_line: shift(a.yarn_line) })),
  }
}

// Picking which yarn a shared amount is for. A candidate that is one of the colour's
// yarn lines links to it; any other (a substitute yarn) is kept as the only candidate.
export function chooseAmountYarn(d: ExtractionData, amountIndex: number, candidate: string): ExtractionData {
  return {
    ...d,
    amounts: d.amounts.map((a, k) => {
      if (k !== amountIndex) return a
      const line = d.yarn_lines.findIndex(l => l.color_group === a.color_group && l.yarn_name === candidate)
      return line >= 0
        ? { ...a, yarn_line: line, candidates: [], needs_choice: false }
        : { ...a, yarn_line: null, candidates: [candidate], needs_choice: false }
    }),
  }
}

// Colour groups with more than one yarn: knitted together.
export function heldTogether(lines: YarnLineData[]): Map<number, YarnLineData[]> {
  const groups = new Map<number, YarnLineData[]>()
  for (const l of lines) groups.set(l.color_group, [...(groups.get(l.color_group) ?? []), l])
  return new Map([...groups].filter(([, ls]) => ls.length > 1))
}

// «Oppskrift - Designer.pdf», or «Oppskrift.pdf». Slashes and other characters Drive or
// a download would trip on become spaces; a dash with spaces in the title would make
// the name read as title + designer, so it is replaced.
export function driveFileName(title: string | null, designer: string | null, fallback: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim()
  const t = clean(title ?? '') || clean(fallback.replace(/\.pdf$/i, '')) || 'Oppskrift'
  const d = clean(designer ?? '')
  return d ? `${t} - ${d}.pdf` : `${t}.pdf`
}
