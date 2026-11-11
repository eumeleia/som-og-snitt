// Pure helpers for reading knitting patterns in locally with Claude Code. See
// docs/strikk-innlesing.md. No API keys for Claude; Supabase only.
import { EXTRACTION_SCHEMA, normalizeExtraction, schemaErrors } from '../../src/app/strikk/_lib/extraction.ts'

export const LOCAL_DIR = 'strikk/Strikkeoppskrifter ryddet'
export const ROUND_SIZE = 20
export const TODO_STATUSES = ['pending', 'failed']

// macOS keeps æ, ø and å decomposed in file names; Supabase has them composed.
const key = s => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

// The local PDF for a recipe: by its file name, then by «Oppskrift - Designer.pdf»
// built from the row, then by title alone. null when none of them is there.
export function findLocalPdf(row, localNames) {
  const byKey = new Map(localNames.map(n => [key(n), n]))
  const candidates = [
    row.file_name,
    row.designer ? `${row.title} - ${row.designer}.pdf` : null,
    `${row.title}.pdf`,
  ].filter(Boolean)
  for (const c of candidates) {
    const hit = byKey.get(key(c))
    if (hit) return hit
  }
  return null
}

// The next recipes to read: not read yet or failed, oldest first. Approved and already
// read recipes are never picked, nor those that already have an answer waiting to be
// saved in an earlier round (answered).
export function nextRound(rows, size = ROUND_SIZE, answered = new Set()) {
  return rows
    .filter(r => TODO_STATUSES.includes(r.extraction_status) && !answered.has(r.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, size)
}

// Pages whose text layer is too thin to read from: rendered as images for reading.
export function needsImage(text) {
  return (text.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length < 200
}

// Checks one answer and saves it through strikk_save_extraction, as a new extraction
// («Til gjennomgang»). db: { status(id) → current status, audience?(id) → the audience
// stored on the row, save(id, data) → rpc result }. A recipe not read yet has only what
// Maria filled in at upload, so her audience wins over the one read from the PDF.
export async function saveAnswer({ id, answer, pages }, db) {
  const errors = schemaErrors(EXTRACTION_SCHEMA, answer)
  if (errors.length) return { id, result: 'invalid', errors: errors.slice(0, 10) }
  const status = await db.status(id)
  if (!TODO_STATUSES.includes(status)) return { id, result: 'skipped', status }
  const data = normalizeExtraction(answer)
  const given = db.audience ? await db.audience(id) : null
  if (given) data.audience = given
  const result = await db.save(id, { ...data, pages, raw: { source: 'claude-code', answer } })
  return { id, result }
}

// A recipe uploaded in the app is only in Drive. The app hands out a short-lived Drive
// token (/api/strikk/token), so the PDF is fetched the same way the browser does it.
export const APP_URL = process.env.STRIKK_APP_URL ?? 'https://som-og-snitt.vercel.app'

export async function downloadFromDrive(fileId, fetchImpl = fetch) {
  const t = await fetchImpl(`${APP_URL}/api/strikk/token`, { cache: 'no-store' })
  const body = await t.json().catch(() => ({}))
  if (!t.ok || !body.accessToken) throw new Error(body.error ?? `Token feilet (${t.status})`)
  const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${body.accessToken}` },
  })
  if (!res.ok) throw new Error(`Henting fra Disk feilet (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
