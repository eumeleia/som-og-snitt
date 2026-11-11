'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { RECIPE_SELECT, type KnitRecipe } from '../_lib/recipes'
import { spellingKey } from '../_lib/yarns'

type State = { kind: 'loading' } | { kind: 'ready'; recipes: KnitRecipe[] } | { kind: 'error'; text: string }

// Velger en oppskrift fra Strikk › Oppskrifter til å starte et nytt prosjekt med.
export default function ProjectRecipePicker({ onSelect, onClose }: {
  onSelect: (recipe: KnitRecipe) => void
  onClose: () => void
}) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase.from('strikk_oppskrift').select(RECIPE_SELECT).order('title').then(({ data, error }) => {
      if (cancelled) return
      if (error) setState({ kind: 'error', text: error.message })
      else setState({ kind: 'ready', recipes: (data ?? []) as unknown as KnitRecipe[] })
    })
    return () => { cancelled = true }
  }, [])

  const q = spellingKey(query)
  const list = state.kind === 'ready'
    ? state.recipes.filter(r => !q || spellingKey(`${r.title} ${r.designer ?? ''}`).includes(q))
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Velg oppskrift" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="font-serif text-xl text-stone-800">Velg oppskrift</div>
          <button onClick={onClose} aria-label="Lukk" className="w-11 h-11 -mr-2 text-2xl text-stone-500">×</button>
        </div>

        <div className="px-4 pb-2">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} autoFocus
            placeholder="Søk på navn eller designer" aria-label="Søk i oppskriftene"
            className="w-full h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900" />
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pb-4"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          {state.kind === 'loading' && <p className="text-sm text-stone-500 px-1 py-2">Laster oppskrifter …</p>}
          {state.kind === 'error' && <p className="text-sm text-red-700 px-1 py-2">{state.text}</p>}
          {state.kind === 'ready' && (
            <ul className="flex flex-col rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
              {list.map(r => (
                <li key={r.id}>
                  <button type="button" onClick={() => onSelect(r)}
                    className="w-full text-left px-3 py-2.5 active:bg-stone-50">
                    <div className="text-sm font-medium text-stone-800">{r.title}</div>
                    {r.designer && <div className="text-xs text-stone-500">{r.designer}</div>}
                  </button>
                </li>
              ))}
              {list.length === 0 && (
                <li className="px-3 py-2.5 text-sm text-stone-500">
                  {state.recipes.length === 0 ? 'Ingen oppskrifter ennå.' : 'Ingen treff.'}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
