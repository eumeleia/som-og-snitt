'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { describeError, type ErrorDetails } from '@/lib/error-details'
import { ErrorDetailsView } from '@/components/ErrorDetailsView'

// ── Types ──────────────────────────────────────────────────────────────────────
// Motiv-formen speiler kun de feltene arrangeringsverktøyet trenger fra det
// eksisterende biblioteket på /dashboard/embroidery — se `embroidery`-tabellen.

interface EmbroiderySize {
  id: string
  sizeLabel: string
  pesUrl: string
  pesFilename: string
  widthMm?: number
  heightMm?: number
}

interface EmbroideryData {
  navn: string
  coverImage: string
  bmpPreview: string
  customImage: string
  useCustomImage: boolean
  sizes: EmbroiderySize[]
}

interface Embroidery {
  id: string
  created_at: string
  data: EmbroideryData
}

interface BroderiBbox {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

interface BroderiBlokk {
  farge_hex: string
  tradnavn: string | null
  sting: [number, number][]
  antall_sting: number
  bbox: BroderiBbox
}

interface BroderiMotivData {
  enhet: string
  bbox: BroderiBbox | null
  total_sting: number
  blokker: BroderiBlokk[]
}

const RAMME_MM = 100
const ADVARSEL_GRENSE_MM = 98

function getCoverImage(d: EmbroideryData): string {
  return d.useCustomImage ? d.customImage : (d.coverImage || d.bmpPreview)
}

// ── Side ───────────────────────────────────────────────────────────────────────

export default function ArrangerPage() {
  const [motifs, setMotifs] = useState<Embroidery[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Embroidery | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('embroidery')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      setLoadError(error.message)
    } else {
      setMotifs((data ?? []) as Embroidery[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    if (!search.trim()) return motifs
    const q = search.toLowerCase()
    return motifs.filter(m => m.data.navn?.toLowerCase().includes(q))
  }, [motifs, search])

  if (selected) {
    return <MotivVisning motiv={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-24">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="font-serif text-2xl text-stone-700">Arranger broderimotiver</h1>
      </div>
      <p className="text-sm text-stone-500 mb-5">
        Velg et motiv fra biblioteket for å se stingbanene og fargeblokkene innenfor 100×100 mm-rammen.
      </p>

      <div className="relative w-full mb-5">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Søk i biblioteket…"
          className="w-full pl-9 pr-4 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300 shadow-sm"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin" />
        </div>
      ) : loadError ? (
        <p className="text-sm text-red-500 text-center py-12">{loadError}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-stone-400 text-center py-12">
          {motifs.length === 0 ? (
            <>Ingen motiver i biblioteket ennå. Last opp under{' '}
              <a href="/dashboard/embroidery" className="text-[#8B6340] underline">Broderi</a>.</>
          ) : 'Ingen treff'}
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          {filtered.map(m => {
            const cover = getCoverImage(m.data)
            return (
              <li key={m.id}>
                <button
                  onClick={() => setSelected(m)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-stone-50 transition-colors text-left"
                >
                  <div className="w-14 h-14 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt={m.data.navn} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-stone-800 text-sm truncate">
                      {m.data.navn || <span className="text-stone-400 italic font-normal">Uten navn</span>}
                    </p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {m.data.sizes?.length ?? 0} størrelse{(m.data.sizes?.length ?? 0) === 1 ? '' : 'r'}
                    </p>
                  </div>
                  <svg className="w-4 h-4 text-stone-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Motiv-visning ──────────────────────────────────────────────────────────────

function MotivVisning({ motiv, onBack }: { motiv: Embroidery; onBack: () => void }) {
  const sizes = motiv.data.sizes ?? []
  const [sizeId, setSizeId] = useState<string | null>(sizes[0]?.id ?? null)
  const [data, setData] = useState<BroderiMotivData | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null)

  const size = sizes.find(s => s.id === sizeId) ?? null

  useEffect(() => {
    if (!size) return
    let cancelled = false

    async function run() {
      setStatus('loading')
      setErrorDetails(null)
      setData(null)
      try {
        const { data: cached } = await supabase
          .from('broderi_motiv')
          .select('data')
          .eq('embroidery_id', motiv.id)
          .eq('size_id', size!.id)
          .maybeSingle()

        if (cancelled) return
        if (cached) {
          setData(cached.data as BroderiMotivData)
          setStatus('idle')
          return
        }

        const res = await fetch('/api/broderi-motiv/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embroideryId: motiv.id, sizeId: size!.id }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Klarte ikke tolke PES-filen')
        if (cancelled) return
        setData(body.data as BroderiMotivData)
        setStatus('idle')
      } catch (err) {
        if (cancelled) return
        setErrorDetails(describeError(err))
        setStatus('error')
      }
    }

    run()
    return () => { cancelled = true }
  }, [motiv.id, size])

  return (
    <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-3 pb-24">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onBack}
          className="p-2 rounded-xl hover:bg-stone-100 text-stone-500 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="font-serif text-xl text-stone-700 truncate flex-1 min-w-0">
          {motiv.data.navn || 'Uten navn'}
        </h2>
      </div>

      {sizes.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {sizes.map(s => (
            <button
              key={s.id}
              onClick={() => setSizeId(s.id)}
              className={`h-8 px-3 rounded-lg border text-sm transition-colors ${
                s.id === sizeId
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
            >
              {s.sizeLabel}
            </button>
          ))}
        </div>
      )}

      {!size ? (
        <p className="text-sm text-stone-400 text-center py-12">Motivet har ingen PES-filer.</p>
      ) : status === 'loading' ? (
        <div className="flex flex-col items-center gap-3 py-24">
          <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin" />
          <p className="text-sm text-stone-400">Tolker sting og farger…</p>
        </div>
      ) : status === 'error' ? (
        <div className="py-8">
          <p className="text-sm text-red-500 mb-2">Klarte ikke tolke PES-filen.</p>
          {errorDetails && <ErrorDetailsView details={errorDetails} context="Tolk PES" />}
        </div>
      ) : data ? (
        <MotivDetaljer data={data} />
      ) : null}
    </div>
  )
}

function MotivDetaljer({ data }: { data: BroderiMotivData }) {
  const bbox = data.bbox
  const widthMm = bbox ? (bbox.max_x - bbox.min_x) / 10 : 0
  const heightMm = bbox ? (bbox.max_y - bbox.min_y) / 10 : 0
  const overGrense = widthMm > ADVARSEL_GRENSE_MM || heightMm > ADVARSEL_GRENSE_MM

  // Rammen er alltid sentrert på registreringspunktet (0,0), som er hoop-senteret
  // maskinen syr fra. ViewBox utvides forbi rammen bare hvis motivet stikker utenfor.
  const halvRamme = RAMME_MM / 2
  const motivHalv = bbox
    ? Math.max(
        Math.abs(bbox.min_x) / 10, Math.abs(bbox.max_x) / 10,
        Math.abs(bbox.min_y) / 10, Math.abs(bbox.max_y) / 10,
      )
    : 0
  const halv = Math.max(halvRamme, motivHalv) + 5
  const viewBox = `${-halv} ${-halv} ${halv * 2} ${halv * 2}`

  return (
    <div className="space-y-5">
      {overGrense && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          Motivet er {widthMm.toFixed(1)} × {heightMm.toFixed(1)} mm — det er over {ADVARSEL_GRENSE_MM} mm i én
          retning og har lite margin igjen til 100×100 mm-rammen.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
        <svg viewBox={viewBox} className="w-full aspect-square">
          <rect
            x={-halvRamme} y={-halvRamme} width={RAMME_MM} height={RAMME_MM}
            fill="none" stroke="#C9A57A" strokeWidth={0.5} strokeDasharray="2 2"
          />
          {data.blokker.map((b, i) => (
            <polyline
              key={i}
              points={b.sting.map(([x, y]) => `${x / 10},${y / 10}`).join(' ')}
              fill="none"
              stroke={b.farge_hex}
              strokeWidth={0.3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        <p className="text-xs text-stone-400 text-center mt-2">
          {bbox ? `${widthMm.toFixed(1)} × ${heightMm.toFixed(1)} mm` : 'Ukjent størrelse'} · {data.total_sting} sting totalt
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm divide-y divide-stone-100">
        {data.blokker.map((b, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <span className="text-xs text-stone-400 w-5 text-right flex-shrink-0">{i + 1}</span>
            <span
              className="w-6 h-6 rounded-md border border-stone-200 flex-shrink-0"
              style={{ backgroundColor: b.farge_hex }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-stone-700 truncate">
                {b.tradnavn || <span className="text-stone-400 italic">Ukjent trådnavn</span>}
              </p>
              <p className="text-xs text-stone-400">{b.farge_hex}</p>
            </div>
            <span className="text-xs text-stone-500 flex-shrink-0">{b.antall_sting} sting</span>
          </div>
        ))}
      </div>
    </div>
  )
}
