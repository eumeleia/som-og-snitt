'use client'

import { useState } from 'react'

export interface PickerProject {
  id: string
  data: {
    name: string
    status: 'Planlagt' | 'Aktiv' | 'Fullført'
    category: string
    images: { id: string; url: string }[]
    focalX?: number
    focalY?: number
  }
}

// Speiler RecipePicker.tsx (samme app, samme mønster) — bevisst IKKE en felles
// generisk "EntityPicker", siden de to har forskjellig sekundærinformasjon (status+kategori
// her, designer+kategori der) og strukturelt ulike datakilder (projects- vs
// recipes-tabellen). Å tvinge dem gjennom én generisk komponent nå, for to kallesteder,
// ville vært abstraksjon uten reell gjenbruksgevinst.
export function ProjectPicker({ projects, onSelect, onClose }: {
  projects: PickerProject[]
  onSelect: (project: PickerProject) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')

  const filtered = projects.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      p.data.name.toLowerCase().includes(q) ||
      p.data.category.toLowerCase().includes(q)
    )
  })

  // Planlagt/Aktiv øverst (det er typisk DE man vil koble et ikke-brukt stoff til),
  // Fullført sist — men ingen skjules, bare sortert.
  const rekkefolge: Record<string, number> = { Planlagt: 0, Aktiv: 1, Fullført: 2 }
  const sortert = [...filtered].sort((a, b) => (rekkefolge[a.data.status] ?? 9) - (rekkefolge[b.data.status] ?? 9))

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '80vh' }}>

        <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-stone-800 mb-3">Velg prosjekt</h3>
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
              placeholder="Søk på navn eller kategori…"
              className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {sortert.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-stone-400">
                {projects.length === 0 ? 'Ingen prosjekter ennå' : 'Ingen treff'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {sortert.map(p => {
                const cover = p.data.images[0]?.url
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => onSelect(p)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-stone-50 transition-colors text-left"
                    >
                      <div className="w-14 h-14 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
                        {cover ? (
                          <img src={cover} alt={p.data.name}
                            className="w-full h-full object-cover"
                            style={{ objectPosition: `${p.data.focalX ?? 50}% ${p.data.focalY ?? 50}%` }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-stone-800 text-sm truncate">
                          {p.data.name || <span className="text-stone-400 italic font-normal">Uten navn</span>}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${
                            p.data.status === 'Planlagt' ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : p.data.status === 'Aktiv' ? 'bg-teal-50 text-teal-700 border-teal-200'
                              : 'bg-stone-100 text-stone-500 border-stone-200'
                          }`}>
                            {p.data.status}
                          </span>
                          {p.data.category && (
                            <span className="text-xs text-stone-400 truncate">{p.data.category}</span>
                          )}
                        </div>
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
