// Pure helpers for scripts/strikk/yarns.mjs, tested in yarn-lib.test.ts.
import { aliasKey, matchYarn } from '../../src/app/strikk/_lib/yarns.ts'

export const GENERIC_REASON = 'Generisk garn, ikke et bestemt garn'
export const NOT_IN_CATALOGUE = 'Ikke i garnkatalogen ennå'
export const RENAMED = 'Garnnavnet i oppskriften er endret etter koblingen'

// Spellings without duplicates; a certain spelling wins over an uncertain one.
export function mergeAliases(existing, added) {
  const out = new Map()
  for (const a of [...(existing ?? []), ...(added ?? [])]) {
    const alias = { brand: a.brand ?? '', name: a.name, certain: a.certain !== false, reason: a.certain === false ? a.reason ?? null : null }
    const k = aliasKey(alias.brand, alias.name)
    const prev = out.get(k)
    if (!prev || (!prev.certain && alias.certain)) out.set(k, alias)
  }
  return [...out.values()]
}

// What to write on each yarn line and alternative so it points at its catalogue yarn.
// Only the three link columns are ever set, and only when they change.
export function linkPlan(lines, yarns, genericKeys) {
  const counts = { linked: 0, linked_uncertain: 0, generic: 0, not_in_catalogue: 0, renamed: 0 }
  const updates = []
  for (const l of lines) {
    let values
    const m = matchYarn(yarns, l.brand, l.yarn_name)
    // A line without a brand can only match a spelling without one, and that spelling
    // carries its own certainty from the grouping.
    if (m) {
      if (l.yarn_id && l.yarn_id !== m.yarn.id) {
        values = { yarn_id: l.yarn_id, yarn_link_uncertain: true, yarn_link_reason: RENAMED }
        counts.renamed++
      } else {
        values = { yarn_id: m.yarn.id, yarn_link_uncertain: !m.certain, yarn_link_reason: m.reason }
        counts[m.certain ? 'linked' : 'linked_uncertain']++
      }
    } else if (genericKeys.has(aliasKey(l.brand, l.yarn_name))) {
      values = { yarn_id: null, yarn_link_uncertain: false, yarn_link_reason: GENERIC_REASON }
      counts.generic++
    } else if (l.yarn_id) {
      values = { yarn_id: l.yarn_id, yarn_link_uncertain: true, yarn_link_reason: RENAMED }
      counts.renamed++
    } else {
      values = { yarn_id: null, yarn_link_uncertain: true, yarn_link_reason: NOT_IN_CATALOGUE }
      counts.not_in_catalogue++
    }
    const same = (l.yarn_id ?? null) === values.yarn_id && !!l.yarn_link_uncertain === values.yarn_link_uncertain && (l.yarn_link_reason ?? null) === values.yarn_link_reason
    if (!same) updates.push({ table: l.table, id: l.id, values })
  }
  return { counts, updates }
}
