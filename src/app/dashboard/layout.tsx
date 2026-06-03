'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

const TABS = [
  { href: '/dashboard/recipes',    label: 'Oppskrifter' },
  { href: '/dashboard/projects',   label: 'Prosjekter' },
  { href: '/dashboard/inventory',  label: 'Lager' },
  { href: '/dashboard/techniques', label: 'Teknikker' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const navRef   = useRef<HTMLElement>(null)

  useEffect(() => {
    const active = navRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [pathname])

  function handleLogout() {
    supabase.auth.signOut().then(() => { window.location.href = '/login' })
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: '#FAF7F4' }}>
      <header className="sticky top-0 z-20 bg-[#FAF7F4] border-b border-stone-200">
        {/* Brand + logout — h-12 = 48px */}
        <div className="flex items-center justify-between px-4 sm:px-8 h-12">
          <Link href="/dashboard">
            <Image src="/logo.png" alt="Søm & Snitt" width={0} height={0} sizes="100vw"
              className="h-10 sm:h-14 w-auto" priority />
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs sm:text-sm text-stone-500 hover:bg-stone-100 rounded-lg transition-colors min-h-[44px]"
          >
            <svg className="w-4 h-4 sm:hidden flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="hidden sm:inline">Logg ut</span>
          </button>
        </div>

        {/* Nav tabs — h-10 = 40px; total header = 88px */}
        <div className="relative border-t border-stone-100">
          <nav
            ref={navRef}
            className="flex overflow-x-auto h-10"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {TABS.map(tab => {
              const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  data-active={String(isActive)}
                  className={`flex-shrink-0 flex items-center px-3 sm:px-7 h-full text-xs sm:text-sm transition-all border-b-2 whitespace-nowrap ${
                    isActive
                      ? 'text-stone-800 border-[#C9A57A] font-semibold'
                      : 'text-stone-400 border-transparent hover:text-stone-600 hover:border-stone-200'
                  }`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </nav>
          {/* Fade indicator — hidden on sm+ where all tabs typically fit */}
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[#FAF7F4] to-transparent sm:hidden" />
        </div>
      </header>

      {children}
    </div>
  )
}
