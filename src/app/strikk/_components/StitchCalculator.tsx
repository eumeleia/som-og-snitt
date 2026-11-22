'use client'

import { useEffect, useState } from 'react'
import { lineParts, maxChanges, spreadStitches, type Direction } from '../_lib/stitch-spread'

const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? Number.parseInt(s.trim(), 10) : null)

// Øke/felle-kalkulator: how to increase or decrease evenly from one stitch count to another
// in one round or row (stitch-spread.ts). Used on its own page and in a sheet in recipes.
export default function StitchCalculator() {
  const [direction, setDirection] = useState<Direction>('increase')
  const [beforeText, setBeforeText] = useState('')
  const [afterText, setAfterText] = useState('')

  const before = toInt(beforeText), after = toInt(afterText)
  const wrongWay = before !== null && after !== null && after !== before && (direction === 'increase') !== (after > before)
  const result = before !== null && after !== null && !wrongWay ? spreadStitches(before, after) : null
  const max = before !== null ? maxChanges(before) : null

  const segment = (on: boolean) =>
    `flex-1 h-11 rounded-xl text-base font-medium transition-colors ${on ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`
  const field = 'h-12 w-full px-3 rounded-xl border border-stone-300 bg-white text-base text-stone-900 tabular-nums'

  return (
    <div data-stitch-calculator className="flex flex-col gap-4">
      <div className="flex gap-1 p-1 bg-stone-100 rounded-2xl" role="tablist">
        <button role="tab" aria-selected={direction === 'increase'} className={segment(direction === 'increase')} onClick={() => setDirection('increase')}>Øke</button>
        <button role="tab" aria-selected={direction === 'decrease'} className={segment(direction === 'decrease')} onClick={() => setDirection('decrease')}>Felle</button>
      </div>

      <div className="grid grid-cols-2 gap-3 items-end">
        <label className="flex flex-col gap-1 text-sm text-[#8B6340] min-w-0">
          Antall masker på pinnen
          <input className={field} inputMode="numeric" pattern="[0-9]*" value={beforeText}
            onChange={e => setBeforeText(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[#8B6340] min-w-0">
          Antall masker på pinnen etter {direction === 'increase' ? 'økning' : 'felling'}
          <input className={field} inputMode="numeric" pattern="[0-9]*" value={afterText}
            onChange={e => setAfterText(e.target.value.replace(/\D/g, ''))} />
        </label>
      </div>
      {max !== null && max > 0 && (
        <p className="text-xs text-stone-500 -mt-2">
          Med {before} masker kan du {direction === 'increase' ? `øke til høyst ${before! + max}` : `felle til minst ${before! - max}`} masker i én omgang.
        </p>
      )}

      {wrongWay && (
        <p data-stitch-error className="text-sm text-stone-800 bg-stone-100 rounded-xl px-3 py-2.5">
          {direction === 'increase'
            ? 'Tallet etter økning må være større enn masketallet nå. Vil du felle? Velg Felle.'
            : 'Tallet etter felling må være mindre enn masketallet nå. Vil du øke? Velg Øke.'}
        </p>
      )}
      {result && !result.ok && (
        <p data-stitch-error className="text-sm text-stone-800 bg-stone-100 rounded-xl px-3 py-2.5">{result.error}</p>
      )}
      {result?.ok && (
        <div data-stitch-result className="flex flex-col gap-3">
          <ol className="flex flex-col gap-2 text-base text-stone-900">
            {result.lines.map((l, i) => (
              <li key={i} className="break-words">
                {lineParts(l, result.direction).map((p, j) => ('text' in p
                  ? <span key={j}>{p.text}</span>
                  : <span key={j} className="font-semibold text-[#9B5B4B] tabular-nums">{p.number}</span>))}
              </li>
            ))}
          </ol>
          <div className="rounded-2xl bg-[#F0E8E2] px-4 py-3 text-center">
            <p className="text-base text-stone-800">Nå har du {result.direction === 'increase' ? 'økt' : 'felt'} {result.changes} {result.changes === 1 ? 'maske' : 'masker'}</p>
            <p className="text-lg font-semibold text-stone-900">Du har nå {result.after} masker på pinnen</p>
          </div>
        </div>
      )}
    </div>
  )
}

// The calculator in a sheet over a recipe or a project.
export function StitchCalculatorSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const keys = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 pointer-events-auto" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Øke/felle-kalkulator" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-serif text-lg text-stone-800">Øke/felle-kalkulator</h2>
          <button onClick={onClose} aria-label="Lukk" className="w-11 h-11 -mr-2 text-2xl text-stone-500 shrink-0">×</button>
        </div>
        <StitchCalculator />
      </div>
    </div>
  )
}
