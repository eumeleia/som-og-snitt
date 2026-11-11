// Garnlageret i Strikk, fylt lokalt av Claude Code fra bilder. Se docs/garnlager-registrering.md.
//   node --no-warnings --env-file=.env.local scripts/strikk/stash.mjs <command>
//
//   convert            strikk/garnbilder → små JPEG-kopier i strikk/garnlager-arbeid/bilder/,
//                       til gjennomsyn (hopper over bilder som alt er konvertert)
//   rounds [--size N] [--all]
//                       neste runde(r) med bilder som ikke er tatt med ennå, i filnavn-
//                       rekkefølge, med INSTRUKS.md og manifest.json
//   check <funn.json>  ett funn.json mot skjemaet, uten databasen
//   save [mappe]        funn.json i hver runde-mappe (standard: alle i strikk/garnlager-arbeid)
//                       inn i garnlageret, status «Til gjennomgang». Garn som ikke finnes i
//                       katalogen fra før, legges inn der som utkast.
//   status              antall rader i garnlageret per status
//
// Reads with the anon key, writes with the service role key. No Claude API.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, basename, extname } from 'path'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { schemaErrors } from '../../src/app/strikk/_lib/extraction.ts'
import { FINDING_SCHEMA, THUMBNAIL_MAX_BYTES, THUMBNAIL_PREFIX, normalizeFinding } from '../../src/app/strikk/_lib/stash.ts'
import { aliasKey, matchYarn } from '../../src/app/strikk/_lib/yarns.ts'

const SRC = 'strikk/garnbilder'
const WORK = 'strikk/garnlager-arbeid'
const PICS = join(WORK, 'bilder')
const BUCKET = 'strikk-thumbnails'
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

// Tries ever smaller sizes and JPEG quality until the thumbnail is under THUMBNAIL_MAX_BYTES.
async function makeThumbnail(buf) {
  for (const side of [800, 600, 450, 320, 220]) {
    for (const quality of [80, 65, 50, 35, 20]) {
      const out = await sharp(buf).rotate()
        .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer()
      if (out.length <= THUMBNAIL_MAX_BYTES) return out
    }
  }
  throw new Error('Klarte ikke gjøre miniatyrbildet lite nok')
}

if (cmd === 'convert') {
  mkdirSync(PICS, { recursive: true })
  if (!existsSync(SRC)) throw new Error(`Finner ikke ${SRC}`)
  const files = readdirSync(SRC).filter(f => !f.startsWith('.')).sort()
  let done = 0, skipped = 0, failed = 0
  for (const f of files) {
    const out = join(PICS, `${basename(f, extname(f))}.jpg`)
    if (existsSync(out)) { skipped++; continue }
    try {
      // sips leser ekte iPhone-HEIC fint (CoreImage/ImageIO) og retter EXIF-rotasjonen selv.
      execFileSync('sips', ['-s', 'format', 'jpeg', '--resampleWidth', '1200', join(SRC, f), '--out', out], { stdio: 'pipe' })
      done++
    } catch (err) {
      failed++
      console.log(`- ${f}: ${err.message.split('\n')[0]}`)
    }
  }
  console.log(`${done} bilder konvertert, ${skipped} fantes fra før, ${failed} feilet, ${files.length} totalt → ${PICS}`)
}

