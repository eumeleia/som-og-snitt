'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { STASH_SELECT, type StashRow } from '../_lib/stash'

function yarnLabel(y: StashRow['strikk_yarn']): string {
  if (!y) return 'Ukjent garn'
  return [y.brand, y.name].filter(Boolean).join(' ')
}

// Vises når Maria setter et prosjekt fra «Pågående» til «Ferdig»: spør om restegarn per
// tildelt garn, legger det tilbake i Garnlageret (godkjent, uten bilde av originalbildet
// siden det IKKE lenger ligger i den originale haugen) og setter så prosjektet ferdig.
export default function CompleteProjectModal({ projectId, onDone, onCancel }: {
  projectId: string
  onDone: () => void
  onCancel: () => void
}) {
  const [rows, setRows] = useState<StashRow[] | null>(null)
  const [skeins, setSkeins] = useState<Record<string, string>>({})
  const [grams, setGrams] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('strikk_yarn_stash').select(STASH_SELECT).eq('project_id', projectId).then(({ data }) => {
      if (!cancelled) setRows((data ?? []) as unknown as StashRow[])
    })
    return () => { cancelled = true }
  }, [projectId])

  async function complete() {
    setBusy(true); setError(null)
    try {
      const leftovers = (rows ?? []).map(r => ({
        stash_id: r.id,
        skein_count: Number((skeins[r.id] ?? '').replace(',', '.')) || 0,
        leftover_g: Number((grams[r.id] ?? '').replace(',', '.')) || 0,
      }))
      const res = await fetch(`/api/strikk/projects/${projectId}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leftovers }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Fullføring feilet')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onCancel}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl p-5 flex flex-col gap-3 max-h-[90dvh] overflow-y-auto">
        <h3 className="font-serif text-xl text-stone-800">Fullfør prosjektet</h3>
        {rows === null && <p className="text-sm text-stone-500">Henter tildelt garn …</p>}
        {rows?.length === 0 && <p className="text-sm text-stone-500">Ingen garn var tildelt dette prosjektet.</p>}
        {rows && rows.length > 0 && (
          <>
            <p className="text-sm text-stone-600">Er det noe igjen av garnet som var tildelt? Det som er igjen, legges tilbake i Garnlageret.</p>
            <div className="flex flex-col gap-3">
              {rows.map(r => (
                <div key={r.id} className="rounded-lg border border-stone-200 bg-white p-2.5">
                  <p className="text-sm text-stone-700 mb-1.5">
                    {yarnLabel(r.strikk_yarn)} — {[r.color_number, r.color_name].filter(Boolean).join(' · ') || 'ukjent farge'}
                    <span className="text-stone-400"> · hadde {r.skein_count} nøste{r.skein_count === 1 ? '' : 'r'}</span>
                  </p>
                  <div className="flex gap-2">
                    <label className="flex-1 flex flex-col gap-0.5">
                      <span className="text-xs text-stone-400">Hele nøster igjen</span>
                      <input inputMode="decimal" placeholder="0" className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm"
                        value={skeins[r.id] ?? ''} onChange={e => setSkeins(s => ({ ...s, [r.id]: e.target.value }))} />
                    </label>
                    <label className="flex-1 flex flex-col gap-0.5">
                      <span className="text-xs text-stone-400">Rest (g)</span>
                      <input inputMode="decimal" placeholder="0" className="px-2 py-1.5 rounded-lg border border-stone-200 text-sm"
                        value={grams[r.id] ?? ''} onChange={e => setGrams(s => ({ ...s, [r.id]: e.target.value }))} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 mt-1">
          <button disabled={busy || rows === null} onClick={() => void complete()}
            className="px-4 py-2 rounded-xl bg-[#2E5339] text-white text-sm disabled:opacity-40">
            {busy ? 'Fullfører …' : 'Fullfør'}
          </button>
          <button disabled={busy} onClick={onCancel} className="px-4 py-2 rounded-xl text-sm text-stone-500">Avbryt</button>
        </div>
      </div>
    </div>
  )
}
