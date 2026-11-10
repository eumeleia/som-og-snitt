// Saves the answers Claude Code wrote for a round, as «Til gjennomgang»:
//   node --no-warnings --env-file=.env.local scripts/strikk/save.mjs strikk/innlesing/runde-N [--dry-run]
// Each svar.json is checked against the schema and normalised as in the app, and saved
// through strikk_save_extraction with the service role key. Approved or already read
// recipes are skipped; the save function refuses approved ones too. A saved recipe gets
// lagret.json and is not saved twice. It also gets the leftover-yarn mark from tekst.txt.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { saveAnswer } from './lib.mjs'
import { findLeftoverMention, hasSearchableText } from '../../src/app/strikk/_lib/leftover.ts'

const dir = process.argv[2]
const dryRun = process.argv.includes('--dry-run')
if (!dir || !existsSync(dir)) throw new Error('Oppgi mappa for runden, f.eks. strikk/innlesing/runde-1')

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const db = {
  async status(id) {
    const { data, error } = await sb.from('strikk_oppskrift').select('extraction_status').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data?.extraction_status ?? 'missing'
  },
  async save(id, data) {
    if (dryRun) return 'dry-run'
    const { data: result, error } = await sb.rpc('strikk_save_extraction', { p_id: id, p_data: data, p_approve: false })
    if (error) throw new Error(error.message)
    return result
  },
}

const results = []
for (const id of readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
  const rdir = join(dir, id)
  if (existsSync(join(rdir, 'lagret.json'))) { results.push({ id, result: 'already-saved' }); continue }
  if (!existsSync(join(rdir, 'svar.json'))) { results.push({ id, result: 'no-answer' }); continue }
  const meta = JSON.parse(readFileSync(join(rdir, 'meta.json'), 'utf8'))
  let answer
  try { answer = JSON.parse(readFileSync(join(rdir, 'svar.json'), 'utf8')) } catch (e) { results.push({ id, title: meta.title, result: 'invalid', errors: [e.message] }); continue }
  const pages = meta.mode === 'images' ? meta.images : meta.planned_pages
  try {
    const r = await saveAnswer({ id, answer, pages }, db)
    results.push({ ...r, title: meta.title })
    if (r.result === 'saved') {
      // The leftover-yarn mark, from the same page text the answer was read from.
      const text = existsSync(join(rdir, 'tekst.txt')) ? readFileSync(join(rdir, 'tekst.txt'), 'utf8') : ''
      if (hasSearchableText(text)) {
        const note = findLeftoverMention(text)
        const { error: e } = await sb.from('strikk_oppskrift').update({ mentions_leftover: !!note, leftover_note: note }).eq('id', id)
        if (e) results.push({ id, title: meta.title, result: 'leftover-mark-failed', errors: [e.message] })
      }
      writeFileSync(join(rdir, 'lagret.json'), JSON.stringify({ saved_at: new Date().toISOString() }))
    }
  } catch (e) {
    results.push({ id, title: meta.title, result: 'error', errors: [e.message] })
  }
}

const count = {}
for (const r of results) count[r.result] = (count[r.result] ?? 0) + 1
console.log(JSON.stringify(count))
for (const r of results.filter(r => !['saved', 'already-saved', 'dry-run'].includes(r.result))) {
  console.log(`- ${r.title ?? r.id}: ${r.result}${r.status ? ` (${r.status})` : ''}${r.errors ? `: ${r.errors.join('; ')}` : ''}`)
}
