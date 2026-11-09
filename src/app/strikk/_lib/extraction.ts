// Recipe data extraction for Strikk: the answer format and reading rules, which PDF pages
// matter, and normalising an answer into the shape that strikk_save_extraction
// (migrations 014–016) stores. The reading itself is done locally by Claude Code with
// scripts/strikk (see docs/strikk-innlesing.md); nothing here calls an API. Pure, with
// no imports, so the tests, the browser and the Node scripts can all load it.

export const AUDIENCES = ['woman', 'man', 'unisex', 'child', 'interior', 'other'] as const
export const ACCESSORY_KINDS = ['buttons', 'zipper', 'elastic', 'other'] as const
export const UNITS = ['g', 'skeins'] as const

export type Audience = typeof AUDIENCES[number]
export type AccessoryKind = typeof ACCESSORY_KINDS[number]
export type Unit = typeof UNITS[number]

export interface SizeData { label: string; uncertain: boolean; uncertain_reason: string | null }
export interface YarnLineData extends YarnLink {
  color_group: number
  color_label: string | null
  yarn_name: string
  brand: string | null
  meterage_m: number | null
  skein_weight_g: number | null
  fiber: string | null
  strands: number
  uncertain_fields: string[]
  uncertain_reasons: Record<string, string>
}

// The link to the yarn catalogue (strikk_yarn), set by scripts/strikk/yarns.mjs link. It
// travels with the line through edits so the save function can keep it.
export interface YarnLink {
  yarn_id: string | null
  yarn_link_uncertain: boolean
  yarn_link_reason: string | null
}
export interface AmountData {
  size: number
  color_group: number
  yarn_line: number | null
  // A range «200–250 g» is amount 200, amount_max 250. Single amounts: amount_max null.
  amount: number | null
  amount_max: number | null
  unit: Unit
  candidates: string[]
  needs_choice: boolean
  uncertain: boolean
  uncertain_reason: string | null
}
export interface AlternativeData extends YarnLink {
  color_group: number | null
  yarn_line: number | null
  yarn_name: string
  brand: string | null
  meterage_m: number | null
  skein_weight_g: number | null
  fiber: string | null
  uncertain: boolean
  uncertain_reason: string | null
}
export interface AccessoryData {
  size: number | null
  kind: AccessoryKind
  description: string | null
  quantity: number | null
  dimension: string | null
  uncertain: boolean
  uncertain_reason: string | null
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
  // PDF page with the yarn amounts, from the «Side N» labels.
  amounts_page: number | null
  uncertain_fields: string[]
  uncertain_reasons: Record<string, string>
}

// ── Output schema ───────────────────────────────────────────────────────────────────
// Structured-output subset: every object closed, every key required, no unions (the API
// caps them at 16). A missing value is an empty value instead: "" for text, 0 for a
// measure, -1 for "no index", and the normaliser turns those back into null.
//
// Kept small because the API compiles it into a grammar with a size cap: sizes are plain
// strings, and all uncertainty is one list of {field, reason} with a path into the answer
// ("amounts[7]", "yarn_lines[1].meterage_m"), instead of flags on every item. The
// normaliser spreads it back onto the items, so the stored data has the same shape.

const str = { type: 'string' }
const measureSchema = { type: 'number', description: '0 when the pattern does not say' }
const indexSchema = { type: 'integer', description: '-1 for none' }
const strArr = { type: 'array', items: str }
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const list = (properties: Record<string, unknown>) => ({ type: 'array', items: obj(properties) })

export const EXTRACTION_SCHEMA = obj({
  title: str,
  designer: str,
  audience: { type: 'string', enum: [...AUDIENCES, ''] },
  garment_type: str,
  is_collection: { type: 'boolean' },
  collection_titles: strArr,
  variants: strArr,
  sizes: strArr,
  yarn_lines: list({
    color_group: { type: 'integer' },
    color_label: str,
    yarn_name: str,
    brand: str,
    meterage_m: measureSchema,
    skein_weight_g: measureSchema,
    fiber: str,
    strands: { type: 'integer' },
  }),
  amounts: list({
    size: { type: 'integer' },
    color_group: { type: 'integer' },
    yarn_line: indexSchema,
    amount: measureSchema,
    amount_max: measureSchema,
    unit: { type: 'string', enum: [...UNITS] },
    candidates: strArr,
  }),
  alternatives: list({
    color_group: indexSchema,
    yarn_line: indexSchema,
    yarn_name: str,
    brand: str,
    meterage_m: measureSchema,
    skein_weight_g: measureSchema,
    fiber: str,
  }),
  gauge_stitches_10cm: measureSchema,
  gauge_rows_10cm: measureSchema,
  gauge_note: str,
  needles: strArr,
  accessories: list({
    size: indexSchema,
    kind: { type: 'string', enum: [...ACCESSORY_KINDS] },
    description: str,
    quantity: measureSchema,
    dimension: str,
  }),
  amounts_page: { type: 'integer', description: '0 when unknown' },
  uncertain: list({ field: str, reason: str }),
})

