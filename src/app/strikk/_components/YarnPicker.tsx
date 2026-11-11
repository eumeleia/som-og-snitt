'use client'

import { useEffect, useMemo, useState } from 'react'
import { spellingKey, type YarnRow } from '../_lib/yarns'
import type { Alternative } from '../_lib/yarn-alternatives'
import { estimatedCost } from '../_lib/project-amounts'
import type { AmountData } from '../_lib/extraction'
import YarnFavoriteStar from './YarnFavoriteStar'

const yarnLabel = (y: Pick<YarnRow, 'brand' | 'name' | 'discontinued'>) =>
  [y.brand, y.name].filter(Boolean).join(' ') + (y.discontinued ? ' (utgått)' : '')

const SOURCE_LABEL: Record<Alternative['source'], string> = {
  own_swatch: 'Egen strikkeprøve', skaberglaede: 'Skaberglæde', pattern: 'Oppskriftens alternativ',
  drops: 'DROPS', same_gauge: 'Samme strikkefasthet i katalogen',
}

function altLabel(a: Alternative): string {
  return a.members.map(m => `${yarnLabel(m.yarn)}${m.strands > 1 ? ` (${m.strands} tråder)` : ''}`).join(' + ')
}

// Velger ett garn fra katalogen til én garnlinje i et prosjekt. suggestedId er garnet
// oppskriften selv er koblet til for den linjen, vist øverst som forslag når det ikke
// allerede er valgt. alternatives (valgfritt) er rangerte garnalternativer for samme
// strikkefasthet — bare de med ett garn kan velges direkte her, resten (flere garn holdt
// sammen) er bare til informasjon siden denne linja holder ett garn.
export default function YarnPicker({ yarns, value, suggestedId, alternatives, amount, onSelect, onYarnUpdated, onClose }: {
  yarns: YarnRow[]
  value: string | null
  suggestedId: string | null
  alternatives?: Alternative[]
  amount?: AmountData | null
  onSelect: (yarnId: string | null) => void
  onYarnUpdated?: (yarnId: string, patch: { favorite?: boolean | null; price_per_skein?: number | null }) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(yarns.map(y => [y.id, y])), [yarns])
  const suggested = suggestedId ? byId.get(suggestedId) : undefined

  useEffect(() => {
    const keys = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [onClose])

  const q = spellingKey(query)
  const list = useMemo(() => [...yarns]
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || yarnLabel(a).localeCompare(yarnLabel(b), 'nb'))
    .filter(y => !q || spellingKey(`${y.brand} ${y.name}`).includes(q)), [yarns, q])

  function pick(id: string | null) { onSelect(id); onClose() }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Velg garn" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="font-serif text-xl text-stone-800">Velg garn</div>
          <button onClick={onClose} aria-label="Lukk" className="w-11 h-11 -mr-2 text-2xl text-stone-500">×</button>
        </div>

        <div className="px-4 pb-2">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} autoFocus
            placeholder="Søk i garnkatalogen" aria-label="Søk i garnkatalogen"
            className="w-full h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900" />
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pb-4 flex flex-col gap-3">
          {suggested && suggested.id !== value && !q && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Garnet i oppskriften</p>
              <button type="button" onClick={() => pick(suggested.id)}
                className="w-full text-left px-3 py-2.5 rounded-lg border border-[#C9A57A] bg-amber-50/40 text-sm text-stone-800">
                {yarnLabel(suggested)}
              </button>
            </div>
          )}

          {alternatives && alternatives.length > 0 && !q && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Alternativer for strikkefastheten</p>
              <ul className="flex flex-col rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
                {alternatives.map((a, i) => {
                  const single = a.members.length === 1
                  const cost = single && amount ? estimatedCost(amount, a.members[0].yarn) : null
                  const content = (
                    <>
                      <div className="text-sm text-stone-800">{altLabel(a)}</div>
                      <div className="text-xs text-stone-500">
                        {SOURCE_LABEL[a.source]}
                        {cost !== null && ` · ca. ${cost} kr`}
                      </div>
                    </>
                  )
                  return (
                    <li key={i}>
                      {single ? (
                        <button type="button" onClick={() => pick(a.members[0].yarn.id)}
                          className="w-full text-left px-3 py-2.5 active:bg-stone-50">
                          {content}
                        </button>
                      ) : (
                        <div className="px-3 py-2.5">{content}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <ul className="flex flex-col rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
            {value && (
              <li>
                <button type="button" onClick={() => pick(null)}
                  className="w-full text-left px-3 py-2.5 text-sm text-red-700 active:bg-stone-50">
                  Fjern garn
                </button>
              </li>
            )}
            {list.map(y => (
              <li key={y.id} className="flex items-center gap-2 px-3 py-2">
                <button type="button" onClick={() => pick(y.id)}
                  className={`flex-1 min-w-0 text-left truncate text-sm active:bg-stone-50 ${y.id === value ? 'font-medium text-stone-900' : 'text-stone-800'}`}>
                  {yarnLabel(y)}
                </button>
                <YarnFavoriteStar yarnId={y.id} favorite={y.favorite} pricePerSkein={y.price_per_skein}
                  onChange={patch => onYarnUpdated?.(y.id, patch)} />
              </li>
            ))}
            {list.length === 0 && <li className="px-3 py-2.5 text-sm text-stone-500">Ingen garn passer søket.</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
