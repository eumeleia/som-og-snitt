import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function getOAuth2Client() {
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

export async function getOrCreateRootFolder(drive: ReturnType<typeof google.drive>): Promise<string> {
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

export async function getOrCreateSubfolder(
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
