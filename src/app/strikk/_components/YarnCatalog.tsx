'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  DROPS_GROUPS,
  SOURCE_KINDS,
  formatFibers,
  formatRange,
  hasPlastic,
  missingFields,
  parseFibers,
  parseRange,
  spellingKey,
  type SourceKind,
  type YarnData,
  type YarnRow,
  type YarnStatus,
} from '../_lib/yarns'

const STATUS_LABEL: Record<YarnStatus, string> = { draft: 'Ikke slått opp', looked_up: 'Til godkjenning', approved: 'Godkjent' }
const FILTERS = ['all', 'draft', 'looked_up', 'approved', 'plastic'] as const
type Filter = typeof FILTERS[number]
const FILTER_LABEL: Record<Filter, string> = { all: 'Alle', ...STATUS_LABEL, plastic: 'Plast' }
const KIND_LABEL: Record<SourceKind, string> = { manufacturer: 'Produsent', pattern: 'Oppskrift', retailer: 'Butikk', other: 'Annet' }

// The stored field names, as shown. Min and max share one field in the form.
const FIELD_LABEL: Record<string, string> = {
  brand: 'Produsent', name: 'Navn', fibers: 'Fiber', skein_weight_g: 'Vekt per nøste', meterage_m: 'Løpelengde',
  gauge_stitches_min: 'Strikkefasthet', gauge_stitches_max: 'Strikkefasthet', needle_mm_min: 'Pinne', needle_mm_max: 'Pinne',
  drops_group: 'DROPS-gruppe', discontinued: 'Utgått', source_url: 'Kilde', source_kind: 'Kildetype', source_note: 'Merknad om kilden',
  favorite: 'Favoritt', price_per_skein: 'Pris per nøste',
}
const label = (f: string) => FIELD_LABEL[f] ?? f

interface Use { yarn_id: string | null; yarn_link_uncertain: boolean; yarn_link_reason: string | null; yarn_name: string; brand: string | null; oppskrift_id: string }

async function allRows<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data as T[]))
    if (data.length < 1000) return out
  }
}

