// Pure helpers for scripts/strikk/check.mjs, tested in check-lib.test.ts.
import { normalizeExtraction } from '../../src/app/strikk/_lib/extraction.ts'

// What is wrong with a kontroll.json, so nothing is lost when it is saved. Anything the
// app's normaliser would drop (an index out of range, an unknown value) is reported.
export function checkErrors(k) {
  const errors = []
  if (!k || typeof k !== 'object') return ['kontroll.json er ikke et objekt']
  if (!k.data || typeof k.data !== 'object') errors.push('data mangler')
  if (typeof k.approve !== 'boolean') errors.push('approve må være true eller false')
  if (!Array.isArray(k.changes)) errors.push('changes må være en liste')
  if (!k.note) errors.push('note mangler')
  if (!k.data || typeof k.data !== 'object') return errors
  const n = normalizeExtraction(k.data)
  if (!n.title) errors.push('title er tom')
  for (const key of ['sizes', 'yarn_lines', 'amounts', 'alternatives', 'accessories', 'needles']) {
    const before = (k.data[key] ?? []).length
    if (before !== n[key].length) errors.push(`${key}: ${before} i svaret, ${n[key].length} etter normalisering (noe ble forkastet)`)
  }
  for (const [i, a] of (k.data.amounts ?? []).entries()) {
    if (a.size < 0 || a.size >= (k.data.sizes ?? []).length) errors.push(`amounts[${i}].size peker utenfor sizes`)
    if (a.yarn_line !== null && a.yarn_line !== undefined && (a.yarn_line < 0 || a.yarn_line >= (k.data.yarn_lines ?? []).length)) {
      errors.push(`amounts[${i}].yarn_line peker utenfor yarn_lines`)
    }
  }
  if (k.data.audience && n.audience === null) errors.push(`audience «${k.data.audience}» er ikke gyldig (woman, man, unisex, child, interior, other)`)
  return errors
}
