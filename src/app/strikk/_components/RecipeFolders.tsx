'use client'

// Folders and the wish list in Strikk › Oppskrifter: the row of folders above the list, the
// sheet with every folder, the folder choices for one recipe, and the wish list itself.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  MIGRATION_031, WISH_SELECT, autoFolders, folderLabel, formatPrice, membership, wishImageUrl,
  type AutoFolder, type Folder, type FolderKey, type FolderLink, type FolderRecipe, type Wish,
} from '../_lib/folders'
import { isMissingTable } from '../_lib/project-photos'
import { compressCover } from '../_lib/cover'
import { thumbnailUrl, type KnitRecipe } from '../_lib/recipes'
import ProjectRecipePicker from './ProjectRecipePicker'

export type FolderData =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; text: string }
  | { kind: 'ready'; folders: Folder[]; links: FolderLink[]; wishes: Wish[] }

export function useFolderData(reload: number): [FolderData, (fn: (d: Extract<FolderData, { kind: 'ready' }>) => Extract<FolderData, { kind: 'ready' }>) => void] {
  const [data, setData] = useState<FolderData>({ kind: 'loading' })
  useEffect(() => {
    let alive = true
    void Promise.all([
      supabase.from('strikk_folder').select('id, name, created_at').order('name'),
      supabase.from('strikk_folder_recipe').select('folder_id, oppskrift_id'),
      supabase.from('strikk_wish').select(WISH_SELECT).order('created_at', { ascending: false }),
    ]).then(([f, l, w]) => {
      if (!alive) return
      const err = f.error ?? l.error ?? w.error
      if (err) { setData(isMissingTable(err) ? { kind: 'missing' } : { kind: 'error', text: err.message }); return }
      setData({ kind: 'ready', folders: (f.data ?? []) as Folder[], links: (l.data ?? []) as FolderLink[], wishes: (w.data ?? []) as Wish[] })
    })
    return () => { alive = false }
  }, [reload])
  const update = useCallback((fn: (d: Extract<FolderData, { kind: 'ready' }>) => Extract<FolderData, { kind: 'ready' }>) => {
    setData(d => (d.kind === 'ready' ? fn(d) : d))
  }, [])
  return [data, update]
}

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Lagring feilet (${res.status})`)
  return json as T
}

export const createFolder = (name: string) => call<Folder>('/api/strikk/folders', 'POST', { name })
const renameFolder = (id: string, name: string) => call<Folder>(`/api/strikk/folders/${id}`, 'PATCH', { name })
const deleteFolder = (id: string) => call<{ ok: true }>(`/api/strikk/folders/${id}`, 'DELETE')
const setMember = (folderId: string, recipeId: string, member: boolean) =>
  call<{ ok: true }>(`/api/strikk/folders/${folderId}/recipes`, 'PUT', { oppskrift_id: recipeId, member })
export const addWish = (body: Record<string, unknown>) => call<Wish>('/api/strikk/wishes', 'POST', body)
const patchWish = (id: string, body: Record<string, unknown>) => call<Wish>(`/api/strikk/wishes/${id}`, 'PATCH', body)
export const removeWish = (id: string) => call<{ ok: true }>(`/api/strikk/wishes/${id}`, 'DELETE')
async function uploadWishImage(id: string, file: File): Promise<Pick<Wish, 'image_path' | 'image_at'>> {
  const blob = await compressCover(file)
  const res = await fetch(`/api/strikk/wishes/${id}/image`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Bildet ble ikke lagret (${res.status})`)
  return json
}

const chip = (on: boolean) =>
  `shrink-0 h-8 px-3 rounded-full text-sm whitespace-nowrap border ${on ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-700 border-stone-200'}`

