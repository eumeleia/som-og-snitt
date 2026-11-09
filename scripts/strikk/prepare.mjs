// Prepares the next round of knitting patterns to be read in by Claude Code:
//   node --no-warnings --env-file=.env.local scripts/strikk/prepare.mjs [--size 20]
// Writes strikk/innlesing/runde-N/: INSTRUKS.md, and per recipe a folder with
// meta.json, tekst.txt (every page) and side-N.png for pages without a text layer.
// Reads Supabase with the anon key only. See docs/strikk-innlesing.md.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { EXTRACTION_SCHEMA, buildExtractionPrompt, normalizePageText, planPages } from '../../src/app/strikk/_lib/extraction.ts'
import { LOCAL_DIR, ROUND_SIZE, findLocalPdf, needsImage, nextRound } from './lib.mjs'

const OUT = 'strikk/innlesing'
const MAX_IMAGES = 6
const sizeArg = process.argv.indexOf('--size')
const size = sizeArg > 0 ? Number(process.argv[sizeArg + 1]) : ROUND_SIZE

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const { data: rows, error } = await sb.from('strikk_oppskrift').select('id, title, designer, file_name, created_at, extraction_status')
if (error) throw new Error(error.message)
const { data: corr, error: corrError } = await sb
  .from('strikk_extraction_correction').select('recipe_title, field, extracted, corrected').order('created_at', { ascending: false })
if (corrError) throw new Error(corrError.message)

mkdirSync(OUT, { recursive: true })
// Answers from earlier rounds not saved yet (e.g. refused by the database): save.mjs on
// that round saves them; reading them again would only duplicate the work.
const answered = new Set()
for (const d of readdirSync(OUT).filter(d => d.startsWith('runde-'))) {
  for (const id of readdirSync(join(OUT, d))) {
    if (existsSync(join(OUT, d, id, 'svar.json')) && !existsSync(join(OUT, d, id, 'lagret.json'))) answered.add(id)
  }
}
if (answered.size) console.log(`${answered.size} har svar som ikke er lagret ennå; kjør save.mjs på rundene deres. De tas ikke med her.`)

const round = nextRound(rows, size, answered)
const left = rows.filter(r => r.extraction_status === 'pending' || r.extraction_status === 'failed').length
if (round.length === 0) {
  console.log('Ingenting å lese inn: ingen oppskrifter står som «Ikke lest» eller «Feilet» uten svar.')
  process.exit(0)
}

const n = readdirSync(OUT).filter(d => d.startsWith('runde-')).length + 1
const dir = join(OUT, `runde-${n}`)
mkdirSync(dir)

writeFileSync(join(dir, 'INSTRUKS.md'), `# Lesing av strikkeoppskrifter, runde ${n}

Les hver oppskrift i denne mappa og skriv svaret som \`svar.json\` i oppskriftens mappe.
Svaret skal følge skjemaet under nøyaktig, slik uttrekket i appen gjorde det. Les
\`tekst.txt\` (alle sidene, med «--- Side N ---») og se på \`side-N.png\` der de finnes;
de er sider uten tekstlag, typisk skannede. \`meta.json\` sier hvilke sider uttrekket i appen
ville valgt (\`planned_pages\`); oppgi \`amounts_page\` etter sidetallene.

Regler, og rettelsene Maria har gjort (alle, nyeste først):

${buildExtractionPrompt(corr ?? [], Infinity)}

## Skjema for svar.json

\`\`\`json
${JSON.stringify(EXTRACTION_SCHEMA, null, 1)}
\`\`\`
`)

const localNames = readdirSync(LOCAL_DIR)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const missing = []
for (const r of round) {
  const local = findLocalPdf(r, localNames)
  if (!local) { missing.push({ id: r.id, title: r.title, designer: r.designer, file_name: r.file_name }); continue }
  const rdir = join(dir, r.id)
  mkdirSync(rdir)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(LOCAL_DIR, local))), verbosity: 0 }).promise
  const texts = []
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent()
    texts.push({ page: p, text: normalizePageText(c.items.map(it => (it.str ?? '') + (it.hasEOL ? '\n' : ' ')).join('')) })
  }
  const plan = planPages(texts)
  const images = []
  for (const t of texts.filter(t => needsImage(t.text)).slice(0, MAX_IMAGES)) {
    const page = await doc.getPage(t.page)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 1600 / Math.max(base.width, base.height) })
    const { canvas, context } = doc.canvasFactory.create(Math.round(viewport.width), Math.round(viewport.height))
    await page.render({ canvas, canvasContext: context, viewport, background: 'white' }).promise
    writeFileSync(join(rdir, `side-${t.page}.png`), await canvas.encode('png'))
    images.push(t.page)
  }
  await doc.destroy()
  writeFileSync(join(rdir, 'tekst.txt'), texts.map(t => `--- Side ${t.page} ---\n${t.text}`).join('\n\n'))
  writeFileSync(join(rdir, 'meta.json'), JSON.stringify({
    id: r.id, title: r.title, designer: r.designer, file_name: r.file_name, local_pdf: local,
    pages: texts.length, planned_pages: plan.pages, mode: plan.mode, images,
  }, null, 1))
}
writeFileSync(join(dir, 'mangler.json'), JSON.stringify(missing, null, 1))
const all = join(OUT, 'mangler-alle.json')
const prev = existsSync(all) ? JSON.parse(readFileSync(all, 'utf8')) : []
writeFileSync(all, JSON.stringify([...prev.filter(p => !missing.some(m => m.id === p.id)), ...missing], null, 1))

console.log(`${dir}: ${round.length - missing.length} oppskrifter klare, ${missing.length} uten lokal PDF, ${left} igjen før denne runden.`)
