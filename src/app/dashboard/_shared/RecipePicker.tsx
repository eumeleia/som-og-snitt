'use client'

import { useState } from 'react'

export interface PickerRecipe {
  id: string
  data: {
    name: string
    designer: string
    category: string
    images: { id: string; url: string }[]
    focalX?: number
    focalY?: number
    pdfs?: { id: string; name: string; url: string; type: string; source: string }[]
    sizes?: string[]
    otherEquipment?: string
  }
}

export function RecipePicker({ recipes, onSelect, onClose }: {
  recipes: PickerRecipe[]
  onSelect: (recipe: PickerRecipe) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')

  const filtered = recipes.filter(r => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      r.data.name.toLowerCase().includes(q) ||
      r.data.designer.toLowerCase().includes(q)
    )
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '80vh' }}>

        <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-stone-800 mb-3">Velg oppskrift</h3>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              placeholder="Søk på navn eller designer…"
              className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-stone-400">
                {recipes.length === 0 ? 'Ingen oppskrifter i biblioteket ennå' : 'Ingen treff'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {filtered.map(r => {
                const cover = r.data.images[0]?.url
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => onSelect(r)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-stone-50 transition-colors text-left"
                    >
                      <div className="w-14 h-14 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
                        {cover ? (
                          <img src={cover} alt={r.data.name}
                            className="w-full h-full object-cover"
                            style={{ objectPosition: `${r.data.focalX ?? 50}% ${r.data.focalY ?? 50}%` }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-stone-800 text-sm truncate">
                          {r.data.name || <span className="text-stone-400 italic font-normal">Uten navn</span>}
                        </p>
                        {r.data.designer && (
                          <p className="text-xs text-stone-400 mt-0.5 truncate">{r.data.designer}</p>
                        )}
                        {r.data.category && (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded border text-xs font-medium bg-rose-50 text-rose-700 border-rose-200">
                            {r.data.category}
                          </span>
                        )}
                      </div>
                      <svg className="w-4 h-4 text-stone-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-2 text-sm text-stone-400 hover:text-stone-600 transition-colors">
            Avbryt
          </button>
        </div>
      </div>
    </div>
  )
}