// The row above the list: Alle, Favoritter, Ønskeliste, Maria's own folders, and «Mapper»
// for the rest (garment types and audiences), which shows the chosen one as a chip.
export function FolderBar({ current, onChange, recipes, data, onOpenSheet }: {
  current: FolderKey
  onChange: (k: FolderKey) => void
  recipes: FolderRecipe[]
  data: FolderData
  onOpenSheet: () => void
}) {
  const auto = autoFolders(recipes)
  const folders = data.kind === 'ready' ? data.folders : []
  const members = data.kind === 'ready' ? membership(data.links) : new Map<string, Set<string>>()
  const fixed: { key: FolderKey; label: string; count?: number }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'fav', label: 'Favoritter', count: auto.favorites },
    ...(data.kind === 'ready' ? [{ key: 'wish', label: 'Ønskeliste', count: data.wishes.length }] : []),
    ...folders.map(f => ({ key: `f:${f.id}`, label: f.name, count: members.get(f.id)?.size ?? 0 })),
  ]
  const autoChosen = current.startsWith('g:') || current.startsWith('a:')
  return (
    <div className="flex gap-1.5 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 pb-0.5" data-folder-bar>
      {fixed.map(f => (
        <button key={f.key} onClick={() => onChange(f.key)} aria-pressed={current === f.key} className={chip(current === f.key)}>
          {f.label}{f.count !== undefined && <span className={current === f.key ? 'text-white/60' : 'text-stone-400'}> {f.count}</span>}
        </button>
      ))}
      {autoChosen && (
        <button onClick={() => onChange('all')} aria-label={`Fjern mappa ${folderLabel(current, folders)}`} className={chip(true)}>
          {folderLabel(current, folders)} <span aria-hidden className="text-white/70">×</span>
        </button>
      )}
      <button onClick={onOpenSheet} className={`${chip(false)} text-stone-600`}>Mapper …</button>
    </div>
  )
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const keys = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="font-serif text-xl text-stone-800">{title}</div>
          <button onClick={onClose} aria-label="Lukk" className="w-11 h-11 -mr-2 text-2xl text-stone-500">×</button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 flex flex-col gap-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// Every folder: Maria's own (make, rename, delete), then one per garment type and audience.
