'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { COMBO_SELECT, SWATCH_SELECT, comboFromRow, swatchFromRow, type ComboRow, type SwatchRow } from '../_lib/combos'
import { rankAlternatives, type Alternative } from '../_lib/yarn-alternatives'
import { formatFibers, formatRange, mainFibre, spellingKey, type YarnRow } from '../_lib/yarns'
import type { StashRow } from '../_lib/stash'
import YarnFavoriteStar from './YarnFavoriteStar'

const SOURCE_LABEL: Record<Alternative['source'], string> = {
  own_swatch: 'Egen strikkeprøve', skaberglaede: 'Skaberglæde', pattern: 'Oppskriftens alternativ',
  drops: 'DROPS', same_gauge: 'Samme strikkefasthet',
}

function yarnLabel(y: YarnRow): string {
  return [y.brand, y.name].filter(Boolean).join(' ') + (y.discontinued ? ' (utgått)' : '')
}

async function addYarn(brand: string, name: string): Promise<YarnRow> {
  const res = await fetch('/api/strikk/yarn', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand, name }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `Lagring feilet (${res.status})`)
  return j as YarnRow
}

// «Finn alternativt garn»: skriv inn et garn eller en strikkefasthet, få alternativer
// rangert etter kilde (yarn-alternatives.ts) — garn Maria har i lageret vises først.
export default function YarnAlternatives({ yarns, stash, onYarnUpdated, onYarnAdded }: {
  yarns: YarnRow[]
  stash: StashRow[]
  onYarnUpdated: (yarnId: string, patch: { favorite?: boolean | null; price_per_skein?: number | null }) => void
  onYarnAdded: (yarn: YarnRow) => void
}) {
  const [mode, setMode] = useState<'yarn' | 'gauge'>('yarn')
  const [query, setQuery] = useState('')
  const [gauge, setGauge] = useState('')
  const [picked, setPicked] = useState<YarnRow | null>(null)
  const [combos, setCombos] = useState<ReturnType<typeof comboFromRow>[]>([])
  const [swatches, setSwatches] = useState<ReturnType<typeof swatchFromRow>[]>([])
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('strikk_yarn_combo').select(COMBO_SELECT),
      supabase.from('strikk_swatch').select(SWATCH_SELECT),
    ]).then(([c, s]) => {
      if (cancelled) return
      if (!c.error) setCombos((c.data as unknown as ComboRow[] ?? []).map(comboFromRow))
      if (!s.error) setSwatches((s.data as unknown as SwatchRow[] ?? []).map(swatchFromRow))
    })
    return () => { cancelled = true }
  }, [])

  const ownedByYarn = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of stash) {
      if (r.status !== 'godkjent' || !r.yarn_id) continue
      m.set(r.yarn_id, (m.get(r.yarn_id) ?? 0) + r.skein_count)
    }
    return m
  }, [stash])

  const q = spellingKey(query)
  const nameMatches = useMemo(() => {
    if (mode !== 'yarn' || !q || picked) return []
    return yarns.filter(y => spellingKey(`${y.brand} ${y.name}`).includes(q)).slice(0, 8)
  }, [yarns, q, mode, picked])

  const alternatives = useMemo<Alternative[] | null>(() => {
    if (mode === 'yarn') {
      if (!picked) return null
      const target = picked.gauge_stitches_min !== null
        ? (picked.gauge_stitches_min + (picked.gauge_stitches_max ?? picked.gauge_stitches_min)) / 2
        : null
      return rankAlternatives({
        targetGauge: target, targetFibre: mainFibre(picked.fibers), excludeYarnId: picked.id,
        catalogue: yarns, combos, swatches, patternAlternativeYarnIds: [],
      })
    }
    const g = Number(gauge.replace(',', '.'))
    if (!gauge.trim() || !Number.isFinite(g) || g <= 0) return null
    return rankAlternatives({
      targetGauge: g, targetFibre: null, excludeYarnId: null,
      catalogue: yarns, combos, swatches, patternAlternativeYarnIds: [],
    })
  }, [mode, picked, gauge, yarns, combos, swatches])

  const sorted = useMemo(() => {
    if (!alternatives) return null
    const owned = (a: Alternative) => a.members.some(m => (ownedByYarn.get(m.yarn.id) ?? 0) > 0)
    return [...alternatives].sort((a, b) => Number(owned(b)) - Number(owned(a)))
  }, [alternatives, ownedByYarn])

  async function handleAdd() {
    const [brand, ...rest] = query.trim().split(' ')
    const name = rest.join(' ') || brand
    setAdding(true); setAddError(null)
    try {
      const yarn = await addYarn(rest.length ? brand : '', name)
      onYarnAdded(yarn)
      setQuery(''); setPicked(null)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Noe gikk galt')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex gap-1 p-1 bg-stone-100 rounded-xl w-fit">
        <button onClick={() => { setMode('yarn'); setPicked(null) }}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${mode === 'yarn' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>
          Garn
        </button>
        <button onClick={() => { setMode('gauge'); setPicked(null) }}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${mode === 'gauge' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>
          Strikkefasthet
        </button>
      </div>

      {mode === 'yarn' ? (
        <div className="relative">
          <input className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" placeholder="Skriv inn et garn, f.eks. Sandnes Garn Sunday"
            value={picked ? yarnLabel(picked) : query}
            onChange={e => { setPicked(null); setQuery(e.target.value) }} />
          {nameMatches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-stone-200 bg-white shadow-md max-h-64 overflow-y-auto">
              {nameMatches.map(y => (
                <button key={y.id} onClick={() => { setPicked(y); setQuery(yarnLabel(y)) }}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-stone-50">
                  {yarnLabel(y)}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <input className="w-full sm:w-64 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" inputMode="decimal"
          placeholder="Masker per 10 cm" value={gauge} onChange={e => setGauge(e.target.value)} />
      )}

      {mode === 'yarn' && query.trim() && !picked && nameMatches.length === 0 && (
        <div className="rounded-lg border border-dashed border-stone-300 px-3 py-2.5 flex items-center gap-2">
          <p className="text-sm text-stone-500 flex-1">Finnes ikke «{query.trim()}» i katalogen.</p>
          <button disabled={adding} onClick={() => void handleAdd()}
            className="text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white disabled:opacity-40">
            {adding ? 'Legger til …' : 'Legg til'}
          </button>
        </div>
      )}
      {addError && <p className="text-sm text-red-600">{addError}</p>}

      {sorted && sorted.length === 0 && <p className="text-sm text-stone-500">Ingen alternativer funnet.</p>}
      {sorted && sorted.length > 0 && (
        <ul className="flex flex-col gap-2">
          {sorted.map((a, i) => (
            <li key={i} className="rounded-xl border border-stone-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs rounded-full bg-stone-100 text-stone-600 px-2 py-0.5">{SOURCE_LABEL[a.source]}</span>
                {a.source !== 'own_swatch' && (
                  <span className="text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">Krever prøvelapp</span>
                )}
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {a.members.map((m, j) => {
                  const owned = ownedByYarn.get(m.yarn.id) ?? 0
                  return (
                    <li key={j} className="flex items-center gap-2">
                      <span className="text-sm text-stone-800 flex-1 min-w-0 truncate">
                        {yarnLabel(m.yarn)}{m.strands > 1 ? ` (${m.strands} tråder)` : ''}
                        {owned > 0 && <span className="text-emerald-700"> · du har {owned} nøste{owned === 1 ? '' : 'r'}</span>}
                      </span>
                      <YarnFavoriteStar yarnId={m.yarn.id} favorite={m.yarn.favorite} pricePerSkein={m.yarn.price_per_skein}
                        onChange={patch => onYarnUpdated(m.yarn.id, patch)} />
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-stone-500 mt-1.5">
                {[
                  a.gauge_stitches_10cm !== null && `${formatRange(a.gauge_stitches_10cm, a.gauge_stitches_10cm)} m/10 cm`,
                  a.needle_mm !== null && `pinne ${a.needle_mm} mm`,
                  formatFibers(a.members[0]?.yarn.fibers ?? []),
                ].filter(Boolean).join(' · ')}
                {a.note && ` — ${a.note}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
