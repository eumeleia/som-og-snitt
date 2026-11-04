import { describe, it, expect, vi } from 'vitest'
import {
  EXTRACTION_SCHEMA,
  chooseAmountYarn,
  clearUncertain,
  driveFileName,
  hasReadableText,
  heldTogether,
  normalizeExtraction,
  planPages,
  removeSize,
  removeYarnLine,
  storedToExtraction,
  type StoredRecipe,
} from './extraction'
import { nextBatch, runExtractionBatch, type ExtractionStatus } from './extract-client'
import { SIMULATED_ANSWER } from './extraction.fixture'

describe('normalizeExtraction', () => {
  it('keeps every field for a pattern with several sizes and colours', () => {
    const d = normalizeExtraction(SIMULATED_ANSWER)
    expect(d).toMatchObject({ title: 'Rein genser', designer: 'Ber-Lin Design', audience: 'woman', garment_type: 'genser' })
    expect(d.sizes.map(s => s.label)).toEqual(['S', 'M', 'L', 'XL'])
    expect(d.sizes[3].uncertain).toBe(true)
    expect(d.yarn_lines).toHaveLength(3)
    expect(d.yarn_lines[2].strands).toBe(2)
    expect(d.amounts).toHaveLength(9)
    expect(d.amounts.filter(a => a.size === 2).map(a => [a.yarn_line, a.amount, a.unit])).toEqual([[0, 350, 'g'], [1, 4, 'skeins']])
    expect(d.amounts[8]).toMatchObject({ yarn_line: null, needs_choice: true, candidates: ['Peer Gynt', 'Smart'] })
    expect(d.alternatives[0]).toMatchObject({ yarn_name: 'Tynn Merinoull', yarn_line: 0, color_group: 0 })
    expect(d).toMatchObject({ gauge_stitches_10cm: 22, gauge_rows_10cm: 30, gauge_note: 'glattstrikk på p 4' })
    expect(d.needles).toHaveLength(2)
    expect(d.accessories.map(a => [a.kind, a.size, a.quantity, a.dimension])).toEqual([['buttons', null, 7, '15 mm'], ['zipper', 3, 1, '60 cm']])
    expect(d.variants).toEqual(['Kort', 'Lang'])
    expect(d.uncertain_fields).toEqual(['gauge_rows_10cm'])
    expect(d.yarn_lines[1].uncertain_fields).toEqual(['meterage_m'])
  })

  it('shows yarns knitted together as a pair', () => {
    const pairs = heldTogether(normalizeExtraction(SIMULATED_ANSWER).yarn_lines)
    expect([...pairs.keys()]).toEqual([0])
    expect(pairs.get(0)!.map(l => l.yarn_name)).toEqual(['Sunday', 'Tynn Silk Mohair'])
  })

  it('drops or nulls what does not fit and marks it uncertain instead of failing', () => {
    const d = normalizeExtraction({
      ...SIMULATED_ANSWER,
      audience: 'baby',
      amounts: [
        { size: 9, color_group: 0, yarn_line: 0, amount: 1, unit: 'g' },
        { size: 0, color_group: 0, yarn_line: 7, amount: 1, unit: 'nøster' },
      ],
      accessories: [{ size: 12, kind: 'hooks', quantity: 3 }],
    })
    expect(d.audience).toBeNull()
    expect(d.uncertain_fields).toEqual(expect.arrayContaining(['audience', 'amounts']))
    expect(d.amounts).toEqual([expect.objectContaining({ size: 0, yarn_line: null, unit: 'skeins', uncertain: true })])
    expect(d.accessories[0]).toMatchObject({ kind: 'other', size: null, uncertain: true })
  })

  it('survives a non-object answer', () => {
    expect(normalizeExtraction(null)).toMatchObject({ title: null, sizes: [], yarn_lines: [] })
  })

  it('clearUncertain removes every mark but keeps the open choice', () => {
    const d = clearUncertain(normalizeExtraction(SIMULATED_ANSWER))
    expect(d.uncertain_fields).toEqual([])
    expect(d.sizes.some(s => s.uncertain)).toBe(false)
    expect(d.yarn_lines.some(l => l.uncertain_fields.length)).toBe(false)
    expect(d.amounts[8].needs_choice).toBe(true)
  })
})