export const EXTRACTION_PROMPT = `You read knitting patterns (usually Norwegian, sometimes English or Danish) and extract the material and size data into the JSON schema. Read only what the pattern states. Never fill a field from general knitting knowledge. When the pattern does not say, leave the field empty: "" for text (audience too), 0 for a number, -1 for an index (yarn_line, size, color_group), [] for a list.

Fields:
- title, designer: as written in the pattern, without model codes, article numbers or dates.
- audience: woman, man, unisex, child, interior or other. Baby and child sizes are child. Use unisex only when the pattern says it or gives both women's and men's sizes. interior is for things for the home that are not worn: blankets (pledd, tepper), cushions (puter), baskets (kurver), dishcloths (kluter). other is for what fits none of these, e.g. decorations; soft toys are child when made for babies or children, otherwise other.
- garment_type: one Norwegian word in lower case, e.g. genser, jakke, vest, lue, votter, sokker, skjerf, kjole, bukse, teppe, sett, kosedyr.
- variants: named variants of the same pattern (e.g. "med hette", "kort", "V-hals").
- is_collection: true when the PDF holds several separate patterns (a booklet, e-book or catalogue). Then title is the name of the collection itself and collection_titles lists the patterns in it. A collection gets no sizes and no amounts (both []), and their absence is not uncertain. Give yarn lines, gauge, needles and accessories only when the whole collection shares them.
- sizes: the size labels in the order the pattern lists them, as written ("2 år", "S", "86 cm").
- yarn_lines: one entry per yarn. color_group numbers each colour role from 0 (Farge 1 / hovedfarge / A = 0, the next = 1, ...). Different yarns knitted together in the same colour role share one color_group, e.g. Sunday held together with a strand of Tynn Silk Mohair Kid-Silk = two yarn_lines with the same color_group. Several strands of the same yarn are one yarn_line with strands = the number of strands. A shared color_group always means knitted together: when a pattern offers alternative colourways or versions in different yarns, each version gets its own color_groups (and is named in variants). color_label is the pattern's name for the colour or role. meterage_m is metres per skein, skein_weight_g grams per skein, fiber the fibre content as written.
- amounts: for each size and colour role, the amount exactly as given, in g or skeins (nøster = skeins). Give one entry per yarn_line when the pattern gives an amount per yarn; then yarn_line is that line's index. When the pattern gives one amount for the colour role, yarn_line is -1. When one amount is given for several yarns with different meterage (e.g. "300 g Sunday eller Peer Gynt"), set yarn_line -1 and candidates to those yarn names; otherwise candidates is []. size is the index into sizes. A range such as "200-250 g" is amount 200 and amount_max 250; a single amount has amount_max 0.
- amounts_page: the page number (from the "Side N" labels) where the yarn amounts stand; 0 when you cannot tell.
- alternatives: only the substitute yarns the pattern itself suggests, linked to the yarn_line or color_group they replace (-1 when not tied to one).
- gauge_stitches_10cm, gauge_rows_10cm: stitches and rows/rounds per 10 cm. Convert only exact ratios (e.g. 11 sts = 5 cm -> 22) and then mark the field uncertain. gauge_note: the stitch pattern and needle the gauge is given for.
- needles: every needle size and type as written (e.g. "rundpinne 3,5 mm 80 cm").
- accessories: buttons, zippers, elastic and similar; quantity and dimension as written; size is the size index when it differs per size, -1 when it is the same for all.

Uncertainty: when a value is hard to read, inferred, conflicting, or you are not sure which size or colour it belongs to, still give your best reading and add an entry to uncertain: field is the path to the value in your answer, and reason says briefly in Norwegian (at most about twelve words) why, e.g. "To ulike tall i tabell og tekst". Paths: a top-level field by name ("audience", "gauge_rows_10cm"); a whole item by list and index ("sizes[3]", "amounts[7]", "alternatives[0]", "accessories[1]"); a value on a yarn line by index and field ("yarn_lines[1].meterage_m"). Leave uncertain empty when nothing is uncertain.`

