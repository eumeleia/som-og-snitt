// The yarn catalogue, filled locally by Claude Code. See docs/strikk-innlesing.md.
//   node --no-warnings --env-file=.env.local scripts/strikk/yarns.mjs <command>
//
//   collect           spellings in the recipes that are not in the catalogue yet
//                     → strikk/garn/kandidater.json
//   create <file>     yarns from a reviewed grouping (grupper.json) as drafts, with their
//                     spellings; generic «yarns» go to strikk/garn/generisk.json
//   prepare [--size]  next round of drafts to look up → strikk/garn/runde-N/
//   save <dir>        checked lookup answers into the catalogue (never approved yarns)
//   check <svar.json> one lookup answer against the schema, without the database
//   link              links every yarn line and alternative to its catalogue yarn
//   status            counts
//
// Reads with the anon key, writes with the service role key. No Claude API.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { schemaErrors } from '../../src/app/strikk/_lib/extraction.ts'
import { YARN_SCHEMA, aliasKey, hasPlastic, matchYarn, missingFields, normalizeYarn } from '../../src/app/strikk/_lib/yarns.ts'
import { GENERIC_REASON, linkPlan, mergeAliases } from './yarn-lib.mjs'

const OUT = 'strikk/garn'
const GENERIC = join(OUT, 'generisk.json')
const [cmd, arg] = process.argv.slice(2)
const flag = name => process.argv.includes(name)

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function all(table, columns) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await anon.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

const LINE_COLS = 'id, oppskrift_id, yarn_name, brand, meterage_m, skein_weight_g, fiber, yarn_id, yarn_link_uncertain, yarn_link_reason'
const loadLines = async () => [
  ...(await all('strikk_yarn_line', LINE_COLS)).map(l => ({ ...l, table: 'strikk_yarn_line' })),
  ...(await all('strikk_yarn_alternative', LINE_COLS + ', source')).filter(a => a.source === 'pattern').map(a => ({ ...a, table: 'strikk_yarn_alternative' })),
]
const loadYarns = () => all('strikk_yarn', 'id, brand, name, aliases, status')
const generic = () => (existsSync(GENERIC) ? JSON.parse(readFileSync(GENERIC, 'utf8')) : [])
mkdirSync(OUT, { recursive: true })