else if (cmd === 'rounds') {
  if (!existsSync(SRC)) throw new Error(`Finner ikke ${SRC}`)
  const files = readdirSync(SRC).filter(f => !f.startsWith('.')).sort()
  const size = flag('--size') ? Number(process.argv[process.argv.indexOf('--size') + 1]) : 20
  mkdirSync(WORK, { recursive: true })
  const existingRounds = readdirSync(WORK, { withFileTypes: true }).filter(d => d.isDirectory() && d.name.startsWith('runde-')).map(d => d.name).sort()
  const taken = new Set()
  for (const d of existingRounds) {
    const manifestFile = join(WORK, d, 'manifest.json')
    if (existsSync(manifestFile)) for (const f of JSON.parse(readFileSync(manifestFile, 'utf8'))) taken.add(f)
  }
  let n = existingRounds.length
  let madeAny = false
  const instruksBase = readFileSync('docs/garnlager-registrering.md', 'utf8')
    + `\n\n## Skjema for funn.json (én liste, ett objekt per funn)\n\n\`\`\`json\n${JSON.stringify(FINDING_SCHEMA, null, 1)}\n\`\`\`\n`

  for (;;) {
    const remaining = files.filter(f => !taken.has(f))
    if (remaining.length === 0) break
    n++
    const overlap = n > 1 ? [files[files.indexOf(remaining[0]) - 1]].filter(Boolean) : []
    const batch = remaining.slice(0, size)
    const manifest = [...overlap, ...batch]
    const dir = join(WORK, `runde-${String(n).padStart(2, '0')}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1))
    writeFileSync(join(dir, 'INSTRUKS.md'), instruksBase)
    for (const f of batch) taken.add(f)
    madeAny = true
    console.log(`${dir}: ${manifest.length} bilder (${overlap.length} til gjenkjenning, ${batch.length} nye)`)
    if (!flag('--all')) break
  }
  if (!madeAny) console.log('Ingen nye bilder å lage runder av.')
}

else if (cmd === 'check') {
  if (!arg || !existsSync(arg)) throw new Error('Oppgi funn.json')
  const findings = JSON.parse(readFileSync(arg, 'utf8'))
  const errors = schemaErrors({ type: 'array', items: FINDING_SCHEMA }, findings)
  if (errors.length) { console.log(`FEIL: ${errors.slice(0, 10).join('; ')}`); process.exit(1) }
  console.log(`ok, ${findings.length} funn`)
}

else if (cmd === 'save') {
  const dirs = arg && !arg.startsWith('--')
    ? [arg]
    : (existsSync(WORK) ? readdirSync(WORK, { withFileTypes: true }).filter(d => d.isDirectory() && d.name.startsWith('runde-')).map(d => join(WORK, d.name)) : [])
  const db = admin()
  const yarns = await all('strikk_yarn', 'id, brand, name, aliases')
  const count = { saved: 0, 'already-saved': 0, 'no-answer': 0, invalid: 0, 'new-yarn': 0, error: 0 }
  const problems = []
  const dryRun = flag('--dry-run')

  for (const dir of dirs) {
    if (existsSync(join(dir, 'lagret.json'))) { count['already-saved']++; continue }
    const file = join(dir, 'funn.json')
    if (!existsSync(file)) { count['no-answer']++; continue }
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const errors = schemaErrors({ type: 'array', items: FINDING_SCHEMA }, raw)
    if (errors.length) { count.invalid++; problems.push(`${dir}: ${errors.slice(0, 5).join('; ')}`); continue }

    let dirFailed = false
    for (const raw1 of raw) {
      const f = normalizeFinding(raw1)
      try {
        let yarnId
        const m = matchYarn(yarns, f.brand, f.name)
        if (m) {
          yarnId = m.yarn.id
        } else if (!dryRun) {
          const { data, error } = await db.from('strikk_yarn')
            .insert({ brand: f.brand, name: f.name, status: 'draft' })
            .select('id, brand, name, aliases').single()
          if (error) throw new Error(error.message)
          yarns.push(data)
          yarnId = data.id
          count['new-yarn']++
        } else {
          count['new-yarn']++
        }

        const imageName = f.thumbnail_image && f.images.includes(f.thumbnail_image) ? f.thumbnail_image : f.images[0]
        const imagePath = imageName && join(PICS, `${basename(imageName, extname(imageName))}.jpg`)
        let thumbnailPath = null
        if (imagePath && existsSync(imagePath) && !dryRun) {
          const id = randomUUID()
          const thumb = await makeThumbnail(readFileSync(imagePath))
          const path = `${THUMBNAIL_PREFIX}${id}.jpg`
          const { error: upErr } = await db.storage.from(BUCKET).upload(path, thumb, { contentType: 'image/jpeg', upsert: true })
          if (upErr) throw new Error(upErr.message)
          thumbnailPath = path
        }

        if (!dryRun) {
          const { error } = await db.from('strikk_yarn_stash').insert({
            yarn_id: yarnId, color_number: f.color_number, color_name: f.color_name,
            skein_count: f.skein_count, leftover_g: f.leftover_g, thumbnail_path: thumbnailPath,
            source_images: f.images, note: f.note,
            uncertain_fields: f.uncertain_fields, uncertain_reasons: f.uncertain_reasons,
          })
          if (error) throw new Error(error.message)
        }
        count.saved++
      } catch (err) {
        dirFailed = true
        count.error++
        problems.push(`${dir} (${f.brand} ${f.name}): ${err.message}`)
      }
    }
    if (!dirFailed && !dryRun) writeFileSync(join(dir, 'lagret.json'), JSON.stringify({ saved_at: new Date().toISOString() }))
  }
  console.log(JSON.stringify(count))
  for (const p of problems) console.log(`- ${p}`)
}

else if (cmd === 'status') {
  const rows = await all('strikk_yarn_stash', 'id, status, skein_count')
  const by = {}
  for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1
  console.log(JSON.stringify({ rows: rows.length, ...by, skeins: rows.reduce((s, r) => s + Number(r.skein_count ?? 0), 0) }))
}

else {
  console.log('Bruk: convert | rounds [--size N] [--all] | check <funn.json> | save [mappe] [--dry-run] | status')
}
