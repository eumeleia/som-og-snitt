'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { RECIPE_SELECT, needsMaria, waitsForClaudeCode, type KnitRecipe } from '../_lib/recipes'
import { AUDIENCES, type Audience } from '../_lib/extraction'
import { AUDIENCE_LABEL, applyFilter, type FilterResult } from '../_lib/recipe-filter'
import { DriveAuthExpiredError, getAccessToken, listDriveFiles, sha256Hex, syncDriveNames, uploadPdf } from '../_lib/drive'
import { runUploadBatch, type UploadProgress, type UploadResult } from '../_lib/upload'
import DriveExpired from './DriveExpired'
import { scheduleOverviewRefresh } from '../_lib/overview-client'
import { spellingKey } from '../_lib/yarns'
import { FilterBar, FilterSheet, HitInfo, filterCount, useFilterData, useStoredFilter } from './RecipeFilters'

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
  scheduleOverviewRefresh()
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
  const [editing, setEditing] = useState<KnitRecipe | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [filterReload, setFilterReload] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [newRecipes, setNewRecipes] = useState<KnitRecipe[] | null>(null)
  const filterData = useFilterData(loadAttempt + filterReload)
  const [filter, setFilter] = useStoredFilter()
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
      const done = await runUploadBatch(files, known, {
        hash: sha256Hex,
        upload: async file => {
          const id = await uploadPdf(file)
          setVisibleIds(v => new Set(v ?? []).add(id))
          return id
        },
        createRow,
        isFatal: err => (authLost = err instanceof DriveAuthExpiredError),
      }, (p, result) => {
        setProgress(p)
        if (result?.row) replace(r => [result.row!, ...r.filter(x => x.id !== result.row!.id)])
      })
      setResults(done)
      setFilterReload(n => n + 1)
      const added = done.filter(r => (r.status === 'uploaded' || r.status === 'linked') && r.row).map(r => r.row!)
      if (added.length) setNewRecipes(added)
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
    scheduleOverviewRefresh()
  }

  // The list as filtered and sorted. Until the filter data is there, the plain list shows.
  const view = useMemo(() => {
    if (list.kind !== 'ready') return null
    if (filterData.kind !== 'ready') return { items: list.recipes.map(recipe => ({ recipe, result: null as FilterResult | null })), unread: 0 }
    const byId = new Map(list.recipes.map(r => [r.id, r]))
    const known = new Set(filterData.recipes.map(r => r.id))
    const items = applyFilter(filterData.recipes, filter, filterData.yarns)
      .filter(x => byId.has(x.recipe.id))
      .map(x => ({ recipe: byId.get(x.recipe.id)!, result: x as FilterResult | null }))
    // A recipe added after the filter data loaded shows while no filter is set.
    if (filterCount(filter) === 0) {
      const q = spellingKey(filter.query)
      for (const r of list.recipes) if (!known.has(r.id) && spellingKey(`${r.title} ${r.designer ?? ''}`).includes(q)) items.unshift({ recipe: r, result: null })
    }
    const unread = filterData.recipes.filter(r => r.extraction_status === 'pending' || r.extraction_status === 'failed').length
    return { items, unread }
  }, [list, filterData, filter])

  const failed = results?.filter(r => r.status === 'failed') ?? []
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
            {progress.current && <> · laster opp «{progress.current}»</>}
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
          {count('uploaded') + count('linked') > 0 && (
            <p className="text-sm text-stone-700">
              De nye er merket «Venter på Claude Code» til du ber Claude Code lese dem inn.
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
      {list.kind === 'ready' && list.recipes.some(waitsForClaudeCode) && (
        <p className="text-sm rounded-xl p-3 bg-amber-50 text-amber-900">
          {list.recipes.filter(waitsForClaudeCode).length} oppskrifter venter på Claude Code. Si «les inn nye
          strikkeoppskrifter» til Claude Code, så blir de lest inn, kontrollert og godkjent.
        </p>
      )}
      {list.kind === 'ready' && list.recipes.some(needsMaria) && (
        <p className="text-sm rounded-xl p-3 bg-stone-100 text-stone-800">
          {list.recipes.filter(needsMaria).length} oppskrifter er kontrollert, men har noe uklart i selve oppskriften.
          Se grunnen under <Link href="/strikk/gjennomgang" className="underline">Gjennomgang</Link>.
        </p>
      )}
      {list.kind === 'ready' && list.recipes.length > 0 && filterData.kind === 'ready' && view && (
        <FilterBar filter={filter} onChange={setFilter} yarns={filterData.yarns} shown={view.items.length}
          total={list.recipes.length} unread={view.unread} onOpen={() => setFiltersOpen(true)} />
      )}
      {list.kind === 'ready' && filterData.kind === 'error' && (
        <p className="text-sm text-amber-800 break-words">Filtrene er ikke tilgjengelige: {filterData.text}</p>
      )}
      {list.kind === 'ready' && list.recipes.length > 0 && view && view.items.length === 0 && (
        <p className="text-sm text-stone-500">Ingen oppskrifter passer filtrene.</p>
      )}
      {list.kind === 'ready' && view && view.items.length > 0 && (
        <ul className="flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white overflow-hidden">
          {view.items.map(({ recipe: r, result }) => {
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
                    {(r.designer || r.audience) && (
                      <div className="text-sm text-stone-500 truncate">{[r.designer, r.audience && AUDIENCE_LABEL[r.audience]].filter(Boolean).join(' · ')}</div>
                    )}
                    {waitsForClaudeCode(r) && (
                      <span className="inline-block mt-1 text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">Venter på Claude Code</span>
                    )}
                    {needsMaria(r) && (
                      <span className="inline-block mt-1 text-xs rounded-full bg-stone-200 text-stone-800 px-2 py-0.5">Trenger deg</span>
                    )}
                    {result && filterData.kind === 'ready' && <HitInfo result={result} yarns={filterData.yarns} filter={filter} />}
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

      {newRecipes && (
        <NewRecipesSheet recipes={newRecipes} onDone={saved => {
          if (saved.length) replace(rs => rs.map(r => saved.find(x => x.id === r.id) ?? r))
          setNewRecipes(null)
          setFilterReload(n => n + 1)
        }} />
      )}

      {filtersOpen && filterData.kind === 'ready' && view && (
        <FilterSheet filter={filter} onChange={setFilter} recipes={filterData.recipes} yarns={filterData.yarns}
          shown={view.items.length} onClose={() => setFiltersOpen(false)} />
      )}

      {editing && (
        <EditSheet
          recipe={editing}
          onClose={() => setEditing(null)}
          onSaved={saved => { replace(rs => rs.map(r => (r.id === saved.id ? saved : r))); setEditing(null); setFilterReload(n => n + 1) }}
          onDeleted={id => { replace(rs => rs.filter(r => r.id !== id)); setEditing(null); setFilterReload(n => n + 1) }}
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
  const [audience, setAudience] = useState<Audience | null>(recipe.audience)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/strikk/oppskrifter/${recipe.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, designer, audience }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Lagring feilet (${res.status})`)
      onSaved(body as KnitRecipe)
      scheduleOverviewRefresh()
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
      scheduleOverviewRefresh()
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
        <AudienceSelect value={audience} onChange={setAudience} />
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

function AudienceSelect({ value, onChange }: { value: Audience | null; onChange: (a: Audience | null) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm text-stone-600">
      Hvem den er ment for
      <select value={value ?? ''} onChange={e => onChange((e.target.value || null) as Audience | null)}
        className="h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900">
        <option value="">Ikke satt</option>
        {AUDIENCES.map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
      </select>
    </label>
  )
}

// Right after an upload: the name and who the recipe is for, which Maria fills in herself.
// The rest is read in later by Claude Code.
function NewRecipesSheet({ recipes, onDone }: { recipes: KnitRecipe[]; onDone: (saved: KnitRecipe[]) => void }) {
  const [rows, setRows] = useState(recipes.map(r => ({ id: r.id, title: r.title, audience: r.audience })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...p } : r)))

  async function save() {
    setBusy(true)
    setError(null)
    const saved: KnitRecipe[] = []
    try {
      for (const r of rows) {
        const res = await fetch(`/api/strikk/oppskrifter/${r.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: r.title, audience: r.audience }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(`«${r.title}»: ${body.error ?? `Lagring feilet (${res.status})`}`)
        saved.push(body as KnitRecipe)
      }
      scheduleOverviewRefresh()
      onDone(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30">
      <form onSubmit={e => { e.preventDefault(); if (rows.every(r => r.title.trim())) void save() }}
        className="w-full sm:max-w-md bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]">
        <div className="px-4 pt-4 pb-2">
          <div className="font-serif text-xl text-stone-800">Navn og målgruppe</div>
          <p className="text-sm text-stone-600">Resten leses inn når du ber Claude Code om det.</p>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 flex flex-col gap-4">
          {rows.map((r, i) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3">
              <label className="flex flex-col gap-1 text-sm text-stone-600">
                Navn på oppskriften
                <input value={r.title} onChange={e => set(i, { title: e.target.value })}
                  className="h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900" />
              </label>
              <AudienceSelect value={r.audience} onChange={a => set(i, { audience: a })} />
            </div>
          ))}
        </div>
        {error && <p className="px-4 pt-2 text-sm text-red-700 break-words">{error}</p>}
        <div className="flex gap-2 px-4 pt-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          <button type="button" onClick={() => onDone([])} disabled={busy}
            className="flex-1 h-11 rounded-xl border border-stone-300 text-stone-700">Senere</button>
          <button type="submit" disabled={busy || rows.some(r => !r.title.trim())}
            className="flex-1 h-11 rounded-xl bg-[#2E5339] text-white disabled:opacity-40">Lagre</button>
        </div>
      </form>
    </div>
  )
}
