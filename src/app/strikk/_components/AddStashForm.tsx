'use client'

import { useMemo, useState } from 'react'
import type { AmountUnit, StashRow } from '../_lib/stash'
import { spellingKey, type YarnRow } from '../_lib/yarns'

const yarnLabel = (y: YarnRow) => [y.brand, y.name].filter(Boolean).join(' ') + (y.discontinued ? ' (utgått)' : '')

// «Legg til garn» in Lager: a yarn from the catalogue, or a new one by brand and name
// (saved as «Ikke slått opp»), with colour, colour number, parti and skeins or grams.
export default function AddStashForm({ yarns, onAdded, onClose }: {
  yarns: YarnRow[]
  onAdded: (row: StashRow, yarn: YarnRow | null, warning: string | null) => void
  onClose: () => void
}) {
  const [isNew, setIsNew] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<YarnRow | null>(null)
  const [brand, setBrand] = useState('')
  const [name, setName] = useState('')
  const [colorName, setColorName] = useState('')
  const [colorNumber, setColorNumber] = useState('')
  const [dyeLot, setDyeLot] = useState('')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<AmountUnit>('skeins')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const words = useMemo(() => spellingKey(query).split(' ').filter(Boolean), [query])
  const matches = useMemo(() => {
    if (picked || !words.length) return []
    return yarns.filter(y => {
      const hay = spellingKey(`${y.brand} ${y.name} ${y.aliases.map(a => `${a.brand} ${a.name}`).join(' ')}`)
      return words.every(w => hay.includes(w))
    }).slice(0, 8)
  }, [yarns, words, picked])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/strikk/garnlager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yarn_id: isNew ? null : picked?.id ?? null,
          brand: isNew ? brand : '', name: isNew ? name : '',
          color_name: colorName, color_number: colorNumber, dye_lot: dyeLot,
          amount: Number(amount.replace(',', '.')), unit,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Lagring feilet (${res.status})`)
      onAdded(j.row as StashRow, (j.yarn as YarnRow | null) ?? null, (j.warning as string | null) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-sm'
  const canSave = (isNew ? name.trim() : picked) && Number(amount.replace(',', '.')) > 0

  return (
    <div data-add-stash className="rounded-xl border border-stone-200 bg-white p-4 flex flex-col gap-3 max-w-xl">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-stone-800">Legg til garn</h2>
        <button onClick={onClose} className="text-sm text-stone-500">Avbryt</button>
      </div>

      <div className="flex gap-1 p-1 bg-stone-100 rounded-xl w-fit">
        <button onClick={() => setIsNew(false)} aria-pressed={!isNew}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium ${!isNew ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>
          Fra katalogen
        </button>
        <button onClick={() => setIsNew(true)} aria-pressed={isNew}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium ${isNew ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>
          Nytt garn
        </button>
      </div>

      {isNew ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-stone-500">Produsent
            <input className={input} value={brand} onChange={e => setBrand(e.target.value)} placeholder="f.eks. Isager" />
          </label>
          <label className="text-xs text-stone-500">Navn
            <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="f.eks. Spinni" />
          </label>
          <p className="sm:col-span-2 text-xs text-stone-500">Nye garn merkes «Ikke slått opp» til fiber, løpelengde og strikkefasthet er slått opp.</p>
        </div>
      ) : (
        <div className="relative">
          <label className="text-xs text-stone-500">Garn
            <input className={input} value={picked ? yarnLabel(picked) : query} placeholder="Søk i katalogen"
              onChange={e => { setPicked(null); setQuery(e.target.value) }} />
          </label>
          {matches.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-stone-200 bg-white shadow-md max-h-64 overflow-y-auto">
              {matches.map(y => (
                <button key={y.id} onClick={() => { setPicked(y); setQuery(yarnLabel(y)) }}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-stone-50">{yarnLabel(y)}</button>
              ))}
            </div>
          )}
          {!picked && words.length > 0 && matches.length === 0 && (
            <button onClick={() => { setIsNew(true); const [b, ...rest] = query.trim().split(' '); setBrand(rest.length ? b : ''); setName(rest.join(' ') || b) }}
              className="mt-1 text-xs text-[#8B6340] underline">Finnes ikke i katalogen. Legg inn som nytt garn</button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-xs text-stone-500">Farge
          <input className={input} value={colorName} onChange={e => setColorName(e.target.value)} />
        </label>
        <label className="text-xs text-stone-500">Fargenummer
          <input className={input} value={colorNumber} onChange={e => setColorNumber(e.target.value)} />
        </label>
        <label className="text-xs text-stone-500">Parti
          <input className={input} value={dyeLot} onChange={e => setDyeLot(e.target.value)} />
        </label>
      </div>

      <div className="flex items-end gap-2">
        <label className="text-xs text-stone-500 w-32">Mengde
          <input className={input} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <div className="flex gap-1 p-1 bg-stone-100 rounded-xl">
          {(['skeins', 'grams'] as const).map(u => (
            <button key={u} onClick={() => setUnit(u)} aria-pressed={unit === u}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium ${unit === u ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>
              {u === 'skeins' ? 'Nøster' : 'Gram'}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button onClick={() => void save()} disabled={!canSave || saving}
        className="self-start px-4 py-2 rounded-lg bg-stone-800 text-white text-sm disabled:opacity-40">
        {saving ? 'Lagrer …' : 'Legg til i lageret'}
      </button>
    </div>
  )
}
