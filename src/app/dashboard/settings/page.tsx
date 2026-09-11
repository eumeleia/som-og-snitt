'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface DriveStatus { connected: boolean }

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

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-70" />
}

// ── Etterfyll produktnummer — ENGANGSJOBB ────────────────────────────────────
// Backfiller data.produktnummer/data.produktUrl på gamle lagerrader som ble lagt inn før
// kvitteringsimportens del 2 (se docs/kvitteringsimport-2026-09-11.md), og som derfor har
// produktsiden liggende i data.kilde i stedet. Uten produktnummer blir ikke disse radene
// flagget som «finnes fra før» når samme vare kjøpes på nytt via kvitteringsimporten.
// Fjern hele denne seksjonen (typene, funksjonene og komponentene under, og
// <BackfillProduktnummer /> i SettingsContent) når jobben er kjørt og bekreftet.

interface BackfillItem {
  id: string
  data: {
    navn?: string
    kategori?: string
    kilde?: string
    produktnummer?: string
    produktUrl?: string
    [key: string]: unknown
  }
}

type BackfillTilstand =
  | { fase: 'slaarOpp' }
  | { fase: 'bekreftet'; sidenummer: string; produktUrl: string }
  | { fase: 'uavklart'; grunn: string }

interface BackfillGrupper {
  harNummer:  BackfillItem[]
  selfmade:   BackfillItem[]
  annenUrl:   BackfillItem[]
  ikkeUrl:    BackfillItem[]
  tomKilde:   BackfillItem[]
}

// Gjett ALDRI produktnummeret fra slugen alene — den stemmer for de fleste, men ikke for
// alt (en glidelås endte på «-z40743», ikke et rent tall). Halen sendes til
// /api/slaa-opp-vare kun som kvitteringensProduktnummer for variantutledning; selve
// produktnummeret kommer fra JSON-LD (sku/mpn) på siden, aldri fra slugen.
function slugHale(url: string): string {
  try {
    const sti = new URL(url).pathname.replace(/\/+$/, '')
    const siste = sti.split('/').filter(Boolean).pop() ?? ''
    const deler = siste.split('-')
    return deler[deler.length - 1] || 'ukjent'
  } catch {
    return 'ukjent'
  }
}

function grupperForBackfill(rader: BackfillItem[]): BackfillGrupper {
  const harNummer: BackfillItem[] = []
  const selfmade:  BackfillItem[] = []
  const annenUrl:  BackfillItem[] = []
  const ikkeUrl:   BackfillItem[] = []
  const tomKilde:  BackfillItem[] = []

  for (const rad of rader) {
    if (typeof rad.data.produktnummer === 'string' && rad.data.produktnummer.trim()) {
      harNummer.push(rad); continue
    }
    const kilde = typeof rad.data.kilde === 'string' ? rad.data.kilde.trim() : ''
    if (!kilde) { tomKilde.push(rad); continue }
    let url: URL
    try { url = new URL(kilde) } catch { ikkeUrl.push(rad); continue }
    const vert = url.hostname.toLowerCase()
    if (vert === 'selfmade.com' || vert.endsWith('.selfmade.com')) selfmade.push(rad)
    else annenUrl.push(rad)
  }
  return { harNummer, selfmade, annenUrl, ikkeUrl, tomKilde }
}

// Egen liten fetch-hjelper — rører ikke slaOppVare i inventory/page.tsx. kunNummer: true
// hopper over Claude-kallet på fritekstfeltene i ruta, som denne jobben ikke bruker.
async function slaOppKunNummer(kilde: string): Promise<BackfillTilstand> {
  try {
    const res = await fetch('/api/slaa-opp-vare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valgtUrl: kilde, produktnummer: slugHale(kilde), kvitteringsnavn: '', kunNummer: true }),
    })
    const j = await res.json()
    if (j.tilstand === 'funnet' && typeof j.produkt?.sidenummer === 'string' && j.produkt.sidenummer.trim()) {
      return { fase: 'bekreftet', sidenummer: j.produkt.sidenummer, produktUrl: j.produkt.url }
    }
    if (j.tilstand === 'funnet')     return { fase: 'uavklart', grunn: 'siden har ikke et produktnummer (sku/mpn)' }
    if (j.tilstand === 'ikkeFunnet') return { fase: 'uavklart', grunn: 'siden fantes ikke' }
    if (j.tilstand === 'flereTreff') return { fase: 'uavklart', grunn: 'flere treff' }
    return { fase: 'uavklart', grunn: typeof j.melding === 'string' ? j.melding : 'oppslag feilet' }
  } catch (err) {
    return { fase: 'uavklart', grunn: err instanceof Error ? err.message : 'oppslag feilet' }
  }
}