// ── Page choice ─────────────────────────────────────────────────────────────────────

// Letter-spaced display fonts («H e i d i») come out of pdf.js one letter per item.
export function normalizePageText(text: string): string {
  return text
    .replace(
      /([^a-zA-ZÀ-ÿ]|^)([a-zA-ZÀ-ÿ](?:\s+[a-zA-ZÀ-ÿ]){3,})(?![a-zA-ZÀ-ÿ])/g,
      (_m, pre: string, letters: string) => pre + letters.replace(/\s+/g, ''),
    )
    .replace(/[^\S\n]+/g, ' ')
    .trim()
}

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
// The schema sends 0 for a measure the pattern does not give, and -1 for no index.
// null is still read the same way, so answers in the older shape normalise alike.
const measure = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && n > 0 ? n : null
}
const optIndex = (v: unknown): number | null => {
  const i = int(v)
  return i !== null && i >= 0 ? i : null
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

// Uncertainty, wherever it comes from, as field → reason ("" when no reason was given).
// Accepts [{field, reason}] and, from older answers and from the review, plain names.
function marksOf(v: unknown, reasons?: unknown): Map<string, string> {
  const out = new Map<string, string>()
  for (const item of asArr(v)) {
    const field = typeof item === 'string' ? text(item) : text(asObj(item).field)
    if (field && !out.has(field)) out.set(field, (typeof item === 'string' ? null : text(asObj(item).reason)) ?? '')
  }
  for (const [field, reason] of Object.entries(asObj(reasons))) {
    if (out.has(field) && !out.get(field) && typeof reason === 'string') out.set(field, reason)
  }
  return out
}

// The paths in the answer's uncertain list, sorted to where they belong: whole items by
// list and raw index, yarn line values by raw index and field, the rest top-level.
type ItemList = 'sizes' | 'amounts' | 'alternatives' | 'accessories'
interface Marks {
  top: Map<string, string>
  items: Record<ItemList, Map<number, string>>
  lines: Map<number, Map<string, string>>
}
function sortMarks(all: Map<string, string>): Marks {
  const m: Marks = { top: new Map(), items: { sizes: new Map(), amounts: new Map(), alternatives: new Map(), accessories: new Map() }, lines: new Map() }
  for (const [path, reason] of all) {
    const p = path.match(/^(\w+)\[(\d+)\](?:\.(\w+))?$/)
    const list = p?.[1]
    if (p && list === 'yarn_lines') {
      const i = Number(p[2])
      const fields = m.lines.get(i) ?? new Map<string, string>()
      fields.set(p[3] ?? 'yarn_name', reason)
      m.lines.set(i, fields)
    } else if (p && (list === 'sizes' || list === 'amounts' || list === 'alternatives' || list === 'accessories')) {
      m.items[list].set(Number(p[2]), reason)
    } else {
      const field = list ?? path
      if (!m.top.has(field) || !m.top.get(field)) m.top.set(field, reason)
    }
  }
  return m
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function linkOf(o: Raw): YarnLink {
  const id = typeof o.yarn_id === 'string' && UUID.test(o.yarn_id) ? o.yarn_id : null
  return { yarn_id: id, yarn_link_uncertain: o.yarn_link_uncertain === true, yarn_link_reason: text(o.yarn_link_reason) }
}

// A range comes low to high; a reversed one is turned round, equal ends are one amount.
function amountRange(lo: number | null, hi: number | null): { amount: number | null; amount_max: number | null } {
  if (lo === null) return { amount: hi, amount_max: null }
  if (hi === null || hi === lo) return { amount: lo, amount_max: null }
  return hi > lo ? { amount: lo, amount_max: hi } : { amount: hi, amount_max: lo }
}

// An item is uncertain when the answer's list names it or the item says so itself
// (older answers, and the data the review sends back).
function itemMark(own: Raw, listed: string | undefined): { uncertain: boolean; uncertain_reason: string | null } {
  const uncertain = listed !== undefined || bool(own.uncertain)
  return { uncertain, uncertain_reason: uncertain ? text(listed) ?? text(own.uncertain_reason) : null }
}

// Turns Claude's answer into what strikk_save_extraction stores. Anything that does not
// fit (a bad enum, an index that points nowhere) is dropped or nulled and the place is
// marked uncertain with a reason, so the review shows it instead of the save failing.
export function normalizeExtraction(input: unknown): ExtractionData {
  const r = asObj(input)
  const marks = sortMarks(new Map([...marksOf(r.uncertain), ...marksOf(r.uncertain_fields, r.uncertain_reasons)]))
  const top = marks.top
  const flag = (f: string, reason: string) => { if (!top.get(f)) top.set(f, reason) }
  const isCollection = bool(r.is_collection)

  const sizes: SizeData[] = []
  asArr(r.sizes).forEach((s, i) => {
    const o = typeof s === 'string' ? { label: s } : asObj(s)
    const label = text(o.label)
    if (label) sizes.push({ label, ...itemMark(o, marks.items.sizes.get(i)) })
  })

  const yarn_lines: YarnLineData[] = []
  const lineIndex = new Map<number, number>()
  asArr(r.yarn_lines).forEach((l, i) => {
    const o = asObj(l)
    const yarn_name = text(o.yarn_name)
    if (!yarn_name) { flag('yarn_lines', 'Et garn uten navn ble utelatt'); return }
    const group = int(o.color_group)
    const strands = int(o.strands)
    const own = new Map([...marksOf(o.uncertain_fields, o.uncertain_reasons), ...(marks.lines.get(i) ?? [])])
    if (group === null || group < 0) own.set('color_group', own.get('color_group') || 'Mangler farge')
    if (strands === null || strands < 1) own.set('strands', own.get('strands') || 'Antall tråder mangler, satt til 1')
    lineIndex.set(i, yarn_lines.length)
    yarn_lines.push({
      color_group: group !== null && group >= 0 ? group : 0,
      color_label: text(o.color_label),
      yarn_name,
      brand: text(o.brand),
      meterage_m: measure(o.meterage_m),
      skein_weight_g: measure(o.skein_weight_g),
      fiber: text(o.fiber),
      strands: strands !== null && strands >= 1 ? strands : 1,
      uncertain_fields: [...own.keys()],
      uncertain_reasons: Object.fromEntries([...own].filter(([, why]) => why)),
      ...linkOf(o),
    })
  })
  const line = (v: unknown): number | null | undefined => {
    if (v === null || v === undefined || (int(v) ?? 0) < 0) return null
    const i = int(v)
    return i !== null && lineIndex.has(i) ? lineIndex.get(i)! : undefined
  }

  const amounts: AmountData[] = []
  asArr(r.amounts).forEach((a, i) => {
    const o = asObj(a)
    const size = int(o.size)
    const unit = unitOf(o.unit)
    if (size === null || size < 0 || size >= sizes.length || !unit) {
      flag('amounts', 'En mengde uten gyldig størrelse eller enhet ble utelatt')
      return
    }
    let yarn_line = line(o.yarn_line)
    let mark = itemMark(o, marks.items.amounts.get(i))
    if (yarn_line === undefined) { yarn_line = null; mark = { uncertain: true, uncertain_reason: 'Garnet mengden viste til, finnes ikke' } }
    const group = yarn_line !== null ? yarn_lines[yarn_line].color_group : optIndex(o.color_group) ?? 0
    const candidates = texts(o.candidates)
    amounts.push({
      size,
      color_group: group,
      yarn_line,
      ...amountRange(measure(o.amount), measure(o.amount_max)),
      unit,
      candidates,
      // Not asked for any more: an amount for no single yarn with several candidates is a choice.
      needs_choice: bool(o.needs_choice) || (yarn_line === null && candidates.length > 1),
      ...mark,
    })
  })

  const alternatives: AlternativeData[] = []
  asArr(r.alternatives).forEach((a, i) => {
    const o = asObj(a)
    const yarn_name = text(o.yarn_name)
    if (!yarn_name) return
    let yarn_line = line(o.yarn_line)
    let mark = itemMark(o, marks.items.alternatives.get(i))
    if (yarn_line === undefined) { yarn_line = null; mark = { uncertain: true, uncertain_reason: 'Garnet det erstatter, finnes ikke' } }
    alternatives.push({
      color_group: yarn_line !== null ? yarn_lines[yarn_line].color_group : optIndex(o.color_group),
      yarn_line,
      yarn_name,
      brand: text(o.brand),
      meterage_m: measure(o.meterage_m),
      skein_weight_g: measure(o.skein_weight_g),
      fiber: text(o.fiber),
      ...mark,
      ...linkOf(o),
    })
  })

  const accessories: AccessoryData[] = []
  asArr(r.accessories).forEach((a, i) => {
    const o = asObj(a)
    const kind = pick(o.kind, ACCESSORY_KINDS) ?? 'other'
    let size = optIndex(o.size)
    let mark = itemMark(o, marks.items.accessories.get(i))
    if (kind !== o.kind) mark = { uncertain: true, uncertain_reason: 'Ukjent type, satt til annet' }
    if (size !== null && size >= sizes.length) { size = null; mark = { uncertain: true, uncertain_reason: 'Størrelsen finnes ikke, gjelder nå alle' } }
    accessories.push({
      size,
      kind,
      description: text(o.description),
      quantity: measure(o.quantity),
      dimension: text(o.dimension),
      ...mark,
    })
  })

  const audience = pick(r.audience, AUDIENCES)
  if (text(r.audience) && !audience) flag('audience', `Ukjent målgruppe «${text(r.audience)}»`)

  // A catalogue holds several patterns: no sizes or amounts of its own, and their
  // absence is not uncertain.
  if (isCollection) { top.delete('sizes'); top.delete('amounts') }
  return {
    title: text(r.title),
    designer: text(r.designer),
    audience,
    garment_type: text(r.garment_type)?.toLowerCase() ?? null,
    is_collection: isCollection,
    collection_titles: texts(r.collection_titles),
    variants: texts(r.variants),
    sizes: isCollection ? [] : sizes,
    yarn_lines,
    amounts: isCollection ? [] : amounts,
    alternatives,
    gauge_stitches_10cm: measure(r.gauge_stitches_10cm),
    gauge_rows_10cm: measure(r.gauge_rows_10cm),
    gauge_note: text(r.gauge_note),
    needles: texts(r.needles),
    accessories: isCollection ? accessories.map(a => ({ ...a, size: null })) : accessories,
    amounts_page: isCollection ? null : optIndex(r.amounts_page) || null,
    uncertain_fields: [...top.keys()],
    uncertain_reasons: Object.fromEntries([...top].filter(([, why]) => why)),
  }
}

// ── Stored rows back to the editable shape ──────────────────────────────────────────

export const EXTRACTION_SELECT =
  'id, title, designer, file_name, drive_file_id, created_at, extraction_status, extraction_error, ' +
  'extracted_at, approved_at, extracted_title, extracted_designer, audience, garment_type, ' +
  'gauge_stitches_10cm, gauge_rows_10cm, gauge_note, needles, variants, is_collection, ' +
  'collection_titles, uncertain_fields, uncertain_reasons, amounts_page, ' +
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
  uncertain_reasons: Record<string, string> | null
  amounts_page: number | null
  strikk_size: { id: string; position: number; label: string; uncertain: boolean; uncertain_reason: string | null }[]
  strikk_yarn_line: (Omit<YarnLineData, 'uncertain_fields' | 'uncertain_reasons' | keyof YarnLink> & Partial<YarnLink> & { id: string; position: number; uncertain_fields: string[] | null; uncertain_reasons: Record<string, string> | null })[]
  strikk_yarn_amount: { size_id: string; color_group: number; yarn_line_id: string | null; amount: number | null; amount_max: number | null; unit: Unit; candidates: string[] | null; needs_choice: boolean; uncertain: boolean; uncertain_reason: string | null }[]
  strikk_yarn_alternative: ({ yarn_line_id: string | null; color_group: number | null; yarn_name: string; brand: string | null; meterage_m: number | null; skein_weight_g: number | null; fiber: string | null; source: 'pattern' | 'app'; uncertain: boolean; uncertain_reason: string | null } & Partial<YarnLink>)[]
  strikk_accessory: { size_id: string | null; kind: AccessoryKind; description: string | null; quantity: number | null; dimension: string | null; uncertain: boolean; uncertain_reason: string | null }[]
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
    sizes: sizes.map(s => ({ label: s.label, uncertain: s.uncertain, uncertain_reason: s.uncertain_reason ?? null })),
    yarn_lines: lines.map(l => ({
      color_group: l.color_group, color_label: l.color_label, yarn_name: l.yarn_name, brand: l.brand,
      meterage_m: n(l.meterage_m), skein_weight_g: n(l.skein_weight_g), fiber: l.fiber, strands: l.strands,
      uncertain_fields: l.uncertain_fields ?? [], uncertain_reasons: l.uncertain_reasons ?? {},
      yarn_id: l.yarn_id ?? null, yarn_link_uncertain: l.yarn_link_uncertain ?? false, yarn_link_reason: l.yarn_link_reason ?? null,
    })),
    amounts: (r.strikk_yarn_amount ?? [])
      .filter(a => sizeIx.has(a.size_id))
      .map(a => ({
        size: sizeIx.get(a.size_id)!, color_group: a.color_group,
        yarn_line: a.yarn_line_id && lineIx.has(a.yarn_line_id) ? lineIx.get(a.yarn_line_id)! : null,
        amount: n(a.amount), amount_max: n(a.amount_max ?? null), unit: a.unit, candidates: a.candidates ?? [],
        needs_choice: a.needs_choice, uncertain: a.uncertain, uncertain_reason: a.uncertain_reason ?? null,
      }))
      .sort((a, b) => a.size - b.size || a.color_group - b.color_group || (a.yarn_line ?? -1) - (b.yarn_line ?? -1)),
    alternatives: (r.strikk_yarn_alternative ?? [])
      .filter(a => a.source === 'pattern')
      .map(a => ({
        color_group: a.color_group, yarn_line: a.yarn_line_id && lineIx.has(a.yarn_line_id) ? lineIx.get(a.yarn_line_id)! : null,
        yarn_name: a.yarn_name, brand: a.brand, meterage_m: n(a.meterage_m), skein_weight_g: n(a.skein_weight_g), fiber: a.fiber,
        uncertain: a.uncertain, uncertain_reason: a.uncertain_reason ?? null,
        yarn_id: a.yarn_id ?? null, yarn_link_uncertain: a.yarn_link_uncertain ?? false, yarn_link_reason: a.yarn_link_reason ?? null,
      })),
    gauge_stitches_10cm: n(r.gauge_stitches_10cm),
    gauge_rows_10cm: n(r.gauge_rows_10cm),
    gauge_note: r.gauge_note,
    needles: r.needles ?? [],
    accessories: (r.strikk_accessory ?? []).map(a => ({
      size: a.size_id && sizeIx.has(a.size_id) ? sizeIx.get(a.size_id)! : null,
      kind: a.kind, description: a.description, quantity: n(a.quantity), dimension: a.dimension,
      uncertain: a.uncertain, uncertain_reason: a.uncertain_reason ?? null,
    })),
    amounts_page: r.amounts_page ?? null,
    uncertain_fields: r.uncertain_fields ?? [],
    uncertain_reasons: r.uncertain_reasons ?? {},
  }
}

