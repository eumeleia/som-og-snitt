'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const TABS = [
  { href: '/dashboard/recipes',    label: 'Oppskrifter' },
  { href: '/dashboard/projects',   label: 'Prosjekter' },
  { href: '/dashboard/inventory',  label: 'Lager' },
  { href: '/dashboard/techniques', label: 'Teknikker' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  function handleLogout() {
    supabase.auth.signOut().then(() => { window.location.href = '/login' })
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAF7F4' }}>
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-stone-200">
        {/* Brand + logout — h-12 = 48px */}
        <div className="flex items-center justify-between px-4 sm:px-8 h-12">
          <span className="font-serif text-xl sm:text-2xl text-[#3E2E2A] leading-none select-none">
            Søm &amp; Snitt
          </span>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-100 rounded-lg transition-colors min-h-[36px]"
          >
            Logg ut
          </button>
        </div>

        {/* Nav tabs — h-10 = 40px; total header = 88px */}
        <nav
          className="flex overflow-x-auto border-t border-stone-100 h-10"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {TABS.map(tab => {
            const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-shrink-0 flex items-center px-5 sm:px-7 h-full text-sm transition-all border-b-2 whitespace-nowrap ${
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
      </header>

      {children}
    </div>
  )
}
