export interface MiniatyrBlokk { farge_hex: string; sting: [number, number][] }
export interface MiniatyrBbox { min_x: number; min_y: number; max_x: number; max_y: number }

// Et TOTALT punktbudsjett for hele motivet (ikke et fast antall PER blokk) — den forrige
// versjonen kappet hver blokk til 40 punkter uansett hvor mange blokker motivet hadde, så
// totalstørrelsen vokste ubegrenset med antall blokker (et motiv med 240 blokker ble over
// 100 KB), mens et motiv med bare 1-2 blokker (uansett hvor mange tusen sting de hadde)
// aldri fikk mer enn 40 punkter — akkurat den kraftige nedsamplingen som gjorde satengfyll
// om til hårtynne kruseduller. Et totalbudsjett fordelt proporsjonalt etter stingantall per
// blokk løser begge: få-blokk-motiver (det vanlige tilfellet) får mye mer detalj, mange-
// blokk-motiver får et forutsigbart tak. Målt mot 25 ekte motiver i basen: dette gir en
// projisert TOTAL databasestørrelse på ca. 37 MB for alle 2967 rader, mot ca. 41 MB om
// dagens flate 40/blokk-grense bare fortsatte å bli fylt ut — altså ikke tyngre totalt,
// bare fordelt der det faktisk gjør nytte.
const TOTAL_PUNKT_BUDSJETT = 800
const MIN_PUNKTER_PER_BLOKK = 20
const STREKTYKKELSE_MM = 1.0

function nedsampleTilBudsjett(sting: [number, number][], budsjett: number): [number, number][] {
  const n = sting.length
  if (budsjett <= 1) return n > 1 ? [sting[0], sting[n - 1]] : sting
  if (n <= budsjett) return sting
  const steg = Math.max(1, Math.round((n - 1) / (budsjett - 1)))
  const ut: [number, number][] = []
  for (let i = 0; i < n; i += steg) ut.push(sting[i])
  const siste = sting[n - 1]
  if (ut[ut.length - 1] !== siste) ut.push(siste)
  return ut
}

// Bygger en liten, forenklet SVG av ETT motiv (én embroidery_id+size_id) fra dets EGNE
// stingdata — kalt fra parse-ruten (ved parsing) og backfill-ruten (generer-miniatyrer),
// ALDRI fra en listevisning. Strektykkelsen er satt til 1 mm (opp fra 0.5) for å gi et
// tydeligere inntrykk av fyll der stingene ligger tett — kombinert med det romsligere
// punktbudsjettet gjengir dette sikksakk-mønsteret i satengkolonner i stedet for å hoppe
// rett mellom noen få hjørner.
export function byggMotivMiniatyrSvg(bbox: MiniatyrBbox, blokker: MiniatyrBlokk[]): string {
  const pad = Math.max(bbox.max_x - bbox.min_x, bbox.max_y - bbox.min_y) * 0.05
  const vx = (bbox.min_x - pad) / 10
  const vy = (bbox.min_y - pad) / 10
  const vw = (bbox.max_x - bbox.min_x + 2 * pad) / 10
  const vh = (bbox.max_y - bbox.min_y + 2 * pad) / 10

  const totalSting = blokker.reduce((sum, b) => sum + b.sting.length, 0) || 1

  const lines = blokker.map(b => {
    const andel = Math.round((TOTAL_PUNKT_BUDSJETT * b.sting.length) / totalSting)
    const budsjettForBlokk = Math.min(b.sting.length, Math.max(MIN_PUNKTER_PER_BLOKK, andel))
    const pts = nedsampleTilBudsjett(b.sting, budsjettForBlokk)
      .map(([x, y]) => `${(x / 10).toFixed(1)},${(y / 10).toFixed(1)}`)
      .join(' ')
    return `<polyline points="${pts}" fill="none" stroke="${b.farge_hex}" stroke-width="${STREKTYKKELSE_MM}" stroke-linecap="round" stroke-linejoin="round"/>`
  }).join('')

  return `<svg viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" xmlns="http://www.w3.org/2000/svg">${lines}</svg>`
}
