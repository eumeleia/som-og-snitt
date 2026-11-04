'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { RECIPE_SELECT, type KnitRecipe } from '../_lib/recipes'
import { DriveAuthExpiredError, getAccessToken, listDriveFiles, sha256Hex, syncDriveNames, uploadPdf } from '../_lib/drive'
import { runUploadBatch, type UploadProgress, type UploadResult } from '../_lib/upload'
import { FIRST_BATCH, extractRecipe } from '../_lib/extract-client'
import DriveExpired from './DriveExpired'

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; recipes: KnitRecipe[] }
  | { kind: 'error'; text: string }

type Connection =
  | { kind: 'checking' }
  | { kind: 'connected'; email: string | null }
  | { kind: 'disconnected' }

// ?drive=… set by /api/strikk/drive/callback.
const CONNECT_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'Strikk er koblet til Disk.', ok: true },
  wrong_account: {
    text: 'Du valgte en annen Google-konto. Strikk godtar bare mariawasmuth.claude@gmail.com. Koble til på nytt og velg den kontoen.',
    ok: false,
  },
  no_refresh_token: {
    text: 'Google sendte ingen varig tilgang. Fjern Søm og Snitt under Google-kontoens tilganger og koble til på nytt.',
    ok: false,
  },
  error: { text: 'Tilkoblingen til Disk feilet. Prøv igjen.', ok: false },
}

