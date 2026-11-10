// Marks recipes whose own text mentions leftover yarn (restegarn, rester, leftover …):
//   node --no-warnings --env-file=.env.local scripts/strikk/leftover.mjs [--all] [--dry-run]
// Reads the local PDFs in strikk/Strikkeoppskrifter ryddet. Without --all only recipes not
// checked yet (mentions_leftover is null). A PDF without a text layer stays unchecked.
// Writes only mentions_leftover and leftover_note, with the service role key. No Claude API.
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { normalizePageText } from '../../src/app/strikk/_lib/extraction.ts'
import { findLeftoverMention, hasSearchableText } from '../../src/app/strikk/_lib/leftover.ts'
import { LOCAL_DIR, findLocalPdf } from './lib.mjs'

const dryRun = process.argv.includes('--dry-run')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const all = process.argv.includes('--all')
const { data: rows, error } = await db.from('strikk_oppskrift').select(`id, title, designer, file_name${all ? '' : ', mentions_leftover'}`)
if (error) throw new Error(error.message)

const localNames = readdirSync(LOCAL_DIR)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const count = { yes: 0, no: 0, no_text: 0, no_pdf: 0, skipped: 0 }
const found = []
for (const r of rows) {
  if (!all && r.mentions_leftover !== null) { count.skipped++; continue }
  const local = findLocalPdf(r, localNames)
  if (!local) { count.no_pdf++; continue }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(LOCAL_DIR, local))), verbosity: 0 }).promise
  let text = ''
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent()
    text += normalizePageText(c.items.map(it => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('')) + '\n'
  }
  if (!hasSearchableText(text)) { count.no_text++; continue }
  const note = findLeftoverMention(text)
  count[note ? 'yes' : 'no']++
  if (note) found.push(`${r.title}: ${note}`)
  if (dryRun) continue
  const { error: e } = await db.from('strikk_oppskrift').update({ mentions_leftover: !!note, leftover_note: note }).eq('id', r.id)
  if (e) throw new Error(`${r.title}: ${e.message}`)
}
console.log(JSON.stringify(count))
for (const f of found) console.log(`- ${f}`)