describe('EXTRACTION_SCHEMA', () => {
  it('closes every object and requires every key, as structured outputs need', () => {
    const walk = (s: unknown): void => {
      if (!s || typeof s !== 'object') return
      const o = s as Record<string, unknown>
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false)
        expect((o.required as string[]).sort()).toEqual(Object.keys(o.properties as object).sort())
      }
      Object.values(o).forEach(walk)
    }
    walk(EXTRACTION_SCHEMA)
  })
})

describe('planPages', () => {
  const filler = 'Strikk videre rundt i glattstrikk til arbeidet måler ønsket lengde og fell av løst. '
  it('sends page 1 and the material pages as text', () => {
    const pages = [
      { page: 1, text: 'Rein genser. ' + filler.repeat(3) },
      { page: 2, text: 'Størrelser S M L. Garn: Sunday 50 g = 235 m. Garnforbruk 300 g. Pinner 4 mm. Strikkefasthet 22 m. Knapper 7.' },
      { page: 3, text: filler.repeat(10) },
      { page: 4, text: 'Diagram A' },
    ]
    expect(planPages(pages)).toEqual({ mode: 'text', pages: [1, 2] })
  })

  it('caps the number of text pages', () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ page: i + 1, text: 'Garn 50 g 100 m pinner 4 mm størrelse nøster. ' + filler }))
    expect(planPages(pages).pages).toHaveLength(8)
  })

  it('sends the first pages as images when the PDF is a scan without text', () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ page: i + 1, text: i === 0 ? '52' : '' }))
    expect(planPages(pages)).toEqual({ mode: 'images', pages: [1, 2, 3, 4] })
    expect(hasReadableText('52 53')).toBe(false)
  })
})

describe('driveFileName', () => {
  it('names the file «Oppskrift - Designer.pdf»', () => {
    expect(driveFileName('Rein genser', 'Ber-Lin Design', 'x.pdf')).toBe('Rein genser - Ber-Lin Design.pdf')
  })
  it('uses only the title when the designer is missing', () => {
    expect(driveFileName('Tusseladd genser', null, 'x.pdf')).toBe('Tusseladd genser.pdf')
  })
  it('falls back to the uploaded name without a title, and cleans characters that break names', () => {
    expect(driveFileName(null, 'A/S Garn', 'IMG_1.pdf')).toBe('IMG_1 - A S Garn.pdf')
    expect(driveFileName('Puf - Pandababy', 'PifPaf', 'x.pdf')).toBe('Puf Pandababy - PifPaf.pdf')
  })
})

describe('nextBatch', () => {
  const rows = (statuses: string[]) => statuses.map((s, i) => ({
    id: `r${i}`, extraction_status: s as ExtractionStatus, created_at: `2026-11-04T10:${String(i).padStart(2, '0')}:00Z`,
  }))
  it('reads ten first when nothing has been read yet', () => {
    expect(nextBatch(rows(Array(170).fill('pending')))).toHaveLength(10)
  })
  it('reads the rest, failed ones included, on the next press', () => {
    const r = rows([...Array(8).fill('extracted'), 'approved', 'failed', ...Array(160).fill('pending')])
    const b = nextBatch(r)
    expect(b).toHaveLength(161)
    expect(b[0].id).toBe('r9')
    expect(b.some(x => x.extraction_status === 'approved' || x.extraction_status === 'extracted')).toBe(false)
  })
})

describe('runExtractionBatch', () => {
  it('runs everything, keeps going past a failure, and limits how many run at once', async () => {
    let running = 0, peak = 0
    const extract = vi.fn(async (n: number) => {
      running++; peak = Math.max(peak, running)
      await new Promise(r => setTimeout(r, 1))
      running--
      if (n === 3) throw new Error('Uttrekket feilet (500)')
      return { status: 'extracted' as const }
    })
    const done: number[] = []
    const results = await runExtractionBatch([1, 2, 3, 4, 5, 6, 7], extract, { concurrency: 3, onDone: (_r, d) => done.push(d) })
    expect(results).toHaveLength(7)
    expect(results.filter(r => !r.ok).map(r => r.item)).toEqual([3])
    expect(peak).toBe(3)
    expect(done.at(-1)).toBe(7)
  })

  it('stops starting new ones when aborted, and lets the started ones finish', async () => {
    const ctrl = new AbortController()
    const started: number[] = []
    const results = await runExtractionBatch(Array.from({ length: 10 }, (_, i) => i), async n => {
      started.push(n)
      if (n === 1) ctrl.abort()
      await new Promise(r => setTimeout(r, 1))
      return { status: 'extracted' as const }
    }, { concurrency: 2, signal: ctrl.signal })
    expect(started).toEqual([0, 1])
    expect(results.every(r => r.ok)).toBe(true)
  })
})

