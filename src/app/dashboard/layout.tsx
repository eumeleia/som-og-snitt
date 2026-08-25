'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { NavIcon } from './_shared/DashboardIcons'
import { SidebarContent } from './_shared/DashboardNav'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const menuRef = useRef<HTMLDivElement>(null)

  const [userName, setUserName]     = useState<string>('Min konto')
  const [menuOpen, setMenuOpen]     = useState(false)
  // Persistent sidebar på desktop (lg+), overlegg på mobil — se DashboardNav.tsx.
  // Uavhengige tilstander: mobileOpen styrer bare overlegget (skjult over lg via
  // lg:hidden på selve elementet), desktopOpen bare den faste kolonnen (skjult
  // under lg). Hamburgerknappen i toppfeltet setter alltid begge til true —
  // riktig variant vises uansett fordi CSS-en over skjuler den andre.
  const [mobileOpen, setMobileOpen]   = useState(false)
  const [desktopOpen, setDesktopOpen] = useState(true)

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

  function closeMenus() { setMobileOpen(false) }

  return (
    <div className="min-h-screen overflow-x-hidden flex" style={{ backgroundColor: '#FAF7F4' }}>
      {/* Desktop persistent sidebar */}
      {desktopOpen && (
        <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:flex-shrink-0 lg:sticky lg:top-0 lg:h-screen border-r border-stone-200">
          <SidebarContent userName={userName} onNavigate={() => {}} onClose={() => setDesktopOpen(false)} />
        </aside>
      )}

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 max-w-[85vw] z-50 bg-[#FAF7F4] border-r border-stone-200 lg:hidden">
            <SidebarContent userName={userName} onNavigate={closeMenus} onClose={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="relative sticky top-0 z-20 bg-[#FAF7F4] border-b border-stone-200 h-[88px] flex-shrink-0">
          <div className="flex items-center justify-between h-full px-4 sm:px-8">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMobileOpen(true)}
                aria-label="Åpne sidemeny"
                className="lg:hidden p-2 -ml-2 text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
              >
                <NavIcon name="menu" className="w-6 h-6" />
              </button>
              {!desktopOpen && (
                <button
                  onClick={() => setDesktopOpen(true)}
                  aria-label="Åpne sidemeny"
                  className="hidden lg:flex p-2 -ml-2 text-stone-600 hover:bg-stone-100 rounded-lg transition-colors"
                >
                  <NavIcon name="menu" className="w-6 h-6" />
                </button>
              )}
              <Link href="/dashboard" className="hidden lg:block ml-1">
                <Image src="/logo.png" alt="Søm & Snitt" width={0} height={0} sizes="100vw"
                  className="h-10 w-auto" priority />
              </Link>
            </div>

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

          {/* Mobil: logo sentrert uavhengig av hamburger/kontomeny-bredden på sidene */}
          <Link href="/dashboard" className="lg:hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Image src="/logo.png" alt="Søm & Snitt" width={0} height={0} sizes="100vw"
              className="h-10 w-auto" priority />
          </Link>
        </header>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  )
}
