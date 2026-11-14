'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { NavIcon, type IconName } from './_shared/DashboardIcons'
import { PROJECT_LIST_SELECT, sortByLastOpened, type ProjectListRow } from '@/app/strikk/_lib/projects'
import { coverUrl } from '@/app/strikk/_lib/cover'
import { hasIndexedDb, idbStore } from '@/app/strikk/_lib/offline'
import { OfflineBadge, useOfflineReady } from '@/app/strikk/_components/OfflineReady'

// Hjem: strikk til venstre, sying til høyre. Hver side viser de aktive prosjektene, det
// sist åpnede øverst, og under dem lenkene til den sidens oppskrifter og verktøy.

// Egen, smal spørring: Hjem trenger bare et fåtall felt fra projects, ikke hele
// ProjectData i projects/page.tsx.
interface LandingProject {
  id: string
  created_at: string
  last_opened_at: string | null
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

interface Card {
  id: string
  name: string
  imageUrl: string | null
  objectPosition: string
  details: string | null
  recipe: { name: string; open: () => void } | null
  open: () => void
  // Stored on this device and ready to open without a network.
  offline?: boolean
}

interface ShortcutLink { href: string; icon: IconName; title: string; text: string }

type Side = 'strikk' | 'sy'
// On a phone one side is shown at a time; remembered on this device.
const SIDE_KEY = 'hjem-side'

export default function DashboardHomePage() {
  const router = useRouter()
  const [sying, setSying] = useState<LandingProject[]>([])
  const [strikk, setStrikk] = useState<ProjectListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [side, setSide] = useState<Side>('strikk')
  const offlineIds = useOfflineReady()

  useEffect(() => {
    try {
      // Browser storage can only be read after the first render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(SIDE_KEY) === 'sy') setSide('sy')
    } catch { /* no storage: start on Strikk */ }
  }, [])

  function chooseSide(s: Side) {
    setSide(s)
    try { localStorage.setItem(SIDE_KEY, s) } catch { /* not remembered */ }
  }

  useEffect(() => {
    Promise.all([
      supabase.from('projects').select('id, created_at, last_opened_at, data'),
      supabase.from('strikk_project').select(PROJECT_LIST_SELECT).eq('status', 'in_progress'),
    ]).then(([syRes, strikkRes]) => {
      if (syRes.error) console.error('[dashboard] henting av syprosjekter feilet', syRes.error)
      else setSying((syRes.data as LandingProject[]) ?? [])
      if (strikkRes.error) {
        console.error('[dashboard] henting av strikkeprosjekter feilet', strikkRes.error)
        // Without a network: the projects in progress stored on this device.
        if (hasIndexedDb()) {
          void idbStore.listBundles().then(bundles => setStrikk(bundles.map(b => ({
            ...b.project,
            strikk_oppskrift: b.recipe ? { title: b.recipe.title ?? '', thumbnail_path: b.recipe.thumbnail_path, thumbnail_at: b.recipe.thumbnail_at } : null,
          }) as unknown as ProjectListRow))).catch(() => undefined)
        }
      } else setStrikk((strikkRes.data as unknown as ProjectListRow[]) ?? [])
      setLoading(false)
    })
  }, [])

  function openSyProject(id: string) {
    sessionStorage.setItem('openProjectId', id)
    router.push('/dashboard/projects')
  }

  function openSyRecipe(id: string) {
    sessionStorage.setItem('openRecipeId', id)
    router.push('/dashboard/recipes')
  }

  // A knitting project not opened since «sist åpnet» was recorded counts by its last change.
  const strikkCards: Card[] = sortByLastOpened(strikk, p => p.updated_at).map(p => ({
    id: p.id,
    name: p.name || p.strikk_oppskrift?.title || 'Uten navn',
    imageUrl: coverUrl(p),
    objectPosition: '50% 0%',
    details: [p.strikk_oppskrift?.title && p.strikk_oppskrift.title !== p.name ? p.strikk_oppskrift.title : null, p.size_label].filter(Boolean).join(' · ') || null,
    recipe: null,
    open: () => router.push(`/strikk/prosjekt/${p.id}?view=pdf`),
    offline: offlineIds.has(p.id),
  }))

  const syCards: Card[] = sortByLastOpened(sying.filter(p => p.data.status === 'Aktiv')).map(p => ({
    id: p.id,
    name: p.data.name || 'Uten navn',
    imageUrl: p.data.images?.[0]?.url ?? null,
    objectPosition: `${p.data.focalX ?? 50}% ${p.data.focalY ?? 50}%`,
    details: [p.data.recipientName && `Til ${p.data.recipientName}`, p.data.size].filter(Boolean).join(' · ') || null,
    recipe: p.data.recipeId ? { name: p.data.recipeName || 'Oppskrift', open: () => openSyRecipe(p.data.recipeId!) } : null,
    open: () => openSyProject(p.id),
  }))

  return (
        // Tight on a phone so at least four project cards fit above the fold on an iPhone.
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 pt-3 pb-6 sm:py-10">
      <h1 className="font-serif text-2xl sm:text-5xl text-stone-800 mb-3 sm:mb-2">Hei Maria!</h1>
      <p className="hidden sm:block text-stone-500 mb-8">Hva vil du jobbe med i dag?</p>

      {!loading && (
        <>
        <div role="tablist" aria-label="Strikk eller sying" className="lg:hidden flex gap-1 bg-white rounded-xl p-1 border border-stone-200 shadow-sm mb-3">
          {(['strikk', 'sy'] as const).map(s => (
            <button key={s} role="tab" aria-selected={side === s} onClick={() => chooseSide(s)}
              className={`flex-1 h-9 rounded-lg text-sm font-medium transition-colors ${side === s ? 'bg-stone-800 text-white' : 'text-stone-500'}`}>
              {s === 'strikk' ? 'Strikk' : 'Sying'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-8">
          <Column
            hidden={side !== 'strikk'}
            title="Strikk"
            icon="yarn"
            allHref="/strikk/prosjekter"
            emptyText="Ingen aktive strikkeprosjekter."
            cards={strikkCards}
            links={[
              { href: '/strikk/oppskrifter', icon: 'book', title: 'Strikkeoppskrifter', text: 'Finn en oppskrift og start et prosjekt' },
              { href: '/strikk/garnlager', icon: 'box', title: 'Garnlager', text: 'Garnet du har, og hva du kan strikke av det' },
            ]}
          />
          <Column
            hidden={side !== 'sy'}
            title="Sying"
            icon="scissors"
            allHref="/dashboard/projects"
            emptyText="Ingen aktive syprosjekter."
            cards={syCards}
            links={[
              { href: '/dashboard/embroidery/arranger', icon: 'hoop', title: 'Broderikomposisjon', text: 'Utforsk og sett sammen motiver' },
              { href: '/dashboard/recipes', icon: 'book', title: 'Syoppskrifter', text: 'Finn og lag vakre syprosjekter' },
            ]}
          />
        </div>
        </>
      )}
    </div>
  )
}

function Column({ hidden, title, icon, allHref, emptyText, cards, links }: {
  // Hidden on a phone when the other tab is chosen; both always show on a wide screen.
  hidden: boolean
  title: string
  icon: IconName
  allHref: string
  emptyText: string
  cards: Card[]
  links: ShortcutLink[]
}) {
  const [first, ...rest] = cards
  return (
    <section className={`${hidden ? 'hidden' : 'flex'} lg:flex flex-col gap-2.5 lg:gap-4 min-w-0`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl lg:text-2xl text-stone-800 flex items-center gap-2">
          <NavIcon name={icon} className="w-5 h-5 text-[#8B6340]" />
          {title}
        </h2>
        <Link href={allHref} className="text-sm text-[#8B6340] hover:underline whitespace-nowrap">
          Se alle prosjekter →
        </Link>
      </div>

      {!first && <p className="text-sm text-stone-400">{emptyText}</p>}

      {first && (
        <div className="relative rounded-2xl border border-stone-200 bg-white overflow-hidden min-h-[150px] lg:min-h-[260px] flex flex-col justify-end">
          {first.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a stored photo; next/image would only add a resize step
            <img src={first.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: first.objectPosition }} />
          )}
          <div className={`relative p-3 lg:p-5 ${first.imageUrl ? 'bg-gradient-to-t from-white via-white/90 to-transparent pt-10 lg:pt-20' : ''}`}>
            <p className="text-xs uppercase tracking-wide text-stone-500 mb-0.5 lg:mb-1">Sist åpnet {first.offline && <OfflineBadge className="ml-1 normal-case tracking-normal" />}</p>
            <h3 className="font-serif text-xl lg:text-2xl text-stone-800 break-words">{first.name}</h3>
            {first.details && <p className="text-sm text-stone-500 mt-0.5">{first.details}</p>}
            {first.recipe && (
              <button onClick={first.recipe.open} className="text-sm text-[#C9A57A] hover:text-[#8B6340] hover:underline">
                {first.recipe.name} ↗
              </button>
            )}
            <div>
              <button onClick={first.open}
                className="mt-2 lg:mt-3 inline-flex items-center gap-2 px-4 lg:px-5 py-2 lg:py-2.5 bg-[#C9A57A] text-white text-sm font-medium rounded-xl hover:bg-[#b8946a] transition-colors">
                Fortsett <NavIcon name="chevronRight" className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rest.map(card => (
            <li key={card.id} className="rounded-2xl border border-stone-200 bg-white flex items-center gap-3 p-2 lg:p-3">
              <div className="w-12 h-12 lg:w-14 lg:h-14 rounded-xl overflow-hidden bg-stone-100 flex-shrink-0">
                {card.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a stored photo; next/image would only add a resize step
                  <img src={card.imageUrl} alt="" className="w-full h-full object-cover" style={{ objectPosition: card.objectPosition }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-stone-800 text-sm truncate">{card.name} {card.offline && <OfflineBadge className="ml-1" />}</p>
                {card.details && <p className="text-xs text-stone-400 truncate">{card.details}</p>}
                {card.recipe && (
                  <button onClick={card.recipe.open} className="text-xs text-[#C9A57A] hover:text-[#8B6340] hover:underline truncate block">
                    {card.recipe.name} ↗
                  </button>
                )}
              </div>
              <button onClick={card.open}
                className="flex-shrink-0 px-3 py-1.5 text-xs font-medium border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors whitespace-nowrap">
                Fortsett →
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {links.map(l => (
          <Link key={l.href} href={l.href}
            className="rounded-2xl border border-stone-200 bg-white p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
            <div className="w-10 h-10 rounded-full bg-[#F5EFE6] flex items-center justify-center flex-shrink-0">
              <NavIcon name={l.icon} className="w-5 h-5 text-[#8B6340]" />
            </div>
            <div className="min-w-0">
              <h3 className="font-serif text-lg text-stone-800">{l.title}</h3>
              <p className="text-xs text-stone-500">{l.text}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
