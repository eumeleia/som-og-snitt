import type { ExtractionData, StoredRecipe } from './extraction'

// Simulated Claude answers, in the shape EXTRACTION_SCHEMA asks for: "" / 0 / -1 for a
// missing value, uncertainty with a reason.

// A sweater in four sizes, two colours, the main colour knitted with two yarns together,
// a range for the largest size, and one shared amount for two yarns with different meterage.
export const SIMULATED_ANSWER = {
  title: 'Rein genser', designer: 'Ber-Lin Design', audience: 'woman', garment_type: 'Genser',
  is_collection: false, collection_titles: [], variants: ['Kort', 'Lang'],
  sizes: [
    { label: 'S', uncertain: false, uncertain_reason: '' },
    { label: 'M', uncertain: false, uncertain_reason: '' },
    { label: 'L', uncertain: false, uncertain_reason: '' },
    { label: 'XL', uncertain: true, uncertain_reason: 'Står bare i måltabellen' },
  ],
  yarn_lines: [
    { color_group: 0, color_label: 'Natur', yarn_name: 'Sunday', brand: 'Sandnes Garn', meterage_m: 235, skein_weight_g: 50, fiber: '100 % merinoull', strands: 1, uncertain_fields: [] },
    { color_group: 0, color_label: 'Natur', yarn_name: 'Tynn Silk Mohair', brand: 'Sandnes Garn', meterage_m: 212, skein_weight_g: 25, fiber: '57 % mohair, 28 % silke, 15 % ull', strands: 1, uncertain_fields: [{ field: 'meterage_m', reason: 'Utydelig trykk' }] },
    { color_group: 1, color_label: 'Rust', yarn_name: 'Peer Gynt', brand: 'Sandnes Garn', meterage_m: 91, skein_weight_g: 50, fiber: 'ull', strands: 2, uncertain_fields: [] },
  ],
  amounts: [
    ...[0, 1, 2].flatMap(s => [
      { size: s, color_group: 0, yarn_line: 0, amount: 250 + 50 * s, amount_max: 0, unit: 'g', candidates: [], needs_choice: false, uncertain: false, uncertain_reason: '' },
      { size: s, color_group: 0, yarn_line: 1, amount: 2 + s, amount_max: 0, unit: 'skeins', candidates: [], needs_choice: false, uncertain: false, uncertain_reason: '' },
    ]),
    { size: 3, color_group: 0, yarn_line: 0, amount: 400, amount_max: 450, unit: 'g', candidates: [], needs_choice: false, uncertain: false, uncertain_reason: '' },
    { size: 3, color_group: 0, yarn_line: 1, amount: 5, amount_max: 0, unit: 'skeins', candidates: [], needs_choice: false, uncertain: true, uncertain_reason: 'Tallet er delvis skjult' },
    { size: 0, color_group: 1, yarn_line: -1, amount: 100, amount_max: 0, unit: 'g', candidates: ['Peer Gynt', 'Smart'], needs_choice: true, uncertain: false, uncertain_reason: '' },
  ],
  alternatives: [{ color_group: 0, yarn_line: 0, yarn_name: 'Tynn Merinoull', brand: 'Sandnes Garn', meterage_m: 175, skein_weight_g: 50, fiber: 'merinoull', uncertain: false, uncertain_reason: '' }],
  gauge_stitches_10cm: 22, gauge_rows_10cm: 30, gauge_note: 'glattstrikk på p 4', needles: ['rundpinne 3,5 mm 80 cm', 'rundpinne 4 mm 80 cm'],
  accessories: [
    { size: -1, kind: 'buttons', description: 'Knapper', quantity: 7, dimension: '15 mm', uncertain: false, uncertain_reason: '' },
    { size: 3, kind: 'zipper', description: 'Glidelås', quantity: 1, dimension: '60 cm', uncertain: false, uncertain_reason: '' },
  ],
  amounts_page: 2,
  uncertain_fields: [{ field: 'gauge_rows_10cm', reason: 'Omregnet fra 15 omg = 5 cm' }],
}

