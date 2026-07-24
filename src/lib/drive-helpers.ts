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
  // 1. Check cache and verify it still exists (not trashed/deleted)
  const { data: cached } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'google_drive_folder_id')
    .single()

  if (cached) {
    const cachedId = (cached.value as { folderId: string }).folderId
    try {
      const verify = await drive.files.get({ fileId: cachedId, fields: 'id,trashed' })
      if (!verify.data.trashed) {
        console.log('[folder] gjenbruker cachet rotmappe:', cachedId)
        return cachedId
      }
    } catch {
      // File not found or inaccessible — fall through
    }
    console.log('[folder] cachet rotmappe ugyldig, søker på nytt')
  }

  // 2. Search Drive for existing root folder (handles duplicates gracefully)
  const q = `name = 'Søm og Snitt' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const searchRes = await drive.files.list({ q, fields: 'files(id,createdTime)', orderBy: 'createdTime', pageSize: 10 })
  const files = searchRes.data.files ?? []
  console.log('[folder] søkte etter rotmappe «Søm og Snitt», fant', files.length, 'mapper')

  let folderId: string
  if (files.length > 0) {
    folderId = files[0].id! // oldest first (createdTime ASC)
    console.log('[folder] gjenbruker eksisterende rotmappe, id:', folderId)
  } else {
    const res = await drive.files.create({
      requestBody: { name: 'Søm og Snitt', mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    })
    folderId = res.data.id!
    console.log('[folder] opprettet ny rotmappe, id:', folderId)
  }

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
  const existing = await drive.files.list({ q, fields: 'files(id,createdTime)', orderBy: 'createdTime', pageSize: 10 })
  const files = existing.data.files ?? []
  console.log('[folder] søkte etter undermappe', `«${name}»`, '— fant', files.length)

  if (files.length > 0) {
    console.log('[folder] gjenbruker undermappe, id:', files[0].id)
    return files[0].id!
  }

  const res = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  })
  console.log('[folder] opprettet undermappe', `«${name}»`, 'id:', res.data.id)
  return res.data.id!
}
