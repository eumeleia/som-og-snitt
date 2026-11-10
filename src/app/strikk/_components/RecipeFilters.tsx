'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AUDIENCES, type Audience } from '../_lib/extraction'
import { spellingKey, type YarnRow } from '../_lib/yarns'
import {
  AUDIENCE_LABEL, EMPTY_FILTER, RECIPE_FILTER_SELECT, SORTS, SORT_LABEL,
  activeChips, garmentTypes, removeChip, yarnLabel,
  type FilterRecipe, type FilterResult, type RecipeFilter, type Sort,
} from '../_lib/recipe-filter'

export type FilterData = { kind: 'loading' } | { kind: 'ready'; recipes: FilterRecipe[]; yarns: YarnRow[] } | { kind: 'error'; text: string }

// The rows the filters need, loaded beside the plain list so the list still shows if this fails.
export function useFilterData(reload: number): FilterData {
  const [data, setData] = useState<FilterData>({ kind: 'loading' })
  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('strikk_oppskrift').select(RECIPE_FILTER_SELECT),
      supabase.from('strikk_yarn').select('*'),
    ]).then(([r, y]) => {
      if (cancelled) return
      const error = r.error ?? y.error
      if (error) setData({ kind: 'error', text: error.message })
      else setData({ kind: 'ready', recipes: (r.data ?? []) as unknown as FilterRecipe[], yarns: (y.data ?? []) as YarnRow[] })
    })
    return () => { cancelled = true }
  }, [reload])
  return data
}

const STORAGE_KEY = 'strikk-oppskrifter-filter'

// Kept for the browser tab, so going into a recipe and back keeps the filters.
export function useStoredFilter(): [RecipeFilter, (f: RecipeFilter) => void] {
  const [filter, setFilter] = useState<RecipeFilter>(EMPTY_FILTER)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      // Reading browser storage has to wait until after the first render on the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setFilter({ ...EMPTY_FILTER, ...JSON.parse(saved) })
    } catch { /* no storage: start empty */ }
  }, [])
  const set = (f: RecipeFilter) => {
    setFilter(f)
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(f)) } catch { /* not kept */ }
  }
  return [filter, set]
}

export const filterCount = (f: RecipeFilter) =>
  f.garmentTypes.length + f.audiences.length + (f.gaugeMin !== null || f.gaugeMax !== null ? 1 : 0) + f.yarnIds.length + (f.leftover ? 1 : 0)

// ── Above the list ──────────────────────────────────────────────────────────────────

export function FilterBar({ filter, onChange, yarns, shown, total, unread, onOpen }: {
  filter: RecipeFilter
  onChange: (f: RecipeFilter) => void
  yarns: YarnRow[]
  shown: number
  total: number
  unread: number
  onOpen: () => void
}) {
  const chips = activeChips(filter, yarns).filter(c => c.key !== 'query')
  const n = filterCount(filter)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="search" value={filter.query} onChange={e => onChange({ ...filter, query: e.target.value })}
          placeholder="Søk på navn eller designer" aria-label="Søk på navn eller designer"
          className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-stone-300 bg-white text-base text-stone-900"
        />
        <button onClick={onOpen}
          className={`h-11 px-3 rounded-xl border text-sm shrink-0 ${n ? 'border-[#2E5339] bg-[#2E5339] text-white' : 'border-stone-300 bg-white text-stone-800'}`}>
          Filter{n > 0 && ` (${n})`}
        </button>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          {chips.map(c => (
            <button key={c.key} onClick={() => onChange(removeChip(filter, c.key))} aria-label={`Fjern filter ${c.label}`}
              className="h-8 pl-3 pr-2 rounded-full bg-stone-100 text-sm text-stone-800 flex items-center gap-1 max-w-full">
              <span className="truncate">{c.label}</span><span aria-hidden className="text-stone-500">×</span>
            </button>
          ))}
          <button onClick={() => onChange({ ...EMPTY_FILTER, query: filter.query, sort: filter.sort })}
            className="h-8 px-2 text-sm text-stone-600 underline">Fjern alle</button>
        </div>
      )}
      <p className="text-sm text-stone-500">
        {shown === total ? `${total} oppskrifter` : `${shown} av ${total} oppskrifter`} · sortert etter {SORT_LABEL[filter.sort].toLowerCase()}
        {n > 0 && unread > 0 && ` · ${unread} er ikke lest inn og kan ikke filtreres`}
      </p>
    </div>
  )
}

