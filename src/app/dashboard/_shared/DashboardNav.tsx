'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { NavIcon, type IconName } from './DashboardIcons'

interface NavLeaf {
  label: string
  href: string
  icon?: IconName
  // Nøkkel/verdi i søkestrengen som gjør akkurat DENNE undermenylenken aktiv —
  // for Prosjekter (status) og Lager (kategori), som styrer fane via URL i stedet
  // for egen rute. Path-baserte undersider (Broderi) trenger ikke dette.
  activeQuery?: { key: string; value: string }
}

interface NavSection {
  label: string
  icon: IconName
  href?: string
  children?: NavLeaf[]
}

// Rekkefølge og struktur følger _prosjekter.png (presedens), med Broderi/Teknikker/
// Prosjekter-undermenyene avklart mot sidemenu1/sidemenu2 og brukeren direkte:
// Teknikker er flat (prosjekter.png sitt "Teknikker"-underpunkt er en tegnefeil),
// Prosjekter har en undermeny (kun vist i sidemenu2, men bekreftet ønsket av brukeren),
// og Broderi har tre underpunkter inkludert Bilde til broderi (bekreftet).
const MENU: NavSection[] = [
  { label: 'Hjem', icon: 'home', href: '/dashboard' },
  { label: 'Oppskrifter', icon: 'book', href: '/dashboard/recipes' },
  {
    label: 'Prosjekter', icon: 'folder', href: '/dashboard/projects',
    children: [
      { label: 'Planlagt', href: '/dashboard/projects?status=Planlagt', activeQuery: { key: 'status', value: 'Planlagt' } },
      { label: 'Aktiv',    href: '/dashboard/projects?status=Aktiv',    activeQuery: { key: 'status', value: 'Aktiv' } },
      { label: 'Fullført', href: '/dashboard/projects?status=Fullført', activeQuery: { key: 'status', value: 'Fullført' } },
    ],
  },
  {
    label: 'Broderi', icon: 'thread', href: '/dashboard/embroidery',
    children: [
      { label: 'Mine motiver',        href: '/dashboard/embroidery',                    icon: 'leaf' },
      { label: 'Broderikomposisjon',  href: '/dashboard/embroidery/arranger',            icon: 'hoop' },
      { label: 'Bilde til broderi',   href: '/dashboard/embroidery/bilde-til-broderi',   icon: 'photo' },
    ],
  },
  { label: 'Teknikker', icon: 'scissors', href: '/dashboard/techniques' },
  {
    label: 'Lager', icon: 'box', href: '/dashboard/inventory',
    children: [
      { label: 'Stoff',    href: '/dashboard/inventory?kategori=Stoff',    icon: 'fabric', activeQuery: { key: 'kategori', value: 'Stoff' } },
      { label: 'Tilbehør', href: '/dashboard/inventory?kategori=Tilbehør', icon: 'button', activeQuery: { key: 'kategori', value: 'Tilbehør' } },
      { label: 'Utstyr',   href: '/dashboard/inventory?kategori=Utstyr',   icon: 'sewingfoot', activeQuery: { key: 'kategori', value: 'Utstyr' } },
    ],
  },
]

function isSectionActive(section: NavSection, pathname: string): boolean {
  if (!section.href) return false
  if (section.href === '/dashboard') return pathname === '/dashboard'
  return pathname === section.href || pathname.startsWith(section.href + '/')
}

// Leser søkestrengen for å utheve riktig undermenypunkt (Prosjekter/Lager) — egen,
// liten komponent slik at bare DENNE pakkes i Suspense (useSearchParams krever det
// ved statisk prerendering, se node_modules/next/dist/docs sin use-search-params.md).
function ActiveQuery({ render }: { render: (search: URLSearchParams) => React.ReactNode }) {
  const searchParams = useSearchParams()
  return <>{render(searchParams)}</>
}

