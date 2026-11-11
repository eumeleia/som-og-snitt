// How much yarn one project's yarn line needs, once a size is chosen. Pure, so it can be
// unit-tested against extraction.fixture.ts-style data without a database.
import { amountForCalc, formatAmount, UNIT_LABEL, type AmountData, type ExtractionData } from './extraction'

// The amount for this exact yarn line in this size, or — when the pattern gives one shared
// amount for the whole colour group instead of one per yarn — that group's amount. Same
// fallback rule recipe-filter.ts's colourSkeins uses for the leftover-yarn count.
export function amountForLine(d: ExtractionData, sizeIndex: number, lineIndex: number): AmountData | null {
  const line = d.yarn_lines[lineIndex]
  if (!line) return null
  const perLine = d.amounts.find(a => a.size === sizeIndex && a.yarn_line === lineIndex)
  if (perLine) return perLine
  return d.amounts.find(a => a.size === sizeIndex && a.yarn_line === null && a.color_group === line.color_group) ?? null
}

// «250 g», «3 nøster», «100 g (velg Peer Gynt eller Smart)» when the amount is shared
// between candidate yarns, or just the candidates when the pattern gives no amount at all.
export function formatAmountForLine(a: AmountData | null): string {
  if (!a) return ''
  const choice = a.needs_choice && a.candidates.length ? ` (velg ${a.candidates.join(' eller ')})` : ''
  if (a.amount !== null) return `${formatAmount(a)} ${UNIT_LABEL[a.unit]}${choice}`
  return a.candidates.length ? `Velg: ${a.candidates.join(' eller ')}` : ''
}

// Antall nøster av dette garnet (ikke oppskriftens eget) en mengde tilsvarer, ved toppen av
// et intervall. g regnes om via garnets egen vekt per nøste; nøster brukes som de står.
export function skeinsNeeded(a: Pick<AmountData, 'amount' | 'amount_max' | 'unit'>, yarn: { skein_weight_g: number | null }): number | null {
  const n = amountForCalc(a)
  if (n === null) return null
  if (a.unit === 'skeins') return n
  if (!yarn.skein_weight_g) return null
  return n / yarn.skein_weight_g
}

// Ca. kostnad for en mengde garn, forutsatt oppgitt pris per nøste. Rundet opp til nærmeste
// nøste før den ganges med prisen, siden man ikke kan kjøpe en brøkdel av et nøste.
export function estimatedCost(a: Pick<AmountData, 'amount' | 'amount_max' | 'unit'>, yarn: { skein_weight_g: number | null; price_per_skein: number | null }): number | null {
  if (yarn.price_per_skein === null) return null
  const skeins = skeinsNeeded(a, yarn)
  if (skeins === null) return null
  return Math.ceil(skeins) * yarn.price_per_skein
}

// Hva Maria har liggende av ett garn fra katalogen, til sizeCoverage.
export interface OwnedYarn { skein_count: number; leftover_g: number }

export interface SizeShortfall { color_label: string | null; short_skeins: number }
export interface SizeCoverage { label: string; covered: boolean; shortfalls: SizeShortfall[] }

// Hvilke størrelser i mønsteret Maria har nok garn på lager til, ut fra garnet hun eier
// (owned, pr. yarn_id) — rester i gram regnes om til nøster med SAMME skein_weight_g som
// mønsterets egen garnlinje oppgir, slik at nøster og rester av samme garn telles likt.
// En garnlinje mønsteret ikke har koblet til et garn i katalogen, eller der mengden er et
// delt valg mellom flere garn (needs_choice), kan ikke sjekkes og hopper over — den blokkerer
// ikke størrelsen, men den bekreftes heller ikke.
export function sizeCoverage(d: Pick<ExtractionData, 'sizes' | 'yarn_lines' | 'amounts'>, owned: Map<string, OwnedYarn>): SizeCoverage[] {
  return d.sizes.map((size, sizeIndex) => {
    const shortfalls: SizeShortfall[] = []
    d.yarn_lines.forEach((line, lineIndex) => {
      if (!line.yarn_id) return
      const amount = amountForLine(d as ExtractionData, sizeIndex, lineIndex)
      if (!amount || amount.needs_choice) return
      const needed = skeinsNeeded(amount, line)
      if (needed === null) return
      const o = owned.get(line.yarn_id) ?? { skein_count: 0, leftover_g: 0 }
      const haveSkeins = o.skein_count + (line.skein_weight_g ? o.leftover_g / line.skein_weight_g : 0)
      if (haveSkeins + 1e-9 < needed) shortfalls.push({ color_label: line.color_label, short_skeins: Math.ceil(needed - haveSkeins) })
    })
    return { label: size.label, covered: shortfalls.length === 0, shortfalls }
  })
}