// Approved data has been looked at, so nothing in it is uncertain any more. needs_choice
// stays: it is a fact about the pattern, cleared only by picking the yarn.
export function clearUncertain(d: ExtractionData): ExtractionData {
  return {
    ...d,
    uncertain_fields: [],
    uncertain_reasons: {},
    sizes: d.sizes.map(s => ({ ...s, uncertain: false, uncertain_reason: null })),
    yarn_lines: d.yarn_lines.map(l => ({ ...l, uncertain_fields: [], uncertain_reasons: {} })),
    amounts: d.amounts.map(a => ({ ...a, uncertain: false, uncertain_reason: null })),
    alternatives: d.alternatives.map(a => ({ ...a, uncertain: false, uncertain_reason: null })),
    accessories: d.accessories.map(a => ({ ...a, uncertain: false, uncertain_reason: null })),
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

// «Oppskrift - Designer.pdf», or «Oppskrift.pdf». The title is kept as written, dashes
// too («Ellinor - Flere plagg - Katalog - Viking Garn.pdf»); parseRecipeFileName splits
// on the last dash, so the designer still reads back. Slashes and other characters Drive
// or a download would trip on become spaces.
export function driveFileName(title: string | null, designer: string | null, fallback: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const t = clean(title ?? '') || clean(fallback.replace(/\.pdf$/i, '')) || 'Oppskrift'
  const d = clean(designer ?? '')
  return d ? `${t} - ${d}.pdf` : `${t}.pdf`
}

// ── Amounts as ranges ───────────────────────────────────────────────────────────────

// What the app calculates with: the top of a range.
export function amountForCalc(a: Pick<AmountData, 'amount' | 'amount_max'>): number | null {
  return a.amount_max ?? a.amount
}

const decimal = (n: number) => String(n).replace('.', ',')

export function formatAmount(a: Pick<AmountData, 'amount' | 'amount_max'>): string {
  if (a.amount === null) return ''
  return a.amount_max !== null ? `${decimal(a.amount)}–${decimal(a.amount_max)}` : decimal(a.amount)
}

export const UNIT_LABEL: Record<Unit, string> = { g: 'g', skeins: 'nøster' }

// What can be typed in the review: «250», «2,5», «200-250», «200 – 250». Empty is no
// amount. Anything else is null, so the field can say it is not a number instead of
// quietly saving nothing.
export function parseAmountInput(input: string): { amount: number | null; amount_max: number | null } | null {
  const t = input.trim()
  if (!t) return { amount: null, amount_max: null }
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:[-–—]\s*(\d+(?:[.,]\d+)?))?$/)
  if (!m) return null
  const lo = Number(m[1].replace(',', '.'))
  const hi = m[2] ? Number(m[2].replace(',', '.')) : null
  return amountRange(lo > 0 ? lo : null, hi !== null && hi > 0 ? hi : null)
}

