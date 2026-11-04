'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  ACCESSORY_KINDS,
  AUDIENCES,
  EXTRACTION_SELECT,
  chooseAmountYarn,
  removeSize,
  removeYarnLine,
  storedToExtraction,
  type AccessoryKind,
  type Audience,
  type ExtractionData,
  type StoredRecipe,
} from '../_lib/extraction'
import { extractRecipe, nextBatch, runExtractionBatch } from '../_lib/extract-client'

const STATUS_LABEL: Record<StoredRecipe['extraction_status'], string> = {
  pending: 'Ikke lest',
  extracted: 'Til gjennomgang',
  failed: 'Feilet',
  approved: 'Godkjent',
}
const AUDIENCE_LABEL: Record<Audience, string> = { woman: 'Kvinne', man: 'Mann', unisex: 'Unisex', child: 'Barn' }
const KIND_LABEL: Record<AccessoryKind, string> = { buttons: 'Knapper', zipper: 'Glidelås', elastic: 'Elastikk', other: 'Annet' }
const FILTERS = ['extracted', 'pending', 'failed', 'approved'] as const

type Run = { done: number; total: number; running: string[]; failed: string[]; stopping: boolean }

export default function ReviewList() {
  const [rows, setRows] = useState<StoredRecipe[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<typeof FILTERS[number]>('extracted')
  const [openId, setOpenId] = useState<string | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [lastRun, setLastRun] = useState<Run | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadAll = useCallback(async () => {
    const { data, error } = await supabase.from('strikk_oppskrift').select(EXTRACTION_SELECT).order('created_at')
    if (error) setLoadError(error.message)
    else setRows((data ?? []) as unknown as StoredRecipe[])
  }, [])

  const loadOne = useCallback(async (id: string) => {
    const { data } = await supabase.from('strikk_oppskrift').select(EXTRACTION_SELECT).eq('id', id).maybeSingle()
    if (data) setRows(rs => rs?.map(r => (r.id === id ? data as unknown as StoredRecipe : r)) ?? rs)
  }, [])

  useEffect(() => {
    let cancelled = false
    supabase.from('strikk_oppskrift').select(EXTRACTION_SELECT).order('created_at').then(({ data, error }) => {
      if (cancelled) return
      if (error) setLoadError(error.message)
      else setRows((data ?? []) as unknown as StoredRecipe[])
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!run) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [run])

  async function start() {
    if (!rows || run) return
    const items = nextBatch(rows)
    if (items.length === 0) return
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let state: Run = { done: 0, total: items.length, running: [], failed: [], stopping: false }
    const set = (fn: (r: Run) => Run) => { state = fn(state); setRun(state) }
    setRun(state)
    setLastRun(null)
    await runExtractionBatch(items, async r => {
      set(s => ({ ...s, running: [...s.running, r.title] }))
      try {
        return await extractRecipe(r)
      } finally {
        set(s => ({ ...s, running: s.running.filter(t => t !== r.title) }))
        await loadOne(r.id)
      }
    }, {
      concurrency: 3,
      signal: ctrl.signal,
      onDone: (res, done) => set(s => ({ ...s, done, failed: res.ok ? s.failed : [...s.failed, `${res.item.title}: ${res.error}`] })),
    })
    setLastRun(state)
    setRun(null)
    abortRef.current = null
  }

  function stop() {
    abortRef.current?.abort()
    setRun(r => (r ? { ...r, stopping: true } : r))
  }

  if (loadError) return <p className="max-w-3xl mx-auto px-4 sm:px-8 py-6 text-sm text-red-700">Klarte ikke hente oppskriftene: {loadError}</p>
  if (!rows) return <p className="max-w-3xl mx-auto px-4 sm:px-8 py-6 text-sm text-stone-500">Henter oppskrifter …</p>

  const count = (s: StoredRecipe['extraction_status']) => rows.filter(r => r.extraction_status === s).length
  const upcoming = nextBatch(rows).length
  const firstRun = !rows.some(r => r.extraction_status === 'extracted' || r.extraction_status === 'approved')
  const shown = rows.filter(r => r.extraction_status === filter)

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-stone-800">Gjennomgang</h1>
        {run ? (
          <button onClick={stop} disabled={run.stopping}
            className="h-11 px-4 rounded-xl border border-stone-300 bg-white text-sm text-stone-800 disabled:opacity-50 shrink-0">
            {run.stopping ? 'Stopper …' : 'Avbryt'}
          </button>
        ) : (
          <button onClick={() => void start()} disabled={upcoming === 0}
            className="h-11 px-4 rounded-xl bg-[#2E5339] text-white text-sm disabled:opacity-50 shrink-0">
            Les inn oppskrifter
          </button>
        )}
      </div>
      {!run && upcoming > 0 && (
        <p className="text-sm text-stone-600">
          {firstRun
            ? `Første gang leses ${upcoming} oppskrifter, så du kan sjekke dem før resten leses.`
            : `${upcoming} oppskrifter er ikke lest ennå eller feilet.`}
        </p>
      )}

      {run && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-2" role="status">
          <p className="text-sm font-medium text-stone-900">Hold denne siden åpen til innlesingen er ferdig.</p>
          <p className="text-sm text-stone-700">
            Avbryter du, eller lukker siden, blir det som er lest så langt lagret. Trykk «Les inn oppskrifter» igjen for å fortsette.
          </p>
          <div className="h-2 rounded-full bg-amber-100 overflow-hidden">
            <div className="h-full bg-[#2E5339] transition-all" style={{ width: `${Math.round((run.done / run.total) * 100)}%` }} />
          </div>
          <p className="text-sm text-stone-700 break-words">
            {run.done} av {run.total} ferdig{run.running.length > 0 && <> · leser «{run.running.join('», «')}»</>}
          </p>
        </div>
      )}
      {lastRun && (
        <div className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-800 flex flex-col gap-1">
          <p>Lest inn: {lastRun.done - lastRun.failed.length} av {lastRun.total}{lastRun.failed.length > 0 && `, ${lastRun.failed.length} feilet`}.</p>
          {lastRun.failed.map((f, i) => <p key={i} className="text-red-700 break-words">{f}</p>)}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`h-9 px-3 rounded-full text-sm whitespace-nowrap ${filter === f ? 'bg-[#2E5339] text-white' : 'bg-white border border-stone-200 text-stone-700'}`}>
            {STATUS_LABEL[f]} ({count(f)})
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="text-sm text-stone-500">Ingen oppskrifter her.</p>}
      <ul className="flex flex-col gap-2">
        {shown.map(r => {
          const d = storedToExtraction(r)
          const marks = uncertainCount(d)
          return (
            <li key={r.id} className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
              <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-base text-stone-800 truncate">{r.title}</div>
                  <div className="text-sm text-stone-500 truncate">
                    {[r.designer, r.garment_type, r.audience && AUDIENCE_LABEL[r.audience], d.sizes.length > 0 && `${d.sizes.length} størrelser`].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {marks > 0 && r.extraction_status !== 'approved' && (
                  <span className="text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-1 shrink-0">{marks} usikre</span>
                )}
              </button>
              {openId === r.id && (
                <RecipeReview key={`${r.id}-${r.extracted_at}-${r.approved_at}`} recipe={r} onChanged={() => loadOne(r.id)} />
              )}
            </li>
          )
        })}
      </ul>
      <button onClick={() => void loadAll()} className="self-start text-sm text-stone-500 underline">Oppdater listen</button>
    </div>
  )
}

function uncertainCount(d: ExtractionData): number {
  return d.uncertain_fields.length
    + d.sizes.filter(s => s.uncertain).length
    + d.yarn_lines.reduce((n, l) => n + l.uncertain_fields.length, 0)
    + d.amounts.filter(a => a.uncertain || a.needs_choice).length
    + d.alternatives.filter(a => a.uncertain).length
    + d.accessories.filter(a => a.uncertain).length
}

// ── One recipe ──────────────────────────────────────────────────────────────────────

const inputCls = 'h-10 px-2 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 min-w-0 disabled:bg-stone-50 disabled:text-stone-600'
const markCls = ' ring-2 ring-amber-400 bg-amber-50'

function Field({ label, uncertain, children }: { label: string; uncertain?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-stone-600 min-w-0">
      <span>{label}{uncertain && <span className="ml-1 text-amber-800 font-medium">usikker</span>}</span>
      {children}
    </label>
  )
}

function Section({ title, uncertain, children }: { title: string; uncertain?: boolean; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={`text-sm font-medium text-stone-800 ${uncertain ? 'text-amber-900' : ''}`}>
        {title}{uncertain && <span className="ml-2 text-xs rounded-full bg-amber-100 px-2 py-0.5">usikker</span>}
      </h3>
      {children}
    </section>
  )
}

function Text({ value, onChange, uncertain, disabled, placeholder }: {
  value: string | null; onChange: (v: string | null) => void; uncertain?: boolean; disabled?: boolean; placeholder?: string
}) {
  return <input value={value ?? ''} placeholder={placeholder} disabled={disabled}
    onChange={e => onChange(e.target.value || null)} className={inputCls + (uncertain ? markCls : '')} />
}

function Num({ value, onChange, uncertain, disabled }: {
  value: number | null; onChange: (v: number | null) => void; uncertain?: boolean; disabled?: boolean
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(value).replace('.', ','))
  return <input inputMode="decimal" value={draft} disabled={disabled}
    onChange={e => {
      setDraft(e.target.value)
      const n = Number(e.target.value.replace(',', '.'))
      onChange(e.target.value.trim() === '' || !Number.isFinite(n) ? null : n)
    }}
    className={inputCls + ' w-24' + (uncertain ? markCls : '')} />
}

function Lines({ value, onChange, uncertain, disabled }: {
  value: string[]; onChange: (v: string[]) => void; uncertain?: boolean; disabled?: boolean
}) {
  return <textarea value={value.join('\n')} disabled={disabled} rows={Math.max(2, value.length + 1)}
    onChange={e => onChange(e.target.value.split('\n'))}
    onBlur={e => onChange(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
    className={'px-2 py-2 rounded-lg border border-stone-300 bg-white text-sm text-stone-900 disabled:bg-stone-50' + (uncertain ? markCls : '')} />
}

function RecipeReview({ recipe, onChanged }: { recipe: StoredRecipe; onChanged: () => Promise<void> }) {
  const [d, setD] = useState<ExtractionData>(() => storedToExtraction(recipe))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locked = recipe.extraction_status === 'approved'
  const u = (f: string) => !locked && d.uncertain_fields.includes(f)
  const patch = (p: Partial<ExtractionData>) => setD(x => ({ ...x, ...p }))
  const groups = [...new Set(d.yarn_lines.map(l => l.color_group))].sort((a, b) => a - b)
  const groupLabel = (g: number) => d.yarn_lines.find(l => l.color_group === g)?.color_label || `Farge ${g + 1}`

  async function approve() {
    setBusy('approve'); setError(null)
    try {
      const res = await fetch(`/api/strikk/extraction/${recipe.id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: d }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Godkjenning feilet (${res.status})`)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(null) }
  }

  async function reextract() {
    setBusy('extract'); setError(null)
    try {
      await extractRecipe(recipe)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      await onChanged()
    }
  }

  const setLine = (i: number, p: Partial<ExtractionData['yarn_lines'][number]>) =>
    patch({ yarn_lines: d.yarn_lines.map((l, k) => (k === i ? { ...l, ...p } : l)) })
  const setAmount = (i: number, p: Partial<ExtractionData['amounts'][number]>) =>
    patch({ amounts: d.amounts.map((a, k) => (k === i ? { ...a, ...p } : a)) })
  const setAlt = (i: number, p: Partial<ExtractionData['alternatives'][number]>) =>
    patch({ alternatives: d.alternatives.map((a, k) => (k === i ? { ...a, ...p } : a)) })
  const setAcc = (i: number, p: Partial<ExtractionData['accessories'][number]>) =>
    patch({ accessories: d.accessories.map((a, k) => (k === i ? { ...a, ...p } : a)) })
  const lineOrGroup = (yarnLine: number | null, group: number | null) => (yarnLine !== null ? `l:${yarnLine}` : group !== null ? `g:${group}` : '')
  const parseTarget = (v: string) => v.startsWith('l:')
    ? { yarn_line: Number(v.slice(2)), color_group: d.yarn_lines[Number(v.slice(2))].color_group }
    : v.startsWith('g:') ? { yarn_line: null, color_group: Number(v.slice(2)) } : { yarn_line: null, color_group: null }
  const targetOptions = (
    <>
      {groups.map(g => (
        <optgroup key={g} label={groupLabel(g)}>
          <option value={`g:${g}`}>{groupLabel(g)} (hele fargen)</option>
          {d.yarn_lines.map((l, i) => l.color_group === g && <option key={i} value={`l:${i}`}>{l.yarn_name}</option>)}
        </optgroup>
      ))}
    </>
  )

  return (
    <div className="border-t border-stone-200 px-4 py-4 flex flex-col gap-5">
      {recipe.extraction_status === 'failed' && recipe.extraction_error && (
        <p className="text-sm text-red-700 break-words">Uttrekket feilet: {recipe.extraction_error}</p>
      )}
      {recipe.extraction_status === 'pending' && <p className="text-sm text-stone-600">Ikke lest inn ennå.</p>}
      {locked && <p className="text-sm text-emerald-800">Godkjent. Et nytt uttrekk endrer ikke denne oppskriften.</p>}
      <p className="text-xs text-stone-500 break-words">Fil: {recipe.file_name}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Oppskrift" uncertain={u('title')}><Text value={d.title} onChange={v => patch({ title: v })} uncertain={u('title')} disabled={locked} /></Field>
        <Field label="Designer" uncertain={u('designer')}><Text value={d.designer} onChange={v => patch({ designer: v })} uncertain={u('designer')} disabled={locked} /></Field>
        {!locked && (recipe.extracted_title !== recipe.title || recipe.extracted_designer !== recipe.designer) && recipe.extracted_title && (
          <p className="sm:col-span-2 text-xs text-stone-500">
            Lest i PDF-en: «{recipe.extracted_title}»{recipe.extracted_designer && ` - ${recipe.extracted_designer}`}
          </p>
        )}
        <Field label="Målgruppe" uncertain={u('audience')}>
          <select value={d.audience ?? ''} disabled={locked} onChange={e => patch({ audience: (e.target.value || null) as Audience | null })}
            className={inputCls + (u('audience') ? markCls : '')}>
            <option value="">—</option>
            {AUDIENCES.map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
          </select>
        </Field>
        <Field label="Plaggtype" uncertain={u('garment_type')}><Text value={d.garment_type} onChange={v => patch({ garment_type: v })} uncertain={u('garment_type')} disabled={locked} /></Field>
      </div>

      <Section title="Størrelser" uncertain={u('sizes')}>
        <div className="flex flex-wrap gap-2">
          {d.sizes.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              <input value={s.label} disabled={locked} onChange={e => patch({ sizes: d.sizes.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })}
                className={inputCls + ' w-24' + (!locked && s.uncertain ? markCls : '')} />
              {!locked && <button onClick={() => setD(removeSize(d, i))} aria-label={`Fjern ${s.label}`} className="text-stone-400 px-1">×</button>}
            </span>
          ))}
          {!locked && <button onClick={() => patch({ sizes: [...d.sizes, { label: '', uncertain: false }] })} className="text-sm text-stone-600 underline">+ størrelse</button>}
        </div>
      </Section>

      <Section title="Garn" uncertain={u('yarn_lines')}>
        {groups.map(g => {
          const members = d.yarn_lines.map((l, i) => ({ l, i })).filter(x => x.l.color_group === g)
          return (
            <div key={g} className="rounded-xl border border-stone-200 p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input value={members[0]?.l.color_label ?? ''} placeholder={`Farge ${g + 1}`} disabled={locked}
                  onChange={e => patch({ yarn_lines: d.yarn_lines.map(l => (l.color_group === g ? { ...l, color_label: e.target.value || null } : l)) })}
                  className={inputCls + ' w-40'} />
                {members.length > 1 && (
                  <span className="text-xs rounded-full bg-stone-100 text-stone-700 px-2 py-1">
                    Strikkes sammen: {members.map(m => m.l.yarn_name).join(' + ')}
                  </span>
                )}
              </div>
              {members.map(({ l, i }) => {
                const lu = (f: string) => !locked && l.uncertain_fields.includes(f)
                return (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <Field label="Garn" uncertain={lu('yarn_name')}><Text value={l.yarn_name} onChange={v => setLine(i, { yarn_name: v ?? '' })} uncertain={lu('yarn_name')} disabled={locked} /></Field>
                    <Field label="Produsent" uncertain={lu('brand')}><Text value={l.brand} onChange={v => setLine(i, { brand: v })} uncertain={lu('brand')} disabled={locked} /></Field>
                    <Field label="Meter per nøste" uncertain={lu('meterage_m')}><Num value={l.meterage_m} onChange={v => setLine(i, { meterage_m: v })} uncertain={lu('meterage_m')} disabled={locked} /></Field>
                    <Field label="Gram per nøste" uncertain={lu('skein_weight_g')}><Num value={l.skein_weight_g} onChange={v => setLine(i, { skein_weight_g: v })} uncertain={lu('skein_weight_g')} disabled={locked} /></Field>
                    <Field label="Fiber" uncertain={lu('fiber')}><Text value={l.fiber} onChange={v => setLine(i, { fiber: v })} uncertain={lu('fiber')} disabled={locked} /></Field>
                    <Field label="Tråder" uncertain={lu('strands')}><Num value={l.strands} onChange={v => setLine(i, { strands: v ?? 1 })} uncertain={lu('strands')} disabled={locked} /></Field>
                    {!locked && <button onClick={() => setD(removeYarnLine(d, i))} className="h-10 text-sm text-red-700 px-2">Fjern</button>}
                  </div>
                )
              })}
              {!locked && (
                <button onClick={() => patch({ yarn_lines: [...d.yarn_lines, { color_group: g, color_label: members[0]?.l.color_label ?? null, yarn_name: '', brand: null, meterage_m: null, skein_weight_g: null, fiber: null, strands: 1, uncertain_fields: [] }] })}
                  className="self-start text-sm text-stone-600 underline">+ garn som strikkes sammen med denne fargen</button>
              )}
            </div>
          )
        })}
        {!locked && (
          <button onClick={() => patch({ yarn_lines: [...d.yarn_lines, { color_group: groups.length ? Math.max(...groups) + 1 : 0, color_label: null, yarn_name: '', brand: null, meterage_m: null, skein_weight_g: null, fiber: null, strands: 1, uncertain_fields: [] }] })}
            className="self-start text-sm text-stone-600 underline">+ farge</button>
        )}
      </Section>

      <Section title="Garnmengde per størrelse" uncertain={u('amounts')}>
        {d.sizes.map((s, si) => (
          <div key={si} className="flex flex-col gap-2">
            <div className="text-xs font-medium text-stone-600">{s.label || '(uten navn)'}</div>
            {d.amounts.map((a, ai) => a.size !== si ? null : (
              <div key={ai} className="flex flex-wrap items-center gap-2">
                <select value={lineOrGroup(a.yarn_line, a.color_group)} disabled={locked}
                  onChange={e => { const t = parseTarget(e.target.value); setAmount(ai, { yarn_line: t.yarn_line, color_group: t.color_group ?? 0 }) }}
                  className={inputCls + ' w-48'}>
                  {targetOptions}
                </select>
                <Num value={a.amount} onChange={v => setAmount(ai, { amount: v })} uncertain={!locked && a.uncertain} disabled={locked} />
                <select value={a.unit} disabled={locked} onChange={e => setAmount(ai, { unit: e.target.value as 'g' | 'skeins' })} className={inputCls + ' w-24'}>
                  <option value="g">g</option>
                  <option value="skeins">nøster</option>
                </select>
                {a.needs_choice ? (
                  <select value="" disabled={locked} onChange={e => e.target.value && setD(chooseAmountYarn(d, ai, e.target.value))}
                    className={inputCls + markCls + ' w-56'}>
                    <option value="">Velg garnet mengden gjelder</option>
                    {a.candidates.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : a.yarn_line === null && a.candidates.length === 1 ? (
                  <span className="text-xs text-stone-600">gjelder {a.candidates[0]}</span>
                ) : null}
                {!locked && <button onClick={() => patch({ amounts: d.amounts.filter((_, k) => k !== ai) })} className="text-sm text-red-700 px-1">Fjern</button>}
              </div>
            ))}
            {!locked && groups.length > 0 && (
              <button onClick={() => patch({ amounts: [...d.amounts, { size: si, color_group: groups[0], yarn_line: null, amount: null, unit: 'g', candidates: [], needs_choice: false, uncertain: false }] })}
                className="self-start text-sm text-stone-600 underline">+ mengde</button>
            )}
          </div>
        ))}
      </Section>

      <Section title="Garnalternativer i oppskriften" uncertain={u('alternatives')}>
        {d.alternatives.length === 0 && <p className="text-sm text-stone-500">Ingen.</p>}
        {d.alternatives.map((a, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label="Erstatter">
              <select value={lineOrGroup(a.yarn_line, a.color_group)} disabled={locked}
                onChange={e => setAlt(i, parseTarget(e.target.value))} className={inputCls + ' w-48'}>
                <option value="">—</option>
                {targetOptions}
              </select>
            </Field>
            <Field label="Garn" uncertain={!locked && a.uncertain}><Text value={a.yarn_name} onChange={v => setAlt(i, { yarn_name: v ?? '' })} uncertain={!locked && a.uncertain} disabled={locked} /></Field>
            <Field label="Produsent"><Text value={a.brand} onChange={v => setAlt(i, { brand: v })} disabled={locked} /></Field>
            <Field label="Meter per nøste"><Num value={a.meterage_m} onChange={v => setAlt(i, { meterage_m: v })} disabled={locked} /></Field>
            <Field label="Gram per nøste"><Num value={a.skein_weight_g} onChange={v => setAlt(i, { skein_weight_g: v })} disabled={locked} /></Field>
            <Field label="Fiber"><Text value={a.fiber} onChange={v => setAlt(i, { fiber: v })} disabled={locked} /></Field>
            {!locked && <button onClick={() => patch({ alternatives: d.alternatives.filter((_, k) => k !== i) })} className="h-10 text-sm text-red-700 px-2">Fjern</button>}
          </div>
        ))}
        {!locked && (
          <button onClick={() => patch({ alternatives: [...d.alternatives, { color_group: groups[0] ?? null, yarn_line: null, yarn_name: '', brand: null, meterage_m: null, skein_weight_g: null, fiber: null, uncertain: false }] })}
            className="self-start text-sm text-stone-600 underline">+ alternativ</button>
        )}
      </Section>

      <Section title="Strikkefasthet og pinner">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Masker per 10 cm" uncertain={u('gauge_stitches_10cm')}><Num value={d.gauge_stitches_10cm} onChange={v => patch({ gauge_stitches_10cm: v })} uncertain={u('gauge_stitches_10cm')} disabled={locked} /></Field>
          <Field label="Omganger per 10 cm" uncertain={u('gauge_rows_10cm')}><Num value={d.gauge_rows_10cm} onChange={v => patch({ gauge_rows_10cm: v })} uncertain={u('gauge_rows_10cm')} disabled={locked} /></Field>
          <Field label="Merknad" uncertain={u('gauge_note')}><Text value={d.gauge_note} onChange={v => patch({ gauge_note: v })} uncertain={u('gauge_note')} disabled={locked} /></Field>
        </div>
        <Field label="Pinner (én per linje)" uncertain={u('needles')}><Lines value={d.needles} onChange={v => patch({ needles: v })} uncertain={u('needles')} disabled={locked} /></Field>
      </Section>

      <Section title="Tilbehør" uncertain={u('accessories')}>
        {d.accessories.length === 0 && <p className="text-sm text-stone-500">Ingen.</p>}
        {d.accessories.map((a, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label="Type" uncertain={!locked && a.uncertain}>
              <select value={a.kind} disabled={locked} onChange={e => setAcc(i, { kind: e.target.value as AccessoryKind })}
                className={inputCls + (!locked && a.uncertain ? markCls : '')}>
                {ACCESSORY_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label="Beskrivelse"><Text value={a.description} onChange={v => setAcc(i, { description: v })} disabled={locked} /></Field>
            <Field label="Antall"><Num value={a.quantity} onChange={v => setAcc(i, { quantity: v })} disabled={locked} /></Field>
            <Field label="Størrelse/lengde"><Text value={a.dimension} onChange={v => setAcc(i, { dimension: v })} disabled={locked} /></Field>
            <Field label="Gjelder">
              <select value={a.size ?? ''} disabled={locked} onChange={e => setAcc(i, { size: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls}>
                <option value="">Alle størrelser</option>
                {d.sizes.map((s, k) => <option key={k} value={k}>{s.label}</option>)}
              </select>
            </Field>
            {!locked && <button onClick={() => patch({ accessories: d.accessories.filter((_, k) => k !== i) })} className="h-10 text-sm text-red-700 px-2">Fjern</button>}
          </div>
        ))}
        {!locked && (
          <button onClick={() => patch({ accessories: [...d.accessories, { size: null, kind: 'buttons', description: null, quantity: null, dimension: null, uncertain: false }] })}
            className="self-start text-sm text-stone-600 underline">+ tilbehør</button>
        )}
      </Section>

      <Section title="Varianter og samling">
        <Field label="Varianter (én per linje)" uncertain={u('variants')}><Lines value={d.variants} onChange={v => patch({ variants: v })} uncertain={u('variants')} disabled={locked} /></Field>
        <label className={`flex items-center gap-2 text-sm text-stone-800 ${u('is_collection') ? 'text-amber-900' : ''}`}>
          <input type="checkbox" checked={d.is_collection} disabled={locked} onChange={e => patch({ is_collection: e.target.checked })} />
          PDF-en inneholder flere oppskrifter{u('is_collection') && ' (usikker)'}
        </label>
        {d.is_collection && (
          <Field label="Oppskrifter i samlingen (én per linje)" uncertain={u('collection_titles')}>
            <Lines value={d.collection_titles} onChange={v => patch({ collection_titles: v })} uncertain={u('collection_titles')} disabled={locked} />
          </Field>
        )}
      </Section>

      {error && <p className="text-sm text-red-700 break-words">{error}</p>}
      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void approve()} disabled={busy !== null || !d.title?.trim() || recipe.extraction_status === 'pending'}
            className="h-11 px-4 rounded-xl bg-[#2E5339] text-white text-sm disabled:opacity-50">
            {busy === 'approve' ? 'Godkjenner …' : 'Godkjenn'}
          </button>
          <button onClick={() => void reextract()} disabled={busy !== null}
            className="h-11 px-4 rounded-xl border border-stone-300 bg-white text-sm text-stone-800 disabled:opacity-50">
            {busy === 'extract' ? 'Leser inn …' : recipe.extraction_status === 'pending' ? 'Les inn' : 'Les inn på nytt'}
          </button>
        </div>
      )}
    </div>
  )
}