export function FolderSheet({ current, onChange, recipes, data, update, onClose }: {
  current: FolderKey
  onChange: (k: FolderKey) => void
  recipes: FolderRecipe[]
  data: FolderData
  update: ReturnType<typeof useFolderData>[1]
  onClose: () => void
}) {
  const auto = autoFolders(recipes)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pick = (k: FolderKey) => { onChange(k); onClose() }

  async function run(fn: () => Promise<void>) {
    setErr(null); setBusy(true)
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Klarte ikke lagre') } finally { setBusy(false) }
  }

  const group = (title: string, list: AutoFolder[]) => list.length > 0 && (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1.5">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {list.map(f => (
          <button key={f.key} onClick={() => pick(f.key)} className={chip(current === f.key)}>
            {f.label} <span className={current === f.key ? 'text-white/60' : 'text-stone-400'}>{f.count}</span>
          </button>
        ))}
      </div>
    </section>
  )

  const members = data.kind === 'ready' ? membership(data.links) : new Map<string, Set<string>>()
  return (
    <Sheet title="Mapper" onClose={onClose}>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500 mb-1.5">Mine mapper</h3>
        {data.kind === 'missing' && <p className="text-sm text-amber-800">{MIGRATION_031}</p>}
        {data.kind === 'error' && <p className="text-sm text-red-700 break-words">{data.text}</p>}
        {data.kind === 'ready' && (
          <>
            <ul className="flex flex-col divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white mb-2">
              {data.folders.map(f => (
                <li key={f.id} className="flex items-center gap-2 px-3 py-1.5">
                  {editing === f.id ? (
                    <form className="flex-1 flex items-center gap-2" onSubmit={e => {
                      e.preventDefault()
                      void run(async () => {
                        const saved = await renameFolder(f.id, editName)
                        update(d => ({ ...d, folders: d.folders.map(x => (x.id === f.id ? saved : x)) }))
                        setEditing(null)
                      })
                    }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus aria-label="Nytt navn"
                        className="flex-1 min-w-0 h-9 px-2 rounded-lg border border-stone-300 bg-white text-base" />
                      <button type="submit" disabled={busy} className="text-sm text-[#2E5339] font-medium">Lagre</button>
                      <button type="button" disabled={busy} className="text-sm text-red-700"
                        onClick={() => void run(async () => {
                          if (!window.confirm(`Slette mappa «${f.name}»? Oppskriftene blir liggende i biblioteket.`)) return
                          await deleteFolder(f.id)
                          update(d => ({ ...d, folders: d.folders.filter(x => x.id !== f.id), links: d.links.filter(l => l.folder_id !== f.id) }))
                          if (current === `f:${f.id}`) onChange('all')
                          setEditing(null)
                        })}>Slett</button>
                    </form>
                  ) : (
                    <>
                      <button onClick={() => pick(`f:${f.id}`)} className={`flex-1 min-w-0 text-left text-sm py-1.5 truncate ${current === `f:${f.id}` ? 'font-medium text-stone-900' : 'text-stone-800'}`}>
                        {f.name} <span className="text-stone-400">{members.get(f.id)?.size ?? 0}</span>
                      </button>
                      <button onClick={() => { setEditing(f.id); setEditName(f.name) }} className="text-xs text-stone-500 underline">Endre</button>
                    </>
                  )}
                </li>
              ))}
              {data.folders.length === 0 && <li className="px-3 py-2 text-sm text-stone-500">Ingen egne mapper ennå.</li>}
            </ul>
            <form className="flex gap-2" onSubmit={e => {
              e.preventDefault()
              void run(async () => {
                const f = await createFolder(name)
                update(d => ({ ...d, folders: [...d.folders, f].sort((a, b) => a.name.localeCompare(b.name, 'nb')) }))
                setName('')
              })
            }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ny mappe, f.eks. Til Ellinor"
                className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-stone-300 bg-white text-base" />
              <button type="submit" disabled={busy || !name.trim()} className="h-10 px-3 rounded-lg bg-[#2E5339] text-white text-sm disabled:opacity-40">Lag</button>
            </form>
          </>
        )}
        {err && <p className="text-sm text-red-700 mt-1 break-words">{err}</p>}
      </section>
      {group('Plaggtype', auto.garments)}
      {group('Målgruppe', auto.audiences)}
    </Sheet>
  )
}

// In «Rediger oppskrift»: which of Maria's folders the recipe is in, and the wish list.
export function RecipeFolderPicker({ recipeId, data, update }: {
  recipeId: string
  data: FolderData
  update: ReturnType<typeof useFolderData>[1]
}) {
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (data.kind === 'missing') return <p className="text-xs text-amber-800">{MIGRATION_031}</p>
  if (data.kind !== 'ready') return null
  const inFolders = new Set(data.links.filter(l => l.oppskrift_id === recipeId).map(l => l.folder_id))
  const wish = data.wishes.find(w => w.oppskrift_id === recipeId)

  async function run(fn: () => Promise<void>) {
    setErr(null); setBusy(true)
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Klarte ikke lagre') } finally { setBusy(false) }
  }
  const toggle = (folderId: string, on: boolean) => run(async () => {
    await setMember(folderId, recipeId, on)
    update(d => ({ ...d, links: on ? [...d.links, { folder_id: folderId, oppskrift_id: recipeId }] : d.links.filter(l => !(l.folder_id === folderId && l.oppskrift_id === recipeId)) }))
  })

  return (
    <fieldset className="flex flex-col gap-1.5" data-recipe-folders>
      <legend className="text-sm text-stone-600 mb-1">Mapper <span className="text-xs text-stone-400">(lagres med en gang)</span></legend>
      <label className="flex items-center gap-2 text-sm text-stone-800">
        <input type="checkbox" checked={!!wish} disabled={busy} onChange={e => void run(async () => {
          if (e.target.checked) { const w = await addWish({ oppskrift_id: recipeId }); update(d => ({ ...d, wishes: [w, ...d.wishes] })) }
          else if (wish) { await removeWish(wish.id); update(d => ({ ...d, wishes: d.wishes.filter(x => x.id !== wish.id) })) }
        })} />
        Ønskeliste
      </label>
      {data.folders.map(f => (
        <label key={f.id} className="flex items-center gap-2 text-sm text-stone-800">
          <input type="checkbox" checked={inFolders.has(f.id)} disabled={busy} onChange={e => void toggle(f.id, e.target.checked)} />
          {f.name}
        </label>
      ))}
      <div className="flex gap-2 mt-1">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ny mappe"
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
          className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-stone-300 bg-white text-base" />
        <button type="button" disabled={busy || !name.trim()} className="h-10 px-3 rounded-lg border border-stone-300 bg-white text-sm disabled:opacity-40"
          onClick={() => void run(async () => {
            const f = await createFolder(name)
            await setMember(f.id, recipeId, true)
            update(d => ({ ...d, folders: [...d.folders, f].sort((a, b) => a.name.localeCompare(b.name, 'nb')), links: [...d.links, { folder_id: f.id, oppskrift_id: recipeId }] }))
            setName('')
          })}>Lag og legg i</button>
      </div>
      {err && <p className="text-xs text-red-700 break-words">{err}</p>}
    </fieldset>
  )
}

const field = 'h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900'

// Add or change a wish Maria does not have in the library yet.
function WishForm({ wish, onSaved, onDeleted, onClose }: {
  wish: Wish | null
  onSaved: (w: Wish) => void
  onDeleted: (id: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(wish?.title ?? '')
  const [designer, setDesigner] = useState(wish?.designer ?? '')
  const [url, setUrl] = useState(wish?.url ?? '')
  const [price, setPrice] = useState(wish?.price_nok?.toString().replace('.', ',') ?? '')
  const [note, setNote] = useState(wish?.note ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const fromLibrary = !!wish?.oppskrift_id

  async function save() {
    setErr(null); setBusy('Lagrer …')
    try {
      const body = { title, designer, url, price_nok: price, note }
      let saved = wish ? await patchWish(wish.id, body) : await addWish(body)
      if (file) { setBusy('Gjør bildet mindre …'); saved = { ...saved, ...await uploadWishImage(saved.id, file) } }
      onSaved(saved)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Klarte ikke lagre')
      setBusy(null)
    }
  }

  return (
    <Sheet title={wish ? 'Endre ønske' : 'Nytt ønske'} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={e => { e.preventDefault(); void save() }}>
        {!fromLibrary && (
          <>
            <label className="flex flex-col gap-1 text-sm text-stone-600">Navn<input value={title} onChange={e => setTitle(e.target.value)} className={field} /></label>
            <label className="flex flex-col gap-1 text-sm text-stone-600">Designer<input value={designer} onChange={e => setDesigner(e.target.value)} className={field} /></label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm text-stone-600">Lenke<input value={url} onChange={e => setUrl(e.target.value)} inputMode="url" placeholder="https://" className={field} /></label>
        <label className="flex flex-col gap-1 text-sm text-stone-600">Ca. pris (kr)<input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" className={`${field} w-32`} /></label>
        <label className="flex flex-col gap-1 text-sm text-stone-600">Notat<textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="px-3 py-2 rounded-lg border border-stone-300 bg-white text-base text-stone-900" /></label>
        <div className="flex items-center gap-2">
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => input.current?.click()} className="h-10 px-3 rounded-xl border border-stone-300 bg-white text-sm">
            {wish?.image_path || file ? 'Bytt bilde' : 'Legg til bilde'}
          </button>
          {file && <span className="text-xs text-stone-500 truncate">{file.name}</span>}
        </div>
        {busy && <p className="text-xs text-stone-500">{busy}</p>}
        {err && <p className="text-sm text-red-700 break-words">{err}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-stone-300 text-stone-700">Avbryt</button>
          <button type="submit" disabled={busy !== null || (!fromLibrary && !title.trim())} className="flex-1 h-11 rounded-xl bg-[#2E5339] text-white disabled:opacity-40">Lagre</button>
        </div>
        {wish && (
          <button type="button" disabled={busy !== null} className="h-10 text-sm text-red-700"
            onClick={async () => {
              if (!window.confirm('Fjerne fra ønskelista?')) return
              try { await removeWish(wish.id); onDeleted(wish.id) } catch (e) { setErr(e instanceof Error ? e.message : 'Klarte ikke fjerne') }
            }}>Fjern fra ønskelista</button>
        )}
      </form>
    </Sheet>
  )
}

// The wish list: recipes from the library and recipes Maria does not have yet.
export function WishList({ data, recipes, update }: {
  data: FolderData
  recipes: KnitRecipe[]
  update: ReturnType<typeof useFolderData>[1]
}) {
  const [form, setForm] = useState<Wish | 'new' | null>(null)
  const [picking, setPicking] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (data.kind === 'missing') return <p className="text-sm text-amber-800">{MIGRATION_031}</p>
  if (data.kind === 'error') return <p className="text-sm text-red-700 break-words">{data.text}</p>
  if (data.kind !== 'ready') return <p className="text-sm text-stone-500">Henter ønskelista …</p>
  const byId = new Map(recipes.map(r => [r.id, r]))

  return (
    <div className="flex flex-col gap-3" data-wish-list>
      <div className="flex gap-2">
        <button onClick={() => setForm('new')} className="h-10 px-3 rounded-xl bg-[#2E5339] text-white text-sm">+ Oppskrift du ikke har</button>
        <button onClick={() => setPicking(true)} className="h-10 px-3 rounded-xl border border-stone-300 bg-white text-sm">Fra biblioteket</button>
      </div>
      {err && <p className="text-sm text-red-700 break-words">{err}</p>}
      {data.wishes.length === 0 && <p className="text-sm text-stone-500">Ønskelista er tom.</p>}
      <ul className="flex flex-col divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white overflow-hidden">
        {data.wishes.map(w => {
          const r = w.oppskrift_id ? byId.get(w.oppskrift_id) : undefined
          const img = wishImageUrl(w) ?? (r ? thumbnailUrl(r) : null)
          const title = r?.title ?? w.title ?? 'Uten navn'
          const designer = r?.designer ?? w.designer
          return (
            <li key={w.id} className="flex gap-3 px-3 py-2.5">
              <div className="w-12 h-16 shrink-0 rounded-md border border-stone-200 bg-stone-100 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- a small public file */}
                {img && <img src={img} alt="" loading="lazy" className="w-full h-full object-cover object-top" />}
              </div>
              <div className="flex-1 min-w-0">
                {r
                  ? <Link href={`/strikk/oppskrifter/${r.id}`} className="block text-base text-stone-800 truncate underline-offset-2 hover:underline">{title}</Link>
                  : <div className="text-base text-stone-800 truncate">{title}</div>}
                <div className="text-sm text-stone-500 truncate">
                  {[designer, r ? 'i biblioteket' : null, formatPrice(w.price_nok)].filter(Boolean).join(' · ')}
                </div>
                {w.note && <p className="text-xs text-stone-600 mt-0.5 line-clamp-2">{w.note}</p>}
                {w.url && <a href={w.url} target="_blank" rel="noreferrer" className="text-xs text-[#8B6340] underline break-all line-clamp-1">{w.url.replace(/^https?:\/\/(www\.)?/, '')}</a>}
              </div>
              <button onClick={() => setForm(w)} aria-label={`Endre ${title}`} className="w-10 h-10 shrink-0 flex items-center justify-center text-stone-500">
                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              </button>
            </li>
          )
        })}
      </ul>
      {form && (
        <WishForm wish={form === 'new' ? null : form} onClose={() => setForm(null)}
          onSaved={w => { update(d => ({ ...d, wishes: d.wishes.some(x => x.id === w.id) ? d.wishes.map(x => (x.id === w.id ? w : x)) : [w, ...d.wishes] })); setForm(null) }}
          onDeleted={id => { update(d => ({ ...d, wishes: d.wishes.filter(x => x.id !== id) })); setForm(null) }} />
      )}
      {picking && (
        <ProjectRecipePicker onClose={() => setPicking(false)} onSelect={async r => {
          setPicking(false); setErr(null)
          try { const w = await addWish({ oppskrift_id: r.id }); update(d => ({ ...d, wishes: [w, ...d.wishes] })) }
          catch (e) { setErr(e instanceof Error ? e.message : 'Klarte ikke lagre') }
        }} />
      )}
    </div>
  )
}
