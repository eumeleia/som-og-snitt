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
