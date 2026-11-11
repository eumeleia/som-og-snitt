// Claude Code checks recipes against their PDFs and approves them. See docs/strikk-innlesing.md.
//   node --no-warnings --env-file=.env.local scripts/strikk/check.mjs <command>
//
//   prepare            every recipe «Til gjennomgang» not checked yet → strikk/innlesing/kontroll/
//   check <file>       one kontroll.json, without the database
//   save [--dry-run]   checked recipes through strikk_save_extraction: approved, or kept for
//                      Maria with their marks
//
// Never writes strikk_extraction_correction: those are Maria's own corrections, which the
// next read-in learns from. No Claude API.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { EXTRACTION_SELECT, buildExtractionPrompt, clearUncertain, normalizeExtraction, storedToExtraction } from '../../src/app/strikk/_lib/extraction.ts'
import { formatFibers } from '../../src/app/strikk/_lib/yarns.ts'
import { checkErrors } from './check-lib.mjs'

const OUT = 'strikk/innlesing/kontroll'
const [cmd, arg] = process.argv.slice(2)
const dry = process.argv.includes('--dry-run')

if (cmd === 'check') {
  if (!arg || !existsSync(arg)) throw new Error('Oppgi kontroll.json')
  const errors = checkErrors(JSON.parse(readFileSync(arg, 'utf8')))
  console.log(errors.length ? `FEIL: ${errors.join('; ')}` : 'ok')
  process.exit(errors.length ? 1 : 0)
}

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

if (cmd === 'prepare') {
  const { data: recipes, error } = await anon.from('strikk_oppskrift').select(EXTRACTION_SELECT).eq('extraction_status', 'extracted')
  if (error) throw new Error(error.message)
  const { data: yarns } = await anon.from('strikk_yarn').select('*')
  const Y = new Map((yarns ?? []).map(y => [y.id, y]))
  const { data: corr } = await anon.from('strikk_extraction_correction').select('recipe_title, field, extracted, corrected').order('created_at', { ascending: false })
  // The page text and images the read-in left behind.
  const readIn = new Map()
  for (const d of readdirSync('strikk/innlesing').filter(d => d.startsWith('runde-'))) {
    for (const id of readdirSync(join('strikk/innlesing', d))) {
      if (existsSync(join('strikk/innlesing', d, id, 'tekst.txt'))) readIn.set(id, join('strikk/innlesing', d, id))
    }
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'INSTRUKS.md'), readFileSync('scripts/strikk/recipe-check.md', 'utf8') +
    `\n\n## Lesereglene og Marias rettelser (alle, nyeste først)\n\n${buildExtractionPrompt(corr ?? [], Infinity)}\n`)
  let added = 0
  const noText = []
  for (const r of recipes) {
    const dir = join(OUT, r.id)
    // A recipe kept for Maria after an earlier check is not checked again.
    if (existsSync(join(dir, 'data.json'))) continue
    if (!readIn.get(r.id)) { noText.push(r.title); continue }
    mkdirSync(dir, { recursive: true })
    const d = storedToExtraction(r)
    const catalogue = d.yarn_lines.map((l, i) => {
      const y = l.yarn_id ? Y.get(l.yarn_id) : null
      return y ? { yarn_line: i, brand: y.brand, name: y.name, fibers: formatFibers(y.fibers), skein_weight_g: y.skein_weight_g, meterage_m: y.meterage_m, discontinued: y.discontinued } : null
    }).filter(Boolean)
    writeFileSync(join(dir, 'data.json'), JSON.stringify(d, null, 1))
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: r.id, title: r.title, designer: r.designer, file_name: r.file_name, read_in: readIn.get(r.id), catalogue }, null, 1))
    added++
  }
  const open = readdirSync(OUT).filter(d => existsSync(join(OUT, d, 'meta.json')) && !existsSync(join(OUT, d, 'kontroll.json')))
  console.log(`${added} nye til kontroll, ${open.length} uten kontroll.json i ${OUT}`)
  for (const t of noText) console.log(`- ${t}: ingen tekst fra innlesingen, les den inn på nytt`)
}

else if (cmd === 'save') {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const count = {}
  const notes = []
  const tally = k => { count[k] = (count[k] ?? 0) + 1 }
  for (const id of readdirSync(OUT).filter(d => existsSync(join(OUT, d, 'meta.json')))) {
    const dir = join(OUT, id)
    if (existsSync(join(dir, 'lagret.json'))) { tally('already-saved'); continue }
    if (!existsSync(join(dir, 'kontroll.json'))) { tally('not-checked'); continue }
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
    const k = JSON.parse(readFileSync(join(dir, 'kontroll.json'), 'utf8'))
    const errors = checkErrors(k)
    if (errors.length) { tally('invalid'); notes.push(`${meta.title}: ${errors.join('; ')}`); continue }
    const { data: row, error } = await db.from('strikk_oppskrift').select('extraction_status, extraction_raw, extraction_pages').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!row || row.extraction_status !== 'extracted') { tally('skipped'); notes.push(`${meta.title}: status ${row?.extraction_status ?? 'mangler'}`); continue }
    const data = normalizeExtraction(k.data)
    // Kept for Maria: saved with its marks, and the stored raw answer and pages kept, which
    // the save function would otherwise overwrite.
    const payload = k.approve ? clearUncertain(data) : { ...data, raw: row.extraction_raw, pages: row.extraction_pages ?? [] }
    if (!k.approve) notes.push(`${meta.title}: ikke godkjent – ${k.note}`)
    if (dry) { tally(k.approve ? 'would-approve' : 'would-keep'); continue }
    const { data: result, error: e2 } = await db.rpc('strikk_save_extraction', { p_id: id, p_data: payload, p_approve: k.approve, p_edit_approved: false })
    if (e2) { tally('error'); notes.push(`${meta.title}: ${e2.message}`); continue }
    tally(result)
    writeFileSync(join(dir, 'lagret.json'), JSON.stringify({ saved_at: new Date().toISOString(), result }))
  }
  console.log(JSON.stringify(count))
  for (const n of notes) console.log(`- ${n}`)
}

else {
  console.log('Bruk: prepare | check <kontroll.json> | save [--dry-run]')
}
