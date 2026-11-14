'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { STATUS_LABEL, type ProjectStatus } from '../_lib/projects'
import type { StashRow } from '../_lib/stash'

interface ProjectOption { id: string; name: string; status: ProjectStatus }

const toNumber = (s: string) => {
  const n = Number(s.replace(',', '.'))
  return s.trim() === '' || !Number.isFinite(n) ? null : n
}

export async function patchStash(id: string, body: Record<string, unknown>): Promise<StashRow> {
  const res = await fetch(`/api/strikk/garnlager/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `Lagring feilet (${res.status})`)
  return j as StashRow
}

// Editing one stash row: how many skeins and grams there are, which project it is set aside
// for (planned or in progress), and how many of the skeins the project gets. The row stays
// together; the rest of the skeins are free.
export default function StashRowEditor({ row, onSaved, onClose }: {
  row: StashRow
  onSaved: (row: StashRow) => void
  onClose: () => void
}) {
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [skeins, setSkeins] = useState(String(row.skein_count).replace('.', ','))
  const [grams, setGrams] = useState(row.leftover_g ? String(row.leftover_g).replace('.', ',') : '')
  const [projectId, setProjectId] = useState(row.project_id ?? '')
  const [forProject, setForProject] = useState(
    row.project_id ? String(row.project_skeins ?? row.skein_count).replace('.', ',') : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    supabase.from('strikk_project').select('id, name, status').in('status', ['planned', 'in_progress']).order('name')
      .then(({ data }) => { if (alive) setProjects((data ?? []) as ProjectOption[]) })
    return () => { alive = false }
  }, [])

  const total = toNumber(skeins)
  const part = toNumber(forProject)

  async function save() {
    setError(null)
    if (total === null || total < 0) { setError('Skriv inn antall nøster i lageret'); return }
    if (projectId && part !== null && (part <= 0 || part > total)) {
      setError(`Nøster til prosjektet må være mellom 0 og ${String(total).replace('.', ',')}`)
      return
    }
    setSaving(true)
    try {
      const saved = await patchStash(row.id, {
        skein_count: total,
        leftover_g: toNumber(grams),
        project_id: projectId || null,
        // Empty or all of them: the whole row.
        project_skeins: projectId && part !== null && part < total ? part : null,
      })
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full px-2 py-1.5 rounded-md border border-stone-200 bg-white text-sm'
  return (
    <div data-stash-editor className="rounded-lg border border-stone-200 bg-stone-50 p-3 flex flex-col gap-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-stone-500">Nøster i lageret
          <input className={input} inputMode="decimal" value={skeins} onChange={e => setSkeins(e.target.value)} />
        </label>
        <label className="text-xs text-stone-500">Rest (gram)
          <input className={input} inputMode="decimal" value={grams} onChange={e => setGrams(e.target.value)} />
        </label>
      </div>
      <label className="text-xs text-stone-500">Prosjekt
        <select className={input} value={projectId} onChange={e => {
          setProjectId(e.target.value)
          if (e.target.value && !forProject) setForProject(skeins)
        }}>
          <option value="">Ingen (ledig)</option>
          {row.project_id && !projects.some(p => p.id === row.project_id) && (
            <option value={row.project_id}>{row.strikk_project?.name ?? 'Nåværende prosjekt'}</option>
          )}
          {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({STATUS_LABEL[p.status].toLowerCase()})</option>)}
        </select>
      </label>
      {projectId && (
        <label className="text-xs text-stone-500">Nøster til prosjektet
          <input className={input} inputMode="decimal" value={forProject} onChange={e => setForProject(e.target.value)} />
          {total !== null && part !== null && part < total && (
            <span className="block mt-0.5 text-stone-500">{String(total - part).replace('.', ',')} blir ledige i lageret.</span>
          )}
        </label>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={saving} className="px-3 py-1.5 rounded-md bg-stone-800 text-white text-sm disabled:opacity-40">
          {saving ? 'Lagrer …' : 'Lagre'}
        </button>
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-stone-500">Avbryt</button>
      </div>
    </div>
  )
}
