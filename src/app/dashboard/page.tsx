'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { NavIcon } from './_shared/DashboardIcons'
import { PROJECT_LIST_SELECT, type ProjectListRow } from '@/app/strikk/_lib/projects'
import { coverUrl } from '@/app/strikk/_lib/cover'

// Egen, smal spørring — landingssiden trenger bare et fåtall felt fra projects,
// ikke hele ProjectData i projects/page.tsx.
interface LandingProject {
  id: string
  created_at: string
  data: {
    name: string
    status: 'Aktiv' | 'Planlagt' | 'Fullført'
    images: { url: string }[]
    focalX?: number
    focalY?: number
    recipientName?: string
    size?: string
    recipeId?: string
    recipeName?: string
  }
}

// Sy- og strikkeprosjekter vist side om side her, med et merke som sier hvilket.
interface SyCard {
  kind: 'sy'
  id: string
  createdAt: string
  name: string
  imageUrl: string | null
  focalX: number
  focalY: number
  recipientName?: string
  size?: string
  recipeId?: string
  recipeName?: string
}
interface StrikkCard {
  kind: 'strikk'
  id: string
  createdAt: string
  name: string
  imageUrl: string | null
}
type Card = SyCard | StrikkCard

const BADGE_STYLE: Record<Card['kind'], string> = { strikk: 'bg-[#2E5339]', sy: 'bg-[#C9A57A]' }
const BADGE_LABEL: Record<Card['kind'], string> = { strikk: 'Strikk', sy: 'Sying' }

