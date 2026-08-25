'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { NavIcon } from './_shared/DashboardIcons'

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
  }
}

function fornavn(userName: string) {
  return userName.split(' ')[0]?.trim() || userName
}

export default function DashboardHomePage() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [projects, setProjects] = useState<LandingProject[]>([])
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
    supabase.from('projects').select('id, created_at, data').order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { console.error('[dashboard] henting av prosjekter feilet', error); setLoading(false); return }
        setProjects((data as LandingProject[]) ?? [])
        setLoading(false)
      })
  }, [])

  function openProject(id: string) {
    sessionStorage.setItem('openProjectId', id)
    router.push('/dashboard/projects')
  }

  const aktive = projects.filter(p => p.data.status === 'Aktiv')
  const nyesteAktive = aktive[0]
  // "Fortsett der du slapp": de tre sist opprettede IKKE-fullførte prosjektene —
  // det finnes ingen "sist åpnet"-tidsstempel å sortere på (se docs/prompt-
  // forbedringer), så created_at er nærmeste reelle proxy.
  const fortsett = projects.filter(p => p.data.status !== 'Fullført').slice(0, 3)

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-10">
      <h1 className="font-serif text-4xl sm:text-5xl text-stone-800 mb-2">Hei {fornavn(userName) || 'der'}</h1>
      <p className="text-stone-500 mb-8">Hva vil du jobbe med i dag?</p>

      {!loading && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            {/* Stort kort — Aktive prosjekter */}
            <div className="relative rounded-2xl border border-stone-200 bg-white overflow-hidden min-h-[280px] flex flex-col justify-end">
              {nyesteAktive?.data.images[0]?.url && (
                <img
                  src={nyesteAktive.data.images[0].url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ objectPosition: `${nyesteAktive.data.focalX ?? 50}% ${nyesteAktive.data.focalY ?? 50}%` }}
                />
              )}
              <div className={`relative p-6 ${nyesteAktive?.data.images[0]?.url ? 'bg-gradient-to-t from-white via-white/90 to-transparent pt-20' : ''}`}>
                <div className="w-11 h-11 rounded-full bg-[#F5EFE6] flex items-center justify-center mb-4">
                  <NavIcon name="thread" className="w-5 h-5 text-[#8B6340]" />
                </div>
                <h2 className="font-serif text-2xl text-stone-800 mb-2">Aktive prosjekter</h2>
                <div className="w-10 h-0.5 bg-[#C9A57A] mb-3" />
                <p className="text-sm text-stone-500 mb-4">{aktive.length} aktiv{aktive.length === 1 ? 't' : 'e'} prosjekt{aktive.length === 1 ? '' : 'er'}</p>
                <button
                  onClick={() => nyesteAktive ? openProject(nyesteAktive.id) : router.push('/dashboard/projects?status=Aktiv')}
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
              {fortsett.map(p => (
                <div key={p.id} className="rounded-2xl border border-stone-200 bg-white overflow-hidden flex items-center gap-3 p-3">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-stone-100 flex-shrink-0">
                    {p.data.images[0]?.url ? (
                      <img src={p.data.images[0].url} alt="" className="w-full h-full object-cover"
                        style={{ objectPosition: `${p.data.focalX ?? 50}% ${p.data.focalY ?? 50}%` }} />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-stone-800 text-sm truncate">{p.data.name || 'Uten navn'}</p>
                    {(p.data.recipientName || p.data.size) && (
                      <p className="text-xs text-stone-400 truncate">
                        {[p.data.recipientName && `Til ${p.data.recipientName}`, p.data.size].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <button onClick={() => openProject(p.id)}
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
