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

  return (
    <div className="flex items-center gap-2 shrink-0 ml-auto py-2">
      {result && !busy && (
        <span className={`text-xs ${result.ok ? 'hidden sm:inline text-stone-500' : 'text-red-700'}`}>{result.message}</span>
      )}
      <button
        disabled={busy}
        onClick={async () => { setBusy(true); try { await refreshOverview(true) } finally { setBusy(false) } }}
        className="h-9 px-3 rounded-full border border-stone-300 bg-white text-sm text-stone-700 whitespace-nowrap disabled:opacity-50"
      >
        {busy ? 'Skriver regnearket …' : 'Oppdater regnearket nå'}
      </button>
    </div>
  )
}
