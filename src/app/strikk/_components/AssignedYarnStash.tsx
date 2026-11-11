'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { STASH_SELECT, stashThumbnailUrl, type StashRow } from '../_lib/stash'

function yarnLabel(y: StashRow['strikk_yarn']): string {
  if (!y) return 'Ukjent garn'
  return [y.brand, y.name].filter(Boolean).join(' ')
}

async function assign(id: string, project_id: string | null) {
  const res = await fetch(`/api/strikk/garnlager/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id }),
  })
  if (!res.ok) throw new Error((await res.json()).error ?? 'Lagring feilet')
}

// Garn fra Garnlageret tildelt dette prosjektet — et annet garn-begrep enn «Garn»-seksjonen
// over (som er oppskriftens garnlinjer/katalogvalg): dette er de FYSISKE nøstene Maria har
// satt til side. Vises her uansett prosjektstatus; i Garnlageret vises de bare mens
// prosjektet er «planlagt» (stjernemerket), og forsvinner derfra når det blir «pågående».
export default function AssignedYarnStash({ projectId }: { projectId: string }) {
  const [assigned, setAssigned] = useState<StashRow[] | null>(null)
  const [available, setAvailable] = useState<StashRow[]>([])
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('strikk_yarn_stash').select(STASH_SELECT).eq('project_id', projectId).order('created_at')
    setAssigned((data ?? []) as unknown as StashRow[])
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    supabase.from('strikk_yarn_stash').select(STASH_SELECT).eq('project_id', projectId).order('created_at').then(({ data }) => {
      if (!cancelled) setAssigned((data ?? []) as unknown as StashRow[])
    })
    return () => { cancelled = true }
  }, [projectId])

  async function loadAvailable() {
    const { data } = await supabase.from('strikk_yarn_stash').select(STASH_SELECT).is('project_id', null).eq('status', 'godkjent').order('created_at')
    setAvailable((data ?? []) as unknown as StashRow[])
    setPicking(true)
  }

  async function pick(id: string) {
    try {
      await assign(id, projectId)
      setPicking(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
    }
  }

  async function unassign(id: string) {
    try {
      await assign(id, null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
    }
  }

  if (!assigned) return null

  return (
    <div>
      <p className="text-xs font-semibold tracking-widest uppercase text-stone-400 mb-1.5">Garn fra lageret</p>
      {error && <p className="text-xs text-red-600 mb-1.5">{error}</p>}
      <div className="flex flex-col gap-2">
        {assigned.map(row => (
          <div key={row.id} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-2">
            <div className="w-9 h-9 rounded-md bg-stone-50 overflow-hidden shrink-0">
              {stashThumbnailUrl(row.thumbnail_path) && <img src={stashThumbnailUrl(row.thumbnail_path)!} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0 text-sm text-stone-700 truncate">
              {yarnLabel(row.strikk_yarn)} — {[row.color_number, row.color_name].filter(Boolean).join(' · ') || 'ukjent farge'}
              <span className="text-stone-400"> · {row.skein_count} nøste{row.skein_count === 1 ? '' : 'r'}</span>
            </div>
            <button onClick={() => void unassign(row.id)} title="Fjern fra prosjektet" className="text-xs text-stone-300 hover:text-red-500 shrink-0">✕</button>
          </div>
        ))}
        {assigned.length === 0 && <p className="text-sm text-stone-400">Ingen garn tildelt ennå.</p>}

        {picking ? (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-2 flex flex-col gap-1 max-h-64 overflow-y-auto">
            {available.length === 0 && <p className="text-sm text-stone-400 px-1">Ingen ledige garn i Garnlageret.</p>}
            {available.map(row => (
              <button key={row.id} onClick={() => void pick(row.id)}
                className="text-left text-sm text-stone-700 px-2 py-1.5 rounded-md hover:bg-white">
                {yarnLabel(row.strikk_yarn)} — {[row.color_number, row.color_name].filter(Boolean).join(' · ') || 'ukjent farge'}
                <span className="text-stone-400"> · {row.skein_count} nøste{row.skein_count === 1 ? '' : 'r'}</span>
              </button>
            ))}
            <button onClick={() => setPicking(false)} className="text-left text-sm text-stone-400 px-2 py-1">Avbryt</button>
          </div>
        ) : (
          <button onClick={() => void loadAvailable()} className="self-start text-sm text-stone-600 underline">+ Tildel garn fra lageret</button>
        )}
      </div>
    </div>
  )
}