function NavRow({ section, isActive, isOpen, onToggle, onNavigate, search }: {
  section: NavSection
  isActive: boolean
  isOpen: boolean
  onToggle: () => void
  onNavigate: () => void
  search: URLSearchParams | null
}) {
  const hasChildren = !!section.children?.length
  return (
    <div>
      <div className={`flex items-center rounded-xl transition-colors ${isActive ? 'bg-[#F5EFE6] text-stone-800' : 'text-stone-600 hover:bg-stone-100'}`}>
        <Link
          href={section.href ?? '#'}
          onClick={onNavigate}
          className="flex-1 flex items-center gap-3 px-3 py-2.5 min-w-0"
        >
          <NavIcon name={section.icon} className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium truncate">{section.label}</span>
        </Link>
        {hasChildren && (
          <button
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Skjul' : 'Vis'} undermeny for ${section.label}`}
            className="px-2.5 py-2.5 text-stone-400 hover:text-stone-600 flex-shrink-0"
          >
            <NavIcon name="chevronDown" className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {hasChildren && isOpen && (
        <div className="mt-0.5 ml-4 pl-4 border-l border-stone-200 space-y-0.5">
          {section.children!.map(leaf => {
            const leafActive = leaf.activeQuery
              ? search?.get(leaf.activeQuery.key) === leaf.activeQuery.value
              : false
            return (
              <Link
                key={leaf.href}
                href={leaf.href}
                onClick={onNavigate}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  leafActive ? 'bg-[#F5EFE6] text-stone-800 font-medium' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700'
                }`}
              >
                {leaf.icon && <NavIcon name={leaf.icon} className="w-4 h-4 flex-shrink-0" />}
                <span className="truncate">{leaf.label}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SidebarContent({ onNavigate, onClose, userName }: {
  onNavigate: () => void
  onClose: () => void
  userName: string
}) {
  const pathname = usePathname()
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})

  function isOpen(section: NavSection) {
    if (section.label in manualOpen) return manualOpen[section.label]
    return isSectionActive(section, pathname)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-[88px] flex-shrink-0 border-b border-stone-200">
        <button onClick={onClose} aria-label="Lukk sidemeny" className="p-2 -ml-2 text-stone-500 hover:text-stone-700">
          <NavIcon name="close" className="w-5 h-5" />
        </button>
        <span className="font-serif text-xl text-stone-800">Søm &amp; Snitt</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <Suspense fallback={
          MENU.map(section => (
            <NavRow key={section.label} section={section} isActive={isSectionActive(section, pathname)}
              isOpen={isOpen(section)} onToggle={() => setManualOpen(m => ({ ...m, [section.label]: !isOpen(section) }))}
              onNavigate={onNavigate} search={null} />
          ))
        }>
          <ActiveQuery render={search => (
            <>
              {MENU.map(section => (
                <NavRow key={section.label} section={section} isActive={isSectionActive(section, pathname)}
                  isOpen={isOpen(section)} onToggle={() => setManualOpen(m => ({ ...m, [section.label]: !isOpen(section) }))}
                  onNavigate={onNavigate} search={search} />
              ))}
            </>
          )} />
        </Suspense>
      </nav>

      <div className="flex-shrink-0 border-t border-stone-200 p-3 space-y-1">
        <Link href="/dashboard/settings" onClick={onNavigate}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            pathname === '/dashboard/settings' ? 'bg-[#F5EFE6] text-stone-800' : 'text-stone-600 hover:bg-stone-100'
          }`}>
          <NavIcon name="gear" className="w-5 h-5 flex-shrink-0" />
          Innstillinger
        </Link>
        <Link href="/dashboard/settings" onClick={onNavigate}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-stone-100 transition-colors">
          <div className="w-8 h-8 rounded-full bg-[#C9A57A] text-white flex items-center justify-center text-xs font-medium flex-shrink-0">
            {userName.slice(0, 1).toUpperCase()}
          </div>
          <span className="text-sm text-stone-700 truncate flex-1 min-w-0">{userName}</span>
          <NavIcon name="chevronRight" className="w-4 h-4 text-stone-300 flex-shrink-0" />
        </Link>
      </div>
    </div>
  )
}