async function createRow(driveFileId: string, fileName: string): Promise<KnitRecipe> {
  const res = await fetch('/api/strikk/oppskrifter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driveFileId, fileName }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Lagring feilet (${res.status})`)
  return body as KnitRecipe
}

export default function RecipeList() {
  const [list, setList] = useState<ListState>({ kind: 'loading' })
  const [connection, setConnection] = useState<Connection>({ kind: 'checking' })
  const [connectMessage, setConnectMessage] = useState<{ text: string; ok: boolean } | null>(null)
  // Drive file ids the Strikk account can see; null until known.
  const [visibleIds, setVisibleIds] = useState<Set<string> | null>(null)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [results, setResults] = useState<UploadResult<KnitRecipe>[] | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [autoExtracted, setAutoExtracted] = useState(true)
  const [editing, setEditing] = useState<KnitRecipe | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const recipesRef = useRef<KnitRecipe[]>([])

  const running = progress !== null && progress.done < progress.total

  useEffect(() => {
    let cancelled = false
    const connectResult = new URLSearchParams(window.location.search).get('drive')
    if (connectResult) window.history.replaceState(null, '', window.location.pathname)
    supabase
      .from('strikk_oppskrift')
      .select(RECIPE_SELECT)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setList({ kind: 'error', text: error.message })
        else setList({ kind: 'ready', recipes: (data ?? []) as KnitRecipe[] })
      })
    fetch('/api/strikk/drive/status', { cache: 'no-store' })
      .then(r => r.json())
      .then((s: { connected?: boolean; email?: string | null }) => {
        if (cancelled) return
        if (connectResult && CONNECT_MESSAGES[connectResult]) setConnectMessage(CONNECT_MESSAGES[connectResult])
        setConnection(s.connected ? { kind: 'connected', email: s.email ?? null } : { kind: 'disconnected' })
        if (!s.connected) return
        // A refresh token Google has revoked still reads as connected; this catches it.
        getAccessToken().catch(err => {
          if (!cancelled && err instanceof DriveAuthExpiredError) setConnection({ kind: 'disconnected' })
        })
        syncDriveNames().then(renamed => {
          if (cancelled || renamed.length === 0) return
          const byId = new Map(renamed.map(r => [r.id, r.file_name]))
          setList(l => (l.kind === 'ready' ? { kind: 'ready', recipes: l.recipes.map(r => (byId.has(r.id) ? { ...r, file_name: byId.get(r.id)! } : r)) } : l))
        })
        // Any other failure leaves rows unmarked rather than wrongly marked.
        listDriveFiles()
          .then(files => { if (!cancelled) setVisibleIds(new Set(files.map(f => f.id))) })
          .catch(() => {})
      })
      .catch(() => { if (!cancelled) setConnection({ kind: 'disconnected' }) })
    return () => { cancelled = true }
  }, [loadAttempt])

  useEffect(() => {
    recipesRef.current = list.kind === 'ready' ? list.recipes : []
  }, [list])

  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  const replace = useCallback((fn: (r: KnitRecipe[]) => KnitRecipe[]) => {
    setList(l => (l.kind === 'ready' ? { kind: 'ready', recipes: fn(l.recipes) } : l))
  }, [])

  async function upload(files: File[]) {
    if (files.length === 0 || running) return
    setUploadError(null)
    setResults(null)
    setProgress({ done: 0, total: files.length, current: null })
    try {
      // Read fresh each run, so a retry or a run after a closed tab sees what is there now.
      const driveFiles = await listDriveFiles()
      setVisibleIds(new Set(driveFiles.map(f => f.id)))
      const known = {
        byHash: new Map(driveFiles.filter(f => f.sha256).map(f => [f.sha256!.toLowerCase(), f.id])),
        withRow: new Set(recipesRef.current.map(r => r.drive_file_id)),
      }
      let authLost = false
      const autoExtract = files.length <= FIRST_BATCH
      setAutoExtracted(autoExtract)
      const done = await runUploadBatch(files, known, {
        hash: sha256Hex,
        upload: async file => {
          const id = await uploadPdf(file)
          setVisibleIds(v => new Set(v ?? []).add(id))
          return id
        },
        createRow,
        // A few new files are read in right away from the bytes already here, the Drive
        // file is renamed to «Oppskrift - Designer.pdf» and the recipe lands in
        // Gjennomgang. A bulk upload is left for «Les inn oppskrifter», so the first ten
        // can be checked before the rest is read.
        afterRow: autoExtract ? async (row, file) => {
          const res = await extractRecipe(row, { bytes: new Uint8Array(await file.arrayBuffer()), rename: true })
          return res.renamed ? { ...row, ...res.renamed } : row
        } : undefined,
        isFatal: err => (authLost = err instanceof DriveAuthExpiredError),
      }, (p, result) => {
        setProgress(p)
        if (result?.row) replace(r => [result.row!, ...r.filter(x => x.id !== result.row!.id)])
      })
      setResults(done)
      if (authLost) setConnection({ kind: 'disconnected' })
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) setConnection({ kind: 'disconnected' })
      else setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(p => (p ? { ...p, done: p.total, current: null } : p))
    }
  }

  async function removeRow(r: KnitRecipe) {
    if (!window.confirm(`Fjerne «${r.title}» fra appen? Filen i den private Disken røres ikke.`)) return
    const res = await fetch(`/api/strikk/oppskrifter/${r.id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { window.alert(body.error ?? `Fjerning feilet (${res.status})`); return }
    replace(rs => rs.filter(x => x.id !== r.id))
  }

  const failed = results?.filter(r => r.status === 'failed') ?? []
  const notes = results?.filter(r => r.note) ?? []
  const count = (s: UploadResult<KnitRecipe>['status']) => results?.filter(r => r.status === s).length ?? 0

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-stone-800">Oppskrifter</h1>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={running || connection.kind !== 'connected'}
          className="h-11 px-4 rounded-xl bg-[#2E5339] text-white text-sm disabled:opacity-50 shrink-0"
        >
          Last opp PDF
        </button>
        <input ref={fileInput} type="file" accept="application/pdf" multiple className="hidden"
          onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>

      {connectMessage && (
        <p className={`text-sm rounded-xl p-3 ${connectMessage.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
          {connectMessage.text}
        </p>
      )}
      {connection.kind === 'disconnected' && <DriveExpired />}
      {connection.kind === 'connected' && connection.email && (
        <p className="text-xs text-stone-500">Disk: {connection.email}</p>
      )}

      {running && progress && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-2" role="status">
          <p className="text-sm font-medium text-stone-900">
            Hold denne siden åpen til opplastingen er ferdig.
          </p>
          <p className="text-sm text-stone-700">
            Lukker du siden eller går til en annen side, stopper opplastingen. Du kan starte den på nytt
            med de samme filene; det som allerede er lastet opp, hoppes over.
          </p>
          <div className="h-2 rounded-full bg-amber-100 overflow-hidden">
            <div className="h-full bg-[#2E5339] transition-all"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
          <p className="text-sm text-stone-700 break-words">
            {progress.done} av {progress.total} ferdig
            {progress.current && <> · {autoExtracted ? 'laster opp og leser inn' : 'laster opp'} «{progress.current}»</>}
          </p>
        </div>
      )}

      {!running && results && (
        <div className="rounded-2xl border border-stone-200 bg-white p-4 flex flex-col gap-2">
          <p className="text-sm text-stone-800">
            Ferdig: {count('uploaded') + count('linked')} lagt til
            {count('skipped') > 0 && <>, {count('skipped')} fantes fra før</>}
            {failed.length > 0 && <>, {failed.length} feilet</>}.
          </p>
          {!autoExtracted && count('uploaded') + count('linked') > 0 && (
            <p className="text-sm text-stone-700">
              Så mange filer leses ikke inn automatisk. Bruk «Les inn oppskrifter» under Gjennomgang.
            </p>
          )}
          {notes.length > 0 && (
            <p className="text-sm text-amber-800">
              {notes.length} ble lastet opp, men kunne ikke leses inn. Prøv igjen fra Gjennomgang.
            </p>
          )}
          {failed.length > 0 && (
            <>
              <ul className="text-sm text-red-700 flex flex-col gap-1">
                {failed.map((r, i) => (
                  <li key={i} className="break-words">«{r.file.name}»: {r.error}</li>
                ))}
              </ul>
              <button
                onClick={() => void upload(failed.map(r => r.file))}
                disabled={connection.kind !== 'connected'}
                className="self-start h-11 px-4 rounded-xl border border-stone-300 bg-white text-sm text-stone-800 disabled:opacity-50"
              >
                Prøv de {failed.length} som feilet på nytt
              </button>
            </>
          )}
        </div>
      )}
      {uploadError && <p className="text-sm text-red-700 break-words">{uploadError}</p>}

      {list.kind === 'loading' && <p className="text-sm text-stone-500">Henter oppskrifter …</p>}
      {list.kind === 'error' && (
        <div className="flex flex-col gap-2 items-start">
          <p className="text-sm text-red-700 break-words">Klarte ikke hente oppskriftene: {list.text}</p>
          <button
            onClick={() => { setList({ kind: 'loading' }); setLoadAttempt(n => n + 1) }}
            className="h-11 px-4 rounded-xl border border-stone-300 bg-white text-sm text-stone-800"
          >
            Prøv igjen
          </button>
        </div>
      )}
      {list.kind === 'ready' && list.recipes.length === 0 && (
        <p className="text-sm text-stone-500">Ingen strikkeoppskrifter ennå. Last opp en PDF for å begynne.</p>
      )}
      {list.kind === 'ready' && list.recipes.length > 0 && (
        <ul className="flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white overflow-hidden">
          {list.recipes.map(r => {
            const elsewhere = visibleIds !== null && !visibleIds.has(r.drive_file_id)
            return (
              <li key={r.id} className="flex items-center">
                {elsewhere ? (
                  <div className="flex-1 min-w-0 px-4 py-3">
                    <div className="text-base text-stone-500 truncate">{r.title}</div>
                    <div className="text-sm text-amber-800">Ligger ikke i Strikk-Disken, trolig i den private Disken.</div>
                  </div>
                ) : (
                  <Link href={`/strikk/oppskrifter/${r.id}`} className="flex-1 min-w-0 px-4 py-3 active:bg-stone-50">
                    <div className="text-base text-stone-800 truncate">{r.title}</div>
                    {r.designer && <div className="text-sm text-stone-500 truncate">{r.designer}</div>}
                  </Link>
                )}
                {elsewhere ? (
                  <button onClick={() => void removeRow(r)}
                    className="h-11 px-3 mr-2 rounded-xl border border-stone-300 text-sm text-stone-700 shrink-0">
                    Fjern fra appen
                  </button>
                ) : (
                  <button
                    onClick={() => setEditing(r)}
                    aria-label={`Rediger ${r.title}`}
                    className="w-12 h-12 flex items-center justify-center text-stone-500 shrink-0"
                  >
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {editing && (
        <EditSheet
          recipe={editing}
          onClose={() => setEditing(null)}
          onSaved={saved => { replace(rs => rs.map(r => (r.id === saved.id ? saved : r))); setEditing(null) }}
          onDeleted={id => { replace(rs => rs.filter(r => r.id !== id)); setEditing(null) }}
        />
      )}
    </div>
  )
}

function EditSheet({ recipe, onClose, onSaved, onDeleted }: {
  recipe: KnitRecipe
  onClose: () => void
  onSaved: (r: KnitRecipe) => void
  onDeleted: (id: string) => void
}) {
  const [title, setTitle] = useState(recipe.title)
  const [designer, setDesigner] = useState(recipe.designer ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/strikk/oppskrifter/${recipe.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, designer }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Lagring feilet (${res.status})`)
      onSaved(body as KnitRecipe)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Slette «${recipe.title}» fra appen? PDF-en blir liggende i Disk.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/strikk/oppskrifter/${recipe.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Sletting feilet (${res.status})`)
      onDeleted(recipe.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (title.trim()) void save() }}
        className="w-full sm:max-w-md bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
      >
        <div className="font-serif text-xl text-stone-800">Rediger oppskrift</div>
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          Tittel
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          Designer (valgfritt)
          <input value={designer} onChange={e => setDesigner(e.target.value)}
            className="h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900" />
        </label>
        <p className="text-xs text-stone-500 break-words">Fil: {recipe.file_name}</p>
        {error && <p className="text-sm text-red-700 break-words">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="flex-1 h-11 rounded-xl border border-stone-300 text-stone-700">
            Avbryt
          </button>
          <button type="submit" disabled={busy || !title.trim()}
            className="flex-1 h-11 rounded-xl bg-[#2E5339] text-white disabled:opacity-40">
            Lagre
          </button>
        </div>
        <button type="button" onClick={() => void remove()} disabled={busy}
          className="h-11 rounded-xl text-sm text-red-700">
          Slett
        </button>
      </form>
    </div>
  )
}