function BackfillRadListe({ tittel, rader, ekstra }: {
  tittel: string
  rader: BackfillItem[]
  ekstra?: (rad: BackfillItem) => string
}) {
  return (
    <details className="border border-stone-200 rounded-xl px-3 py-2">
      <summary className="text-sm text-stone-600 cursor-pointer">{tittel} ({rader.length})</summary>
      {rader.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-stone-500">
          {rader.map(rad => {
            const tillegg = ekstra?.(rad)
            return (
              <li key={rad.id}>
                {rad.data.navn || '(uten navn)'} · {rad.data.kategori || '–'}
                {tillegg ? ` — ${tillegg}` : ''}
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}

function BackfillProduktnummer() {
  const [gruppert, setGruppert]         = useState<BackfillGrupper | null>(null)
  const [tilstander, setTilstander]     = useState<Record<string, BackfillTilstand>>({})
  const [fremdrift, setFremdrift]       = useState<{ gjort: number; totalt: number } | null>(null)
  const [kjorer, setKjorer]             = useState(false)
  const [feilmelding, setFeilmelding]   = useState('')
  const [skriver, setSkriver]           = useState(false)
  const [skrevet, setSkrevet]           = useState(false)
  const [skriveMelding, setSkriveMelding] = useState('')

  async function kjorTorrt() {
    setKjorer(true); setFeilmelding(''); setSkriveMelding(''); setSkrevet(false); setTilstander({})
    const { data, error } = await supabase.from('inventory').select('*')
    if (error) {
      setFeilmelding(error.message)
      setKjorer(false)
      return
    }
    const g = grupperForBackfill((data ?? []) as BackfillItem[])
    setGruppert(g)
    setFremdrift({ gjort: 0, totalt: g.selfmade.length })
    for (let i = 0; i < g.selfmade.length; i++) {
      const rad = g.selfmade[i]
      setTilstander(prev => ({ ...prev, [rad.id]: { fase: 'slaarOpp' } }))
      const tilstand = await slaOppKunNummer(rad.data.kilde ?? '')
      setTilstander(prev => ({ ...prev, [rad.id]: tilstand }))
      setFremdrift({ gjort: i + 1, totalt: g.selfmade.length })
    }
    setKjorer(false)
  }

  async function skrivTilLageret() {
    if (!gruppert) return
    const bekreftede = gruppert.selfmade.filter(r => tilstander[r.id]?.fase === 'bekreftet')
    setSkriver(true)
    for (const rad of bekreftede) {
      const t = tilstander[rad.id]
      if (t.fase !== 'bekreftet') continue
      await supabase.from('inventory')
        .update({ data: { ...rad.data, produktnummer: t.sidenummer, produktUrl: t.produktUrl } })
        .eq('id', rad.id)
    }
    setSkriver(false)
    setSkrevet(true)
    setSkriveMelding(`Skrev produktnummer til ${bekreftede.length} ${bekreftede.length === 1 ? 'vare' : 'varer'}.`)
  }

  const bekreftetRader = gruppert ? gruppert.selfmade.filter(r => tilstander[r.id]?.fase === 'bekreftet') : []
  const uavklartCount  = gruppert ? gruppert.selfmade.filter(r => tilstander[r.id]?.fase === 'uavklart').length : 0

  function tilstandTekst(rad: BackfillItem): string {
    const t = tilstander[rad.id]
    if (!t) return kjorer ? 'venter…' : ''
    if (t.fase === 'slaarOpp')  return 'slår opp…'
    if (t.fase === 'bekreftet') return `bekreftet: ${t.sidenummer}`
    return `uavklart — ${t.grunn}`
  }

  return (
    <section className="bg-white rounded-2xl border border-stone-100 p-5 shadow-sm space-y-4">
      <div>
        <h2 className="font-medium text-stone-800">Etterfyll produktnummer</h2>
        <p className="text-sm text-stone-500 mt-0.5">
          Engangsjobb: slår opp produktnummer for gamle lagerrader som har produktsiden
          liggende i kilde, men mangler produktnummer. Tørrkjøringen skriver ingenting —
          «Skriv til lageret» dukker opp når rapporten står klar.
        </p>
      </div>

      <button
        onClick={kjorTorrt}
        disabled={kjorer}
        className="px-4 py-2 text-sm rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors disabled:opacity-40"
      >
        {kjorer ? 'Slår opp…' : 'Tørrkjør'}
      </button>

      {feilmelding && <p className="text-xs text-red-500">{feilmelding}</p>}

      {fremdrift && kjorer && (
        <p className="text-xs text-stone-400 inline-flex items-center gap-1.5">
          <Spinner /> Slår opp {fremdrift.gjort} av {fremdrift.totalt}…
        </p>
      )}

      {gruppert && !kjorer && (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">
            Bekreftet: {bekreftetRader.length} · Uavklart: {uavklartCount} · Hoppet over:
            annen URL {gruppert.annenUrl.length}, ikke URL {gruppert.ikkeUrl.length}, tom kilde {gruppert.tomKilde.length}
          </p>

          <BackfillRadListe tittel="Har nummer fra før" rader={gruppert.harNummer} />
          <BackfillRadListe tittel="Selfmade-URL i kilde" rader={gruppert.selfmade} ekstra={tilstandTekst} />
          <BackfillRadListe tittel="Annen URL i kilde" rader={gruppert.annenUrl} />
          <BackfillRadListe tittel="Tekst i kilde som ikke er en URL" rader={gruppert.ikkeUrl} />
          <BackfillRadListe tittel="Tom kilde" rader={gruppert.tomKilde} />

          {bekreftetRader.length > 0 && !skrevet && (
            <button
              onClick={skrivTilLageret}
              disabled={skriver}
              className="px-4 py-2 text-sm rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-40"
            >
              {skriver ? 'Skriver…' : `Skriv til lageret (${bekreftetRader.length})`}
            </button>
          )}
          {skriveMelding && <p className="text-sm text-green-700">{skriveMelding}</p>}
        </div>
      )}
    </section>
  )
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const [drive, setDrive] = useState<DriveStatus | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [kvitteringsmappeUrl, setKvitteringsmappeUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/drive/status').then(r => r.json()).then(setDrive)
  }, [])

  useEffect(() => {
    if (!drive?.connected) return
    // getOrCreateSubfolder er idempotent — trygt å kalle hver gang siden lastes.
    // Feiler dette, vises bare ingen lenke; det er en snarvei, ikke en kritisk funksjon.
    fetch('/api/drive/ensure-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName: 'Kvitteringer' }),
    })
      .then(r => r.json())
      .then((j: { folderId?: string }) => {
        if (j.folderId) setKvitteringsmappeUrl(`https://drive.google.com/drive/folders/${j.folderId}`)
      })
      .catch(err => console.error('[Innstillinger] Fant ikke kvitteringsmappe:', err))
  }, [drive?.connected])

  async function disconnect() {
    setDisconnecting(true)
    await fetch('/api/drive/disconnect', { method: 'POST' })
    setDrive({ connected: false })
    setKvitteringsmappeUrl(null)
    setDisconnecting(false)
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
            {kvitteringsmappeUrl && (
              <a
                href={kvitteringsmappeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-stone-500 hover:text-stone-700 underline underline-offset-2"
              >
                Åpne kvitteringsmappen i Drive
              </a>
            )}
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

      <BackfillProduktnummer />
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
