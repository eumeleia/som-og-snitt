import { describe, it, expect, vi, afterEach } from 'vitest'
import ExcelJS from 'exceljs'
import { normalizeExtraction } from './extraction'
import { CATALOGUE_ANSWER, SIMULATED_ANSWER, storedFrom } from './extraction.fixture'
import { normalizeYarn, type YarnRow } from './yarns'
import { OVERVIEW_FILE_NAME, overviewSheets, planOverviewWrite, recipeSheet, yarnSheet, type Sheet } from './overview'
import { workbookBuffer } from '@/lib/strikk-overview'

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

const SUNDAY = '3f2a8b1c-1111-4222-8333-944455556666'
const yarn = (id: string, data: Record<string, unknown>, over: Partial<YarnRow> = {}): YarnRow => ({
  ...normalizeYarn(data), id, aliases: [], has_plastic: null, status: 'looked_up', approved_at: null, created_at: '', updated_at: '', ...over,
})
const catalogue = [
  yarn(SUNDAY, { brand: 'Sandnes Garn', name: 'Sunday', fibers: [{ fiber: 'merinoull', percent: 100 }], skein_weight_g: 50, meterage_m: 235, gauge_stitches_min: 27, gauge_stitches_max: 28, needle_mm_min: 3, needle_mm_max: 3, source_url: 'https://www.sandnesgarn.no/sunday', source_kind: 'manufacturer' }, { has_plastic: false, status: 'approved' }),
  yarn('y2', { brand: 'DROPS', name: 'Air', fibers: [{ fiber: 'alpakka', percent: 65 }, { fiber: 'polyamid', percent: 28 }], drops_group: 'C', discontinued: false }, { has_plastic: true }),
]

const rein = (() => {
  const d = normalizeExtraction(SIMULATED_ANSWER)
  d.yarn_lines[0] = { ...d.yarn_lines[0], brand: 'Sandnes', yarn_name: 'Sunday', yarn_id: SUNDAY }
  return storedFrom(d, { id: 'rein', extraction_status: 'approved', file_name: 'Rein genser - Ber-Lin Design.pdf', drive_file_id: 'pdf1' })
})()
// A stored size on a collection must still give a single row.
const collection = storedFrom(normalizeExtraction(CATALOGUE_ANSWER), {
  id: 'kat', drive_file_id: 'pdf2', strikk_size: [{ id: 's0', position: 0, label: 'x-liten', uncertain: false, uncertain_reason: null }],
})
const unread = { ...storedFrom(normalizeExtraction({ title: 'Ulest' }), { id: 'ulest', extraction_status: 'pending' as const }) }

const byHeader = (s: Sheet, row: number) => Object.fromEntries(s.headers.map((h, i) => [h, s.rows[row][i]]))

describe('Oppskrifter sheet', () => {
  const sheet = recipeSheet([unread, rein, collection], catalogue)
  const rows = sheet.rows.map((_, i) => byHeader(sheet, i))

  it('has a row per size, and one row for a collection and for a recipe not read yet', () => {
    expect(rows.map(r => [r['Oppskrift'], r['Størrelse']])).toEqual([
      ['Alpaca Silk', null],
      ['Rein genser', 'S'], ['Rein genser', 'M'], ['Rein genser', 'L'], ['Rein genser', 'XL'],
      ['Ulest', null],
    ])
    expect(rows[0]['Katalog inneholder']).toBe('Genser og bukse 1111-4; One piece 1111-8')
    expect(rows[5]['Status']).toBe('Ikke lest')
  })

  it('gives yarn and amount per colour, with the catalogue name, ranges and yarns knitted together', () => {
    expect(sheet.headers.slice(6, 10)).toEqual(['Garn 1', 'Mengde 1', 'Garn 2', 'Mengde 2'])
    const s = rows[1]
    expect(s['Garn 1']).toBe('Natur: Sandnes Garn Sunday + Sandnes Garn Tynn Silk Mohair')
    expect(s['Mengde 1']).toBe('250 g + 2 nøster')
    expect(s['Garn 2']).toBe('Rust: Sandnes Garn Peer Gynt (2 tråder)')
    expect(s['Mengde 2']).toBe('100 g')
    expect(rows[2]['Mengde 2']).toBeNull()
    expect(rows[4]['Mengde 1']).toBe('400–450 g + 5 nøster')
    expect(s['Strikkes sammen']).toBe('Natur: Sandnes Garn Sunday + Sandnes Garn Tynn Silk Mohair')
  })

  it('fills needles, gauge, accessories per size, the pattern\'s own alternatives, status and the PDF link', () => {
    const [s, xl] = [rows[1], rows[4]]
    expect(s['Pinner']).toBe('rundpinne 3,5 mm 80 cm, rundpinne 4 mm 80 cm')
    expect(s['Strikkefasthet']).toBe('22 m × 30 p = 10 cm – glattstrikk på p 4')
    expect(s['Tilbehør']).toBe('Knapper: 7 stk, Knapper, 15 mm')
    expect(xl['Tilbehør']).toBe('Knapper: 7 stk, Knapper, 15 mm; Glidelås: 1 stk, Glidelås, 60 cm')
    expect(s['Garnalternativer']).toBe('Natur: Sandnes Garn Tynn Merinoull')
    expect(s['Status']).toBe('Godkjent')
    expect(s['PDF']).toEqual({ text: 'Rein genser - Ber-Lin Design.pdf', hyperlink: 'https://drive.google.com/file/d/pdf1/view' })
    expect(s['ID']).toBe('rein')
  })
})