// What a recipe matched on, for the active yarn and leftover filters.
export function HitInfo({ result, yarns, filter }: { result: FilterResult; yarns: YarnRow[]; filter: RecipeFilter }) {
  const byId = new Map(yarns.map(y => [y.id, y]))
  const lines: string[] = []
  for (const { yarnId, hits } of result.yarnHits) {
    const y = byId.get(yarnId)
    const name = y ? yarnLabel(y) : 'garnet'
    for (const h of hits) {
      lines.push(h.kind === 'uses' ? `Bruker ${name}` : h.kind === 'alternative' ? `${name} er oppskriftens eget alternativ` : `Appen foreslår ${name} i stedet for ${h.instead} (utgått)`)
    }
  }
  if (filter.leftover && result.leftover) {
    lines.push(result.leftover.kind === 'mentions'
      ? `Restegarn: nevnt i oppskriften${result.leftover.note ? ` («${result.leftover.note.replace(/^…|…$/g, '').trim()}»)` : ''}`
      : `Restegarn: ${result.leftover.count} farger under to nøster i minste størrelse`)
  }
  if (!lines.length) return null
  return <div className="flex flex-col gap-0.5 mt-1">{lines.map((l, i) => <span key={i} className="text-xs text-[#2E5339] break-words">{l}</span>)}</div>
}

// ── The sheet ───────────────────────────────────────────────────────────────────────

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`h-9 px-3 rounded-full text-sm border ${on ? 'bg-[#2E5339] border-[#2E5339] text-white' : 'bg-white border-stone-300 text-stone-800'}`}>
      {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-stone-800">{title}</h3>
      {children}
    </section>
  )
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])
const parseGauge = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(n) && n > 0 ? n : null }