if (cmd === 'collect') {
  const [lines, yarns, recipes] = await Promise.all([loadLines(), loadYarns(), all('strikk_oppskrift', 'id, title, designer')])
  const recipe = new Map(recipes.map(r => [r.id, r]))
  const genericKeys = new Set(generic().map(g => g.key))
  const cand = new Map()
  for (const l of lines) {
    const key = aliasKey(l.brand, l.yarn_name)
    if (genericKeys.has(key) || matchYarn(yarns, l.brand, l.yarn_name)) continue
    const c = cand.get(key) ?? { key, brand: l.brand ?? '', name: l.yarn_name, uses: 0, recipes: [], pattern_data: [], other_yarns_in_recipe: [] }
    c.uses++
    const r = recipe.get(l.oppskrift_id)
    if (r && !c.recipes.some(x => x.title === r.title)) c.recipes.push({ title: r.title, designer: r.designer })
    if (l.meterage_m || l.skein_weight_g || l.fiber) c.pattern_data.push({ recipe: r?.title, meterage_m: l.meterage_m, skein_weight_g: l.skein_weight_g, fiber: l.fiber })
    for (const o of lines.filter(o => o.oppskrift_id === l.oppskrift_id && o !== l).slice(0, 6)) {
      const s = `${o.brand ? o.brand + ' / ' : ''}${o.yarn_name}`
      if (!c.other_yarns_in_recipe.includes(s)) c.other_yarns_in_recipe.push(s)
    }
    cand.set(key, c)
  }
  const list = [...cand.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'))
  writeFileSync(join(OUT, 'kandidater.json'), JSON.stringify(list, null, 1))
  console.log(`${list.length} skrivemåter er ikke i katalogen ennå → ${join(OUT, 'kandidater.json')}`)
}

else if (cmd === 'create') {
  if (!arg || !existsSync(arg)) throw new Error('Oppgi grupperingsfila, f.eks. strikk/garn/grupper.json')
  const groups = JSON.parse(readFileSync(arg, 'utf8'))
  const db = admin()
  const yarns = await loadYarns()
  let created = 0, merged = 0
  const gen = generic()
  for (const g of groups) {
    if (g.generic) {
      for (const a of g.aliases) {
        const key = aliasKey(a.brand, a.name)
        if (!gen.some(x => x.key === key)) gen.push({ key, brand: a.brand ?? '', name: a.name, reason: g.reason ?? GENERIC_REASON })
      }
      continue
    }
    const existing = yarns.find(y => aliasKey(y.brand, y.name) === aliasKey(g.brand, g.name))
    if (existing) {
      const { error } = await db.from('strikk_yarn').update({ aliases: mergeAliases(existing.aliases, g.aliases), updated_at: new Date().toISOString() }).eq('id', existing.id)
      if (error) throw new Error(`${g.brand} ${g.name}: ${error.message}`)
      merged++
    } else {
      const { error } = await db.from('strikk_yarn').insert({ brand: g.brand ?? '', name: g.name, aliases: mergeAliases([], g.aliases), status: 'draft' })
      if (error) throw new Error(`${g.brand} ${g.name}: ${error.message}`)
      created++
    }
  }
  writeFileSync(GENERIC, JSON.stringify(gen, null, 1))
  console.log(`${created} nye garn, ${merged} slått sammen med eksisterende, ${gen.length} generiske skrivemåter i ${GENERIC}`)
}

else if (cmd === 'prepare') {
  const size = flag('--size') ? Number(process.argv[process.argv.indexOf('--size') + 1]) : 20
  // A yarn in a round that is not saved yet is taken: finish that round instead.
  const taken = new Set()
  for (const d of readdirSync(OUT).filter(d => d.startsWith('runde-'))) {
    for (const id of readdirSync(join(OUT, d))) {
      if (existsSync(join(OUT, d, id, 'meta.json')) && !existsSync(join(OUT, d, id, 'lagret.json'))) taken.add(id)
    }
  }
  const [yarns, lines, recipes] = await Promise.all([loadYarns(), loadLines(), all('strikk_oppskrift', 'id, title')])
  const title = new Map(recipes.map(r => [r.id, r.title]))
  const round = yarns.filter(y => y.status === 'draft' && !taken.has(y.id)).sort((a, b) => a.name.localeCompare(b.name, 'nb')).slice(0, size)
  if (round.length === 0) { console.log('Ingen garn å slå opp.'); process.exit(0) }
  const n = readdirSync(OUT).filter(d => d.startsWith('runde-')).length + 1
  const dir = join(OUT, `runde-${n}`)
  mkdirSync(dir)
  writeFileSync(join(dir, 'INSTRUKS.md'), readFileSync('scripts/strikk/yarn-lookup.md', 'utf8') + `\n\n## Skjema for svar.json\n\n\`\`\`json\n${JSON.stringify(YARN_SCHEMA, null, 1)}\n\`\`\`\n`)
  for (const y of round) {
    const used = lines.filter(l => matchYarn([y], l.brand, l.yarn_name))
    mkdirSync(join(dir, y.id))
    writeFileSync(join(dir, y.id, 'meta.json'), JSON.stringify({
      id: y.id, brand: y.brand, name: y.name, aliases: y.aliases,
      pattern_data: used.filter(l => l.meterage_m || l.skein_weight_g || l.fiber)
        .map(l => ({ recipe: title.get(l.oppskrift_id), meterage_m: l.meterage_m, skein_weight_g: l.skein_weight_g, fiber: l.fiber })),
      used_in: [...new Set(used.map(l => title.get(l.oppskrift_id)))],
    }, null, 1))
  }
  const left = yarns.filter(y => y.status === 'draft' && !taken.has(y.id)).length - round.length
  console.log(`${dir}: ${round.length} garn klare, ${left} utkast igjen utenfor rundene.`)
}

else if (cmd === 'save') {
  if (!arg || !existsSync(arg)) throw new Error('Oppgi mappa for runden, f.eks. strikk/garn/runde-1')
  const db = admin()
  const count = {}
  const problems = []
  for (const id of readdirSync(arg, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    const rdir = join(arg, id)
    const tally = r => { count[r] = (count[r] ?? 0) + 1 }
    if (existsSync(join(rdir, 'lagret.json'))) { tally('already-saved'); continue }
    if (!existsSync(join(rdir, 'svar.json'))) { tally('no-answer'); continue }
    const meta = JSON.parse(readFileSync(join(rdir, 'meta.json'), 'utf8'))
    const answer = JSON.parse(readFileSync(join(rdir, 'svar.json'), 'utf8'))
    const errors = schemaErrors(YARN_SCHEMA, answer)
    if (errors.length) { tally('invalid'); problems.push(`${meta.name}: ${errors.slice(0, 5).join('; ')}`); continue }
    const y = normalizeYarn(answer)
    for (const f of missingFields(y)) {
      if (!y.uncertain_fields.includes(f)) { y.uncertain_fields.push(f); y.uncertain_reasons[f] ??= 'Ikke funnet' }
    }
    const { data: row, error: readError } = await db.from('strikk_yarn').select('status, brand, name, aliases').eq('id', id).maybeSingle()
    if (readError) throw new Error(readError.message)
    if (!row || row.status === 'approved') { tally('skipped'); problems.push(`${meta.name}: ${row ? 'godkjent, ikke endret' : 'finnes ikke'}`); continue }
    // A corrected brand or name keeps the old one as a spelling, so links still find it.
    const aliases = mergeAliases(row.aliases, [{ brand: row.brand, name: row.name, certain: true, reason: null }])
    if (flag('--dry-run')) { tally('dry-run'); continue }
    const { error } = await db.from('strikk_yarn').update({
      ...y, brand: y.brand || row.brand, name: y.name || row.name, aliases,
      has_plastic: hasPlastic(y.fibers), status: 'looked_up', updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { tally('error'); problems.push(`${meta.name}: ${error.message}`); continue }
    writeFileSync(join(rdir, 'lagret.json'), JSON.stringify({ saved_at: new Date().toISOString() }))
    tally('saved')
  }
  console.log(JSON.stringify(count))
  for (const p of problems) console.log(`- ${p}`)
}

else if (cmd === 'check') {
  // Checks one lookup answer against the schema without touching the database.
  if (!arg || !existsSync(arg)) throw new Error('Oppgi svar.json')
  const answer = JSON.parse(readFileSync(arg, 'utf8'))
  const errors = schemaErrors(YARN_SCHEMA, answer)
  if (errors.length) { console.log(`FEIL: ${errors.join('; ')}`); process.exit(1) }
  const y = normalizeYarn(answer)
  const missing = missingFields(y).filter(f => !y.uncertain_fields.includes(f))
  console.log(missing.length ? `ok, men mangler uten å stå i uncertain: ${missing.join(', ')}` : 'ok')
}

else if (cmd === 'link') {
  const [yarns, lines] = await Promise.all([loadYarns(), loadLines()])
  const plan = linkPlan(lines, yarns, new Set(generic().map(g => g.key)))
  const db = admin()
  let failed = 0
  if (!flag('--dry-run')) {
    for (const u of plan.updates) {
      const { error } = await db.from(u.table).update(u.values).eq('id', u.id)
      if (error) { failed++; console.log(`- ${u.id}: ${error.message}`) }
    }
  }
  console.log(JSON.stringify({ ...plan.counts, updated: plan.updates.length - failed, failed }))
}

else if (cmd === 'status') {
  const [yarns, lines] = await Promise.all([all('strikk_yarn', 'id, status, has_plastic, uncertain_fields, discontinued'), loadLines()])
  const by = {}
  for (const y of yarns) by[y.status] = (by[y.status] ?? 0) + 1
  console.log(JSON.stringify({
    yarns: yarns.length, ...by,
    plastic: yarns.filter(y => y.has_plastic).length, discontinued: yarns.filter(y => y.discontinued).length,
    with_uncertain: yarns.filter(y => y.uncertain_fields.length).length,
    lines: lines.length, linked: lines.filter(l => l.yarn_id).length,
    linked_uncertain: lines.filter(l => l.yarn_id && l.yarn_link_uncertain).length,
    generic: lines.filter(l => !l.yarn_id && l.yarn_link_reason === GENERIC_REASON).length,
    not_linked: lines.filter(l => !l.yarn_id && l.yarn_link_reason !== GENERIC_REASON).length,
  }))
}

else {
  console.log('Bruk: collect | create <fil> | prepare [--size N] | check <svar.json> | save <mappe> [--dry-run] | link [--dry-run] | status')
}
