'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

interface DriveStatus { connected: boolean }
interface RestoreResult { gjenopprettet: number; hoppet_over: number; feilet: number; detaljer: string[] }
interface MigrateAnnetResult { oppdatert: number; hoppet_over: number; feilet: number; detaljer: string[] }

function DriveIcon() {
  return (
    <svg viewBox="0 0 87.3 78" className="w-5 h-5" aria-hidden>
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 27h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  )
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const [drive, setDrive] = useState<DriveStatus | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [migratingAnnet, setMigratingAnnet] = useState(false)
  const [migrateAnnetResult, setMigrateAnnetResult] = useState<MigrateAnnetResult | null>(null)
  const [migrateAnnetError, setMigrateAnnetError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/drive/status').then(r => r.json()).then(setDrive)
  }, [])

  async function disconnect() {
    setDisconnecting(true)
    await fetch('/api/drive/disconnect', { method: 'POST' })
    setDrive({ connected: false })
    setDisconnecting(false)
  }

  async function migrateAnnet() {
    setMigratingAnnet(true)
    setMigrateAnnetResult(null)
    setMigrateAnnetError(null)
    try {
      const res = await fetch('/api/storage/migrate-annet-to-drive', { method: 'POST' })
      const json = await res.json() as MigrateAnnetResult & { error?: string }
      if (!res.ok || json.error) { setMigrateAnnetError(json.error ?? 'Ukjent feil'); return }
      setMigrateAnnetResult(json)
    } catch (err) {
      setMigrateAnnetError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setMigratingAnnet(false)
    }
  }

  async function restoreInstructions() {
    setRestoring(true)
    setRestoreResult(null)
    setRestoreError(null)
    try {
      const res = await fetch('/api/storage/restore-instructions', { method: 'POST' })
      const json = await res.json() as RestoreResult & { error?: string }
      if (!res.ok || json.error) { setRestoreError(json.error ?? 'Ukjent feil'); return }
      setRestoreResult(json)
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Ukjent feil')
    } finally {
      setRestoring(false)
    }
  }

  const flash = searchParams.get('drive')

  return (
    <main className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <h1 className="font-serif text-2xl text-stone-800">Innstillinger</h1>

      {flash === 'connected' && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
          Google Drive er nå tilkoblet.
        </div>
      )}
      {(flash === 'error' || flash === 'no_refresh_token') && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {flash === 'no_refresh_token'
            ? 'Ingen refresh-token mottatt — prøv å fjerne Søm og Snitt fra Google-tilganger og koble til på nytt.'
            : 'Noe gikk galt. Prøv igjen.'}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#E8F0FE] flex items-center justify-center flex-shrink-0">
            <DriveIcon />
          </div>
          <div>
            <h2 className="font-medium text-stone-800">Google Drive</h2>
            <p className="text-sm text-stone-500 mt-0.5">
              Mønster-PDF-er lastes opp til Drive-mappen «Søm og Snitt» i stedet for Supabase Storage — sparer lagringsplass.
            </p>
          </div>
        </div>

        {drive === null ? (
          <div className="h-10 bg-stone-50 rounded-xl animate-pulse" />
        ) : drive.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
              Tilkoblet
            </div>
            <button
              onClick={disconnect}
              disabled={disconnecting}
              className="px-4 py-2 text-sm rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-40"
            >
              {disconnecting ? 'Kobler fra…' : 'Koble fra'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-stone-500">
              <span className="w-2 h-2 rounded-full bg-stone-300 flex-shrink-0" />
              Ikke tilkoblet
            </div>
            <a
              href="/api/drive/auth"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors"
            >
              Koble til Google Drive
            </a>
          </div>
        )}
      </section>

      {/* Temporary: migrate existing 'Annet' PDFs to Drive-only storage */}
      <section className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-3">
        <div>
          <h2 className="font-medium text-stone-800">Koble Annet-dokumenter til Drive</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Oppdaterer eksisterende PDF-er av type «Annet» til å peke på Drive i stedet for Supabase. Supabase-filene slettes ikke nå.
          </p>
        </div>
        <button
          onClick={migrateAnnet}
          disabled={migratingAnnet}
          className="px-4 py-2 text-sm rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:opacity-40"
        >
          {migratingAnnet ? 'Oppdaterer…' : 'Koble Annet-dokumenter til Drive'}
        </button>
        {migrateAnnetError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {migrateAnnetError}
          </div>
        )}
        {migrateAnnetResult && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 space-y-1">
            <p>Oppdatert: {migrateAnnetResult.oppdatert} &nbsp;·&nbsp; Hoppet over: {migrateAnnetResult.hoppet_over} &nbsp;·&nbsp; Feilet: {migrateAnnetResult.feilet}</p>
            {migrateAnnetResult.detaljer.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-green-800 max-h-48 overflow-y-auto">
                {migrateAnnetResult.detaljer.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Temporary: restore instruction PDFs accidentally deleted from Supabase during cleanup */}
      <section className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-3">
        <div>
          <h2 className="font-medium text-stone-800">Gjenopprett instruksjoner fra Drive</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            Laster ned Oppskrift- og Annet-PDF-er fra Google Drive-arkivet og gjenoppretter Supabase-arbeidskopiene.
          </p>
        </div>
        <button
          onClick={restoreInstructions}
          disabled={restoring}
          className="px-4 py-2 text-sm rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:opacity-40"
        >
          {restoring ? 'Gjenoppretter…' : 'Gjenopprett instruksjoner'}
        </button>
        {restoreError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {restoreError}
          </div>
        )}
        {restoreResult && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 space-y-1">
            <p>Gjenopprettet: {restoreResult.gjenopprettet} &nbsp;·&nbsp; Hoppet over: {restoreResult.hoppet_over} &nbsp;·&nbsp; Feilet: {restoreResult.feilet}</p>
            {restoreResult.detaljer.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-green-800 max-h-48 overflow-y-auto">
                {restoreResult.detaljer.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsContent />
    </Suspense>
  )
}