// ── Corrections ─────────────────────────────────────────────────────────────────────
// What changed between the extraction and what was approved, in words Claude can use as
// an example next time. Title and designer are left out: they come from the file names.

export interface Correction { field: string; extracted: string; corrected: string }

export const MAX_CORRECTION_EXAMPLES = 20
const MAX_VALUE = 300
const AUDIENCE_NO: Record<Audience, string> = { woman: 'kvinne', man: 'mann', unisex: 'unisex', child: 'barn', interior: 'interiør', other: 'annet' }
const KIND_NO: Record<AccessoryKind, string> = { buttons: 'knapper', zipper: 'glidelås', elastic: 'elastikk', other: 'annet' }

const groupName = (d: ExtractionData, g: number | null) =>
  g === null ? 'uten farge' : d.yarn_lines.find(l => l.color_group === g)?.color_label || `Farge ${g + 1}`
const lineText = (d: ExtractionData, l: YarnLineData) => [
  `${groupName(d, l.color_group)}: ${l.yarn_name}`,
  l.brand,
  l.meterage_m !== null || l.skein_weight_g !== null ? `${l.meterage_m ?? '?'} m/${l.skein_weight_g ?? '?'} g` : null,
  l.fiber,
  l.strands > 1 ? `${l.strands} tråder` : null,
].filter(Boolean).join(', ')
const amountText = (a: AmountData) => {
  const v = formatAmount(a)
  const base = v ? `${v} ${UNIT_LABEL[a.unit]}` : '—'
  if (a.needs_choice) return `${base} (gjelder ett av: ${a.candidates.join(', ')})`
  if (a.yarn_line === null && a.candidates.length === 1) return `${base} (gjelder ${a.candidates[0]})`
  return base
}
const amountPlace = (d: ExtractionData, a: AmountData) =>
  `${d.sizes[a.size]?.label ?? '?'} / ${a.yarn_line !== null ? d.yarn_lines[a.yarn_line]?.yarn_name ?? '?' : `${groupName(d, a.color_group)} (hele fargen)`}`