export function FilterSheet({ filter, onChange, recipes, yarns, shown, onClose }: {
  filter: RecipeFilter
  onChange: (f: RecipeFilter) => void
  recipes: FilterRecipe[]
  yarns: YarnRow[]
  shown: number
  onClose: () => void
}) {
  const [yarnQuery, setYarnQuery] = useState('')
  const [gauge, setGauge] = useState({ min: filter.gaugeMin?.toString() ?? '', max: filter.gaugeMax?.toString() ?? '' })
  const types = useMemo(() => garmentTypes(recipes), [recipes])
  const sortedYarns = useMemo(() => [...yarns].sort((a, b) => yarnLabel(a).localeCompare(yarnLabel(b), 'nb')), [yarns])
  const q = spellingKey(yarnQuery)
  const yarnList = sortedYarns.filter(y => !filter.yarnIds.includes(y.id) && (!q || spellingKey(`${y.brand} ${y.name} ${y.aliases.map(a => a.name).join(' ')}`).includes(q))).slice(0, 40)
  const chosen = sortedYarns.filter(y => filter.yarnIds.includes(y.id))

  useEffect(() => {
    const keys = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Filter og sortering" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-lg bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="font-serif text-xl text-stone-800">Filter og sortering</div>
          <button onClick={onClose} aria-label="Lukk" className="w-11 h-11 -mr-2 text-2xl text-stone-500">×</button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pb-4 flex flex-col gap-5">
          <Section title="Sortering">
            <div className="flex flex-wrap gap-1.5">
              {SORTS.map(s => <Toggle key={s} on={filter.sort === s} onClick={() => onChange({ ...filter, sort: s as Sort })}>{SORT_LABEL[s]}</Toggle>)}
            </div>
          </Section>

          <Section title="Plaggtype">
            <div className="flex flex-wrap gap-1.5">
              {types.map(t => (
                <Toggle key={t.type} on={filter.garmentTypes.includes(t.type)} onClick={() => onChange({ ...filter, garmentTypes: toggle(filter.garmentTypes, t.type) })}>
                  {t.type} <span className="opacity-60">{t.count}</span>
                </Toggle>
              ))}
            </div>
          </Section>

          <Section title="Målgruppe">
            <div className="flex flex-wrap gap-1.5">
              {AUDIENCES.map(a => (
                <Toggle key={a} on={filter.audiences.includes(a)} onClick={() => onChange({ ...filter, audiences: toggle(filter.audiences, a as Audience) })}>
                  {AUDIENCE_LABEL[a]}
                </Toggle>
              ))}
            </div>
          </Section>

          <Section title="Strikkefasthet (masker per 10 cm)">
            <div className="flex items-center gap-2">
              {(['min', 'max'] as const).map((k, i) => (
                <span key={k} className="contents">
                  {i === 1 && <span className="text-stone-500">–</span>}
                  <input inputMode="decimal" value={gauge[k]} placeholder={k === 'min' ? 'fra' : 'til'} aria-label={k === 'min' ? 'Strikkefasthet fra' : 'Strikkefasthet til'}
                    onChange={e => {
                      const next = { ...gauge, [k]: e.target.value }
                      setGauge(next)
                      onChange({ ...filter, gaugeMin: parseGauge(next.min), gaugeMax: parseGauge(next.max) })
                    }}
                    className="w-24 h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900" />
                </span>
              ))}
            </div>
            <p className="text-xs text-stone-500">Kataloger er ikke med når strikkefasthet eller garn er valgt.</p>
          </Section>

          <Section title="Garn">
            {chosen.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {chosen.map(y => <Toggle key={y.id} on onClick={() => onChange({ ...filter, yarnIds: toggle(filter.yarnIds, y.id) })}>{yarnLabel(y)} ×</Toggle>)}
              </div>
            )}
            <input type="search" value={yarnQuery} onChange={e => setYarnQuery(e.target.value)} placeholder="Søk i garnkatalogen" aria-label="Søk i garnkatalogen"
              className="h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900" />
            <ul className="flex flex-col max-h-56 overflow-y-auto rounded-lg border border-stone-200 bg-white divide-y divide-stone-100">
              {yarnList.map(y => (
                <li key={y.id}>
                  <button type="button" onClick={() => { onChange({ ...filter, yarnIds: [...filter.yarnIds, y.id] }); setYarnQuery('') }}
                    className="w-full text-left px-3 py-2.5 text-sm text-stone-800 active:bg-stone-50">
                    {yarnLabel(y)}
                  </button>
                </li>
              ))}
              {yarnList.length === 0 && <li className="px-3 py-2.5 text-sm text-stone-500">Ingen garn passer søket.</li>}
            </ul>
            <p className="text-xs text-stone-500">Treffer oppskrifter som bruker garnet, har det som eget alternativ, eller der appen foreslår det i stedet for et utgått garn.</p>
          </Section>

          <Section title="Restegarn">
            <div><Toggle on={filter.leftover} onClick={() => onChange({ ...filter, leftover: !filter.leftover })}>Bare restegarnoppskrifter</Toggle></div>
            <p className="text-xs text-stone-500">Oppskrifter som selv nevner restegarn, eller som har minst tre farger der hver trenger under to nøster i minste størrelse.</p>
          </Section>
        </div>

        <div className="flex gap-2 px-4 pt-2 border-t border-stone-200" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          <button onClick={() => { setGauge({ min: '', max: '' }); onChange({ ...EMPTY_FILTER, query: filter.query, sort: filter.sort }) }}
            className="flex-1 h-11 rounded-xl border border-stone-300 text-stone-700">Nullstill</button>
          <button onClick={onClose} className="flex-1 h-11 rounded-xl bg-[#2E5339] text-white">Vis {shown} oppskrifter</button>
        </div>
      </div>
    </div>
  )
}
