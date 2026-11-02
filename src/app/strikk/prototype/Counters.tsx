'use client'

import { useEffect, useRef, useState } from 'react'
import type { Counter } from './ops'

interface Props {
  counters: Counter[]
  onAdd: (name: string, total: number | null) => void
  onSet: (id: string, value: number) => void
  onStep: (id: string, delta: number) => void
  onDelete: (id: string) => void
  onHeight: (px: number) => void
}

export default function Counters({ counters, onAdd, onSet, onStep, onDelete, onHeight }: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const ro = new ResizeObserver(() => onHeight(el.getBoundingClientRect().height))
    ro.observe(el)
    return () => {
      ro.disconnect()
      onHeight(0)
    }
  }, [onHeight])

  return (
    <>
      <div
        ref={barRef}
        className="absolute inset-x-0 bottom-0 pointer-events-auto border-t border-stone-300 bg-[#FAF7F4]/95 backdrop-blur"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
      >
        <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory px-3 pt-2 pb-1"
          style={{ scrollPaddingInline: 12 }}>
          {counters.map(c => (
            <CounterCard key={c.id} counter={c} onSet={onSet} onStep={onStep} onDelete={onDelete} />
          ))}
          <button
            onClick={() => setAdding(true)}
            className="snap-start shrink-0 w-[44vw] max-w-[220px] min-h-[148px] rounded-2xl border-2 border-dashed border-stone-300 text-stone-500 text-sm"
          >
            Legg til teller
          </button>
        </div>
      </div>
      {adding && (
        <AddCounterSheet
          onCancel={() => setAdding(false)}
          onAdd={(name, total) => { onAdd(name, total); setAdding(false) }}
        />
      )}
    </>
  )
}

function CounterCard({ counter, onSet, onStep, onDelete }: {
  counter: Counter
  onSet: (id: string, value: number) => void
  onStep: (id: string, delta: number) => void
  onDelete: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const done = counter.total !== null && counter.value >= counter.total

  return (
    <div
      className={`relative snap-start shrink-0 w-[44vw] max-w-[220px] rounded-2xl border p-3 flex flex-col transition-colors ${
        done ? 'bg-[#B9CBB0] border-[#8FA886]' : 'bg-white border-stone-200'
      }`}
    >
      <div className="flex items-start gap-1">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-stone-800 truncate">{counter.name}</div>
          {counter.total !== null && (
            <div className="text-xs text-stone-500">av {counter.total}</div>
          )}
        </div>
        <button
          aria-label="Meny"
          onClick={() => setMenuOpen(o => !o)}
          className="-mr-1 -mt-1 w-9 h-9 flex items-center justify-center rounded-full text-stone-500"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
      </div>

      <div className="text-4xl font-semibold text-center text-stone-900 tabular-nums my-1">{counter.value}</div>

      <div className="flex gap-2">
        <button
          aria-label="Minus"
          onClick={() => onStep(counter.id, -1)}
          className="flex-1 h-12 rounded-xl bg-stone-100 active:bg-stone-200 text-2xl text-stone-800"
        >
          −
        </button>
        <button
          aria-label="Pluss"
          onClick={() => onStep(counter.id, 1)}
          className="flex-1 h-12 rounded-xl bg-[#2E5339] active:bg-[#244230] text-2xl text-white"
        >
          +
        </button>
      </div>

      <button
        onClick={() => { if (window.confirm(`Nullstille «${counter.name}»?`)) onSet(counter.id, 0) }}
        className="mt-1.5 text-xs text-stone-500 self-center py-1"
      >
        Nullstill
      </button>

      {menuOpen && (
        <div className="absolute right-2 top-10 z-10 bg-white border border-stone-200 rounded-xl shadow-lg py-1">
          <button
            onClick={() => {
              setMenuOpen(false)
              if (window.confirm(`Slette «${counter.name}»?`)) onDelete(counter.id)
            }}
            className="px-4 py-2.5 text-sm text-red-700"
          >
            Slett
          </button>
        </div>
      )}
    </div>
  )
}

function AddCounterSheet({ onAdd, onCancel }: {
  onAdd: (name: string, total: number | null) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [total, setTotal] = useState('')
  const parsedTotal = total.trim() === '' ? null : Number.parseInt(total, 10)
  const valid = name.trim() !== '' && (parsedTotal === null || (Number.isFinite(parsedTotal) && parsedTotal > 0))

  return (
    <div className="absolute inset-0 pointer-events-auto z-30 flex flex-col justify-end bg-black/30" onClick={onCancel}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (valid) onAdd(name.trim(), parsedTotal) }}
        className="bg-[#FAF7F4] rounded-t-2xl p-4 flex flex-col gap-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
      >
        <div className="text-base font-medium text-stone-800">Ny teller</div>
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          Navn
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className="h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-stone-600">
          Totalt antall (valgfritt)
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={total}
            onChange={e => setTotal(e.target.value.replace(/\D/g, ''))}
            className="h-11 px-3 rounded-lg border border-stone-300 bg-white text-base text-stone-900"
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel}
            className="flex-1 h-11 rounded-xl border border-stone-300 text-stone-700">
            Avbryt
          </button>
          <button type="submit" disabled={!valid}
            className="flex-1 h-11 rounded-xl bg-[#2E5339] text-white disabled:opacity-40">
            Legg til
          </button>
        </div>
      </form>
    </div>
  )
}
