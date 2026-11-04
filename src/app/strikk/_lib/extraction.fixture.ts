// Simulated Claude answer for a sweater in four sizes, two colours, the main colour knitted
// with two yarns together, one shared amount for two yarns with different meterage.
export const SIMULATED_ANSWER = {
  title: 'Rein genser', designer: 'Ber-Lin Design', audience: 'woman', garment_type: 'Genser',
  is_collection: false, collection_titles: [], variants: ['Kort', 'Lang'],
  sizes: [{ label: 'S', uncertain: false }, { label: 'M', uncertain: false }, { label: 'L', uncertain: false }, { label: 'XL', uncertain: true }],
  yarn_lines: [
    { color_group: 0, color_label: 'Natur', yarn_name: 'Sunday', brand: 'Sandnes Garn', meterage_m: 235, skein_weight_g: 50, fiber: '100 % merinoull', strands: 1, uncertain_fields: [] },
    { color_group: 0, color_label: 'Natur', yarn_name: 'Tynn Silk Mohair', brand: 'Sandnes Garn', meterage_m: 212, skein_weight_g: 25, fiber: '57 % mohair, 28 % silke, 15 % ull', strands: 1, uncertain_fields: ['meterage_m'] },
    { color_group: 1, color_label: 'Rust', yarn_name: 'Peer Gynt', brand: 'Sandnes Garn', meterage_m: 91, skein_weight_g: 50, fiber: 'ull', strands: 2, uncertain_fields: [] },
  ],
  amounts: [
    ...[0, 1, 2, 3].flatMap(s => [
      { size: s, color_group: 0, yarn_line: 0, amount: 250 + 50 * s, unit: 'g', candidates: [], needs_choice: false, uncertain: false },
      { size: s, color_group: 0, yarn_line: 1, amount: 2 + s, unit: 'skeins', candidates: [], needs_choice: false, uncertain: false },
    ]),
    { size: 0, color_group: 1, yarn_line: null, amount: 100, unit: 'g', candidates: ['Peer Gynt', 'Smart'], needs_choice: true, uncertain: false },
  ],
  alternatives: [{ color_group: 0, yarn_line: 0, yarn_name: 'Tynn Merinoull', brand: 'Sandnes Garn', meterage_m: 175, skein_weight_g: 50, fiber: 'merinoull', uncertain: false }],
  gauge_stitches_10cm: 22, gauge_rows_10cm: 30, gauge_note: 'glattstrikk på p 4', needles: ['rundpinne 3,5 mm 80 cm', 'rundpinne 4 mm 80 cm'],
  accessories: [
    { size: null, kind: 'buttons', description: 'Knapper', quantity: 7, dimension: '15 mm', uncertain: false },
    { size: 3, kind: 'zipper', description: 'Glidelås', quantity: 1, dimension: '60 cm', uncertain: false },
  ],
  uncertain_fields: ['gauge_rows_10cm'],
}
