import { describe, it, expect } from 'vitest'
import { checkErrors } from './check-lib.mjs'
import { normalizeExtraction } from '../../src/app/strikk/_lib/extraction'
import { SIMULATED_ANSWER } from '../../src/app/strikk/_lib/extraction.fixture'

const data = () => JSON.parse(JSON.stringify(normalizeExtraction(SIMULATED_ANSWER)))
const k = (over: Record<string, unknown> = {}) => ({ data: data(), changes: [], approve: true, note: 'Alt stemte.', ...over })

describe('checkErrors', () => {
  it('accepts a checked recipe as the app stores it', () => {
    expect(checkErrors(k())).toEqual([])
  })
  it('asks for the decision, the changes and a note', () => {
    expect(checkErrors({ data: data() })).toEqual(['approve må være true eller false', 'changes må være en liste', 'note mangler'])
  })
  it('catches what saving would silently drop or break', () => {
    const d = data()
    d.amounts[0].size = 9
    d.amounts[1].yarn_line = 7
    d.audience = 'baby'
    d.title = ''
    const errors = checkErrors(k({ data: d }))
    expect(errors).toEqual(expect.arrayContaining([
      'title er tom',
      'amounts[0].size peker utenfor sizes',
      'amounts[1].yarn_line peker utenfor yarn_lines',
      'audience «baby» er ikke gyldig (woman, man, unisex, child, interior, other)',
    ]))
    expect(errors.some(e => e.startsWith('amounts: '))).toBe(true)
  })
})
