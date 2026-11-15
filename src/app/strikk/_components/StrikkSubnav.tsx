'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { STRIKK_SECTIONS } from '../sections'
import OverviewButton from './OverviewButton'

export default function StrikkSubnav() {
  const pathname = usePathname()
  const nav = useRef<HTMLElement>(null)
  // On a phone the last tab does not fit: scroll the current one into view.
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (el && nav.current) nav.current.scrollLeft = Math.max(0, el.offsetLeft + el.offsetWidth - nav.current.clientWidth)
  }, [pathname])
  return (
    // The button sits outside the scrolling menu, so it is always fully on screen.
    <div className="flex flex-wrap items-center gap-x-1 sm:gap-x-2 border-b border-stone-200 px-2 sm:px-8">
      <nav ref={nav} className="relative flex flex-1 min-w-0 gap-1 overflow-x-auto" aria-label="Strikk">
      {STRIKK_SECTIONS.map(s => {
        const active = pathname === s.href || pathname.startsWith(s.href + '/')
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 px-2 sm:px-3 py-3 text-sm border-b-2 -mb-px transition-colors ${
              active ? 'border-[#8B6340] text-stone-800 font-medium' : 'border-transparent text-stone-500 hover:text-stone-700'
            }`}
          >
            {s.label}
          </Link>
        )
      })}
      </nav>
      <OverviewButton />
    </div>
  )
}
