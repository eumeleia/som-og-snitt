'use client'

import { useState } from 'react'

export interface PickerFabric {
  id: string
  data: {
    navn: string
    bilde: string
    materiale?: string
    mengde?: string
  }
}

// Speiler ProjectPicker.tsx/RecipePicker.tsx (samme app, samme mønster) — se
// begrunnelsen der for hvorfor dette ikke er slått sammen til én generisk picker.
export function FabricPicker({ fabrics, onSelect, onClose }: {
  fabrics: PickerFabric[]
  onSelect: (fabric: PickerFabric) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')

  const filtered = fabrics.filter(f => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      f.data.navn.toLowerCase().includes(q) ||
      (f.data.materiale ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '80vh' }}>

        <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-stone-800 mb-3">Velg stoff</h3>
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
              placeholder="Søk på navn eller materiale…"
              className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-stone-400">
                {fabrics.length === 0 ? 'Ingen stoffer i Lageret ennå' : 'Ingen treff'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {filtered.map(f => (
                <li key={f.id}>
                  <button
                    onClick={() => onSelect(f)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-stone-50 transition-colors text-left"
                  >
                    <div className="w-14 h-14 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
                      {f.data.bilde ? (
                        <img src={f.data.bilde} alt={f.data.navn} className="w-full h-full object-cover" />
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
                        {f.data.navn || <span className="text-stone-400 italic font-normal">Uten navn</span>}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        {f.data.materiale && (
                          <span className="text-xs text-stone-400 truncate">{f.data.materiale}</span>
                        )}
                        {f.data.mengde && (
                          <span className="text-xs text-stone-400 truncate">· {f.data.mengde}</span>
                        )}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-stone-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </li>
              ))}
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
