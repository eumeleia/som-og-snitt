'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface DriveStatus { connected: boolean }

interface PdfItem {
  id: string; name: string; url: string; type: string; source: string
  storage?: string; driveFileId?: string; driveLink?: string; formatLabel?: string
}
interface DbRow { id: string; data: { name?: string; pdfs?: PdfItem[]; [key: string]: unknown } }

interface MigrationItem {
  entity: 'recipe' | 'project'
  id: string
  entityName: string
  pdf: PdfItem
}

interface MigrationProgress { current: number; total: number; fileName: string }
interface MigrationResult  { migrated: number; skipped: number; failed: number; total: number }
interface CleanupResult    { found: number; deleted: number; failed: number; cancelled?: boolean }

function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

function extractSupabasePath(url: string): string | null {
  // Strip query params/fragments so we get just the storage object name
  const match = url.match(/\/project-images\/([^?#]+)/)
  return match ? match[1] : null
}

function isSupabasePdfUrl(url: string): boolean {
  return url.includes('.supabase.co/storage/v1/object/public/project-images/')
}

function DriveIcon() {
  return (
    <svg viewBox="0 0 87.3 78" className="w-5 h-5" aria-hidden>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  )
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const [drive, setDrive] = useState<DriveStatus | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const [migrating, setMigrating]           = useState(false)
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress | null>(null)
  const [migrationResult, setMigrationResult]     = useState<MigrationResult | null>(null)

  const [copying, setCopying]             = useState(false)
  const [copyProgress, setCopyProgress]   = useState<MigrationProgress | null>(null)
  const [copyResult, setCopyResult]       = useState<MigrationResult | null>(null)

  const [cleanupRunning, setCleanupRunning] = useState(false)
  const [cleanupResult, setCleanupResult]   = useState<CleanupResult | null>(null)

  useEffect(() => {
    fetch('/api/drive/status').then(r => r.json()).then(setDrive)
  }, [])

  async function disconnect() {
    setDisconnecting(true)
    await fetch('/api/drive/disconnect', { method: 'POST' })
    setDrive({ connected: false })
    setDisconnecting(false)
  }

  async function runMigration() {
    setMigrating(true)
    setMigrationProgress(null)
    setMigrationResult(null)

    try {
      // Load all recipes and projects
      const [{ data: recipes }, { data: projects }] = await Promise.all([
        supabase.from('recipes').select('*'),
        supabase.from('projects').select('*'),
      ])

      // Find all Mønster PDFs still in Supabase
      const items: MigrationItem[] = []
      for (const row of (recipes ?? []) as DbRow[]) {
        for (const pdf of row.data.pdfs ?? []) {
          if (
            pdf.type === 'Mønster' &&
            (pdf.storage === 'supabase' || !pdf.storage) &&
            pdf.url && isSupabasePdfUrl(pdf.url)
          ) {
            items.push({ entity: 'recipe', id: row.id, entityName: row.data.name ?? 'Uten navn', pdf })
          }
        }
      }
      for (const row of (projects ?? []) as DbRow[]) {
        for (const pdf of row.data.pdfs ?? []) {
          if (
            pdf.type === 'Mønster' &&
            (pdf.storage === 'supabase' || !pdf.storage) &&
            pdf.url && isSupabasePdfUrl(pdf.url)
          ) {
            items.push({ entity: 'project', id: row.id, entityName: row.data.name ?? 'Uten navn', pdf })
          }
        }
      }

      if (items.length === 0) {
        setMigrationResult({ migrated: 0, skipped: 0, failed: 0, total: 0 })
        setMigrating(false)
        return
      }

      let migrated = 0, skipped = 0, failed = 0

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        setMigrationProgress({ current: i + 1, total: items.length, fileName: item.pdf.name })
        try {
          // Capture BEFORE any updates so the Supabase URL is still intact for deletion
          const originalSupabaseUrl = item.pdf.url

          // a. Ensure Drive subfolder for this recipe/project
          const folderName = sanitizeFolderName(item.entityName) || 'Uten navn'
          const ensureRes = await fetch('/api/drive/ensure-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderName }),
          })
          if (!ensureRes.ok) {
            console.error('[migrate] ensure-folder feilet for:', item.pdf.name)
            failed++; continue
          }
          const { folderId } = await ensureRes.json() as { folderId: string }

          // b. Download file bytes from Supabase
          const fileRes = await fetch(item.pdf.url)
          if (!fileRes.ok) {
            console.error('[migrate] Nedlasting feilet:', item.pdf.url)
            failed++; continue
          }
          const blob = await fileRes.blob()
          const file = new File([blob], item.pdf.name, { type: 'application/pdf' })

          // c. Resumable upload to Drive via upload-session → PUT → file-by-name
          const sessionRes = await fetch('/api/drive/upload-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: item.pdf.name, mimeType: 'application/pdf', folderId }),
          })
          if (!sessionRes.ok) {
            console.error('[migrate] upload-session feilet for:', item.pdf.name)
            failed++; continue
          }
          const { uploadUrl } = await sessionRes.json() as { uploadUrl: string }

          try {
            await fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/pdf' },
              body: file,
            })
          } catch { /* CORS blocks response reading — upload likely succeeded */ }

          const lookupRes = await fetch('/api/drive/file-by-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: item.pdf.name, folderId }),
          })
          if (!lookupRes.ok) {
            console.error('[migrate] file-by-name fant ikke fila etter opplasting:', item.pdf.name)
            failed++; continue
          }
          const { fileId, webViewLink } = await lookupRes.json() as { fileId: string; webViewLink: string }

          // d. Update PdfItem in DB — re-fetch row to avoid overwriting concurrent changes
          const table = item.entity === 'recipe' ? 'recipes' : 'projects'
          const { data: freshRow } = await supabase.from(table).select('*').eq('id', item.id).single() as { data: DbRow | null }
          if (!freshRow) {
            console.error('[migrate] Rad ikke funnet i DB:', item.id)
            failed++; continue
          }

          const freshPdfs = [...(freshRow.data.pdfs ?? [])]
          const pdfIdx = freshPdfs.findIndex(p => p.id === item.pdf.id)
          if (pdfIdx === -1) {
            skipped++; continue
          }

          freshPdfs[pdfIdx] = {
            ...freshPdfs[pdfIdx],
            url: webViewLink,
            storage: 'drive',
            driveFileId: fileId,
            driveLink: webViewLink,
          }

          const { error: updateErr } = await supabase
            .from(table)
            .update({ data: { ...freshRow.data, pdfs: freshPdfs } })
            .eq('id', item.id)
          if (updateErr) {
            console.error('[migrate] DB-oppdatering feilet:', updateErr)
            failed++; continue
          }

          // e. Delete from Supabase Storage — use original URL captured before DB update
          const supabasePath = extractSupabasePath(originalSupabaseUrl)
          if (supabasePath) {
            const { error: delErr } = await supabase.storage.from('project-images').remove([supabasePath])
            if (delErr) console.error('[migrate] Sletting fra Storage feilet:', JSON.stringify(delErr))
          }

          migrated++
        } catch (err) {
          console.error('[migrate] Uventet feil for:', item.pdf.name, err)
          failed++
        }
      }

      setMigrationResult({ migrated, skipped, failed, total: items.length })
    } catch (err) {
      console.error('[migrate] Fatal feil:', err)
      setMigrationResult({ migrated: 0, skipped: 0, failed: 1, total: 1 })
    } finally {
      setMigrating(false)
      setMigrationProgress(null)
    }
  }

  async function runCopy() {
    setCopying(true)
    setCopyProgress(null)
    setCopyResult(null)

    try {
      const [{ data: recipes }, { data: projects }] = await Promise.all([
        supabase.from('recipes').select('*'),
        supabase.from('projects').select('*'),
      ])

      // Find instruction PDFs (Oppskrift/Annet) with Supabase URL and no Drive archive yet
      const items: MigrationItem[] = []
      for (const row of (recipes ?? []) as DbRow[]) {
        for (const pdf of row.data.pdfs ?? []) {
          if (
            (pdf.type === 'Oppskrift' || pdf.type === 'Annet') &&
            !pdf.driveFileId &&
            pdf.url && isSupabasePdfUrl(pdf.url)
          ) {
            items.push({ entity: 'recipe', id: row.id, entityName: row.data.name ?? 'Uten navn', pdf })
          }
        }
      }
      for (const row of (projects ?? []) as DbRow[]) {
        for (const pdf of row.data.pdfs ?? []) {
          if (
            (pdf.type === 'Oppskrift' || pdf.type === 'Annet') &&
            !pdf.driveFileId &&
            pdf.url && isSupabasePdfUrl(pdf.url)
          ) {
            items.push({ entity: 'project', id: row.id, entityName: row.data.name ?? 'Uten navn', pdf })
          }
        }
      }

      if (items.length === 0) {
        setCopyResult({ migrated: 0, skipped: 0, failed: 0, total: 0 })
        setCopying(false)
        return
      }

      let migrated = 0, skipped = 0, failed = 0

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        setCopyProgress({ current: i + 1, total: items.length, fileName: item.pdf.name })
        try {
          // a. Ensure Drive subfolder
          const folderName = sanitizeFolderName(item.entityName) || 'Uten navn'
          const ensureRes = await fetch('/api/drive/ensure-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderName }),
          })
          if (!ensureRes.ok) {
            console.error('[copy] ensure-folder feilet for:', item.pdf.name)
            failed++; continue
          }
          const { folderId } = await ensureRes.json() as { folderId: string }

          // b. Download file bytes from Supabase
          const fileRes = await fetch(item.pdf.url)
          if (!fileRes.ok) {
            console.error('[copy] Nedlasting feilet:', item.pdf.url)
            failed++; continue
          }
          const blob = await fileRes.blob()
          const file = new File([blob], item.pdf.name, { type: 'application/pdf' })

          // c. Resumable upload → PUT → file-by-name
          const sessionRes = await fetch('/api/drive/upload-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: item.pdf.name, mimeType: 'application/pdf', folderId }),
          })
          if (!sessionRes.ok) {
            console.error('[copy] upload-session feilet for:', item.pdf.name)
            failed++; continue
          }
          const { uploadUrl } = await sessionRes.json() as { uploadUrl: string }

          try {
            await fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/pdf' },
              body: file,
            })
          } catch { /* CORS blocks response reading — upload likely succeeded */ }

          const lookupRes = await fetch('/api/drive/file-by-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: item.pdf.name, folderId }),
          })
          if (!lookupRes.ok) {
            console.error('[copy] file-by-name fant ikke fila etter opplasting:', item.pdf.name)
            failed++; continue
          }
          const { fileId, webViewLink } = await lookupRes.json() as { fileId: string; webViewLink: string }

          // d. Update PdfItem in DB — keep storage 'supabase' and url unchanged, only add Drive fields
          const table = item.entity === 'recipe' ? 'recipes' : 'projects'
          const { data: freshRow } = await supabase.from(table).select('*').eq('id', item.id).single() as { data: DbRow | null }
          if (!freshRow) {
            console.error('[copy] Rad ikke funnet i DB:', item.id)
            failed++; continue
          }

          const freshPdfs = [...(freshRow.data.pdfs ?? [])]
          const pdfIdx = freshPdfs.findIndex(p => p.id === item.pdf.id)
          if (pdfIdx === -1) {
            skipped++; continue
          }

          // Preserve storage + url (Supabase working copy); only add Drive archive fields
          freshPdfs[pdfIdx] = {
            ...freshPdfs[pdfIdx],
            driveFileId: fileId,
            driveLink: webViewLink,
          }

          const { error: updateErr } = await supabase
            .from(table)
            .update({ data: { ...freshRow.data, pdfs: freshPdfs } })
            .eq('id', item.id)
          if (updateErr) {
            console.error('[copy] DB-oppdatering feilet:', updateErr)
            failed++; continue
          }

          // e. No Storage deletion — Supabase working copy is kept
          migrated++
        } catch (err) {
          console.error('[copy] Uventet feil for:', item.pdf.name, err)
          failed++
        }
      }

      setCopyResult({ migrated, skipped, failed, total: items.length })
    } catch (err) {
      console.error('[copy] Fatal feil:', err)
      setCopyResult({ migrated: 0, skipped: 0, failed: 1, total: 1 })
    } finally {
      setCopying(false)
      setCopyProgress(null)
    }
  }

  async function runCleanup() {
    setCleanupRunning(true)
    setCleanupResult(null)

    try {
      // Dry-run: server scans with service_role key (anon key can't list bucket)
      const scanRes = await fetch('/api/storage/cleanup-orphans', { method: 'GET' })
      if (!scanRes.ok) {
        const err = await scanRes.json() as { error?: string }
        throw new Error(err.error ?? 'Skanning feilet')
      }
      const scan = await scanRes.json() as {
        scanned: { recipes: number; projects: number }
        inUseCount: number
        totalObjects: number
        orphanCount: number
        orphanSample: string[]
        totalOrphanBytes: number
      }

      if (scan.orphanCount === 0) {
        setCleanupResult({ found: 0, deleted: 0, failed: 0 })
        return
      }

      const mb = (scan.totalOrphanBytes / 1024 / 1024).toFixed(1)
      const ok = window.confirm(
        `Fant ${scan.orphanCount} foreldreløs${scan.orphanCount === 1 ? '' : 'e'} PDF-fil${scan.orphanCount === 1 ? '' : 'er'} i Supabase Storage (${mb} MB) som ikke lenger er i bruk.\n\nVil du slette ${scan.orphanCount === 1 ? 'den' : 'dem'}?`
      )
      if (!ok) {
        setCleanupResult({ found: scan.orphanCount, deleted: 0, failed: 0, cancelled: true })
        return
      }

      // Actual deletion via server route
      const delRes = await fetch('/api/storage/cleanup-orphans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      })
      if (!delRes.ok) {
        const err = await delRes.json() as { error?: string }
        throw new Error(err.error ?? 'Sletting feilet')
      }
      const result = await delRes.json() as { deleted: number; freedBytes: number; failed: number }

      setCleanupResult({ found: scan.orphanCount, deleted: result.deleted, failed: result.failed })
    } catch (err) {
      console.error('[cleanup] Fatal feil:', err)
      setCleanupResult({ found: 0, deleted: 0, failed: 1 })
    } finally {
      setCleanupRunning(false)
    }
  }

  const flash = searchParams.get('drive')

  return (
    <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <h1 className="font-serif text-2xl text-stone-800">Innstillinger</h1>

      {flash === 'connected' && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
          Google Drive er nå tilkoblet.
        </div>
      )}
      {(flash === 'error' || flash === 'no_refresh_token') && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {flash === 'no_refresh_token'
            ? 'Ingen refresh-token mottatt — prøv å fjerne Søm og Snitt fra Google-tilganger og koble til på nytt.'
            : 'Noe gikk galt. Prøv igjen.'}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E8F0FE] flex items-center justify-center flex-shrink-0">
            <DriveIcon />
          </div>
          <div>
            <h2 className="font-medium text-stone-800">Google Drive</h2>
            <p className="text-sm text-stone-500 mt-0.5">
              Mønster-PDF-er lastes opp til Drive-mappen «Søm og Snitt» i stedet for Supabase Storage — sparer lagringsplass.
            </p>
          </div>
        </div>

        {drive === null ? (
          <div className="h-10 bg-stone-50 rounded-xl animate-pulse" />
        ) : drive.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              Tilkoblet
            </div>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="px-4 py-2 text-sm rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-40"
            >
              {disconnecting ? 'Kobler fra…' : 'Koble fra'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <span className="w-2 h-2 rounded-full bg-stone-300 flex-shrink-0" />
              Ikke tilkoblet
            </div>
            <a
              href="/api/drive/auth"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors"
            >
              Koble til Google Drive
            </a>
          </div>
        )}
      </section>

      {drive?.connected && (
        <section className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-4">
          <div>
            <h2 className="font-medium text-stone-800">Flytt eksisterende mønstre til Drive</h2>
            <p className="text-sm text-stone-500 mt-1">
              Kopierer mønster-PDF-er som fortsatt ligger i Supabase Storage til Drive-mappen din og oppdaterer databasen. Instruksjoner og oppskrifter røres ikke. Kan kjøres flere ganger uten å duplisere allerede migrerte filer.
            </p>
          </div>

          {migrationProgress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-stone-500">
                <span>Flytter {migrationProgress.current} av {migrationProgress.total}</span>
              </div>
              <div className="w-full bg-stone-100 rounded-full h-1.5">
                <div
                  className="bg-stone-800 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(migrationProgress.current / migrationProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-stone-400 truncate">{migrationProgress.fileName}</p>
            </div>
          )}

          {migrationResult && !migrating && (
            <div className={`rounded-xl px-4 py-3 text-sm ${
              migrationResult.failed > 0
                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                : 'bg-green-50 border border-green-200 text-green-700'
            }`}>
              {migrationResult.total === 0 ? (
                'Ingen mønster-PDF-er å flytte — alt er allerede i Drive.'
              ) : (
                <>
                  Ferdig: <strong>{migrationResult.migrated}</strong> flyttet
                  {migrationResult.skipped > 0 && <>, <strong>{migrationResult.skipped}</strong> hoppet over</>}
                  {migrationResult.failed > 0 && <>, <strong>{migrationResult.failed}</strong> feilet</>}.
                </>
              )}
            </div>
          )}

          <button
            onClick={runMigration}
            disabled={migrating || copying || cleanupRunning}
            className="px-4 py-2 text-sm rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:opacity-40"
          >
            {migrating ? 'Migrerer…' : 'Flytt eksisterende mønstre til Drive'}
          </button>
        </section>
      )}

      {drive?.connected && (
        <section className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-4">
          <div>
            <h2 className="font-medium text-stone-800">Kopier instruksjoner til Drive-arkiv</h2>
            <p className="text-sm text-stone-500 mt-1">
              Kopierer instruksjons-PDF-er (Oppskrift og Annet) til Drive-mappen per oppskrift, slik at alt innhold ligger samlet. Supabase-arbeidskopien beholdes uendret — kun Drive-arkivfelter legges til. Kan kjøres flere ganger uten duplikater.
            </p>
          </div>

          {copyProgress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-stone-500">
                <span>Kopierer {copyProgress.current} av {copyProgress.total}</span>
              </div>
              <div className="w-full bg-stone-100 rounded-full h-1.5">
                <div
                  className="bg-stone-800 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(copyProgress.current / copyProgress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-stone-400 truncate">{copyProgress.fileName}</p>
            </div>
          )}

          {copyResult && !copying && (
            <div className={`rounded-xl px-4 py-3 text-sm ${
              copyResult.failed > 0
                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                : 'bg-green-50 border border-green-200 text-green-700'
            }`}>
              {copyResult.total === 0 ? (
                'Ingen instruksjons-PDF-er å kopiere — alle har allerede Drive-arkivkopi.'
              ) : (
                <>
                  Ferdig: <strong>{copyResult.migrated}</strong> kopiert
                  {copyResult.skipped > 0 && <>, <strong>{copyResult.skipped}</strong> hoppet over</>}
                  {copyResult.failed > 0 && <>, <strong>{copyResult.failed}</strong> feilet</>}.
                </>
              )}
            </div>
          )}

          <button
            onClick={runCopy}
            disabled={copying || migrating || cleanupRunning}
            className="px-4 py-2 text-sm rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:opacity-40"
          >
            {copying ? 'Kopierer…' : 'Kopier instruksjoner til Drive-arkiv'}
          </button>
        </section>
      )}
      {drive?.connected && (
        <section className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-4">
          <div>
            <h2 className="font-medium text-stone-800">Rydd opp: slett foreldreløse PDF-er</h2>
            <p className="text-sm text-stone-500 mt-1">
              Finner PDF-filer i Supabase Storage som ikke lenger er i aktiv bruk — typisk mønstre som allerede er flyttet til Drive. Bilder og andre filer røres ikke. Du får se antallet og bekrefte før noe slettes.
            </p>
          </div>

          {cleanupResult && !cleanupRunning && (
            <div className={`rounded-xl px-4 py-3 text-sm ${
              cleanupResult.failed > 0
                ? 'bg-amber-50 border border-amber-200 text-amber-800'
                : 'bg-green-50 border border-green-200 text-green-700'
            }`}>
              {cleanupResult.cancelled ? (
                `Avbrutt — ${cleanupResult.found} foreldreløs${cleanupResult.found === 1 ? '' : 'e'} fil${cleanupResult.found === 1 ? '' : 'er'} ble ikke slettet.`
              ) : cleanupResult.found === 0 ? (
                'Ingen foreldreløse PDF-filer funnet — Supabase Storage er ryddig.'
              ) : (
                <>
                  Ferdig: <strong>{cleanupResult.deleted}</strong> av {cleanupResult.found} slettet
                  {cleanupResult.failed > 0 && <>, <strong>{cleanupResult.failed}</strong> feilet</>}.
                </>
              )}
            </div>
          )}

          <button
            onClick={runCleanup}
            disabled={cleanupRunning || migrating || copying}
            className="px-4 py-2 text-sm rounded-xl border border-red-200 text-red-700 hover:bg-red-50 transition-colors disabled:opacity-40"
          >
            {cleanupRunning ? 'Skanner…' : 'Rydd opp: slett foreldreløse PDF-er'}
          </button>
        </section>
      )}
    </main>
  )
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}
