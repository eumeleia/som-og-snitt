'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { STRIKK_SECTIONS } from '../sections'
import OverviewButton from './OverviewButton'

export default function StrikkSubnav() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-stone-200 px-4 sm:px-8" aria-label="Strikk">
      {STRIKK_SECTIONS.map(s => {
        const active = pathname === s.href || pathname.startsWith(s.href + '/')
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 px-3 py-3 text-sm border-b-2 -mb-px transition-colors ${
              active ? 'border-[#8B6340] text-stone-800 font-medium' : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            {s.label}
          </Link>
        )
      })}
      <OverviewButton />
    </nav>
  )
}
