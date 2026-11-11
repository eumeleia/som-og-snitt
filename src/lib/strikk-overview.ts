// Writes «Strikkeoversikt.xlsx» to the Strikk folder in Drive. The file is a copy for
// reading and filtering; the database is what counts, so the file is always overwritten.
import { createHash } from 'crypto'
import { Readable } from 'stream'
import ExcelJS from 'exceljs'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { getStrikkOAuth2Client } from '@/lib/strikk-drive'
import { KNIT_FOLDER_NAME, getOrCreateTopLevelFolder } from '@/lib/knit-folder'
import { EXTRACTION_SELECT, type StoredRecipe } from '@/app/strikk/_lib/extraction'
import type { YarnRow } from '@/app/strikk/_lib/yarns'
import { OVERVIEW_FILE_NAME, overviewSheets, planOverviewWrite, type Sheet } from '@/app/strikk/_lib/overview'
import { COMBO_SELECT, comboFromRow, type ComboRow } from '@/app/strikk/_lib/combos'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const STATE_KEY = 'strikk_overview'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface OverviewState { file_id: string | null; hash: string | null; written_at: string | null }

export async function workbookBuffer(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.addRow(s.headers).font = { bold: true }
    for (const row of s.rows) ws.addRow(row.map(c => (c && typeof c === 'object' ? { text: c.text, hyperlink: c.hyperlink } : c ?? null)))
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.headers.length } }
    ws.columns.forEach((col, i) => {
      const longest = Math.max(s.headers[i].length, ...s.rows.map(r => {
        const c = r[i]
        return c === null ? 0 : String(typeof c === 'object' ? c.text : c).length
      }))
      col.width = Math.min(60, Math.max(8, longest + 2))
    })
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

async function all<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data as T[]))
    if (data.length < 1000) return out
  }
}

async function readState(): Promise<OverviewState> {
  const { data, error } = await supabaseAdmin.from('app_config').select('value').eq('key', STATE_KEY).maybeSingle()
  if (error) throw new Error(error.message)
  return { file_id: null, hash: null, written_at: null, ...(data?.value as Partial<OverviewState> | undefined) }
}

export async function writeOverview(force: boolean): Promise<{ status: 'created' | 'updated' | 'unchanged'; recipes: number; yarns: number }> {
  const [recipes, yarns, comboRows] = await Promise.all([
    all<StoredRecipe>('strikk_oppskrift', EXTRACTION_SELECT),
    all<YarnRow>('strikk_yarn', '*'),
    all<ComboRow>('strikk_yarn_combo', COMBO_SELECT),
  ])
  const sheets = overviewSheets(recipes, yarns, comboRows.map(comboFromRow))
  const hash = createHash('sha256').update(JSON.stringify(sheets)).digest('hex')

  const drive = google.drive({ version: 'v3', auth: await getStrikkOAuth2Client() })
  const state = await readState()
  // drive.file only sees files this app made, so a file of the same name made by hand is never touched.
  let fileId = state.file_id
  if (fileId) {
    const found = await drive.files.get({ fileId, fields: 'id, trashed' }).then(r => r.data, () => null)
    if (!found || found.trashed) fileId = null
  }
  const folderId = await getOrCreateTopLevelFolder(drive.files, KNIT_FOLDER_NAME)
  if (!fileId) {
    const q = `name = '${OVERVIEW_FILE_NAME}' and '${folderId}' in parents and trashed = false`
    fileId = (await drive.files.list({ q, fields: 'files(id)', orderBy: 'createdTime', pageSize: 1 })).data.files?.[0]?.id ?? null
  }

  const plan = planOverviewWrite({ fileId, storedHash: state.hash, hash, force })
  const count = { recipes: sheets[0].rows.length, yarns: sheets[1].rows.length }
  if (plan === 'unchanged') return { status: 'unchanged', ...count }

  const media = { mimeType: XLSX_MIME, body: Readable.from(await workbookBuffer(sheets)) }
  if (plan === 'update') {
    await drive.files.update({ fileId: fileId!, media, fields: 'id' })
  } else {
    const res = await drive.files.create({ requestBody: { name: OVERVIEW_FILE_NAME, parents: [folderId], mimeType: XLSX_MIME }, media, fields: 'id' })
    fileId = res.data.id ?? null
  }
  const value: OverviewState = { file_id: fileId, hash, written_at: new Date().toISOString() }
  const { error } = await supabaseAdmin.from('app_config').upsert({ key: STATE_KEY, value, updated_at: value.written_at }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  return { status: plan === 'update' ? 'updated' : 'created', ...count }
}
