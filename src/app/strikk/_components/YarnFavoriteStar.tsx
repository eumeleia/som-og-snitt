'use client'

import { useState } from 'react'

async function patchYarn(id: string, body: { favorite?: boolean | null; price_per_skein?: number | null }) {
  const res = await fetch(`/api/strikk/yarn/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Lagring feilet (${res.status})`)
}

// Stjerne for favoritt og et lite prisfelt (kr per nøste), brukt overalt et garn vises:
// i garnvelgeren i prosjektet og i garnfilteret i oppskriftene.
export default function YarnFavoriteStar({ yarnId, favorite, pricePerSkein, onChange }: {
  yarnId: string
  favorite: boolean | null
  pricePerSkein: number | null
  onChange: (next: { favorite?: boolean | null; price_per_skein?: number | null }) => void
}) {
  const [price, setPrice] = useState(pricePerSkein?.toString() ?? '')

  async function toggleFavorite(e: React.MouseEvent) {
    e.stopPropagation()
    const next = !favorite
    onChange({ favorite: next })
    try { await patchYarn(yarnId, { favorite: next }) } catch { onChange({ favorite: favorite ?? null }) }
  }

  async function commitPrice() {
    const n = price.trim() === '' ? null : Number(price.replace(',', '.'))
    const value = n !== null && Number.isFinite(n) && n >= 0 ? n : null
    if (value === pricePerSkein) return
    onChange({ price_per_skein: value })
    try { await patchYarn(yarnId, { price_per_skein: value }) } catch { /* left as entered locally */ }
  }

  return (
    <span className="inline-flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
      <button type="button" onClick={toggleFavorite} aria-pressed={!!favorite}
        aria-label={favorite ? 'Fjern som favoritt' : 'Merk som favoritt'}
        className={`w-7 h-7 flex items-center justify-center rounded-full ${favorite ? 'text-amber-500' : 'text-stone-300'}`}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 3.5l2.6 5.5 6 .7-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.7z" />
        </svg>
      </button>
      <input
        inputMode="decimal" value={price} placeholder="kr/nøste"
        onChange={e => setPrice(e.target.value)}
        onBlur={commitPrice}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="w-20 h-7 px-1.5 rounded-md border border-stone-200 bg-white text-xs text-stone-700"
      />
    </span>
  )
}