// A catalogue: Claude still sent sizes and an amount, and flagged amounts as uncertain.
export const CATALOGUE_ANSWER = {
  title: 'Alpaca Silk', designer: 'Viking Garn', audience: 'child', garment_type: 'sett',
  is_collection: true, collection_titles: ['Genser og bukse 1111-4', 'One piece 1111-8'], variants: [],
  sizes: [{ label: 'x-liten', uncertain: false, uncertain_reason: '' }],
  yarn_lines: [{ color_group: 0, color_label: '', yarn_name: 'Viking Alpaca Silk', brand: 'Viking Garn', meterage_m: 0, skein_weight_g: 50, fiber: '', strands: 1, uncertain_fields: [] }],
  amounts: [{ size: 0, color_group: 0, yarn_line: 0, amount: 0, amount_max: 0, unit: 'g', candidates: [], needs_choice: false, uncertain: true, uncertain_reason: 'Mengde mangler' }],
  alternatives: [],
  gauge_stitches_10cm: 0, gauge_rows_10cm: 0, gauge_note: '', needles: [],
  accessories: [{ size: 0, kind: 'buttons', description: 'Knapper', quantity: 0, dimension: '', uncertain: false, uncertain_reason: '' }],
  amounts_page: 3,
  uncertain_fields: [{ field: 'amounts', reason: 'Ingen garnmengde funnet' }, { field: 'sizes', reason: 'Ulike størrelser per modell' }, { field: 'audience', reason: 'Både barn og voksen' }],
}

// The rows strikk_save_extraction would leave for this data (ids instead of indexes, in
// reverse order), plus one app-suggested alternative an extraction never touches.
export function storedFrom(d: ExtractionData, over: Partial<StoredRecipe> = {}): StoredRecipe {
  const sizeIds = d.sizes.map((_, i) => `s${i}`)
  const lineIds = d.yarn_lines.map((_, i) => `l${i}`)
  return {
    id: 'r1', title: d.title!, designer: d.designer, file_name: 'x.pdf', drive_file_id: 'f', created_at: '',
    extraction_status: 'extracted', extraction_error: null, extracted_at: null, approved_at: null,
    extracted_title: d.title, extracted_designer: d.designer, audience: d.audience, garment_type: d.garment_type,
    gauge_stitches_10cm: d.gauge_stitches_10cm, gauge_rows_10cm: d.gauge_rows_10cm, gauge_note: d.gauge_note,
    needles: d.needles, variants: d.variants, is_collection: d.is_collection, collection_titles: d.collection_titles,
    uncertain_fields: d.uncertain_fields, uncertain_reasons: d.uncertain_reasons, amounts_page: d.amounts_page,
    strikk_size: d.sizes.map((s, i) => ({ id: sizeIds[i], position: i, ...s })).reverse(),
    strikk_yarn_line: d.yarn_lines.map((l, i) => ({ id: lineIds[i], position: i, ...l })).reverse(),
    strikk_yarn_amount: d.amounts.map(a => ({
      size_id: sizeIds[a.size], color_group: a.color_group, yarn_line_id: a.yarn_line === null ? null : lineIds[a.yarn_line],
      amount: a.amount, amount_max: a.amount_max, unit: a.unit, candidates: a.candidates, needs_choice: a.needs_choice,
      uncertain: a.uncertain, uncertain_reason: a.uncertain_reason,
    })).reverse(),
    strikk_yarn_alternative: [
      ...d.alternatives.map(a => ({ ...a, yarn_line_id: a.yarn_line === null ? null : lineIds[a.yarn_line], source: 'pattern' as const })),
      { yarn_line_id: null, color_group: 0, yarn_name: 'App-forslag', brand: null, meterage_m: null, skein_weight_g: null, fiber: null, source: 'app' as const, uncertain: false, uncertain_reason: null },
    ],
    strikk_accessory: d.accessories.map(a => ({ ...a, size_id: a.size === null ? null : sizeIds[a.size] })),
    ...over,
  }
}
