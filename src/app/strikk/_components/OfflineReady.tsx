'use client'

import { useEffect, useState } from 'react'
import { hasIndexedDb, idbStore, offlineReady } from '../_lib/offline'
import { OFFLINE_EVENT } from '../_lib/project-bundle'

// Ids of the projects stored on this device with their PDF, ready to open without a network.
export function useOfflineReady(): Set<string> {
  const [ready, setReady] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!hasIndexedDb()) return
    let alive = true
    const read = () => { offlineReady(idbStore).then(s => { if (alive) setReady(s) }).catch(() => undefined) }
    read()
    window.addEventListener(OFFLINE_EVENT, read)
    return () => { alive = false; window.removeEventListener(OFFLINE_EVENT, read) }
  }, [])
  return ready
}

export function OfflineBadge({ className = '' }: { className?: string }) {
  return (
    <span data-offline-badge title="Lagret på enheten: kan åpnes uten nett"
      className={`inline-flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 text-sky-800 text-[11px] px-1.5 py-0.5 ${className}`}>
      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </svg>
      Uten nett
    </span>
  )
}
