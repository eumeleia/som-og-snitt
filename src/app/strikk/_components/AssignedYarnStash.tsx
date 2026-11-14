'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { freeSkeins, projectSkeins, skeinsText, stashThumbnailUrl, type StashRow } from '../_lib/stash'
import { fetchStash } from '../_lib/stash-client'
import { spellingKey } from '../_lib/yarns'
import StashRowEditor, { patchStash } from './StashRowEditor'

function yarnLabel(y: StashRow['strikk_yarn']): string {
  if (!y) return 'Ukjent garn'
  return [y.brand, y.name].filter(Boolean).join(' ')
}
const colourText = (r: StashRow) => [r.color_number, r.color_name].filter(Boolean).join(' · ') || 'ukjent farge'
const nb = (a: string, b: string) => a.localeCompare(b, 'nb', { sensitivity: 'base', numeric: true })

// Garn fra Garnlageret tildelt dette prosjektet — et annet garn-begrep enn «Garn»-seksjonen
// over (som er oppskriftens garnlinjer/katalogvalg): dette er de FYSISKE nøstene Maria har
// satt til side. En rad ligger samlet i lageret; prosjektet kan få alle eller noen av nøstene.
export default function AssignedYarnStash({ projectId }: { projectId: string }) {
  const [all, setAll] = useState<StashRow[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<StashRow | null>(null)
  const [count, setCount] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await fetchStash()
    if (err) setError(err)
    else setAll(data ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchStash().then(({ data, error: err }) => {
      if (cancelled) return
      if (err) setError(err)
      else setAll(data ?? [])
    })
    return () => { cancelled = true }
  }, [])

  const assigned = useMemo(() => (all ?? []).filter(r => r.project_id === projectId), [all, projectId])

  // What can be picked: free yarn, and yarn planned for a project not started yet (shown with
  // a note). Yarn in a project that is going does not show. Alphabetical by brand, name, colour.
  const available = useMemo(() => {
    const words = spellingKey(query).split(' ').filter(Boolean)
    return (all ?? [])
      .filter(r => r.status === 'godkjent' && r.project_id !== projectId)
      .filter(r => !r.project_id || r.strikk_project?.status === 'planned')
      .filter(r => {
        if (!words.length) return true
        const hay = spellingKey(`${yarnLabel(r.strikk_yarn)} ${r.color_number ?? ''} ${r.color_name ?? ''} ${r.dye_lot ?? ''}`)
        return words.every(w => hay.includes(w))
      })
      .sort((a, b) => nb(a.strikk_yarn?.brand ?? '', b.strikk_yarn?.brand ?? '') ||
        nb(a.strikk_yarn?.name ?? '', b.strikk_yarn?.name ?? '') || nb(a.color_number ?? '', b.color_number ?? ''))
  }, [all, projectId, query])

  function choose(r: StashRow) {
    setChosen(r)
    setCount(String(r.project_id ? r.skein_count : freeSkeins(r) || r.skein_count).replace('.', ','))
  }

  async function assign() {
    if (!chosen) return
    const n = Number(count.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0 || n > chosen.skein_count) {
      setError(`Antall må være mellom 0 og ${String(chosen.skein_count).replace('.', ',')}`)
      return
    }
    setError(null)
    try {
      await patchStash(chosen.id, { project_id: projectId, project_skeins: n < chosen.skein_count ? n : null })
      setChosen(null)
      setPicking(false)
      setQuery('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
    }
  }

  async function unassign(id: string) {
    try {
      await patchStash(id, { project_id: null })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
    }
  }

  if (!all) return error ? <p className="text-xs text-red-600">{error}</p> : null

  return (
    <div>
      <p className="text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5">Garn fra lageret</p>
      {error && <p role="alert" className="text-xs text-red-600 mb-1.5">{error}</p>}
      <div className="flex flex-col gap-2">
        {assigned.map(row => (
          <div key={row.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-2">
              <div className="w-9 h-9 rounded-md bg-stone-50 overflow-hidden shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- a small stored picture */}
                {stashThumbnailUrl(row.thumbnail_path) && <img src={stashThumbnailUrl(row.thumbnail_path)!} alt="" className="w-full h-full object-cover" />}
              </div>
              <button onClick={() => setEditing(e => (e === row.id ? null : row.id))} aria-expanded={editing === row.id}
                className="flex-1 min-w-0 text-left text-sm text-stone-700 truncate hover:underline">
                {yarnLabel(row.strikk_yarn)} — {colourText(row)}
                <span className="text-stone-400">
                  {' · '}{row.project_skeins != null
                    ? `${skeinsText(projectSkeins(row))} av ${String(row.skein_count).replace('.', ',')}`
                    : skeinsText(row.skein_count)}
                </span>
              </button>
              <button onClick={() => void unassign(row.id)} title="Fjern fra prosjektet" className="text-xs text-stone-300 hover:text-red-500 shrink-0">✕</button>
            </div>
            {editing === row.id && (
              <StashRowEditor row={row} onClose={() => setEditing(null)}
                onSaved={() => { setEditing(null); void load() }} />
            )}
          </div>
        ))}
        {assigned.length === 0 && <p className="text-sm text-stone-400">Ingen garn tildelt ennå.</p>}

        {picking ? (
          <div data-stash-picker className="rounded-lg border border-stone-200 bg-stone-50 p-2 flex flex-col gap-1.5">
            <input autoFocus value={query} onChange={e => { setQuery(e.target.value); setChosen(null) }}
              placeholder="Søk på garn, produsent, farge eller parti"
              className="w-full px-2 py-1.5 rounded-md border border-stone-200 bg-white text-sm" />
            <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto">
              {available.length === 0 && <p className="text-sm text-stone-400 px-1">Ingen garn passer.</p>}
              {available.map(row => (
                <button key={row.id} onClick={() => choose(row)}
                  className={`text-left text-sm px-2 py-1.5 rounded-md ${chosen?.id === row.id ? 'bg-white ring-1 ring-stone-300' : 'hover:bg-white'} text-stone-700`}>
                  {yarnLabel(row.strikk_yarn)} — {colourText(row)}
                  <span className="text-stone-400"> · {skeinsText(row.project_id ? row.skein_count : freeSkeins(row))}</span>
                  {row.project_id && (
                    <span className="block text-xs text-amber-700">Planlagt i et annet prosjekt: {row.strikk_project?.name ?? 'ukjent'}</span>
                  )}
                </button>
              ))}
            </div>
            {chosen && (
              <div className="flex flex-wrap items-end gap-2 border-t border-stone-200 pt-2">
                <label className="text-xs text-stone-500">Nøster til dette prosjektet
                  <input inputMode="decimal" value={count} onChange={e => setCount(e.target.value)}
                    className="block w-28 px-2 py-1.5 rounded-md border border-stone-200 bg-white text-sm" />
                </label>
                <button onClick={() => void assign()} className="px-3 py-1.5 rounded-md bg-stone-800 text-white text-sm">Tildel</button>
                {chosen.project_id && (
                  <p className="w-full text-xs text-amber-700">Garnet flyttes fra «{chosen.strikk_project?.name ?? 'det andre prosjektet'}» til dette.</p>
                )}
              </div>
            )}
            <button onClick={() => { setPicking(false); setChosen(null); setQuery('') }} className="self-start text-sm text-stone-400 px-1">Avbryt</button>
          </div>
        ) : (
          <button onClick={() => setPicking(true)} className="self-start text-sm text-stone-600 underline">+ Tildel garn fra lageret</button>
        )}
      </div>
    </div>
  )
}