describe('storedToExtraction', () => {
  // Stores the data the way strikk_save_extraction does (ids, positions, size and line
  // ids instead of indexes), shuffled, then reads it back.
  it('reads stored rows back into the same data, with an app suggestion left out', () => {
    const d = normalizeExtraction(SIMULATED_ANSWER)
    const sizeIds = d.sizes.map((_, i) => `s${i}`)
    const lineIds = d.yarn_lines.map((_, i) => `l${i}`)
    const stored: StoredRecipe = {
      id: 'r1', title: d.title!, designer: d.designer, file_name: 'x.pdf', drive_file_id: 'f', created_at: '',
      extraction_status: 'extracted', extraction_error: null, extracted_at: null, approved_at: null,
      extracted_title: d.title, extracted_designer: d.designer, audience: d.audience, garment_type: d.garment_type,
      gauge_stitches_10cm: d.gauge_stitches_10cm, gauge_rows_10cm: d.gauge_rows_10cm, gauge_note: d.gauge_note,
      needles: d.needles, variants: d.variants, is_collection: d.is_collection, collection_titles: d.collection_titles,
      uncertain_fields: d.uncertain_fields,
      strikk_size: d.sizes.map((s, i) => ({ id: sizeIds[i], position: i, ...s })).reverse(),
      strikk_yarn_line: d.yarn_lines.map((l, i) => ({ id: lineIds[i], position: i, ...l })).reverse(),
      strikk_yarn_amount: d.amounts.map(a => ({
        size_id: sizeIds[a.size], color_group: a.color_group, yarn_line_id: a.yarn_line === null ? null : lineIds[a.yarn_line],
        amount: a.amount, unit: a.unit, candidates: a.candidates, needs_choice: a.needs_choice, uncertain: a.uncertain,
      })).reverse(),
      strikk_yarn_alternative: [
        ...d.alternatives.map(a => ({ ...a, yarn_line_id: a.yarn_line === null ? null : lineIds[a.yarn_line], source: 'pattern' as const })),
        { yarn_line_id: null, color_group: 0, yarn_name: 'App-forslag', brand: null, meterage_m: null, skein_weight_g: null, fiber: null, source: 'app' as const, uncertain: false },
      ],
      strikk_accessory: d.accessories.map(a => ({ ...a, size_id: a.size === null ? null : sizeIds[a.size] })),
    }
    const back = storedToExtraction(stored)
    const strip = <T extends object>(xs: T[]) => xs.map(x => Object.fromEntries(Object.entries(x).filter(([k]) => !['yarn_line_id', 'size_id', 'source'].includes(k))))
    const byPlace = [...d.amounts].sort((a, b) => a.size - b.size || a.color_group - b.color_group || (a.yarn_line ?? -1) - (b.yarn_line ?? -1))
    expect(back).toEqual({ ...d, amounts: byPlace, alternatives: strip(d.alternatives), accessories: strip(d.accessories) })
  })
})

describe('review edits', () => {
  const d = () => normalizeExtraction(SIMULATED_ANSWER)
  it('removing a size drops its amounts and shifts the rest', () => {
    const r = removeSize(d(), 1)
    expect(r.sizes.map(s => s.label)).toEqual(['S', 'L', 'XL'])
    expect(r.amounts.filter(a => a.size === 1).map(a => a.amount)).toEqual([350, 4])
    expect(r.accessories.map(a => a.size)).toEqual([null, 2])
  })
  it('removing a yarn line unlinks its amounts and shifts the later lines', () => {
    const r = removeYarnLine(d(), 0)
    expect(r.yarn_lines.map(l => l.yarn_name)).toEqual(['Tynn Silk Mohair', 'Peer Gynt'])
    expect(r.amounts.filter(a => a.size === 0).map(a => a.yarn_line)).toEqual([null, 0, null])
    expect(r.alternatives[0].yarn_line).toBeNull()
  })
  it('choosing the yarn for a shared amount links it to the line, or keeps a substitute by name', () => {
    expect(chooseAmountYarn(d(), 8, 'Peer Gynt').amounts[8]).toMatchObject({ yarn_line: 2, needs_choice: false, candidates: [] })
    expect(chooseAmountYarn(d(), 8, 'Smart').amounts[8]).toMatchObject({ yarn_line: null, needs_choice: false, candidates: ['Smart'] })
  })
})
