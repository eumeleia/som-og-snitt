'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { RECIPE_SELECT, type KnitRecipe } from '../_lib/recipes'
import { DriveAuthExpiredError, getAccessToken, migrateLegacyFolder, uploadPdf } from '../_lib/drive'
import DriveExpired from './DriveExpired'

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; recipes: KnitRecipe[] }
  | { kind: 'error'; text: string }

export default function RecipeList() {
  const [list, setList] = useState<ListState>({ kind: 'loading' })
  const [driveExpired, setDriveExpired] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<KnitRecipe | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => { void migrateLegacyFolder() }, [])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('strikk_oppskrift')
      .select(RECIPE_SELECT)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setList({ kind: 'error', text: error.message })
        else setList({ kind: 'ready', recipes: (data ?? []) as KnitRecipe[] })
      })
    // Checked up front so an expired Drive grant shows before you try to upload or open.
    // Any other failure here is left to the upload or the viewer to report.
    getAccessToken().catch(err => {
      if (!cancelled && err instanceof DriveAuthExpiredError) setDriveExpired(true)
    })
    return () => { cancelled = true }
  }, [loadAttempt])

  const replace = useCallback((fn: (r: KnitRecipe[]) => KnitRecipe[]) => {
    setList(l => (l.kind === 'ready' ? { kind: 'ready', recipes: fn(l.recipes) } : l))
  }, [])

  async function onFileChosen(file: File | undefined) {
    if (!file) return
    setUploadError(null)
    setUploading(file.name)
    try {
      const driveFileId = await uploadPdf(file)
      const res = await fetch('/api/strikk/oppskrifter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driveFileId, fileName: file.name }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `Lagring feilet (${res.status})`)
      replace(r => [body as KnitRecipe, ...r])
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) setDriveExpired(true)
      else setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-stone-800">Oppskrifter</h1>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading !== null || driveExpired}
          className="h-11 px-4 rounded-xl bg-[#2E5339] text-white text-sm disabled:opacity-50 shrink-0"
        >
          Last opp PDF
        </button>
        <input ref={fileInput} type="file" accept="application/pdf" className="hidden"
          onChange={e => { void onFileChosen(e.target.files?.[0]); e.target.value = '' }} />
      </div>

      {driveExpired && <DriveExpired />}
      {uploading && <p className="text-sm text-stone-600">Laster opp «{uploading}» …</p>}
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
          {list.recipes.map(r => (
            <li key={r.id} className="flex items-center">
              <Link href={`/strikk/oppskrifter/${r.id}`} className="flex-1 min-w-0 px-4 py-3 active:bg-stone-50">
                <div className="text-base text-stone-800 truncate">{r.title}</div>
                {r.designer && <div className="text-sm text-stone-500 truncate">{r.designer}</div>}
              </Link>
              <button
                onClick={() => setEditing(r)}
                aria-label={`Rediger ${r.title}`}
                className="w-12 h-12 flex items-center justify-center text-stone-500 shrink-0"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                  <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
            </li>
          ))}
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
