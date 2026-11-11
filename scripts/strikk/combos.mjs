// Garnkombinasjoner (strikk_yarn_combo, migrasjon 021), hentet lokalt av Claude Code fra
// Skaberglæde og DROPS. See docs/strikk-innlesing.md.
//   node --no-warnings --env-file=.env.local scripts/strikk/combos.mjs <command>
//
//   import <rå.json>   matcher kombinasjonenes garn mot katalogen, skriver
//                       strikk/garn/combos-staged.json (klare + de som trenger garn)
//   save <staged.json>  setter de klare kombinasjonene inn i databasen [--dry-run]
//   status              hvor mange kombinasjoner er klare, hvor mange mangler garn
//
// Reads with the anon key, writes with the service role key. No Claude API.
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { matchYarn, spellingKey } from '../../src/app/strikk/_lib/yarns.ts'

// Skaberglæde seldom states the brand. When matchYarn (brand + name) misses, fall back to
// matching the name alone — only when exactly one catalogue yarn has that name, since more
// than one would be a guess. Always uncertain: a name-only match across brands can be wrong.
function matchByNameOnly(yarns, name) {
  const key = spellingKey(name)
  const hits = yarns.filter(y => spellingKey(y.name) === key || y.aliases.some(a => spellingKey(a.name) === key))
  return hits.length === 1 ? hits[0] : null
}

const OUT = 'strikk/garn'
const STAGED = `${OUT}/combos-staged.json`
const [cmd, arg] = process.argv.slice(2)
const flag = name => process.argv.includes(name)

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function loadYarns() {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await anon.from('strikk_yarn').select('id, brand, name, aliases').range(from, from + 999)
    if (error) throw new Error(`strikk_yarn: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

if (cmd === 'import') {
  if (!arg || !existsSync(arg)) throw new Error('Oppgi den rå fila, f.eks. strikk/garn/skaberglaede-combos-raw.json')
  const raw = JSON.parse(readFileSync(arg, 'utf8'))
  const yarns = await loadYarns()
  let ready = 0, needsYarn = 0
  const staged = raw.map(c => {
    const members = c.members.map(m => {
      const exact = matchYarn(yarns, m.brand, m.name)
      const byName = !exact ? matchByNameOnly(yarns, m.name) : null
      const yarn = exact?.yarn ?? byName
      const certain = exact ? exact.certain : false
      return { raw_brand: m.brand ?? null, raw_name: m.name, strands: m.strands ?? 1, yarn_id: yarn?.id ?? null, certain }
    })
    const complete = members.every(m => m.yarn_id)
    if (complete) ready++; else needsYarn++
    return { ...c, members, status: complete ? 'ready' : 'needs_yarn' }
  })
  writeFileSync(STAGED, JSON.stringify(staged, null, 1))
  console.log(`${ready} kombinasjoner klare, ${needsYarn} mangler minst ett garn i katalogen → ${STAGED}`)
}

else if (cmd === 'save') {
  if (!arg || !existsSync(arg)) throw new Error('Oppgi strikk/garn/combos-staged.json')
  const staged = JSON.parse(readFileSync(arg, 'utf8'))
  const db = admin()
  let saved = 0, skipped = 0
  for (const c of staged) {
    if (c.status !== 'ready') { skipped++; continue }
    if (flag('--dry-run')) { saved++; continue }
    const { data: combo, error: comboErr } = await db.from('strikk_yarn_combo').insert({
      source: c.source, source_url: c.source_url ?? null, stitch_pattern: c.stitch_pattern ?? null,
      gauge_stitches_10cm: c.gauge_stitches_10cm ?? null, gauge_rows_10cm: c.gauge_rows_10cm ?? null,
      needle_mm: c.needle_mm ?? null, note: c.note ?? null,
    }).select('id').single()
    if (comboErr) throw new Error(comboErr.message)
    const { error: memberErr } = await db.from('strikk_yarn_combo_member').insert(
      c.members.map((m, i) => ({ combo_id: combo.id, position: i, yarn_id: m.yarn_id, raw_brand: m.raw_brand, raw_name: m.raw_name, strands: m.strands })),
    )
    if (memberErr) throw new Error(memberErr.message)
    saved++
  }
  console.log(`${saved} kombinasjoner lagret, ${skipped} hoppet over (ikke klare)`)
}

else if (cmd === 'status') {
  const { data, error } = await anon.from('strikk_yarn_combo').select('id, source')
  if (error) throw new Error(error.message)
  const by = {}
  for (const c of data) by[c.source] = (by[c.source] ?? 0) + 1
  console.log(JSON.stringify({ total: data.length, ...by }))
}

else {
  console.log('Bruk: import <rå.json> | save <staged.json> [--dry-run] | status')
}