describe('Garn sheet', () => {
  it('has one row per catalogue yarn with fibre, plastic, ranges and source', () => {
    const sheet = yarnSheet(catalogue)
    expect(sheet.rows).toHaveLength(2)
    const [air, sunday] = [byHeader(sheet, 0), byHeader(sheet, 1)]
    expect(air).toMatchObject({ Produsent: 'DROPS', Navn: 'Air', Fiber: '65 % alpakka, 28 % polyamid', Plast: 'Ja', 'DROPS-garngruppe': 'C', Utgått: 'Nei', Status: 'Til godkjenning' })
    expect(sunday).toMatchObject({
      Plast: 'Nei', 'Vekt per nøste (g)': 50, 'Løpelengde per nøste (m)': 235, 'Strikkefasthet (m per 10 cm)': '27–28', 'Pinne (mm)': '3',
      Favoritt: null, 'Pris per nøste (kr)': null, Kilde: { text: 'Produsent', hyperlink: 'https://www.sandnesgarn.no/sunday' }, Status: 'Godkjent',
    })
  })
})

describe('the workbook', () => {
  it('has the sheets Oppskrifter and Garn, a filtered header row, and links', async () => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await workbookBuffer(overviewSheets([rein, collection], catalogue)) as unknown as ArrayBuffer)
    expect(wb.worksheets.map(w => w.name)).toEqual(['Oppskrifter', 'Garn'])
    const r = wb.getWorksheet('Oppskrifter')!
    expect(r.getRow(1).getCell(2).value).toBe('Oppskrift')
    expect(r.getRow(1).font?.bold).toBe(true)
    expect(r.autoFilter).toBeTruthy()
    expect(r.rowCount).toBe(1 + 1 + 4)
    const pdf = r.getRow(3).getCell(r.getRow(1).values && (r.getRow(1).values as string[]).indexOf('PDF')).value
    expect(pdf).toMatchObject({ hyperlink: 'https://drive.google.com/file/d/pdf1/view' })
    expect(wb.getWorksheet('Garn')!.rowCount).toBe(3)
    expect(OVERVIEW_FILE_NAME).toBe('Strikkeoversikt.xlsx')
  })
})

describe('planOverviewWrite', () => {
  it('creates a missing file, rewrites on change or on request, and leaves an unchanged one alone', () => {
    expect(planOverviewWrite({ fileId: null, storedHash: 'a', hash: 'a', force: false })).toBe('create')
    expect(planOverviewWrite({ fileId: 'f', storedHash: 'a', hash: 'b', force: false })).toBe('update')
    expect(planOverviewWrite({ fileId: 'f', storedHash: 'a', hash: 'a', force: true })).toBe('update')
    expect(planOverviewWrite({ fileId: 'f', storedHash: 'a', hash: 'a', force: false })).toBe('unchanged')
  })
})

describe('when the browser writes the file', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

  it('writes once after a series of changes, and once when Strikk opens', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'updated', recipes: 1, yarns: 1 })))
    vi.stubGlobal('fetch', fetch)
    const client = await import('./overview-client')
    for (let i = 0; i < 25; i++) client.scheduleOverviewRefresh()
    await vi.advanceTimersByTimeAsync(14_000)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ force: false })

    client.refreshOverviewOnOpen()
    client.refreshOverviewOnOpen()
    await vi.runAllTimersAsync()
    expect(fetch).toHaveBeenCalledTimes(2)

    const r = await client.refreshOverview(true)
    expect(JSON.parse((fetch.mock.calls[2] as unknown as [string, RequestInit])[1].body as string)).toEqual({ force: true })
    expect(r).toEqual({ ok: true, message: 'Regnearket er skrevet (1 oppskriftsrader og 1 garn)' })
  })
})
