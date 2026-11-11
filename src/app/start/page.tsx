'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { PROJECT_LIST_SELECT, type ProjectListRow } from '@/app/strikk/_lib/projects'
import { coverUrl } from '@/app/strikk/_lib/cover'

// Egen, smal spørring for syprosjektene — samme felt som /dashboard sin «Fortsett der
// du slapp», ikke hele ProjectData i dashboard/projects/page.tsx.
interface SyProjectRow {
  id: string
  created_at: string
  data: {
    name: string
    status: 'Aktiv' | 'Planlagt' | 'Fullført'
    images: { url: string }[]
    focalX?: number
    focalY?: number
  }
}

interface Card {
  kind: 'strikk' | 'sying'
  id: string
  name: string
  imageUrl: string | null
  focalX: number
  focalY: number
  createdAt: string
}

export default function StartPage() {
  const router = useRouter()
  const [cards, setCards] = useState<Card[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('projects').select('id, created_at, data'),
      supabase.from('strikk_project').select(PROJECT_LIST_SELECT).eq('status', 'in_progress'),
    ]).then(([syRes, strikkRes]) => {
      if (cancelled) return
      const err = syRes.error ?? strikkRes.error
      if (err) { setError(err.message); return }

      const sy: Card[] = ((syRes.data ?? []) as SyProjectRow[])
        .filter(p => p.data.status === 'Aktiv')
        .map(p => ({
          kind: 'sying', id: p.id, name: p.data.name || 'Uten navn',
          imageUrl: p.data.images[0]?.url ?? null, focalX: p.data.focalX ?? 50, focalY: p.data.focalY ?? 50,
          createdAt: p.created_at,
        }))

      const strikk: Card[] = ((strikkRes.data ?? []) as unknown as ProjectListRow[])
        .map(p => ({
          kind: 'strikk', id: p.id, name: p.name || p.strikk_oppskrift?.title || 'Uten navn',
          imageUrl: coverUrl(p), focalX: 50, focalY: 50,
          createdAt: p.created_at,
        }))

      setCards([...sy, ...strikk].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    })
    return () => { cancelled = true }
  }, [])

  function open(card: Card) {
    if (card.kind === 'sying') {
      sessionStorage.setItem('openProjectId', card.id)
      router.push('/dashboard/projects')
    } else {
      router.push(`/strikk/prosjekt/${card.id}?view=pdf`)
    }
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
      <h1 className="font-serif text-4xl sm:text-5xl text-stone-800 mb-2">Pågående prosjekter</h1>
      <p className="text-stone-500 mb-8">Strikk og sying, samlet på ett sted.</p>

      {error && <p className="text-sm text-red-700 mb-4">{error}</p>}
      {cards === null && !error && <p className="text-sm text-stone-500">Laster …</p>}

      {cards !== null && cards.length === 0 && (
        <p className="text-sm text-stone-400">Ingen pågående prosjekter ennå.</p>
      )}

      {cards !== null && cards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {cards.map(card => (
            <button key={`${card.kind}-${card.id}`} onClick={() => open(card)} className="text-left">
              <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden hover:shadow-md transition-shadow h-full flex flex-col">
                <div className="aspect-[3/4] bg-stone-100 relative overflow-hidden">
                  {card.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small remote/public file; next/image would only add a resize step
                    <img src={card.imageUrl} alt="" loading="lazy" decoding="async" draggable={false}
                      className="w-full h-full object-cover"
                      style={{ objectPosition: `${card.focalX}% ${card.focalY}%` }} />
                  ) : null}
                  <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium text-white ${
                    card.kind === 'strikk' ? 'bg-[#2E5339]' : 'bg-[#C9A57A]'
                  }`}>
                    {card.kind === 'strikk' ? 'Strikk' : 'Sying'}
                  </span>
                </div>
                <div className="p-3">
                  <p className="font-serif text-base text-stone-800 truncate">{card.name}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="mt-8">
        <Link href="/dashboard" className="text-sm text-[#8B6340] hover:underline">Til Hjem →</Link>
      </p>
    </div>
  )
}
