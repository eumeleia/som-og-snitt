'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const TABS = [
  { href: '/dashboard/recipes',    label: 'Oppskrifter' },
  { href: '/dashboard/projects',   label: 'Prosjekter' },
  { href: '/dashboard/embroidery', label: 'Broderi' },
  { href: '/dashboard/techniques', label: 'Teknikker' },
  { href: '/dashboard/inventory',  label: 'Lager' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const navRef    = useRef<HTMLElement>(null)
  const menuRef   = useRef<HTMLDivElement>(null)

  const [userName, setUserName] = useState<string>('Min konto')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const active = navRef.current?.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [pathname])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user
      if (!user) return
      const fullName: string = user.user_metadata?.full_name ?? user.user_metadata?.name ?? ''
      const firstName = fullName.split(' ')[0].trim()
      if (firstName) { setUserName(firstName); return }
      const emailPrefix = user.email?.split('@')[0] ?? ''
      if (emailPrefix) setUserName(emailPrefix)
    })
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [menuOpen])

  function handleLogout() {
    supabase.auth.signOut().then(() => { window.location.href = '/login' })
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: '#FAF7F4' }}>
      <header className="sticky top-0 z-20 bg-[#FAF7F4] border-b border-stone-200">
        {/* Brand + account menu — h-12 = 48px */}
        <div className="flex items-center justify-between px-4 sm:px-8 h-12">
          <Link href="/dashboard">
            <Image src="/logo.png" alt="Søm & Snitt" width={0} height={0} sizes="100vw"
              className="h-10 sm:h-14 w-auto" priority />
          </Link>

          {/* Account dropdown */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs sm:text-sm text-stone-500 hover:bg-stone-100 rounded-lg transition-colors min-h-[44px]"
            >
              {/* Person icon — shown on mobile in place of name */}
              <svg className="w-4 h-4 sm:hidden flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="hidden sm:inline">{userName}</span>
              <svg className="w-3 h-3 flex-shrink-0 transition-transform duration-150"
                style={{ transform: menuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-stone-200 shadow-lg py-1 z-30">
                <Link
                  href="/dashboard/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                >
                  Innstillinger
                </Link>
                <div className="border-t border-stone-100 my-1" />
                <button
                  onClick={() => { setMenuOpen(false); handleLogout() }}
                  className="w-full text-left flex items-center px-4 py-2.5 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                >
                  Logg ut
                </button>
              </div>
            )}
          </div>
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
