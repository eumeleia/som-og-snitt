'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { PIN_EVENT, savePin, type PinKind } from '@/lib/menu-pin'

// «Fest til meny» / «Løsne fra meny» for one project. Pinning replaces the earlier pin
// of the same kind.
export function usePinState(kind: PinKind, projectId: string) {
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const read = () => {
      void supabase.from('menu_pin').select('project_id').eq('kind', kind).maybeSingle()
        .then(({ data }) => { if (alive) setPinned(data?.project_id === projectId) })
    }
    read()
    window.addEventListener(PIN_EVENT, read)
    return () => { alive = false; window.removeEventListener(PIN_EVENT, read) }
  }, [kind, projectId])

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      await savePin(kind, pinned ? null : projectId)
      setPinned(!pinned)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Klarte ikke lagre')
    } finally {
      setBusy(false)
    }
  }

  return { pinned, busy, error, toggle, label: pinned ? 'Løsne fra meny' : 'Fest til meny' }
}

export function PinToMenuButton({ kind, projectId, className }: { kind: PinKind; projectId: string; className?: string }) {
  const { busy, error, toggle, label } = usePinState(kind, projectId)
  return (
    <span className="inline-flex flex-col items-end">
      <button onClick={toggle} disabled={busy} className={className}>{label}</button>
      {error && <span role="alert" className="text-xs text-red-500 max-w-[16rem] text-right">{error}</span>}
    </span>
  )
}
