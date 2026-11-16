'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { COMBO_SELECT, SWATCH_SELECT, comboFromRow, swatchFromRow, type ComboRow, type SwatchRow } from '../_lib/combos'
import { rankAlternatives, strandText, type Alternative, type RawCombo, type RawSwatch } from '../_lib/yarn-alternatives'
import { formatRange, mainFibre, spellingKey, type YarnRow } from '../_lib/yarns'
import { RECIPE_FILTER_SELECT, type FilterRecipe } from '../_lib/recipe-filter'
import {
  FACT_FIELDS, FACT_LABEL, HIT_GROUP, HIT_GROUP_LABEL, HIT_SOURCE_LABEL, factDiffs, formatPair, pairAlternatives, pairGauge,
  parsePair, recipesForYarn, yarnFacts, type HitGroup, type PairMember, type RecipeForYarn,
} from '../_lib/yarn-recipes'
import type { StashRow } from '../_lib/stash'
import YarnFavoriteStar from './YarnFavoriteStar'
import { MAX_STRANDS, MAX_YARNS, RULE_TEXT, estimateGauge, matchingSwatches, parseNeedle } from '../_lib/gauge-calc'

const SOURCE_LABEL: Record<Alternative['source'], string> = {
  own_swatch: 'Egen strikkeprøve', skaberglaede: 'Skaberglæde', pattern: 'Oppskriftens alternativ',
  drops: 'DROPS', yarn_info: 'Garnets opplysninger', same_gauge: 'Samme strikkefasthet', same_thickness: 'Samme tykkelse',
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

const toNumber = (s: string) => { const n = Number(s.replace(',', '.')); return s.trim() && Number.isFinite(n) && n > 0 ? n : null }

// Type-ahead over the catalogue: every word somewhere in brand + name, in any order.
function YarnSearch({ yarns, picked, onPick, placeholder, onAddMissing }: {
  yarns: YarnRow[]
  picked: YarnRow | null
  onPick: (y: YarnRow | null) => void
  placeholder: string
  onAddMissing?: (query: string) => void
}) {
  const [query, setQuery] = useState('')
  const words = useMemo(() => spellingKey(query).split(' ').filter(Boolean), [query])
  const matches = useMemo(() => {
    if (picked || !words.length) return []
    return yarns.filter(y => { const hay = spellingKey(`${y.brand} ${y.name}`); return words.every(w => hay.includes(w)) }).slice(0, 8)
  }, [yarns, words, picked])
  return (
    <div className="relative">
      <input className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" placeholder={placeholder}
        value={picked ? yarnLabel(picked) : query} onChange={e => { onPick(null); setQuery(e.target.value) }} />
      {matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-stone-200 bg-white shadow-md max-h-64 overflow-y-auto">
          {matches.map(y => (
            <button key={y.id} onClick={() => { onPick(y); setQuery(yarnLabel(y)) }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-stone-50">{yarnLabel(y)}</button>
          ))}
        </div>
      )}
      {onAddMissing && query.trim() && !picked && matches.length === 0 && (
        <div className="mt-2 rounded-lg border border-dashed border-stone-300 px-3 py-2.5 flex items-center gap-2">
          <p className="text-sm text-stone-500 flex-1">Finnes ikke «{query.trim()}» i katalogen.</p>
          <button onClick={() => { onAddMissing(query.trim()); setQuery('') }} className="text-sm px-3 py-1.5 rounded-lg bg-stone-800 text-white">Legg til</button>
        </div>
      )}
    </div>
  )
}

// One yarn's fibre, meterage, skein weight, gauge and needle, with the fields that differ
// from the yarn being replaced marked.
function Facts({ yarn, target }: { yarn: YarnRow; target?: YarnRow | null }) {
  const facts = yarnFacts(yarn)
  const diff = target && target.id !== yarn.id ? factDiffs(target, yarn) : new Set()
  return (
    <dl data-facts className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      {FACT_FIELDS.map(f => (
        <div key={f} className="contents">
          <dt className="text-stone-500">{FACT_LABEL[f]}</dt>
          <dd data-diff={diff.has(f) ? 'true' : undefined}
            className={diff.has(f) ? 'text-amber-900 bg-amber-100 rounded px-1 -mx-1 font-medium' : 'text-stone-800'}>
            {facts[f]}{diff.has(f) && <span className="sr-only"> (avviker)</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function AlternativeCard({ a, target, ownedByYarn, onYarnUpdated }: {
  a: Alternative
  target: YarnRow | null
  ownedByYarn: Map<string, number>
  onYarnUpdated: (yarnId: string, patch: { favorite?: boolean | null; price_per_skein?: number | null }) => void
}) {
  return (
    <li className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs rounded-full bg-stone-100 text-stone-600 px-2 py-0.5">{SOURCE_LABEL[a.source]}</span>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {a.members.map((m, j) => {
          const owned = ownedByYarn.get(m.yarn.id) ?? 0
          return (
            <li key={j}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-stone-800 flex-1 min-w-0 truncate">
                  {yarnLabel(m.yarn)}{strandText(m)}
                  {owned > 0 && <span className="text-emerald-700"> · du har {owned} nøste{owned === 1 ? '' : 'r'}</span>}
                </span>
                <YarnFavoriteStar yarnId={m.yarn.id} favorite={m.yarn.favorite} pricePerSkein={m.yarn.price_per_skein}
                  onChange={patch => onYarnUpdated(m.yarn.id, patch)} />
              </div>
              {/* A combination's members are not compared one by one with a single yarn. */}
              <Facts yarn={m.yarn} target={a.members.length === 1 && m.strands === 1 ? target : null} />
            </li>
          )
        })}
      </ul>
      {(a.members.length > 1 || a.members.some(m => m.strands > 1)) && (
        <p className="text-xs text-stone-600 mt-1.5">
          Sammen: {[a.gauge_stitches_10cm !== null && `${formatRange(a.gauge_stitches_10cm, a.gauge_stitches_10cm)} m/10 cm`, a.needle_mm !== null && `pinne ${fmt(a.needle_mm)} mm`].filter(Boolean).join(' · ') || 'strikkefasthet ikke oppgitt'}
        </p>
      )}
      {a.note && <p className="text-xs text-stone-500 mt-1">{a.note}</p>}
    </li>
  )
}

const fmt = (n: number) => n.toLocaleString('nb-NO', { maximumFractionDigits: 1 })

// Kalkulator: one to three catalogue yarns with strands and a needle → an estimated gauge
// (gauge-calc.ts), with Maria's own swatch of the same yarns and needle shown first.
function GaugeCalculator({ yarns, swatches, onSwatchSaved }: {
  yarns: YarnRow[]
  swatches: RawSwatch[]
  onSwatchSaved: (row: SwatchRow) => void
}) {
  const [rows, setRows] = useState<{ key: number; yarn: YarnRow | null; strands: number }[]>([{ key: 0, yarn: null, strands: 1 }])
  const [needleInput, setNeedleInput] = useState('')
  const [saving, setSaving] = useState<null | 'form' | 'busy'>(null)
  const [measured, setMeasured] = useState({ stitches: '', rows: '', notes: '' })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const chosen = rows.filter((r): r is { key: number; yarn: YarnRow; strands: number } => r.yarn !== null)
  const needle = parseNeedle(needleInput)
  const estimate = chosen.length ? estimateGauge(chosen.map(r => ({ yarn: r.yarn, strands: r.strands })), needle) : null
  const own = matchingSwatches(swatches, chosen.map(r => ({ yarnId: r.yarn.id, strands: r.strands })), needle)
  const ready = chosen.length > 0 && needle !== null && estimate !== null && (estimate.ok || !estimate.error.startsWith('Pinnen'))
  const update = (key: number, patch: Partial<{ yarn: YarnRow | null; strands: number }>) => {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))
    setSavedNote(null)
  }

  async function save() {
    setSaveError(null)
    setSaving('busy')
    try {
      const res = await fetch('/api/strikk/swatches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          members: chosen.map(r => ({ yarn_id: r.yarn.id, strands: r.strands })), needle_mm: needle,
          gauge_stitches_10cm: measured.stitches, gauge_rows_10cm: measured.rows, notes: measured.notes,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Lagring feilet (${res.status})`)
      onSwatchSaved(j as SwatchRow)
      setSaving(null)
      setMeasured({ stitches: '', rows: '', notes: '' })
      setSavedNote('Strikkeprøven er lagret og brukes neste gang du velger samme garn og pinne.')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Noe gikk galt')
      setSaving('form')
    }
  }

  return (
    <section data-calculator className="flex flex-col gap-3">
      <p className="text-sm text-stone-600">Velg garnene som strikkes sammen, antall tråder av hvert og pinnen du vil bruke.</p>
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <YarnSearch yarns={yarns} picked={r.yarn} onPick={y => update(r.key, { yarn: y })} placeholder={i === 0 ? 'Garn' : 'Garn nr. ' + (i + 1)} />
          </div>
          <select aria-label="Antall tråder" value={r.strands} onChange={e => update(r.key, { strands: Number(e.target.value) })}
            className="shrink-0 px-2 py-2 rounded-lg border border-stone-200 bg-white text-sm">
            {Array.from({ length: MAX_STRANDS }, (_, k) => k + 1).map(n => <option key={n} value={n}>{n} {n === 1 ? 'tråd' : 'tråder'}</option>)}
          </select>
          {rows.length > 1 && (
            <button aria-label="Fjern garnet" onClick={() => { setRows(rs => rs.filter(x => x.key !== r.key)); setSavedNote(null) }}
              className="shrink-0 px-2 py-2 text-stone-400 hover:text-red-500">✕</button>
          )}
        </div>
      ))}
      {rows.length < MAX_YARNS && (
        <button onClick={() => setRows(rs => [...rs, { key: Math.max(...rs.map(x => x.key)) + 1, yarn: null, strands: 1 }])}
          className="self-start text-sm text-[#8B6340] underline">+ Legg til garn</button>
      )}
      <label className="text-sm text-stone-700 flex items-center gap-2">
        Pinne
        <input className="w-24 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" inputMode="decimal" placeholder="mm"
          value={needleInput} onChange={e => { setNeedleInput(e.target.value); setSavedNote(null) }} />
        mm
      </label>

      {own.length > 0 && needle !== null && (
        <div data-own-swatch className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3">
          <p className="text-xs uppercase tracking-wide text-emerald-800">Din strikkeprøve</p>
          {own.map((s, i) => (
            <p key={i} className="text-sm text-stone-800 mt-0.5">
              {s.gauge_stitches_10cm !== null ? fmt(s.gauge_stitches_10cm) : '?'} masker{s.gauge_rows_10cm !== null ? ` × ${fmt(s.gauge_rows_10cm)} pinner/omganger` : ''} per 10 cm på pinne {fmt(needle)} mm
              {s.created_at && <span className="text-stone-500"> · målt {new Date(s.created_at).toLocaleDateString('nb-NO')}</span>}
              {s.notes && <span className="text-stone-500"> · {s.notes}</span>}
            </p>
          ))}
        </div>
      )}

      {estimate && ready && (estimate.ok ? (
        <div data-estimate className="rounded-xl border border-stone-200 bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Anslag</p>
          <p className="text-lg text-stone-800">ca. {estimate.gauge} masker per 10 cm <span className="text-sm text-stone-500">({estimate.low}–{estimate.high})</span></p>
          <p className="text-sm text-stone-700">Naturlig pinne for kombinasjonen: ca. {fmt(estimate.naturalNeedle)} mm</p>
          {estimate.neutral.length > 0 && (
            <p className="text-xs text-stone-600 mt-1">{estimate.neutral.join(' og ')} er tatt med uten å endre utregningen: påvirker ikke strikkefastheten etter katalogen.</p>
          )}
          <p className="text-xs text-stone-500 mt-2">{RULE_TEXT}</p>
          <p className="text-xs text-stone-500 mt-1">Dette er et anslag, ikke en målt strikkeprøve.</p>
        </div>
      ) : (
        <p data-estimate-error className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">{estimate.error}</p>
      ))}
      {chosen.length > 0 && needleInput.trim() && needle === null && <p className="text-sm text-amber-800">Pinnen må være et tall i mm.</p>}

      {chosen.length > 0 && needle !== null && estimate !== null && (estimate.ok || !estimate.error.startsWith('Pinnen')) && (saving === null ? (
        <button onClick={() => { setSaving('form'); setSavedNote(null) }} className="self-start text-sm px-3 py-2 rounded-lg border border-stone-300 bg-white text-stone-800">
          Lagre som strikkeprøve
        </button>
      ) : (
        <div data-save-swatch className="rounded-xl border border-stone-200 bg-stone-50 p-3 flex flex-col gap-2">
          <p className="text-sm text-stone-700">Det du faktisk målte, på pinne {fmt(needle)} mm:</p>
          <div className="flex flex-wrap gap-2">
            <input className="w-32 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" inputMode="decimal" placeholder="Masker/10 cm"
              value={measured.stitches} onChange={e => setMeasured(m => ({ ...m, stitches: e.target.value }))} />
            <input className="w-40 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" inputMode="decimal" placeholder="Pinner/omg. (valgfritt)"
              value={measured.rows} onChange={e => setMeasured(m => ({ ...m, rows: e.target.value }))} />
          </div>
          <input className="px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" placeholder="Notat (valgfritt)"
            value={measured.notes} onChange={e => setMeasured(m => ({ ...m, notes: e.target.value }))} />
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          <div className="flex gap-2">
            <button disabled={saving === 'busy'} onClick={() => void save()} className="text-sm px-3 py-2 rounded-lg bg-stone-800 text-white disabled:opacity-50">
              {saving === 'busy' ? 'Lagrer …' : 'Lagre'}
            </button>
            <button onClick={() => { setSaving(null); setSaveError(null) }} className="text-sm px-3 py-2 rounded-lg text-stone-600">Avbryt</button>
          </div>
        </div>
      ))}
      {savedNote && <p className="text-sm text-emerald-700">{savedNote}</p>}
    </section>
  )
}

// «Finn alternativt garn»: et garn, et par (hovedgarn og følgetråd), en strikkefasthet eller
// kalkulatoren (anslått strikkefasthet for garn strikket sammen).
// For et garn vises garnet som byttes ut, alternativene med forskjellene markert, og alle
// oppskriftene garnet kan brukes til (yarn-recipes.ts, samme regel som garnfilteret).
export default function YarnAlternatives({ yarns, stash, onYarnUpdated, onYarnAdded, initialPair, pairRecipeId, pairGroup }: {
  yarns: YarnRow[]
  stash: StashRow[] | null
  onYarnUpdated: (yarnId: string, patch: { favorite?: boolean | null; price_per_skein?: number | null }) => void
  onYarnAdded: (yarn: YarnRow) => void
  // From a recipe: the pair as «id,idx2», the recipe whose gauge to use, and its colour.
  initialPair?: string | null
  pairRecipeId?: string | null
  pairGroup?: string | null
}) {
  const [mode, setMode] = useState<'yarn' | 'pair' | 'gauge' | 'calc'>('yarn')
  const [picked, setPicked] = useState<YarnRow | null>(null)
  const [pairMain, setPairMain] = useState<YarnRow | null>(null)
  const [pairCarry, setPairCarry] = useState<YarnRow | null>(null)
  // A pair opened from a recipe: its yarns, and the recipe and colour whose gauge it uses.
  const [linked, setLinked] = useState<{ members: PairMember[]; recipeId: string | null; group: string | null } | null>(null)
  const [pairGaugeInput, setPairGaugeInput] = useState('')
  const [gauge, setGauge] = useState('')
  const [combos, setCombos] = useState<RawCombo[]>([])
  const [swatches, setSwatches] = useState<RawSwatch[]>([])
  const [recipes, setRecipes] = useState<FilterRecipe[]>([])
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('strikk_yarn_combo').select(COMBO_SELECT),
      supabase.from('strikk_swatch').select(SWATCH_SELECT),
      supabase.from('strikk_oppskrift').select(RECIPE_FILTER_SELECT),
    ]).then(([c, s, r]) => {
      if (cancelled) return
      if (!c.error) setCombos((c.data as unknown as ComboRow[] ?? []).map(comboFromRow))
      if (!s.error) setSwatches((s.data as unknown as SwatchRow[] ?? []).map(swatchFromRow))
      if (!r.error) setRecipes((r.data ?? []) as unknown as FilterRecipe[])
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const members = parsePair(initialPair ?? null)
    if (members.length < 2) return
    // The link arrives with the page; the pair is shown from it once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode('pair')
    setLinked({ members, recipeId: pairRecipeId ?? null, group: pairGroup ?? null })
  }, [initialPair, pairRecipeId, pairGroup])

  function openPair(members: PairMember[], recipeId: string, group: number) {
    setLinked({ members, recipeId, group: String(group) })
    setMode('pair')
    // Kept in the address, so a reload or the back button shows the same pair.
    window.history.pushState(null, '', `/strikk/garnlager?tab=alternativ&pair=${formatPair(members)}&recipe=${recipeId}&group=${group}`)
  }

  const byId = useMemo(() => new Map(yarns.map(y => [y.id, y])), [yarns])

  const ownedByYarn = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of stash ?? []) {
      if (r.status !== 'godkjent' || !r.yarn_id) continue
      m.set(r.yarn_id, (m.get(r.yarn_id) ?? 0) + r.skein_count)
    }
    return m
  }, [stash])
  const ownedFirst = (list: Alternative[]) => {
    const owned = (a: Alternative) => a.members.some(m => (ownedByYarn.get(m.yarn.id) ?? 0) > 0)
    return [...list].sort((a, b) => Number(owned(b)) - Number(owned(a)))
  }

  // ── Yarn ──
  const yarnAlternatives = useMemo<Alternative[] | null>(() => {
    if (mode !== 'yarn' || !picked) return null
    const target = picked.gauge_stitches_min !== null
      ? (picked.gauge_stitches_min + (picked.gauge_stitches_max ?? picked.gauge_stitches_min)) / 2
      : null
    return rankAlternatives({
      targetGauge: target, targetFibre: mainFibre(picked.fibers), targetYarn: picked, excludeYarnId: picked.id,
      catalogue: yarns, combos, swatches, patternAlternativeYarnIds: [],
    })
  }, [mode, picked, yarns, combos, swatches])

  const recipeHits = useMemo<RecipeForYarn<FilterRecipe>[] | null>(() => {
    if (mode !== 'yarn' || !picked) return null
    return recipesForYarn(recipes, picked.id, { catalogue: byId, combos, swatches })
  }, [mode, picked, recipes, byId, combos, swatches])

  // ── Pair ──
  const linkedPair = linked?.members ?? null
  const pair: PairMember[] | null = linkedPair ?? (pairMain && pairCarry ? [{ yarnId: pairMain.id, strands: 1 }, { yarnId: pairCarry.id, strands: 1 }] : null)
  const pairRecipe = linked?.recipeId ? recipes.find(r => r.id === linked.recipeId) ?? null : null
  const recipeGauge = pairRecipe?.gauge_stitches_10cm !== undefined && pairRecipe?.gauge_stitches_10cm !== null ? Number(pairRecipe.gauge_stitches_10cm) : null
  const tableGauge = pair ? pairGauge(pair, combos, swatches) : null
  const resolvedPairGauge = linkedPair && recipeGauge !== null ? { value: recipeGauge, from: 'oppskriften' }
    : tableGauge !== null ? { value: tableGauge, from: 'kombinasjonstabellene' }
    : toNumber(pairGaugeInput) !== null ? { value: toNumber(pairGaugeInput)!, from: 'det du skrev inn' } : null
  const pairPatternAlts = useMemo(() => {
    if (!pairRecipe || linked?.group === null || linked?.group === undefined) return []
    const g = Number(linked.group)
    const lineIds = new Set(pairRecipe.strikk_yarn_line.filter(l => l.color_group === g).map(l => l.id))
    return pairRecipe.strikk_yarn_alternative
      .filter(a => a.source === 'pattern' && a.yarn_id && (a.yarn_line_id ? lineIds.has(a.yarn_line_id) : a.color_group === g))
      .map(a => a.yarn_id!)
  }, [pairRecipe, linked])
  const pairResult = useMemo(() => {
    if (mode !== 'pair' || !pair || !resolvedPairGauge) return null
    return pairAlternatives({ members: pair, gauge: resolvedPairGauge.value, catalogue: yarns, combos, swatches, patternAlternativeYarnIds: pairPatternAlts })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pair && formatPair(pair), resolvedPairGauge?.value, yarns, combos, swatches, pairPatternAlts])

  // ── Gauge ──
  const gaugeAlternatives = useMemo<Alternative[] | null>(() => {
    if (mode !== 'gauge') return null
    const g = toNumber(gauge)
    if (g === null) return null
    return rankAlternatives({ targetGauge: g, targetFibre: null, excludeYarnId: null, catalogue: yarns, combos, swatches, patternAlternativeYarnIds: [] })
  }, [mode, gauge, yarns, combos, swatches])

  async function handleAdd(query: string) {
    const [brand, ...rest] = query.split(' ')
    setAddError(null)
    try {
      const yarn = await addYarn(rest.length ? brand : '', rest.join(' ') || brand)
      onYarnAdded(yarn)
      setPicked(yarn)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Noe gikk galt')
    }
  }

  const tabButton = (m: typeof mode, label: string) => (
    <button onClick={() => { setMode(m); if (m !== 'pair') setLinked(null) }}
      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${mode === m ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>
      {label}
    </button>
  )

  const grouped = useMemo(() => {
    const out = new Map<HitGroup, RecipeForYarn<FilterRecipe>[]>()
    for (const r of recipeHits ?? []) {
      const g = HIT_GROUP[r.best.source]
      out.set(g, [...(out.get(g) ?? []), r])
    }
    return out
  }, [recipeHits])

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex gap-1 p-1 bg-stone-100 rounded-xl w-fit">
        {tabButton('yarn', 'Garn')}
        {tabButton('pair', 'Par')}
        {tabButton('gauge', 'Strikkefasthet')}
        {tabButton('calc', 'Kalkulator')}
      </div>

      {mode === 'yarn' && (
        <YarnSearch yarns={yarns} picked={picked} onPick={setPicked} placeholder="Skriv inn et garn, f.eks. Sandnes Garn Sunday"
          onAddMissing={q => void handleAdd(q)} />
      )}
      {mode === 'pair' && !linkedPair && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <YarnSearch yarns={yarns} picked={pairMain} onPick={setPairMain} placeholder="Hovedgarn" />
          <YarnSearch yarns={yarns} picked={pairCarry} onPick={setPairCarry} placeholder="Følgetråd" />
        </div>
      )}
      {mode === 'gauge' && (
        <input className="w-full sm:w-64 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" inputMode="decimal"
          placeholder="Masker per 10 cm" value={gauge} onChange={e => setGauge(e.target.value)} />
      )}
      {addError && <p className="text-sm text-red-600">{addError}</p>}

      {/* ── Yarn result ── */}
      {mode === 'yarn' && picked && (
        <>
          <section data-target className="rounded-xl border-2 border-stone-300 bg-stone-50 p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">Garnet som skal byttes ut</p>
            <p className="text-sm font-medium text-stone-800 mt-0.5">{yarnLabel(picked)}</p>
            {picked.status === 'draft' && <p className="text-xs text-stone-500">Ikke slått opp ennå, så det gir ingen alternativer fra katalogen.</p>}
            <Facts yarn={picked} />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-serif text-lg text-stone-700">Alternativer</h3>
            {yarnAlternatives && yarnAlternatives.length === 0 && <p className="text-sm text-stone-500">Ingen alternativer funnet.</p>}
            <ul className="flex flex-col gap-2">
              {ownedFirst(yarnAlternatives ?? []).map((a, i) => (
                <AlternativeCard key={i} a={a} target={picked} ownedByYarn={ownedByYarn} onYarnUpdated={onYarnUpdated} />
              ))}
            </ul>
          </section>

          <section data-recipe-hits className="flex flex-col gap-3">
            <h3 className="font-serif text-lg text-stone-700">Oppskrifter garnet kan brukes til ({recipeHits?.length ?? 0})</h3>
            {recipeHits && recipeHits.length === 0 && <p className="text-sm text-stone-500">Ingen oppskrifter funnet.</p>}
            {(['recommended', 'pattern', 'alternatives'] as const).map(g => grouped.get(g) && (
              <div key={g} className="flex flex-col gap-1.5">
                <h4 className="text-sm font-semibold text-stone-600">{HIT_GROUP_LABEL[g]} ({grouped.get(g)!.length})</h4>
                <ul className="flex flex-col gap-1.5">
                  {grouped.get(g)!.map(({ recipe, best }) => {
                    const pairLines = recipe.strikk_yarn_line.filter(l => l.color_group === best.colorGroup)
                    const canOpenPair = best.heldTogether && pairLines.length > 1 && pairLines.every(l => l.yarn_id)
                    return (
                      <li key={recipe.id} className="rounded-lg border border-stone-200 bg-white px-3 py-2 flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <Link href={`/strikk/oppskrifter/${recipe.id}`} className="text-sm text-stone-800 flex-1 min-w-0 truncate hover:underline">{recipe.title}</Link>
                        </div>
                        <p className="text-xs text-stone-500">
                          {best.source === 'recommended' ? 'Oppskriften bruker dette garnet' : `I stedet for ${best.instead.join(' + ')}`}
                          {best.source !== 'recommended' && best.source !== 'pattern' && ` · ${HIT_SOURCE_LABEL[best.source].toLowerCase()}`}
                          {best.with.length > 0 && ` · sammen med ${best.with.join(' + ')}`}
                          {best.heldTogether && best.source === 'recommended' && ' · med følgetråd'}
                        </p>
                        {canOpenPair && (
                          <button onClick={() => openPair(pairLines.map(l => ({ yarnId: l.yarn_id!, strands: l.strands ?? 1 })), recipe.id, best.colorGroup)}
                            className="text-xs text-[#8B6340] underline self-start">Finn alternativer til paret</button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </section>
        </>
      )}

      {/* ── Pair result ── */}
      {mode === 'pair' && pair && (
        <>
          <section data-target className="rounded-xl border-2 border-stone-300 bg-stone-50 p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">Paret som skal byttes ut{pairRecipe ? ` (${pairRecipe.title})` : ''}</p>
            {pair.map((m, i) => {
              const y = byId.get(m.yarnId)
              return (
                <div key={i} className="mt-1.5">
                  <p className="text-sm font-medium text-stone-800">{i === 0 ? 'Hovedgarn' : 'Følgetråd'}: {y ? yarnLabel(y) : 'ukjent garn'}{m.strands > 1 ? ` (${m.strands} tråder)` : ''}</p>
                  {y && <Facts yarn={y} />}
                </div>
              )
            })}
            {resolvedPairGauge ? (
              <p className="text-xs text-stone-700 mt-2">Sammen: {formatRange(resolvedPairGauge.value, resolvedPairGauge.value)} m/10 cm (fra {resolvedPairGauge.from})</p>
            ) : (
              <label className="block text-xs text-stone-700 mt-2">
                Strikkefastheten for paret finnes verken i oppskriften eller i kombinasjonstabellene. Skriv den inn:
                <input className="mt-1 w-40 px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm" inputMode="decimal"
                  placeholder="Masker per 10 cm" value={pairGaugeInput} onChange={e => setPairGaugeInput(e.target.value)} />
              </label>
            )}
            {linkedPair && <button onClick={() => setLinked(null)} className="mt-2 text-xs text-stone-500 underline">Velg et annet par</button>}
          </section>
          {pairResult && (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="font-serif text-lg text-stone-700">Andre trådkombinasjoner ({pairResult.combinations.length})</h3>
                {pairResult.combinations.length === 0 && <p className="text-sm text-stone-500">Ingen funnet.</p>}
                <ul className="flex flex-col gap-2">
                  {ownedFirst(pairResult.combinations).map((a, i) => <AlternativeCard key={i} a={a} target={null} ownedByYarn={ownedByYarn} onYarnUpdated={onYarnUpdated} />)}
                </ul>
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="font-serif text-lg text-stone-700">Enkeltgarn med samme strikkefasthet ({pairResult.singles.length})</h3>
                {pairResult.singles.length === 0 && <p className="text-sm text-stone-500">Ingen funnet.</p>}
                <ul className="flex flex-col gap-2">
                  {ownedFirst(pairResult.singles).map((a, i) => <AlternativeCard key={i} a={a} target={byId.get(pair[0].yarnId) ?? null} ownedByYarn={ownedByYarn} onYarnUpdated={onYarnUpdated} />)}
                </ul>
              </section>
            </>
          )}
        </>
      )}

      {mode === 'calc' && (
        <GaugeCalculator yarns={yarns} swatches={swatches}
          onSwatchSaved={row => setSwatches(s => [...s, swatchFromRow(row)])} />
      )}

      {/* ── Gauge result ── */}
      {mode === 'gauge' && gaugeAlternatives && (
        <section className="flex flex-col gap-2">
          {gaugeAlternatives.length === 0 && <p className="text-sm text-stone-500">Ingen alternativer funnet.</p>}
          <ul className="flex flex-col gap-2">
            {ownedFirst(gaugeAlternatives).map((a, i) => <AlternativeCard key={i} a={a} target={null} ownedByYarn={ownedByYarn} onYarnUpdated={onYarnUpdated} />)}
          </ul>
        </section>
      )}
    </div>
  )
}
