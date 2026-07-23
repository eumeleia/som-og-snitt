import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { Readable } from 'stream'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function getOAuth2Client() {
  const { data } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'som_og_snitt_google_drive_token')
    .single()
  if (!data) throw new Error('Drive ikke tilkoblet')
  const { refresh_token } = data.value as { refresh_token: string }
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  )
  client.setCredentials({ refresh_token })
  return client
}

async function getOrCreateFolder(drive: ReturnType<typeof google.drive>): Promise<string> {
  const { data: cached } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'google_drive_folder_id')
    .single()
  if (cached) return (cached.value as { folderId: string }).folderId

  const res = await drive.files.create({
    requestBody: { name: 'Søm og Snitt', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  })
  const folderId = res.data.id!
  await supabaseAdmin.from('app_config').upsert(
    { key: 'google_drive_folder_id', value: { folderId }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  return folderId
}

async function getOrCreateSubfolder(
  drive: ReturnType<typeof google.drive>,
  parentId: string,
  name: string,
): Promise<string> {
  const safeName = name.replace(/'/g, "\\'")
  const q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`
  const existing = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 })
  if (existing.data.files?.length) {
    console.log('[upload] subfolder funnet:', name)
    return existing.data.files[0].id!
  }
  const res = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  })
  console.log('[upload] subfolder opprettet:', name)
  return res.data.id!
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const folderName = (formData.get('folderName') as string | null)?.trim() ?? ''
    if (!file) return NextResponse.json({ error: 'Ingen fil' }, { status: 400 })

    const auth = await getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const rootFolderId = await getOrCreateFolder(drive)

    const targetFolderId = folderName
      ? await getOrCreateSubfolder(drive, rootFolderId, folderName)
      : rootFolderId

    console.log('[upload] laster opp:', file.name, '→', folderName || '(rot)')

    const buffer = Buffer.from(await file.arrayBuffer())
    const stream = Readable.from(buffer)

    const uploaded = await drive.files.create({
      requestBody: { name: file.name, parents: [targetFolderId] },
      media: { mimeType: 'application/pdf', body: stream },
      fields: 'id,webViewLink',
    })

    console.log('[upload] ferdig:', file.name)

    return NextResponse.json({
      fileId: uploaded.data.id,
      webViewLink: uploaded.data.webViewLink,
    })
  } catch (err) {
    console.error('[Drive upload]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukjent feil' },
      { status: 500 },
    )
  }
}