const altText = (d: ExtractionData, a: AlternativeData) => [
  a.yarn_name, a.brand,
  a.meterage_m !== null || a.skein_weight_g !== null ? `${a.meterage_m ?? '?'} m/${a.skein_weight_g ?? '?'} g` : null,
  a.fiber,
  `erstatter ${a.yarn_line !== null ? d.yarn_lines[a.yarn_line]?.yarn_name : groupName(d, a.color_group)}`,
].filter(Boolean).join(', ')
const accText = (d: ExtractionData, a: AccessoryData) => [
  KIND_NO[a.kind], a.description, a.quantity !== null ? `${decimal(a.quantity)} stk` : null, a.dimension,
  a.size !== null ? `str. ${d.sizes[a.size]?.label}` : null,
].filter(Boolean).join(', ')

export function corrections(before: ExtractionData, after: ExtractionData): Correction[] {
  const out: Correction[] = []
  const add = (field: string, b: string | null | undefined, a: string | null | undefined) => {
    const x = (b ?? '').trim() || '—'
    const y = (a ?? '').trim() || '—'
    if (x !== y) out.push({ field, extracted: x.slice(0, MAX_VALUE), corrected: y.slice(0, MAX_VALUE) })
  }
  const n = (v: number | null) => (v === null ? '' : decimal(v))
  add('Målgruppe', before.audience && AUDIENCE_NO[before.audience], after.audience && AUDIENCE_NO[after.audience])
  add('Plaggtype', before.garment_type, after.garment_type)
  add('Flere oppskrifter i PDF-en (katalog)', before.is_collection ? 'ja' : 'nei', after.is_collection ? 'ja' : 'nei')
  add('Oppskrifter i katalogen', before.collection_titles.join('; '), after.collection_titles.join('; '))
  add('Varianter', before.variants.join('; '), after.variants.join('; '))
  add('Størrelser', before.sizes.map(s => s.label).join(', '), after.sizes.map(s => s.label).join(', '))
  add('Garn', before.yarn_lines.map(l => lineText(before, l)).join('; '), after.yarn_lines.map(l => lineText(after, l)).join('; '))

  const byPlace = (d: ExtractionData) => {
    const m = new Map<string, string[]>()
    for (const a of d.amounts) m.set(amountPlace(d, a), [...(m.get(amountPlace(d, a)) ?? []), amountText(a)])
    return m
  }
  const bm = byPlace(before)
  const am = byPlace(after)
  for (const place of [...new Set([...am.keys(), ...bm.keys()])]) {
    add(`Garnmengde ${place}`, bm.get(place)?.join(' + '), am.get(place)?.join(' + '))
  }

  add('Garnalternativer', before.alternatives.map(a => altText(before, a)).join('; '), after.alternatives.map(a => altText(after, a)).join('; '))
  add('Strikkefasthet, masker per 10 cm', n(before.gauge_stitches_10cm), n(after.gauge_stitches_10cm))
  add('Strikkefasthet, omganger per 10 cm', n(before.gauge_rows_10cm), n(after.gauge_rows_10cm))
  add('Strikkefasthet, merknad', before.gauge_note, after.gauge_note)
  add('Pinner', before.needles.join('; '), after.needles.join('; '))
  add('Tilbehør', before.accessories.map(a => accText(before, a)).join('; '), after.accessories.map(a => accText(after, a)).join('; '))
  return out
}

