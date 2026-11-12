'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { isVisibleInGarnlager, STASH_SELECT, stashThumbnailUrl, type StashRow } from '../_lib/stash'
import { EXTRACTION_SELECT, storedToExtraction, type StoredRecipe } from '../_lib/extraction'
import { matchRecipes, type MatchRecipe, type MatchYarn, type RecipeMatch } from '../_lib/stash-match'

interface ProjectOption { id: string; name: string; status: string }

const FIELD_LABEL: Record<string, string> = {
  brand: 'Merke', name: 'Garn', color_number: 'Fargenr.', color_name: 'Fargenavn', skein_count: 'Antall',
}


async function patchRow(id: string, body: Record<string, unknown>): Promise<StashRow> {
  const res = await fetch(`/api/strikk/garnlager/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json()
  if (!res.ok) throw new Error(j.error ?? `Lagring feilet (${res.status})`)
  return j as StashRow
}

const THUMBNAIL_MAX_BYTES = 4.5 * 1024 * 1024 // Vercels grense for en API-rute uten streaming.

async function uploadThumbnail(id: string, file: File): Promise<string> {
  if (file.size > THUMBNAIL_MAX_BYTES) throw new Error(`Bildet er for stort (maks ${(THUMBNAIL_MAX_BYTES / 1024 / 1024).toFixed(1)} MB) — velg et mindre bilde.`)
  const res = await fetch(`/api/strikk/garnlager/${id}/thumbnail`, {
    method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `Opplasting feilet (${res.status})`)
  return j.thumbnail_path as string
}

function yarnLabel(y: StashRow['strikk_yarn']): string {
  if (!y) return 'Ukjent garn'
  return [y.brand, y.name].filter(Boolean).join(' ') + (y.discontinued ? ' (utgått)' : '')
}


// Garnlageret: raden som venter på gjennomgang øverst (bilde, rettbare felt, usikre merker),
// godkjent garn gruppert produsent > garn > farge under, og «Hva vil du strikke?» i hjørnet —
// oppskrifter som er godkjent og bruker garn Maria allerede har liggende.
export default function GarnlagerList() {
  const router = useRouter()
  const [rows, setRows] = useState<StashRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [library, setLibrary] = useState<{ recipes: MatchRecipe[]; yarns: MatchYarn[] } | { error: string } | null>(null)
  const [projects, setProjects] = useState<ProjectOption[]>([])

  useEffect(() => {
    let cancelled = false
    supabase.from('strikk_project').select('id, name, status').neq('status', 'done').order('name').then(({ data }) => {
      if (!cancelled && data) setProjects(data as ProjectOption[])
    })
    return () => { cancelled = true }
  }, [])

  const loadAll = useCallback(async () => {
    const { data, error } = await supabase.from('strikk_yarn_stash').select(STASH_SELECT).order('created_at')
    if (error) setLoadError(error.message)
    else setRows((data ?? []) as unknown as StashRow[])
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.from('strikk_yarn_stash').select(STASH_SELECT).order('created_at').then(({ data, error }) => {
      if (cancelled) return
      if (error) setLoadError(error.message)
      else setRows((data ?? []) as unknown as StashRow[])
    })
    return () => { cancelled = true }
  }, [])

  const approved = useMemo(() => (rows ?? []).filter(r => r.status === 'godkjent' && isVisibleInGarnlager(r)), [rows])
  const pending = useMemo(() => (rows ?? []).filter(r => r.status === 'til_gjennomgang'), [rows])

  // «Hva vil du strikke?»: every approved recipe and the catalogue, loaded once; which of
  // them the stash can knit is worked out again whenever the stash changes.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('strikk_oppskrift').select(`${EXTRACTION_SELECT}, mentions_leftover`).eq('extraction_status', 'approved'),
      supabase.from('strikk_yarn').select('id, brand, name, meterage_m, skein_weight_g, gauge_stitches_min, gauge_stitches_max, fibers'),
    ]).then(([r, y]) => {
      if (cancelled) return
      const error = r.error ?? y.error
      if (error) { setLibrary({ error: error.message }); return }
      const recipes = (r.data ?? []).map(raw => {
        const stored = raw as unknown as StoredRecipe & { mentions_leftover: boolean | null }
        return { id: stored.id, title: stored.title, designer: stored.designer, mentions_leftover: stored.mentions_leftover, data: storedToExtraction(stored) }
      })
      setLibrary({ recipes, yarns: (y.data ?? []) as MatchYarn[] })
    })
    return () => { cancelled = true }
  }, [])

  const matches = useMemo<RecipeMatch[] | null>(() => {
    if (!library || 'error' in library || !rows) return null
    return matchRecipes(library.recipes, rows, library.yarns)
  }, [library, rows])
  const fromLeftovers = useMemo(() => matches?.filter(m => m.fromLeftovers) ?? [], [matches])

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(b => new Set(b).add(id))
    setErrors(e => { const n = { ...e }; delete n[id]; return n })
    try { await fn() } catch (err) { setErrors(e => ({ ...e, [id]: err instanceof Error ? err.message : 'Noe gikk galt' })) }
    finally { setBusy(b => { const n = new Set(b); n.delete(id); return n }) }
  }

  function updateLocal(id: string, patch: Partial<StashRow>) {
    setRows(rs => rs?.map(r => (r.id === id ? { ...r, ...patch } : r)) ?? rs)
  }

  async function saveField(row: StashRow, field: keyof StashRow, value: unknown) {
    await withBusy(row.id, async () => {
      const clear = row.uncertain_fields.includes(field as string) ? [field as string] : undefined
      const updated = await patchRow(row.id, { [field]: value, ...(clear ? { clear_uncertain: clear } : {}) })
      updateLocal(row.id, updated)
    })
  }

  async function approve(row: StashRow) {
    await withBusy(row.id, async () => updateLocal(row.id, await patchRow(row.id, { status: 'godkjent' })))
  }

  async function unapprove(row: StashRow) {
    await withBusy(row.id, async () => updateLocal(row.id, await patchRow(row.id, { status: 'til_gjennomgang' })))
  }

  async function remove(row: StashRow) {
    setConfirmingDelete(null)
    await withBusy(row.id, async () => {
      const res = await fetch(`/api/strikk/garnlager/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Sletting feilet')
      setRows(rs => rs?.filter(r => r.id !== row.id) ?? rs)
    })
  }

  async function assignProject(row: StashRow, projectId: string | null) {
    await withBusy(row.id, async () => updateLocal(row.id, await patchRow(row.id, { project_id: projectId })))
  }

  async function changeThumbnail(row: StashRow, file: File) {
    await withBusy(row.id, async () => {
      const thumbnail_path = await uploadThumbnail(row.id, file)
      updateLocal(row.id, { thumbnail_path })
    })
  }

  // Lager et prosjekt fra oppskriften og tildeler garnet som ga treffet med én gang — garn
  // som allerede er tildelt et annet prosjekt, rører den ikke.
  async function planProject(match: RecipeMatch) {
    await withBusy(match.id, async () => {
      const res = await fetch('/api/strikk/projects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oppskriftId: match.id }),
      })
      const project = await res.json()
      if (!res.ok) throw new Error(project.error ?? 'Klarte ikke lage prosjektet')
      // The rows of the first combination: the pattern's own yarn, in the most sizes.
      const ids = new Set(match.groups[0]?.rowIds ?? [])
      const toAssign = approved.filter(r => ids.has(r.id) && !r.project_id)
      await Promise.all(toAssign.map(r => patchRow(r.id, { project_id: project.id })))
      router.push(`/strikk/prosjekt/${project.id}`)
    })
  }

  function toggleSelect(id: string) {
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function mergeSelected() {
    const [keep_id, remove_id] = [...selected]
    if (!keep_id || !remove_id) return
    await withBusy(keep_id, async () => {
      const res = await fetch('/api/strikk/garnlager/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keep_id, remove_id }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Sammenslåing feilet')
      setRows(rs => rs ? [j as StashRow, ...rs.filter(r => r.id !== keep_id && r.id !== remove_id)] : rs)
      setSelected(new Set())
    })
  }

  if (loadError) return <p className="max-w-5xl mx-auto px-4 sm:px-8 py-6 text-sm text-red-700">Klarte ikke hente garnlageret: {loadError}</p>
  if (!rows) return <p className="max-w-5xl mx-auto px-4 sm:px-8 py-6 text-sm text-stone-500">Henter garnlageret …</p>

  const approvedGrouped = groupApproved(approved)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 flex flex-col lg:flex-row gap-8">
      <div className="flex-1 min-w-0 flex flex-col gap-6">
        <div>
          <h1 className="font-serif text-2xl text-stone-800">Garnlager</h1>
          <p className="text-sm text-stone-600 mt-1">
            Registrert fra bilder: se <code>docs/garnlager-registrering.md</code>. Garn «Til gjennomgang» ligger øverst.
          </p>
        </div>

        {selected.size === 2 && (
          <div className="sticky top-2 z-10 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
            <span className="text-sm text-amber-900">2 rader valgt — slå dem sammen til én?</span>
            <button onClick={() => void mergeSelected()} className="text-sm px-3 py-1 rounded-lg bg-stone-800 text-white">Slå sammen</button>
            <button onClick={() => setSelected(new Set())} className="text-sm text-stone-500">Avbryt</button>
          </div>
        )}

        {pending.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="font-serif text-lg text-stone-700">Til gjennomgang ({pending.length})</h2>
            {pending.map(row => (
              <PendingCard key={row.id} row={row} busy={busy.has(row.id)} selected={selected.has(row.id)}
                error={errors[row.id]} confirmingDelete={confirmingDelete === row.id}
                onSelect={() => toggleSelect(row.id)} onField={(f, v) => void saveField(row, f, v)}
                onApprove={() => void approve(row)}
                onRequestDelete={() => setConfirmingDelete(row.id)} onCancelDelete={() => setConfirmingDelete(null)}
                onDelete={() => void remove(row)} onThumbnail={f => void changeThumbnail(row, f)} />
            ))}
          </section>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="font-serif text-lg text-stone-700">Godkjent garn ({approved.length})</h2>
          {approvedGrouped.length === 0 && <p className="text-sm text-stone-400">Ingen godkjent garn ennå.</p>}
          {approvedGrouped.map(([brand, byName]) => (
            <div key={brand} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{brand}</h3>
              {byName.map(([name, colorRows]) => (
                <div key={name} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                  <div className="text-base text-stone-800">{name}</div>
                  <ul className="mt-1 flex flex-col gap-1">
                    {colorRows.map(row => (
                      <li key={row.id} className="flex flex-col gap-1 py-1">
                        <div className="flex items-center gap-2 text-sm text-stone-600">
                          <ThumbnailPicker img={stashThumbnailUrl(row.thumbnail_path)} size="w-9 h-9" busy={busy.has(row.id)}
                            onUpload={f => void changeThumbnail(row, f)} />
                          <span className="flex-1 min-w-0 truncate">
                            {row.project_id && <span className="text-amber-600" title={`Tildelt ${row.strikk_project?.name}`}>* </span>}
                            {[row.color_number, row.color_name].filter(Boolean).join(' · ') || 'Ukjent farge'}
                          </span>
                          <span className="font-medium text-stone-800">
                            {row.skein_count > 0 && `${row.skein_count} nøste${row.skein_count === 1 ? '' : 'r'}`}
                            {row.skein_count > 0 && row.leftover_g ? ' + ' : ''}
                            {row.leftover_g ? `rest ~${row.leftover_g} g` : ''}
                          </span>
                          <select value={row.project_id ?? ''} disabled={busy.has(row.id)}
                            onChange={e => void assignProject(row, e.target.value || null)}
                            title="Tildel til prosjekt" className="text-xs rounded-md border border-stone-200 bg-white text-stone-600 max-w-[7rem]">
                            <option value="">Ikke tildelt</option>
                            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                          <button onClick={() => void unapprove(row)} title="Tilbake til gjennomgang" className="text-xs text-stone-400 hover:text-stone-600">↩</button>
                          {confirmingDelete === row.id ? (
                            <span className="flex items-center gap-1 text-xs shrink-0">
                              <span className="text-stone-500">Slette?</span>
                              <button onClick={() => void remove(row)} className="text-red-600 font-medium">Ja</button>
                              <button onClick={() => setConfirmingDelete(null)} className="text-stone-400">Nei</button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmingDelete(row.id)} title="Slett" className="text-xs text-stone-300 hover:text-red-500">✕</button>
                          )}
                        </div>
                        {errors[row.id] && <p className="text-xs text-red-600 pl-11">{errors[row.id]}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </section>

        <button onClick={() => void loadAll()} className="self-start text-sm text-stone-500 underline">Oppdater listen</button>
      </div>

      <aside className="w-full lg:w-80 shrink-0">
        <div className="lg:sticky lg:top-4 rounded-2xl border border-[#D4A574] bg-[#F5EFE6] px-4 py-4">
          <h2 className="font-serif text-lg text-stone-800">Hva vil du strikke?</h2>
          {library && 'error' in library && <p className="text-sm text-red-700 mt-2 break-words">Kunne ikke hente oppskriftene: {library.error}</p>}
          {matches === null && !(library && 'error' in library) && <p className="text-sm text-stone-500 mt-2">Ser gjennom oppskriftene …</p>}
          {matches?.length === 0 && <p className="text-sm text-stone-500 mt-2">Ingen oppskrifter kan strikkes med garnet i lageret ennå.</p>}
          {matches && matches.length > 0 && (
            <p className="text-xs text-stone-500 mt-1">{matches.length} oppskrifter du har garn til, i minst én størrelse.</p>
          )}
          <ul className="mt-2 flex flex-col gap-3">
            {matches?.map(m => (
              <MatchCard key={m.id} match={m} busy={busy.has(m.id)} error={errors[m.id]} onPlan={() => void planProject(m)} />
            ))}
          </ul>
          {fromLeftovers.length > 0 && (
            <section className="mt-5">
              <h3 className="font-serif text-base text-stone-800">Kan strikkes av rester</h3>
              <p className="text-xs text-stone-500">Oppskrifter som selv nevner restegarn, og små prosjekter som trenger høyst ett nøste av hvert garn.</p>
              <ul className="mt-2 flex flex-col gap-3">
                {fromLeftovers.map(m => (
                  <MatchCard key={m.id} match={m} busy={busy.has(m.id)} error={errors[m.id]} onPlan={() => void planProject(m)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}

// One recipe in «Hva vil du strikke?»: which yarn in the stash knits which sizes, the pattern's
// own yarn first and alternatives (swatch first) after, and what the other sizes lack.
function MatchCard({ match: m, busy, error, onPlan }: { match: RecipeMatch; busy: boolean; error?: string; onPlan: () => void }) {
  return (
    <li className="rounded-lg bg-white/70 px-2.5 py-2">
      <a href={`/strikk/oppskrifter/${m.id}`} className="block hover:underline">
        <div className="text-sm text-stone-800">{m.title}</div>
        {m.designer && <div className="text-xs text-stone-500">{m.designer}</div>}
      </a>
      <ul className="mt-1 flex flex-col gap-1">
        {m.groups.map((g, i) => (
          <li key={i} className={`text-xs ${g.alternative ? 'text-stone-600' : 'text-emerald-800'}`}>
            {g.alternative && <span className="mr-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900">Alternativ – strikk prøvelapp</span>}
            {g.text}
          </li>
        ))}
      </ul>
      {m.missing.length > 0 && (
        <details className="mt-1 text-xs text-stone-500">
          <summary className="cursor-pointer">Går ikke i {m.missing.length === 1 ? '1 størrelse' : `${m.missing.length} størrelser`}</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {m.missing.map(x => <li key={x.size}><span className="text-stone-700">{x.size}:</span> {x.lines.join('; ')}</li>)}
          </ul>
        </details>
      )}
      <button disabled={busy} onClick={onPlan}
        className="mt-1.5 text-xs px-2.5 py-1 rounded-lg bg-[#2E5339] text-white disabled:opacity-40">
        Planlegg prosjekt →
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </li>
  )
}

function groupApproved(rows: StashRow[]): [string, [string, StashRow[]][]][] {
  const byBrand = new Map<string, Map<string, StashRow[]>>()
  for (const r of rows) {
    const brand = r.strikk_yarn?.brand || 'Ukjent merke'
    const name = r.strikk_yarn?.name || 'Ukjent garn'
    if (!byBrand.has(brand)) byBrand.set(brand, new Map())
    const byName = byBrand.get(brand)!
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)!.push(r)
  }
  return [...byBrand.entries()].sort(([a], [b]) => a.localeCompare(b, 'nb'))
    .map(([brand, byName]) => [brand, [...byName.entries()].sort(([a], [b]) => a.localeCompare(b, 'nb'))])
}

// Bildet og et lite kamera-ikon over det, til å velge en ny fil med. Native <input type=file>
// brukes rett fra en knapp i stedet for window.confirm/alert — de kan være slått av eller
// bli hoppet over i enkelte nettlesere/apper, uten noen synlig feilmelding.
function ThumbnailPicker({ img, size, busy, onUpload }: {
  img: string | null
  size: string
  busy: boolean
  onUpload: (file: File) => void
}) {
  return (
    <label className={`relative ${size} rounded-lg bg-stone-50 overflow-hidden shrink-0 cursor-pointer group`} title="Bytt bilde">
      {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : null}
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
        <svg className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </span>
      <input type="file" accept="image/*,.heic,.heif" disabled={busy} className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
    </label>
  )
}

function PendingCard({ row, busy, selected, error, confirmingDelete, onSelect, onField, onApprove, onRequestDelete, onCancelDelete, onDelete, onThumbnail }: {
  row: StashRow
  busy: boolean
  selected: boolean
  error?: string
  confirmingDelete: boolean
  onSelect: () => void
  onField: (field: keyof StashRow, value: unknown) => void
  onApprove: () => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
  onThumbnail: (file: File) => void
}) {
  const [colorNumber, setColorNumber] = useState(row.color_number ?? '')
  const [colorName, setColorName] = useState(row.color_name ?? '')
  const [skeinCount, setSkeinCount] = useState(String(row.skein_count))
  const [leftoverG, setLeftoverG] = useState(row.leftover_g?.toString() ?? '')
  const img = stashThumbnailUrl(row.thumbnail_path)
  const uncertain = new Set(row.uncertain_fields)

  const inputCls = (field: string) =>
    `w-full px-2 py-1.5 rounded-lg border text-sm bg-white ${uncertain.has(field) ? 'border-amber-400 bg-amber-50' : 'border-stone-200'}`

  return (
    <div className={`rounded-2xl border bg-white p-3 flex gap-3 ${selected ? 'border-stone-500 ring-2 ring-stone-300' : 'border-stone-200'}`}>
      <button onClick={onSelect} aria-pressed={selected} title="Velg for sammenslåing"
        className={`w-5 h-5 mt-1 rounded border-2 shrink-0 ${selected ? 'bg-stone-800 border-stone-800' : 'border-stone-300'}`} />
      <ThumbnailPicker img={img} size="w-20 h-20" busy={busy} onUpload={onThumbnail} />
      <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="col-span-2 sm:col-span-4 text-sm font-medium text-stone-800">{yarnLabel(row.strikk_yarn)}</div>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-stone-400">Fargenr.</span>
          <input className={inputCls('color_number')} value={colorNumber} onChange={e => setColorNumber(e.target.value)}
            onBlur={() => onField('color_number', colorNumber.trim() || null)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-stone-400">Fargenavn</span>
          <input className={inputCls('color_name')} value={colorName} onChange={e => setColorName(e.target.value)}
            onBlur={() => onField('color_name', colorName.trim() || null)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-stone-400">Antall nøster</span>
          <input className={inputCls('skein_count')} inputMode="decimal" value={skeinCount} onChange={e => setSkeinCount(e.target.value)}
            onBlur={() => onField('skein_count', Number(skeinCount.replace(',', '.')) || 0)} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-stone-400">Rest (g)</span>
          <input className={inputCls('leftover_g')} inputMode="decimal" value={leftoverG} onChange={e => setLeftoverG(e.target.value)}
            onBlur={() => onField('leftover_g', leftoverG.trim() ? Number(leftoverG.replace(',', '.')) : null)} />
        </label>
        {row.uncertain_fields.length > 0 && (
          <div className="col-span-2 sm:col-span-4 flex flex-wrap gap-1.5">
            {row.uncertain_fields.map(f => (
              <span key={f} className="text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">
                {FIELD_LABEL[f] ?? f}: {row.uncertain_reasons[f] || 'usikker'}
              </span>
            ))}
          </div>
        )}
        <div className="col-span-2 sm:col-span-4 flex items-center gap-2 mt-1">
          <button disabled={busy} onClick={onApprove} className="text-sm px-3 py-1.5 rounded-lg bg-[#2E5339] text-white disabled:opacity-40">Godkjenn</button>
          {confirmingDelete ? (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-stone-500">Slette denne raden?</span>
              <button onClick={onDelete} className="text-red-600 font-medium">Ja, slett</button>
              <button onClick={onCancelDelete} className="text-stone-400">Avbryt</button>
            </span>
          ) : (
            <button disabled={busy} onClick={onRequestDelete} className="text-sm px-3 py-1.5 rounded-lg border border-stone-200 text-stone-500">Slett</button>
          )}
          {row.note && <span className="text-xs text-stone-400 self-center truncate">{row.note}</span>}
        </div>
        {error && <p className="col-span-2 sm:col-span-4 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
