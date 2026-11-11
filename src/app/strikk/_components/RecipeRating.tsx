'use client'

// Stars (1–5) and favourite for a recipe, used in the list and in the open recipe.
import { useEffect } from 'react'
import type { KnitRecipe } from '../_lib/recipes'

export type RatingPatch = Partial<Pick<KnitRecipe, 'rating' | 'favorite'>>

export async function saveRecipePatch(id: string, patch: Record<string, unknown>, keepalive = false): Promise<KnitRecipe> {
  const res = await fetch(`/api/strikk/oppskrifter/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), keepalive,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Lagring feilet (${res.status})`)
  return body as KnitRecipe
}

const GOLD = '#C8961E'

export function StarIcon({ filled, className = 'w-6 h-6' }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? GOLD : 'none'} stroke={filled ? GOLD : 'currentColor'} strokeWidth={1.6} strokeLinejoin="round">
      <path d="M12 3.2l2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83-5.38 2.83 1.03-6L3.3 9.6l6-.9z" />
    </svg>
  )
}

export function HeartIcon({ filled, className = 'w-6 h-6' }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? '#C8326B' : 'none'} stroke={filled ? '#C8326B' : 'currentColor'} strokeWidth={1.7} strokeLinejoin="round">
      <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z" />
    </svg>
  )
}

export function FavoriteButton({ on, title, onToggle, className = '' }: { on: boolean; title: string; onToggle: () => void; className?: string }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} aria-label={on ? `Fjern ${title} fra favoritter` : `Merk ${title} som favoritt`}
      className={`w-11 h-11 flex items-center justify-center text-stone-400 shrink-0 ${className}`}>
      <HeartIcon filled={on} />
    </button>
  )
}

// The stars on a list row: a small badge that opens the sheet.
export function RatingBadge({ rating, title, onOpen }: { rating: number | null; title: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={rating ? `${title}: ${rating} stjerner. Endre` : `Gi ${title} stjerner`}
      className="h-11 min-w-11 px-1 flex items-center justify-center gap-0.5 text-stone-400 shrink-0">
      <StarIcon filled={rating !== null} className="w-5 h-5" />
      {rating !== null && <span className="text-sm text-stone-700 tabular-nums">{rating}</span>}
    </button>
  )
}

export function StarPicker({ rating, onChange }: { rating: number | null; onChange: (r: number | null) => void }) {
  return (
    <div className="flex items-center" role="radiogroup" aria-label="Stjerner">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} ${n === 1 ? 'stjerne' : 'stjerner'}`}
          // The same star again takes the stars away.
          onClick={() => onChange(rating === n ? null : n)}
          className="w-11 h-11 flex items-center justify-center text-stone-400">
          <StarIcon filled={rating !== null && n <= rating} className="w-8 h-8" />
        </button>
      ))}
    </div>
  )
}

export function RatingSheet({ recipe, onChange, onClose }: {
  recipe: Pick<KnitRecipe, 'title' | 'rating' | 'favorite'>
  onChange: (patch: RatingPatch) => void
  onClose: () => void
}) {
  useEffect(() => {
    const keys = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Stjerner og favoritt for ${recipe.title}`} onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-[#FAF7F4] rounded-t-2xl sm:rounded-2xl p-4 flex flex-col gap-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
        <div className="flex items-start justify-between gap-2">
          <div className="font-serif text-lg text-stone-800 break-words min-w-0">{recipe.title}</div>
          <button onClick={onClose} aria-label="Lukk" className="w-11 h-11 -mr-2 -mt-2 text-2xl text-stone-500 shrink-0">×</button>
        </div>
        <StarPicker rating={recipe.rating} onChange={rating => onChange({ rating })} />
        <p className="text-xs text-stone-500 -mt-1">Trykk på samme stjerne igjen for å fjerne stjernene.</p>
        <button type="button" onClick={() => onChange({ favorite: !recipe.favorite })} aria-pressed={recipe.favorite}
          className="h-11 px-3 rounded-xl border border-stone-300 bg-white flex items-center gap-2 text-sm text-stone-800 self-start">
          <HeartIcon filled={recipe.favorite} className="w-5 h-5" />
          {recipe.favorite ? 'Favoritt' : 'Merk som favoritt'}
        </button>
      </div>
    </div>
  )
}