export interface CorrectionExample extends Correction { recipe_title: string }

// The extraction instructions with the newest corrections appended as examples.
export function buildExtractionPrompt(examples: CorrectionExample[], limit = MAX_CORRECTION_EXAMPLES): string {
  const list = examples.slice(0, limit)
  if (list.length === 0) return EXTRACTION_PROMPT
  return `${EXTRACTION_PROMPT}

Corrections the user made to earlier extractions, newest first. They show how this user wants patterns read: apply the same reading when the same situation comes up, but take values only from the pattern in front of you, never from these examples.
${list.map(e => `- «${e.recipe_title}», ${e.field}: extracted «${e.extracted}», corrected to «${e.corrected}»`).join('\n')}`
}

// ── Checking an answer against the schema ───────────────────────────────────────────

// Errors in an answer against the subset of JSON Schema used by EXTRACTION_SCHEMA, so a
// hand-written or locally produced answer is held to the same shape as one the API
// returned under structured outputs. Empty when it fits.
export function schemaErrors(schema: Record<string, unknown>, v: unknown, path = '$'): string[] {
  const t = schema.type
  if (schema.enum && !(schema.enum as unknown[]).includes(v)) return [`${path}: ${JSON.stringify(v)} not in enum`]
  if (t === 'string' && typeof v !== 'string') return [`${path}: not a string`]
  if (t === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) return [`${path}: not a number`]
  if (t === 'integer' && !Number.isInteger(v)) return [`${path}: not an integer`]
  if (t === 'boolean' && typeof v !== 'boolean') return [`${path}: not a boolean`]
  if (t === 'array') {
    if (!Array.isArray(v)) return [`${path}: not an array`]
    return v.flatMap((x, i) => schemaErrors(schema.items as Record<string, unknown>, x, `${path}[${i}]`))
  }
  if (t === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return [`${path}: not an object`]
    const o = v as Record<string, unknown>
    const properties = schema.properties as Record<string, Record<string, unknown>>
    return [
      ...(schema.required as string[]).filter(k => !(k in o)).map(k => `${path}.${k}: missing`),
      ...Object.keys(o).filter(k => !(k in properties)).map(k => `${path}.${k}: not allowed`),
      ...Object.entries(o).filter(([k]) => k in properties).flatMap(([k, x]) => schemaErrors(properties[k], x, `${path}.${k}`)),
    ]
  }
  return []
}
