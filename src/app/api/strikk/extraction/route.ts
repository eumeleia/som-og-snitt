import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { getStrikkOAuth2Client } from '@/lib/strikk-drive'
import { logDriveError } from '@/lib/drive-log'
import {
  EXTRACTION_PROMPT,
  EXTRACTION_SCHEMA,
  MAX_IMAGE_PAGES,
  MAX_TEXT_CHARS,
  MAX_TEXT_PAGES,
  driveFileName,
  normalizeExtraction,
} from '@/app/strikk/_lib/extraction'

// One Claude call per recipe; Opus with thinking on can take a minute or two on a
// pattern with many sizes and colours.
export const maxDuration = 300

const MODEL = 'claude-opus-5-5'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

interface Body {
  recipeId?: string
  pages?: { page: number; text: string }[]
  images?: { page: number; data: string }[]
  // New uploads: rename the Drive file to «Oppskrift - Designer.pdf» and take the
  // title and designer from the pattern.
  rename?: boolean
}

function userContent(body: Body): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = []
  for (const img of (body.images ?? []).slice(0, MAX_IMAGE_PAGES)) {
    content.push({ type: 'text', text: `Side ${img.page}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.data } })
  }
  const pages = (body.pages ?? []).slice(0, MAX_TEXT_PAGES)
  if (pages.length > 0) {
    const joined = pages.map(p => `--- Side ${p.page} ---\n${p.text}`).join('\n\n').slice(0, MAX_TEXT_CHARS)
    content.push({ type: 'text', text: `Tekst fra oppskriften (pdf.js):\n\n${joined}` })
  }
  if (content.length > 0) content.push({ type: 'text', text: 'Les ut oppskriftsdataene fra sidene over.' })
  return content
}

async function markFailed(id: string, message: string) {
  await supabaseAdmin
    .from('strikk_oppskrift')
    .update({ extraction_status: 'failed', extraction_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', id)
    .neq('extraction_status', 'approved')
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = await req.json() as Body
  } catch {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 })
  }
  const id = body.recipeId
  if (!id) return NextResponse.json({ error: 'recipeId er påkrevd' }, { status: 400 })

  const { data: row, error: readError } = await supabaseAdmin
    .from('strikk_oppskrift')
    .select('id, title, designer, file_name, drive_file_id, extraction_status')
    .eq('id', id)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })
  // Checked before the Claude call so an approved recipe costs nothing; the save
  // function checks again under a row lock.
  if (row.extraction_status === 'approved') return NextResponse.json({ status: 'approved' }, { status: 409 })

  const content = userContent(body)
  if (content.length === 0) return NextResponse.json({ error: 'Ingen sider å lese' }, { status: 400 })

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: EXTRACTION_PROMPT,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      messages: [{ role: 'user', content }],
    })
    if (msg.stop_reason === 'refusal') throw new Error('Claude avviste forespørselen')
    if (msg.stop_reason === 'max_tokens') throw new Error('Svaret fra Claude ble for langt og er kuttet')
    const textBlock = msg.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
    if (!textBlock) throw new Error('Claude svarte uten tekst')
    const raw = JSON.parse(textBlock.text) as unknown
    const data = normalizeExtraction(raw)
    const pages = [...(body.images ?? []).map(i => i.page), ...(body.pages ?? []).map(p => p.page)]

    const { data: result, error: saveError } = await supabaseAdmin.rpc('strikk_save_extraction', {
      p_id: id,
      p_data: { ...data, pages, raw },
      p_approve: false,
    })
    if (saveError) throw new Error(`Lagring feilet: ${saveError.message}`)
    if (result === 'locked') return NextResponse.json({ status: 'approved' }, { status: 409 })
    if (result === 'missing') return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })

    let renamed: { file_name: string; title: string; designer: string | null } | null = null
    let renameError: string | null = null
    if (body.rename) {
      const fileName = driveFileName(data.title, data.designer, row.file_name)
      try {
        const drive = google.drive({ version: 'v3', auth: await getStrikkOAuth2Client() })
        await drive.files.update({ fileId: row.drive_file_id, requestBody: { name: fileName }, fields: 'id' })
        renamed = { file_name: fileName, title: data.title ?? row.title, designer: data.designer ?? row.designer }
        const { error } = await supabaseAdmin.from('strikk_oppskrift').update(renamed).eq('id', id)
        if (error) throw new Error(error.message)
      } catch (err) {
        // The extraction itself is saved; only the file name stays as uploaded.
        logDriveError('strikk/extraction rename', err)
        renameError = err instanceof Error ? err.message : 'Ukjent feil'
      }
    }

    return NextResponse.json({ status: 'extracted', data, renamed, renameError })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ukjent feil'
    console.error(`[strikk/extraction] ${id}: ${message.slice(0, 300)}`)
    await markFailed(id, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
