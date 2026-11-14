import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { getStrikkOAuth2Client } from '@/lib/strikk-drive'
import { driveErrorResponse } from '../../../driveError'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Vercel's limit for a request body to an API route.
const MAX_BYTES = 4.5 * 1024 * 1024

// Replaces the content of a recipe's PDF on Drive with a new version, for example the
// two-column layout (docs/oppskrift-oppsett.md). The file keeps its Drive id, so the
// recipe, its projects and links still point to it, and Drive keeps the earlier version.
// Not for the app's pages: it takes the service role key and is used from Claude Code.
export async function POST(req: NextRequest, ctx: RouteContext<'/api/strikk/oppskrifter/[id]/pdf'>) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || req.headers.get('authorization') !== `Bearer ${key}`) {
    return NextResponse.json({ error: 'Ikke tilgang' }, { status: 401 })
  }
  try {
    const { id } = await ctx.params
    if (req.headers.get('content-type') !== 'application/pdf') {
      return NextResponse.json({ error: 'Filen må være PDF' }, { status: 415 })
    }
    const bytes = Buffer.from(await req.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      return NextResponse.json({ error: 'PDF-en må være under 4,5 MB' }, { status: 413 })
    }
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return NextResponse.json({ error: 'Filen er ikke en PDF' }, { status: 415 })
    }

    const { data: row, error } = await supabaseAdmin.from('strikk_oppskrift')
      .select('id, drive_file_id').eq('id', id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!row) return NextResponse.json({ error: 'Fant ikke oppskriften' }, { status: 404 })

    const drive = google.drive({ version: 'v3', auth: await getStrikkOAuth2Client() })
    const res = await drive.files.update({
      fileId: row.drive_file_id,
      keepRevisionForever: true,
      media: { mimeType: 'application/pdf', body: Readable.from(bytes) },
      fields: 'id, name, size, md5Checksum, modifiedTime',
    })
    const sent = createHash('md5').update(bytes).digest('hex')
    return NextResponse.json({
      ok: res.data.md5Checksum === sent,
      drive_file_id: res.data.id,
      name: res.data.name,
      size: res.data.size,
      md5: res.data.md5Checksum,
      sent_md5: sent,
      modified: res.data.modifiedTime,
    })
  } catch (err) {
    return driveErrorResponse(err, 'strikk/oppskrifter/pdf')
  }
}