async function loadCatalogue() {
  const cols = 'yarn_id, yarn_link_uncertain, yarn_link_reason, yarn_name, brand, oppskrift_id'
  const [yarns, lines, alts, recipes] = await Promise.all([
    allRows<YarnRow>('strikk_yarn', '*'),
    allRows<Use>('strikk_yarn_line', cols),
    allRows<Use & { source: string }>('strikk_yarn_alternative', cols + ', source'),
    allRows<{ id: string; title: string }>('strikk_oppskrift', 'id, title'),
  ])
  yarns.sort((a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`, 'nb'))
  return { yarns, uses: [...lines, ...alts.filter(a => a.source === 'pattern')], titles: new Map(recipes.map(r => [r.id, r.title])) }
}

export default function YarnCatalog() {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadCatalogue>> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try { setData(await loadCatalogue()) } catch (e) { setLoadError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => {
    let cancelled = false
    loadCatalogue().then(d => { if (!cancelled) setData(d) }, e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])

  const usesBy = useMemo(() => {
    const m = new Map<string, Use[]>()
    for (const u of data?.uses ?? []) if (u.yarn_id) m.set(u.yarn_id, [...(m.get(u.yarn_id) ?? []), u])
    return m
  }, [data])

  if (loadError) return <p className="max-w-3xl mx-auto px-4 sm:px-8 py-6 text-sm text-red-700">Klarte ikke hente garnkatalogen: {loadError}</p>
  if (!data) return <p className="max-w-3xl mx-auto px-4 sm:px-8 py-6 text-sm text-stone-500">Henter garnkatalogen …</p>

  const { yarns, uses, titles } = data
  const q = spellingKey(query)
  const matches = (y: YarnRow) => !q || [y.brand, y.name, `${y.brand} ${y.name}`, ...y.aliases.flatMap(a => [a.name, `${a.brand} ${a.name}`]), formatFibers(y.fibers)]
    .some(s => spellingKey(s).includes(q))
  const inFilter = (y: YarnRow, f: Filter) => f === 'all' || (f === 'plastic' ? y.has_plastic === true : y.status === f)
  const shown = yarns.filter(y => inFilter(y, filter) && matches(y))
  const unlinked = uses.filter(u => !u.yarn_id)
  const uncertainLinks = uses.filter(u => u.yarn_id && u.yarn_link_uncertain).length

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-8 py-6 flex flex-col gap-4">
      <h1 className="font-serif text-2xl text-stone-800">Garnkatalog</h1>
      <p className="text-sm text-stone-600">
        {yarns.length} garn. {uses.length - unlinked.length} av {uses.length} garnlinjer i oppskriftene er koblet hit
        {uncertainLinks > 0 && `, ${uncertainLinks} av dem usikkert`}.
      </p>

      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Søk på produsent, navn eller fiber"
        className="h-11 px-3 rounded-xl border border-stone-300 bg-white text-base text-stone-900" />
      <div className="flex gap-1 overflow-x-auto">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`h-9 px-3 rounded-full text-sm whitespace-nowrap ${filter === f ? 'bg-[#2E5339] text-white' : 'bg-white border border-stone-200 text-stone-700'}`}>
            {FILTER_LABEL[f]} ({yarns.filter(y => inFilter(y, f)).length})
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="text-sm text-stone-500">Ingen garn her.</p>}
      <ul className="flex flex-col gap-2">
        {shown.map(y => {
          const missing = missingFields(y)
          const used = usesBy.get(y.id) ?? []
          return (
            <li key={y.id} className="rounded-2xl border border-stone-200 bg-white">
              <button onClick={() => setOpenId(openId === y.id ? null : y.id)} className="w-full text-left px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-base text-stone-800">{[y.brand, y.name].filter(Boolean).join(' ')}{y.favorite && ' ★'}</div>
                  <div className="text-sm text-stone-500">
                    {[
                      formatFibers(y.fibers),
                      (y.skein_weight_g || y.meterage_m) && `${y.skein_weight_g ? formatRange(y.skein_weight_g, y.skein_weight_g) + ' g' : '?'} / ${y.meterage_m ? formatRange(y.meterage_m, y.meterage_m) + ' m' : '?'}`,
                      y.gauge_stitches_min && `${formatRange(y.gauge_stitches_min, y.gauge_stitches_max)} m/10 cm`,
                      y.needle_mm_min && `p ${formatRange(y.needle_mm_min, y.needle_mm_max)}`,
                      `${used.length} ${used.length === 1 ? 'linje' : 'linjer'}`,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-1 shrink-0 max-w-[45%]">
                  {y.has_plastic && <Badge cls="bg-sky-100 text-sky-900">Plast</Badge>}
                  {y.drops_group && <Badge cls="bg-stone-100 text-stone-700">DROPS {y.drops_group}</Badge>}
                  {y.discontinued && <Badge cls="bg-stone-200 text-stone-700">Utgått</Badge>}
                  {y.status !== 'approved' && <Badge cls="bg-stone-100 text-stone-600">{STATUS_LABEL[y.status]}</Badge>}
                  {y.uncertain_fields.length > 0 && <Badge cls="bg-amber-100 text-amber-900">{y.uncertain_fields.length} usikre</Badge>}
                  {missing.length > 0 && <Badge cls="bg-red-50 text-red-800">{missing.length} mangler</Badge>}
                </div>
              </button>
              {openId === y.id && (
                <YarnEditor key={`${y.id}-${y.updated_at}`} yarn={y} uses={used} titles={titles} onSaved={reload} />
              )}
            </li>
          )
        })}
      </ul>

      {unlinked.length > 0 && (
        <details className="text-sm text-stone-700">
          <summary className="cursor-pointer">{unlinked.length} garnlinjer er ikke koblet til et garn</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {groupUnlinked(unlinked, titles).map(g => (
              <li key={g.key}>
                {g.name} <span className="text-stone-500">({g.count}) · {g.reason ?? 'Ikke koblet ennå'} · {g.recipes.join(', ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <button onClick={() => void reload()} className="self-start text-sm text-stone-500 underline">Oppdater listen</button>
    </div>
  )
}

function groupUnlinked(list: Use[], titles: Map<string, string>) {
  const groups = new Map<string, { key: string; name: string; count: number; reason: string | null; recipes: string[] }>()
  for (const u of list) {
    const key = `${spellingKey(u.brand)}|${spellingKey(u.yarn_name)}`
    const g = groups.get(key) ?? { key, name: [u.brand, u.yarn_name].filter(Boolean).join(' '), count: 0, reason: u.yarn_link_reason, recipes: [] }
    g.count++
    const t = titles.get(u.oppskrift_id)
    if (t && !g.recipes.includes(t)) g.recipes.push(t)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'))
}

function Badge({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`text-xs rounded-full px-2 py-1 whitespace-nowrap ${cls}`}>{children}</span>
}

// ── One yarn ────────────────────────────────────────────────────────────────────────

const inputCls = 'h-10 px-2 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 min-w-0 w-full'
const markCls = ' ring-2 ring-amber-400 bg-amber-50'
const badCls = ' ring-2 ring-red-500 bg-red-50'

function Source({ text }: { text: string | undefined }) {
  if (!text) return null
  return (
    <span className="block text-[11px] leading-snug text-stone-500 break-words">
      Kilde: {/^https?:\/\//.test(text) ? <a href={text} target="_blank" rel="noreferrer" className="underline">{text}</a> : text}
    </span>
  )
}

function YField({ label: l, uncertain, reason, missing, source, wide, children }: {
  label: string; uncertain: boolean; reason?: string; missing: boolean; source?: string; wide?: boolean; children: React.ReactNode
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-stone-600 min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <span>
        {l}
        {uncertain && <span className="ml-1 text-amber-800 font-medium">usikker</span>}
        {missing && <span className="ml-1 text-red-700 font-medium">mangler</span>}
      </span>
      {children}
      {uncertain && reason && <span className="block text-[11px] leading-snug text-amber-900">{reason}</span>}
      <Source text={source} />
    </label>
  )
}

function YarnEditor({ yarn, uses, titles, onSaved }: { yarn: YarnRow; uses: Use[]; titles: Map<string, string>; onSaved: () => Promise<void> }) {
  const [d, setD] = useState<YarnData>(yarn)
  const [text, setText] = useState({
    fibers: formatFibers(yarn.fibers),
    skein_weight_g: formatRange(yarn.skein_weight_g, yarn.skein_weight_g),
    meterage_m: formatRange(yarn.meterage_m, yarn.meterage_m),
    gauge: formatRange(yarn.gauge_stitches_min, yarn.gauge_stitches_max),
    needle: formatRange(yarn.needle_mm_min, yarn.needle_mm_max),
    price_per_skein: formatRange(yarn.price_per_skein, yarn.price_per_skein),
  })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const set = <K extends keyof YarnData>(k: K, v: YarnData[K]) => setD(x => ({ ...x, [k]: v }))
  const single = (s: string) => { const r = parseRange(s); return r && r.min === r.max ? r : null }
  const bad = {
    skein_weight_g: !single(text.skein_weight_g),
    meterage_m: !single(text.meterage_m),
    gauge: !parseRange(text.gauge),
    needle: !parseRange(text.needle),
    price_per_skein: !single(text.price_per_skein),
  }
  const anyBad = Object.values(bad).some(Boolean)
  const fibers = parseFibers(text.fibers)
  const plastic = hasPlastic(fibers)

  const current = (): YarnData => {
    const g = parseRange(text.gauge)!, n = parseRange(text.needle)!
    return {
      ...d, fibers,
      skein_weight_g: single(text.skein_weight_g)!.min, meterage_m: single(text.meterage_m)!.min,
      gauge_stitches_min: g.min, gauge_stitches_max: g.max, needle_mm_min: n.min, needle_mm_max: n.max,
      price_per_skein: single(text.price_per_skein)!.min,
    }
  }
  const missing = anyBad ? [] : missingFields(current())
  const unc = (...fields: string[]) => fields.find(f => d.uncertain_fields.includes(f))
  const known = new Set(Object.keys(FIELD_LABEL))
  const otherUncertain = d.uncertain_fields.filter(f => !known.has(f))

  async function save(approve: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/strikk/yarns/${yarn.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: current(), approve }),
      })
      const body = await res.json() as { error?: string }
      if (!res.ok) { setMessage({ ok: false, text: body.error ?? `Feil ${res.status}` }); return }
      setMessage({ ok: true, text: approve ? 'Godkjent' : 'Lagret' })
      await onSaved()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  // Field props for one form field: uncertainty, missing and source of the stored fields.
  const fp = (fields: string[]) => {
    const u = unc(...fields)
    return {
      uncertain: !!u,
      reason: u ? d.uncertain_reasons[u] : undefined,
      missing: fields.some(f => missing.includes(f)),
      source: fields.map(f => d.field_sources[f]).find(Boolean),
    }
  }
  const cls = (fields: string[], isBad = false) => inputCls + (isBad ? badCls : unc(...fields) ? markCls : '')

  return (
    <div className="border-t border-stone-200 px-4 py-4 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <YField label="Produsent" {...fp(['brand'])}><input value={d.brand} onChange={e => set('brand', e.target.value)} className={cls(['brand'])} /></YField>
        <YField label="Navn" {...fp(['name'])}><input value={d.name} onChange={e => set('name', e.target.value)} className={cls(['name'])} /></YField>
        <YField label={`Fiber${plastic ? ' (plast)' : plastic === false ? ' (uten plast)' : ''}`} {...fp(['fibers'])} wide>
          <input value={text.fibers} onChange={e => setText(t => ({ ...t, fibers: e.target.value }))} placeholder="80 % merinoull, 20 % polyamid" className={cls(['fibers'])} />
        </YField>
        <YField label="Vekt per nøste (g)" {...fp(['skein_weight_g'])}>
          <input inputMode="decimal" value={text.skein_weight_g} onChange={e => setText(t => ({ ...t, skein_weight_g: e.target.value }))} className={cls(['skein_weight_g'], bad.skein_weight_g)} />
        </YField>
        <YField label="Løpelengde per nøste (m)" {...fp(['meterage_m'])}>
          <input inputMode="decimal" value={text.meterage_m} onChange={e => setText(t => ({ ...t, meterage_m: e.target.value }))} className={cls(['meterage_m'], bad.meterage_m)} />
        </YField>
        <YField label="Strikkefasthet (masker per 10 cm)" {...fp(['gauge_stitches_min', 'gauge_stitches_max'])}>
          <input inputMode="decimal" value={text.gauge} placeholder="22 eller 22–24" onChange={e => setText(t => ({ ...t, gauge: e.target.value }))} className={cls(['gauge_stitches_min', 'gauge_stitches_max'], bad.gauge)} />
        </YField>
        <YField label="Pinne (mm)" {...fp(['needle_mm_min', 'needle_mm_max'])}>
          <input inputMode="decimal" value={text.needle} placeholder="4 eller 3,5–4" onChange={e => setText(t => ({ ...t, needle: e.target.value }))} className={cls(['needle_mm_min', 'needle_mm_max'], bad.needle)} />
        </YField>
        <YField label="DROPS-gruppe" {...fp(['drops_group'])}>
          <select value={d.drops_group ?? ''} onChange={e => set('drops_group', (e.target.value || null) as YarnData['drops_group'])} className={cls(['drops_group'])}>
            <option value="">Ikke DROPS</option>
            {DROPS_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </YField>
        <YField label="Utgått" {...fp(['discontinued'])}>
          <span className="h-10 flex items-center gap-2 text-sm text-stone-800">
            <input type="checkbox" checked={d.discontinued} onChange={e => set('discontinued', e.target.checked)} className="h-5 w-5" />
            Produseres ikke lenger
          </span>
        </YField>
        <YField label="Favoritt" {...fp(['favorite'])}>
          <select value={d.favorite === null ? '' : String(d.favorite)} onChange={e => set('favorite', e.target.value === '' ? null : e.target.value === 'true')} className={inputCls}>
            <option value="">Ikke satt</option>
            <option value="true">Ja</option>
            <option value="false">Nei</option>
          </select>
        </YField>
        <YField label="Pris per nøste (kr)" {...fp(['price_per_skein'])}>
          <input inputMode="decimal" value={text.price_per_skein} onChange={e => setText(t => ({ ...t, price_per_skein: e.target.value }))} className={cls([], bad.price_per_skein)} />
        </YField>
        <YField label="Kilde (lenke)" {...fp(['source_url'])} wide>
          <input value={d.source_url ?? ''} onChange={e => set('source_url', e.target.value || null)} className={cls(['source_url'])} />
          {d.source_url && /^https?:\/\//.test(d.source_url) && <a href={d.source_url} target="_blank" rel="noreferrer" className="text-xs underline text-stone-600 break-all">{d.source_url}</a>}
        </YField>
        <YField label="Kildetype" {...fp(['source_kind'])}>
          <select value={d.source_kind ?? ''} onChange={e => set('source_kind', (e.target.value || null) as SourceKind | null)} className={inputCls}>
            <option value="">Ikke satt</option>
            {SOURCE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </YField>
        <YField label="Merknad om kilden" {...fp(['source_note'])}>
          <input value={d.source_note ?? ''} onChange={e => set('source_note', e.target.value || null)} className={inputCls} />
        </YField>
      </div>

      {otherUncertain.length > 0 && (
        <div className="text-xs text-amber-900">
          {otherUncertain.map(f => <div key={f}>Usikker: {label(f)}{d.uncertain_reasons[f] && ` – ${d.uncertain_reasons[f]}`}</div>)}
        </div>
      )}

      {yarn.aliases.length > 0 && (
        <div className="text-xs text-stone-600">
          <div className="font-medium text-stone-700 mb-1">Skrivemåter i oppskriftene</div>
          <ul className="flex flex-col gap-0.5">
            {yarn.aliases.map(a => (
              <li key={`${a.brand}|${a.name}`}>
                {[a.brand, a.name].filter(Boolean).join(' ')}
                {!a.certain && <span className="text-amber-900"> · usikker{a.reason && `: ${a.reason}`}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {uses.length > 0 && (
        <div className="text-xs text-stone-600">
          <div className="font-medium text-stone-700 mb-1">Brukt i</div>
          <ul className="flex flex-col gap-0.5">
            {uses.map((u, i) => (
              <li key={i}>
                {titles.get(u.oppskrift_id) ?? 'Ukjent oppskrift'}
                {u.yarn_link_uncertain && <span className="text-amber-900"> · usikker kobling{u.yarn_link_reason && `: ${u.yarn_link_reason}`}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button disabled={busy || anyBad || !d.name.trim()} onClick={() => void save(false)}
          className="h-10 px-4 rounded-full border border-stone-300 bg-white text-sm text-stone-800 disabled:opacity-50">Lagre</button>
        {yarn.status !== 'approved' && (
          <button disabled={busy || anyBad || !d.name.trim()} onClick={() => void save(true)}
            className="h-10 px-4 rounded-full bg-[#2E5339] text-white text-sm disabled:opacity-50">Godkjenn</button>
        )}
        {yarn.status === 'approved' && yarn.approved_at && <span className="text-xs text-stone-500">Godkjent {new Date(yarn.approved_at).toLocaleDateString('nb-NO')}</span>}
        {anyBad && <span className="text-xs text-red-700">Rett feltene i rødt først</span>}
        {message && <span className={`text-sm ${message.ok ? 'text-[#2E5339]' : 'text-red-700'}`}>{message.text}</span>}
      </div>
    </div>
  )
}
