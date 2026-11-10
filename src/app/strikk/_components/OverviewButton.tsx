'use client'

import { useEffect, useState } from 'react'
import { onOverviewResult, refreshOverview, refreshOverviewOnOpen, type OverviewResult } from '../_lib/overview-client'

export default function OverviewButton() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<OverviewResult | null>(null)

  useEffect(() => {
    const off = onOverviewResult(setResult)
    refreshOverviewOnOpen()
    return off
  }, [])

  // On a phone the button is short and a message gets its own line under the menu.
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); try { await refreshOverview(true) } finally { setBusy(false) } }}
        aria-label="Oppdater regnearket nå"
        className="shrink-0 my-2 h-9 px-3 rounded-full border border-stone-300 bg-white text-sm text-stone-700 whitespace-nowrap disabled:opacity-50 sm:order-last"
      >
        {busy ? 'Skriver …' : <><span className="sm:hidden">↻ Regneark</span><span className="hidden sm:inline">Oppdater regnearket nå</span></>}
      </button>
      {result && !busy && (
        <span className={`basis-full sm:basis-auto pb-2 sm:pb-0 text-xs ${result.ok ? 'hidden sm:inline text-stone-500' : 'text-red-700'}`}>{result.message}</span>
      )}
    </>
  )
}
