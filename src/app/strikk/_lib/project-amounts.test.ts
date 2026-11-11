import { describe, it, expect } from 'vitest'
import { normalizeExtraction } from './extraction'
import { SIMULATED_ANSWER } from './extraction.fixture'
import { amountForLine, formatAmountForLine } from './project-amounts'

// SIMULATED_ANSWER (Rein genser): yarn_line 0 (Sunday) and 1 (Tynn Silk Mohair) are held
// together in color_group 0, each with its own per-size amount. yarn_line 2 (Peer Gynt) is
// color_group 1, where size 0's amount is a shared, not-yet-chosen candidate (yarn_line -1).
const d = normalizeExtraction(SIMULATED_ANSWER)

describe('amountForLine', () => {
  it('finds the amount given directly for the yarn line', () => {
    expect(amountForLine(d, 1, 0)).toMatchObject({ amount: 300, unit: 'g' })
    expect(amountForLine(d, 2, 1)).toMatchObject({ amount: 4, unit: 'skeins' })
  })

  it('reads a range by its upper end through formatAmountForLine', () => {
    expect(formatAmountForLine(amountForLine(d, 3, 0))).toBe('400–450 g')
  })

  it('falls back to the colour group\'s shared amount when none is given per line', () => {
    const a = amountForLine(d, 0, 2)
    expect(a).toMatchObject({ yarn_line: null, color_group: 1, needs_choice: true })
  })

  it('shows the candidates alongside a shared amount that needs a choice', () => {
    expect(formatAmountForLine(amountForLine(d, 0, 2))).toBe('100 g (velg Peer Gynt eller Smart)')
  })

  it('returns null for a line or size that does not exist', () => {
    expect(amountForLine(d, 0, 99)).toBeNull()
    expect(formatAmountForLine(null)).toBe('')
  })
})