function Badge({ kind }: { kind: Card['kind'] }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white ${BADGE_STYLE[kind]}`}>
      {BADGE_LABEL[kind]}
    </span>
  )
}

function fornavn(userName: string) {
  return userName.split(' ')[0]?.trim() || userName
}

export default function DashboardHomePage() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [projects, setProjects] = useState<LandingProject[]>([])
  const [strikkProjects, setStrikkProjects] = useState<ProjectListRow[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user
      if (!user) return
      const fullName: string = user.user_metadata?.full_name ?? user.user_metadata?.name ?? ''
      if (fullName.trim()) { setUserName(fullName.trim()); return }
      const emailPrefix = user.email?.split('@')[0] ?? ''
      if (emailPrefix) setUserName(emailPrefix)
    })
  }, [])

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id, created_at, data').order('created_at', { ascending: false }),
      supabase.from('strikk_project').select(PROJECT_LIST_SELECT).eq('status', 'in_progress'),
    ]).then(([syRes, strikkRes]) => {
      if (syRes.error) console.error('[dashboard] henting av prosjekter feilet', syRes.error)
      else setProjects((syRes.data as LandingProject[]) ?? [])
      if (strikkRes.error) console.error('[dashboard] henting av strikkeprosjekter feilet', strikkRes.error)
      else setStrikkProjects((strikkRes.data as unknown as ProjectListRow[]) ?? [])
      setLoading(false)
    })
  }, [])

  function openProject(id: string) {
    sessionStorage.setItem('openProjectId', id)
    router.push('/dashboard/projects')
  }

  function openRecipe(id: string) {
    sessionStorage.setItem('openRecipeId', id)
    router.push('/dashboard/recipes')
  }

  function openCard(card: Card) {
    if (card.kind === 'sy') openProject(card.id)
    else router.push(`/strikk/prosjekt/${card.id}?view=pdf`)
  }

  const strikkOngoing: StrikkCard[] = strikkProjects.map(p => ({
    kind: 'strikk', id: p.id, createdAt: p.created_at,
    name: p.name || p.strikk_oppskrift?.title || 'Uten navn', imageUrl: coverUrl(p),
  }))
  const syOngoing: SyCard[] = projects.filter(p => p.data.status === 'Aktiv').map(p => ({
    kind: 'sy', id: p.id, createdAt: p.created_at, name: p.data.name || 'Uten navn',
    imageUrl: p.data.images[0]?.url ?? null, focalX: p.data.focalX ?? 50, focalY: p.data.focalY ?? 50,
    recipientName: p.data.recipientName, size: p.data.size, recipeId: p.data.recipeId, recipeName: p.data.recipeName,
  }))
  // Pågående fra begge, nyeste først: skjæringspunktet mellom strikk og sy sin "Aktiv".
  const ongoing: Card[] = [...syOngoing, ...strikkOngoing].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const nyesteAktive = ongoing[0]
  // "Fortsett der du slapp": syprosjekter som ikke er fullført (som før), pluss
  // pågående strikkeprosjekter, nyeste først — ingen "sist åpnet"-tidsstempel å sortere
  // på (se docs/prompt-forbedringer), så created_at er nærmeste reelle proxy.
  const syIkkeFullfort: SyCard[] = projects.filter(p => p.data.status !== 'Fullført').map(p => ({
    kind: 'sy', id: p.id, createdAt: p.created_at, name: p.data.name || 'Uten navn',
    imageUrl: p.data.images[0]?.url ?? null, focalX: p.data.focalX ?? 50, focalY: p.data.focalY ?? 50,
    recipientName: p.data.recipientName, size: p.data.size, recipeId: p.data.recipeId, recipeName: p.data.recipeName,
  }))
  const fortsett: Card[] = [...syIkkeFullfort, ...strikkOngoing].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3)

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
      <h1 className="font-serif text-4xl sm:text-5xl text-stone-800 mb-2">Hei {fornavn(userName) || 'der'}</h1>
      <p className="text-stone-500 mb-8">Hva vil du jobbe med i dag?</p>

      {!loading && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            {/* Stort kort — pågående prosjekter, strikk og sy */}
            <div className="relative rounded-2xl border border-stone-200 bg-white overflow-hidden min-h-[280px] flex flex-col justify-end">
              {nyesteAktive?.imageUrl && (
                <img
                  src={nyesteAktive.imageUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ objectPosition: nyesteAktive.kind === 'sy' ? `${nyesteAktive.focalX}% ${nyesteAktive.focalY}%` : '50% 50%' }}
                />
              )}
              <div className={`relative p-6 ${nyesteAktive?.imageUrl ? 'bg-gradient-to-t from-white via-white/90 to-transparent pt-20' : ''}`}>
                <div className="w-11 h-11 rounded-full bg-[#F5EFE6] flex items-center justify-center mb-4">
                  <NavIcon name="thread" className="w-5 h-5 text-[#8B6340]" />
                </div>
                <h2 className="font-serif text-2xl text-stone-800 mb-2">Pågående prosjekter</h2>
                <div className="w-10 h-0.5 bg-[#C9A57A] mb-3" />
                <p className="text-sm text-stone-500 mb-4">{ongoing.length} pågående prosjekt{ongoing.length === 1 ? '' : 'er'}</p>
                <button
                  onClick={() => nyesteAktive ? openCard(nyesteAktive) : router.push('/dashboard/projects?status=Aktiv')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#C9A57A] text-white text-sm font-medium rounded-xl hover:bg-[#b8946a] transition-colors"
                >
                  Fortsett <NavIcon name="chevronRight" className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <Link href="/dashboard/embroidery/arranger"
                className="rounded-2xl border border-stone-200 bg-white p-5 flex items-center gap-4 hover:shadow-sm transition-shadow">
                <div className="w-11 h-11 rounded-full bg-[#F5EFE6] flex items-center justify-center flex-shrink-0">
                  <NavIcon name="hoop" className="w-5 h-5 text-[#8B6340]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-serif text-lg text-stone-800">Broderikomposisjon</h3>
                  <p className="text-sm text-stone-500">Utforsk og sett sammen motiver</p>
                </div>
                <NavIcon name="chevronRight" className="w-4 h-4 text-stone-300 flex-shrink-0 ml-auto" />
              </Link>
              <Link href="/dashboard/recipes"
                className="rounded-2xl border border-stone-200 bg-white p-5 flex items-center gap-4 hover:shadow-sm transition-shadow">
                <div className="w-11 h-11 rounded-full bg-[#F5EFE6] flex items-center justify-center flex-shrink-0">
                  <NavIcon name="book" className="w-5 h-5 text-[#8B6340]" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-serif text-lg text-stone-800">Oppskrifter</h3>
                  <p className="text-sm text-stone-500">Finn og lag vakre syprosjekter</p>
                </div>
                <NavIcon name="chevronRight" className="w-4 h-4 text-stone-300 flex-shrink-0 ml-auto" />
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <h2 className="font-serif text-2xl text-stone-800">Fortsett der du slapp</h2>
            <Link href="/dashboard/projects" className="text-sm text-[#8B6340] hover:underline whitespace-nowrap">
              Se alle prosjekter →
            </Link>
          </div>

          {fortsett.length === 0 ? (
            <p className="text-sm text-stone-400">Ingen prosjekter ennå.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {fortsett.map(card => (
                <div key={`${card.kind}-${card.id}`} className="rounded-2xl border border-stone-200 bg-white overflow-hidden flex items-center gap-3 p-3">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-stone-100 flex-shrink-0 relative">
                    {card.imageUrl ? (
                      <img src={card.imageUrl} alt="" className="w-full h-full object-cover"
                        style={{ objectPosition: card.kind === 'sy' ? `${card.focalX}% ${card.focalY}%` : '50% 50%' }} />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5"><Badge kind={card.kind} /></div>
                    <p className="font-medium text-stone-800 text-sm truncate">{card.name}</p>
                    {card.kind === 'sy' && (card.recipientName || card.size) && (
                      <p className="text-xs text-stone-400 truncate">
                        {[card.recipientName && `Til ${card.recipientName}`, card.size].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {card.kind === 'sy' && card.recipeId && (
                      <button
                        onClick={e => { e.stopPropagation(); openRecipe(card.recipeId!) }}
                        className="text-xs text-[#C9A57A] hover:text-[#8B6340] hover:underline transition-colors truncate block"
                      >
                        {card.recipeName || 'Oppskrift'} ↗
                      </button>
                    )}
                  </div>
                  <button onClick={() => openCard(card)}
                    className="flex-shrink-0 px-3 py-1.5 text-xs font-medium border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors whitespace-nowrap">
                    Fortsett →
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
