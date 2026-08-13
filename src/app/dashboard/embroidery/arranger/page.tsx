'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { hentAllePaginert } from '@/lib/supabasePaginering'
import { describeError, type ErrorDetails } from '@/lib/error-details'
import { ErrorDetailsView } from '@/components/ErrorDetailsView'
import { KomposisjonEditor } from './KomposisjonEditor'
import { byggVirtuelleMotiver } from './motivvalg'
import { EmbroideryCard, KATEGORIER } from '../page'
import {
  type Embroidery, type BroderiMotivData, type BroderiKomposisjon,
  type EmbroideryBundle, type VirtuelMotiv,
  getBundleCoverImage, byggKategoriGrupper,
} from './types'
import { useHistoryVisning } from '../../_shared/useHistoryVisning'

const RAMME_MM = 100
const ADVARSEL_GRENSE_MM = 98

type Tab = 'bibliotek' | 'komposisjoner'

type ArrVisning =
  | { v: 'liste' }
  | { v: 'motiv'; id: string }
  | { v: 'komposisjon'; id: string }
  | { v: 'ny' }
  // Enkeltmotiv åpnet for redigering fra biblioteket: samme editor som en komposisjon,
  // men med bare dette ene motivet plassert. Lagres den, blir den en helt vanlig
  // komposisjon — det finnes bevisst ingen egen "enkeltmotiv-lagring" ved siden av.
  | { v: 'nyFraMotiv'; id: string; sizeId: string }

// ── Side ───────────────────────────────────────────────────────────────────────

export default function ArrangerPage() {
  const [tab, setTab] = useState<Tab>('bibliotek')
  const [motifs, setMotifs] = useState<Embroidery[]>([])
  const [bundlerMap, setBundlerMap] = useState<Map<string, EmbroideryBundle>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Embroidery | null>(null)
  // Lokal (ikke historikk-sporet) navigasjon INNI biblioteket — kategori- og
  // bundle-nivåene er mellomstopp på vei mot et motiv, ikke egne "sider" brukeren
  // trenger å komme rett tilbake til med nettleserens tilbakeknapp. Selve motivvisningen
  // (MotivVisning under) ER historikk-sporet via pushVisning, se useHistoryVisning over.
  const [libView, setLibView] = useState<
    { type: 'kategorier' } | { type: 'kategori'; kat: string | null } | { type: 'bundle'; bundleId: string }
  >({ type: 'kategorier' })

  const [komposisjoner, setKomposisjoner] = useState<BroderiKomposisjon[]>([])
  const [kompLoading, setKompLoading] = useState(true)
  const [kompError, setKompError] = useState<string | null>(null)
  const [aktivKomposisjon, setAktivKomposisjon] = useState<BroderiKomposisjon | null>(null)
  const [nyKomposisjon, setNyKomposisjon] = useState(false)
  const [deleteKompId, setDeleteKompId] = useState<string | null>(null)
  const [kopierKompId, setKopierKompId] = useState<string | null>(null)
  // Enkeltmotiv som er åpnet i komposisjonseditoren (se ArrVisning: 'nyFraMotiv').
  const [startMotiv, setStartMotiv] = useState<{ embroideryId: string; sizeId: string; navn: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    // created_at er ikke unik nok alene til å garantere en stabil sidedeling - rader satt inn i
    // samme transaksjon (f.eks. en zip-opplasting med mange filer) kan dele eksakt samme
    // created_at, siden Postgres sin now() returnerer transaksjonstidspunktet, ikke kalletidspunktet.
    // id som sekundær sortering bryter alle slike bånd deterministisk uten å endre visningsrekkefølgen.
    // Bundlene hentes i samme slengen (samme mønster som embroidery/page.tsx og
    // MotivPicker) — biblioteket her skal grupperes akkurat som resten av appen, se
    // byggVirtuelleMotiver/byggKategoriGrupper under.
    const [embRes, bundleRes] = await Promise.all([
      hentAllePaginert<Embroidery>(
        (fra, til) => supabase.from('embroidery')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(fra, til),
        ['created_at', 'id'],
      ),
      hentAllePaginert<EmbroideryBundle>(
        (fra, til) => supabase.from('embroidery_bundles')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(fra, til),
        ['created_at', 'id'],
      ),
    ])
    if (embRes.error) {
      setLoadError(embRes.error.message)
    } else {
      setMotifs(embRes.data)
      if (!bundleRes.error) {
        setBundlerMap(new Map(bundleRes.data.map(b => [b.id, b])))
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const loadKomposisjoner = useCallback(async () => {
    setKompLoading(true)
    setKompError(null)
    const { data, error } = await hentAllePaginert<BroderiKomposisjon>(
      (fra, til) => supabase.from('broderi_komposisjon')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(fra, til),
      ['created_at', 'id'],
    )
    if (error) {
      setKompError(error.message)
    } else {
      setKomposisjoner(data)
    }
    setKompLoading(false)
  }, [])

  const { push: pushVisning, closeToBase } = useHistoryVisning<ArrVisning>(
    'arr', { v: 'liste' },
    visning => {
      if (visning.v === 'liste') {
        setSelected(null); setAktivKomposisjon(null); setNyKomposisjon(false); setStartMotiv(null)
        loadKomposisjoner()
      } else if (visning.v === 'motiv') {
        const funnet = motifs.find(m => m.id === visning.id)
        setSelected(funnet ?? null)
        setAktivKomposisjon(null); setNyKomposisjon(false); setStartMotiv(null)
      } else if (visning.v === 'komposisjon') {
        const funnet = komposisjoner.find(k => k.id === visning.id)
        setAktivKomposisjon(funnet ?? null)
        setSelected(null); setNyKomposisjon(false); setStartMotiv(null)
      } else if (visning.v === 'nyFraMotiv') {
        // Tilbake/fram til en enkeltmotiv-redigering: bygg startMotiv på nytt fra id-ene i
        // historikk-staten. Finnes ikke raden lenger (slettet i en annen fane), faller vi
        // tilbake til listen i stedet for å åpne en tom editor.
        const funnet = motifs.find(m => m.id === visning.id)
        const size = funnet?.data.sizes?.find(s => s.id === visning.sizeId)
        if (funnet && size) {
          setStartMotiv({ embroideryId: funnet.id, sizeId: size.id, navn: funnet.data.navn || 'Uten navn' })
        } else {
          setStartMotiv(null)
        }
        setSelected(null); setAktivKomposisjon(null); setNyKomposisjon(false)
      } else {
        setNyKomposisjon(true)
        setSelected(null); setAktivKomposisjon(null); setStartMotiv(null)
      }
    },
  )

  useEffect(() => {
    loadKomposisjoner()
  }, [loadKomposisjoner])

  async function slettKomposisjon(id: string) {
    const res = await fetch(`/api/broderi-komposisjon/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setKomposisjoner(k => k.filter(x => x.id !== id))
    }
    setDeleteKompId(null)
  }

  async function kopierKomposisjon(k: BroderiKomposisjon) {
    setKopierKompId(k.id)
    const kopi = { ...k.data, navn: `${k.data.navn || 'Uten navn'} (kopi)` }
    const res = await fetch('/api/broderi-komposisjon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: kopi }),
    })
    if (res.ok) {
      const ny = await res.json() as BroderiKomposisjon
      setKomposisjoner(prev => [ny, ...prev])
    }
    setKopierKompId(null)
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return motifs
    const q = search.toLowerCase()
    return motifs.filter(m => m.data.navn?.toLowerCase().includes(q))
  }, [motifs, search])

  // Samme grupperingslogikk (identitet, font-gjenkjenning, kategoriarv fra bundle) som
  // MotivPicker i KomposisjonEditor bruker når et motiv skal velges INN i en komposisjon
  // — gjenbrukt her fremfor gjenoppfunnet, siden det er nettopp denne logikken (ikke
  // selve visningen, som er en annen interaksjon: bla/se, ikke velg/plasser) som er delt.
  const virtuelleMotiver = useMemo(
    () => byggVirtuelleMotiver(motifs, bundlerMap),
    [motifs, bundlerMap],
  )
  const kategoriGrupper = useMemo(
    () => byggKategoriGrupper(virtuelleMotiver, KATEGORIER),
    [virtuelleMotiver],
  )

  // Åpner MotivVisning for det motivet en VM (evt. et bundle-medlem) faktisk peker på.
  // For font-grupperte VM-er (ett tegn i flere tommestørrelser, ofte fra FLERE
  // embroidery-rader) finnes det ingen enkelt Embroidery-rad som dekker alle
  // størrelsene — vi åpner da raden bak FØRSTE størrelse. MotivVisning viser uansett
  // bare én rad med dens egne størrelser (samme visning som å åpne raden direkte fra
  // et flatt søk), så dette er en bevisst forenkling, ikke en feil forsøkt skjult.
  function apneVM(vm: VirtuelMotiv) {
    const forsteStorrelse = vm.sizes[0]
    const rad = forsteStorrelse ? motifs.find(m => m.id === forsteStorrelse.embroideryId) : undefined
    if (!rad) return
    setSelected(rad)
    pushVisning({ v: 'motiv', id: rad.id })
  }

  // Enkeltmotiv-redigering vinner over selve motivvisningen: å trykke «Rediger» der
  // åpner den samme editoren som komposisjoner bruker, med bare dette motivet plassert.
  if (startMotiv) {
    return (
      <KomposisjonEditor
        komposisjon={null}
        biblioteket={motifs}
        onBack={closeToBase}
        startMotiv={startMotiv}
      />
    )
  }

  if (selected) {
    return (
      <MotivVisning
        motiv={selected}
        onBack={closeToBase}
        onRediger={sizeId => {
          const m = selected
          setSelected(null)
          setStartMotiv({ embroideryId: m.id, sizeId, navn: m.data.navn || 'Uten navn' })
          pushVisning({ v: 'nyFraMotiv', id: m.id, sizeId })
        }}
      />
    )
  }

  if (aktivKomposisjon || nyKomposisjon) {
    return (
      <KomposisjonEditor
        komposisjon={aktivKomposisjon}
        biblioteket={motifs}
        onBack={closeToBase}
      />
    )
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 pb-24">
      <div className="flex items-center gap-3 mb-1">
        <h1 className="font-serif text-2xl text-stone-700">Arranger broderimotiver</h1>
      </div>
      <p className="text-sm text-stone-500 mb-5">
        Velg et motiv fra biblioteket for å se stingbanene, eller sett sammen flere motiver til én komposisjon.
      </p>

      <div className="flex items-center gap-2 mb-5">
        <button
          onClick={() => setTab('bibliotek')}
          className={`h-9 px-4 rounded-xl border text-sm transition-colors ${
            tab === 'bibliotek'
              ? 'bg-stone-800 text-white border-stone-800'
              : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
          }`}
        >
          Bibliotek
        </button>
        <button
          onClick={() => setTab('komposisjoner')}
          className={`h-9 px-4 rounded-xl border text-sm transition-colors ${
            tab === 'komposisjoner'
              ? 'bg-stone-800 text-white border-stone-800'
              : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
          }`}
        >
          Komposisjoner
        </button>
      </div>

      {tab === 'bibliotek' ? (
        <>
          <div className="relative w-full mb-5">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={e => { setSearch(e.target.value); setLibView({ type: 'kategorier' }) }}
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
          ) : motifs.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-12">
              Ingen motiver i biblioteket ennå. Last opp under{' '}
              <a href="/dashboard/embroidery" className="text-[#8B6340] underline">Broderi</a>.
            </p>
          ) : search.trim() ? (
            // Søk går på tvers av kategorier/bundles og viser flate treff — samme
            // kortkomponent og rutenett som hovedbiblioteket (/dashboard/embroidery).
            filtered.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-12">Ingen treff</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
                {filtered.map(m => (
                  <EmbroideryCard key={m.id} item={m} onEdit={() => { setSelected(m); pushVisning({ v: 'motiv', id: m.id }) }} />
                ))}
              </div>
            )
          ) : libView.type === 'kategorier' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
              {kategoriGrupper.map(({ kat, vms }) => (
                <KategoriTile key={kat ?? '(uten)'} kat={kat} vms={vms} bundlerMap={bundlerMap}
                  onClick={() => setLibView({ type: 'kategori', kat })} />
              ))}
            </div>
          ) : libView.type === 'kategori' ? (
            <KategoriInnhold
              kat={libView.kat}
              vms={kategoriGrupper.find(g => g.kat === libView.kat)?.vms ?? []}
              bundlerMap={bundlerMap}
              onBack={() => setLibView({ type: 'kategorier' })}
              onApneBundle={bundleId => setLibView({ type: 'bundle', bundleId })}
              onApneVM={apneVM}
            />
          ) : (
            <BundleInnhold
              bundle={bundlerMap.get(libView.bundleId)}
              vms={virtuelleMotiver.filter(vm => vm.bundleId === libView.bundleId)}
              onBack={() => setLibView({ type: 'kategorier' })}
              onApneVM={apneVM}
            />
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => { setNyKomposisjon(true); pushVisning({ v: 'ny' }) }}
            className="w-full mb-5 py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors"
          >
            + Ny komposisjon
          </button>

          {kompLoading ? (
            <div className="flex justify-center py-24">
              <div className="w-8 h-8 border-2 border-stone-200 border-t-stone-600 rounded-full animate-spin" />
            </div>
          ) : kompError ? (
            <p className="text-sm text-red-500 text-center py-12">{kompError}</p>
          ) : komposisjoner.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-12">Ingen komposisjoner lagret ennå.</p>
          ) : (
            <ul className="divide-y divide-stone-100 bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
              {komposisjoner.map(k => (
                <li key={k.id} className="flex items-center gap-3 p-3 hover:bg-stone-50 transition-colors">
                  <button onClick={() => { setAktivKomposisjon(k); pushVisning({ v: 'komposisjon', id: k.id }) }} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-stone-100 flex-shrink-0 flex items-center justify-center">
                      {k.data.miniatyrSvg ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`data:image/svg+xml;utf8,${encodeURIComponent(k.data.miniatyrSvg)}`}
                          alt={k.data.navn}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        // Eksisterende komposisjoner (lagret før miniatyren fantes) har ingen
                        // — vises uten i stedet for å regne den ut her, se miniatyr.ts.
                        <svg className="w-5 h-5 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-stone-800 text-sm truncate">
                        {k.data.navn || <span className="text-stone-400 italic font-normal">Uten navn</span>}
                      </p>
                      <p className="text-xs text-stone-400 mt-0.5">
                        {k.data.motiver?.length ?? 0} motiv{(k.data.motiver?.length ?? 0) === 1 ? '' : 'er'}
                      </p>
                    </div>
                  </button>
                  {deleteKompId === k.id ? (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => slettKomposisjon(k.id)} className="text-xs px-2.5 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
                        Slett
                      </button>
                      <button onClick={() => setDeleteKompId(null)} className="text-xs px-2.5 py-1.5 rounded-lg text-stone-400 hover:bg-stone-100 transition-colors">
                        Avbryt
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => kopierKomposisjon(k)}
                        disabled={kopierKompId === k.id}
                        className="p-2 rounded-lg hover:bg-stone-100 text-stone-300 hover:text-stone-500 transition-colors disabled:opacity-40"
                        aria-label="Kopier komposisjon"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDeleteKompId(k.id)}
                        className="p-2 rounded-lg hover:bg-red-50 text-stone-300 hover:text-red-400 transition-colors"
                        aria-label="Slett komposisjon"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                            d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

// ── Bibliotek: kategorier og bundles ────────────────────────────────────────────

// Ett representativt bilde er nok her (ikke kategoriData sin 4-bilders collage i
// MotivPicker) — denne flisen er bare en inngang til kategorien, ikke et forsøk på å
// vise alt den inneholder. Ekte forsidebilde foretrekkes over miniatyr_svg, av samme
// grunn og med samme regel som MotivKort/kategoriflisene i MotivPicker (KomposisjonEditor.tsx):
// dette er gjenkjenning, ikke stingdetaljer.
function kategoriThumbnail(vms: VirtuelMotiv[], bundlerMap: Map<string, EmbroideryBundle>): string | null {
  for (const vm of vms) {
    if (vm.bundleId) {
      const bundle = bundlerMap.get(vm.bundleId)
      if (bundle) return getBundleCoverImage(bundle.data)
    }
  }
  for (const vm of vms) {
    if (vm.coverImage) return vm.coverImage
  }
  return null
}

function BiblioTile({ bilde, tittel, undertekst, onClick }: {
  bilde: string | null
  tittel: string
  undertekst?: string
  onClick: () => void
}) {
  return (
    <article
      onClick={onClick}
      className="group bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col relative min-w-0"
    >
      <div className="relative aspect-[5/4] overflow-hidden bg-stone-50">
        {bilde ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={bilde} alt={tittel} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-10 h-10 text-stone-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-3 py-2.5">
          <h3 className="font-serif text-sm font-semibold text-white leading-tight truncate">{tittel}</h3>
          {undertekst && <p className="text-xs text-white/80 truncate">{undertekst}</p>}
        </div>
      </div>
    </article>
  )
}

function KategoriTile({ kat, vms, bundlerMap, onClick }: {
  kat: string | null; vms: VirtuelMotiv[]; bundlerMap: Map<string, EmbroideryBundle>; onClick: () => void
}) {
  return (
    <BiblioTile
      bilde={kategoriThumbnail(vms, bundlerMap)}
      tittel={kat ?? 'Uten kategori'}
      undertekst={`${vms.length} motiv${vms.length === 1 ? '' : 'er'}`}
      onClick={onClick}
    />
  )
}

function TilbakeKnapp({ onClick, tittel }: { onClick: () => void; tittel: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <button onClick={onClick} className="p-2 rounded-xl hover:bg-stone-100 text-stone-500 transition-colors">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 className="font-serif text-xl text-stone-700 truncate flex-1 min-w-0">{tittel}</h2>
    </div>
  )
}

// Innholdet i én kategori: bundles i kategorien vises som egne fliser (klikk åpner
// bundle-innhold), løse motiver (uten bundle) vises direkte som motivfliser.
function KategoriInnhold({ kat, vms, bundlerMap, onBack, onApneBundle, onApneVM }: {
  kat: string | null
  vms: VirtuelMotiv[]
  bundlerMap: Map<string, EmbroideryBundle>
  onBack: () => void
  onApneBundle: (bundleId: string) => void
  onApneVM: (vm: VirtuelMotiv) => void
}) {
  const bundleIder = Array.from(new Set(vms.filter(vm => vm.bundleId).map(vm => vm.bundleId!)))
  const løse = vms.filter(vm => !vm.bundleId)

  return (
    <div>
      <TilbakeKnapp onClick={onBack} tittel={kat ?? 'Uten kategori'} />
      {bundleIder.length === 0 && løse.length === 0 ? (
        <p className="text-sm text-stone-400 text-center py-12">Ingen motiver i denne kategorien.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {bundleIder.map(bid => {
            const bundle = bundlerMap.get(bid)
            const antall = vms.filter(vm => vm.bundleId === bid).length
            return (
              <BiblioTile
                key={bid}
                bilde={bundle ? getBundleCoverImage(bundle.data) : null}
                tittel={bundle?.data.navn || 'Uten navn'}
                undertekst={`Bundle · ${antall} motiv${antall === 1 ? '' : 'er'}`}
                onClick={() => onApneBundle(bid)}
              />
            )
          })}
          {løse.map(vm => (
            <BiblioTile
              key={vm.key}
              bilde={vm.coverImage || null}
              tittel={vm.navn}
              onClick={() => onApneVM(vm)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BundleInnhold({ bundle, vms, onBack, onApneVM }: {
  bundle: EmbroideryBundle | undefined
  vms: VirtuelMotiv[]
  onBack: () => void
  onApneVM: (vm: VirtuelMotiv) => void
}) {
  return (
    <div>
      <TilbakeKnapp onClick={onBack} tittel={bundle?.data.navn || 'Uten navn'} />
      {vms.length === 0 ? (
        <p className="text-sm text-stone-400 text-center py-12">Fant ingen motiver i denne bundlen.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {vms.map(vm => (
            <BiblioTile key={vm.key} bilde={vm.coverImage || null} tittel={vm.navn} onClick={() => onApneVM(vm)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Motiv-visning ──────────────────────────────────────────────────────────────

function MotivVisning({ motiv, onBack, onRediger }: {
  motiv: Embroidery
  onBack: () => void
  // Åpner motivet i komposisjonseditoren med den størrelsen som er valgt HER. Visningen
  // under er bevisst fortsatt bare lesing (rask titt på sting, farger og mål) — all
  // redigering skjer i den ene editoren, ikke i en egen, halv kopi av den.
  onRediger: (sizeId: string) => void
}) {
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
        const { data: cached, error: cacheErr } = await supabase
          .from('broderi_motiv')
          .select('data')
          .eq('embroidery_id', motiv.id)
          .eq('size_id', size!.id)
          .maybeSingle()
        // A permission/schema error here (e.g. missing GRANT) looks identical to "not
        // cached yet" unless we log it — fall through to re-parsing either way, but
        // don't let it pass silently.
        if (cacheErr) console.error('[Arranger] Oppslag i broderi_motiv-cache feilet', cacheErr)

        if (cancelled) return
        // Eldre cachede rader (før fargekjøring-grupperingen) har ikke stingblokker —
        // behandle dem som ikke cachet i stedet for å krasje på formen.
        if (cached && Array.isArray(cached.data?.stingblokker)) {
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
        <button
          onClick={() => size && onRediger(size.id)}
          disabled={!size}
          className="flex-shrink-0 h-9 px-4 rounded-xl bg-stone-800 text-white text-sm hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Rediger
        </button>
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
  const antallFarger = new Set(data.fargekjoringer.map(k => k.farge_hex)).size

  // Motivets registreringspunkt (0,0 i PES-koordinatene) er ikke en pålitelig
  // hoop-midte — noen filer har bbox fra (0,0) og oppover, andre har den sentrert
  // om origo. Sentrer i stedet rammen og viewBox på motivets EGEN bbox-midte, slik
  // at motivet vises midt i 100×100-rammen uansett kildefilens konvensjon. Dette er
  // bare en visnings-transform (translasjon) — stingkoordinatene i data er urørt.
  const halvRamme = RAMME_MM / 2
  const senterXmm = bbox ? (bbox.min_x + bbox.max_x) / 20 : 0
  const senterYmm = bbox ? (bbox.min_y + bbox.max_y) / 20 : 0
  const halv = Math.max(halvRamme, widthMm / 2, heightMm / 2) + 5
  const viewBox = `${senterXmm - halv} ${senterYmm - halv} ${halv * 2} ${halv * 2}`

  return (
    <div className="space-y-5">
      <p className="text-sm text-stone-500">
        {antallFarger} farge{antallFarger === 1 ? '' : 'r'}, {data.stingblokker.length} stingblokk{data.stingblokker.length === 1 ? '' : 'er'}
      </p>

      {overGrense && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          Motivet er {widthMm.toFixed(1)} × {heightMm.toFixed(1)} mm — det er over {ADVARSEL_GRENSE_MM} mm i én
          retning og har lite margin igjen til 100×100 mm-rammen.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4">
        <svg viewBox={viewBox} className="w-full aspect-square">
          <rect
            x={senterXmm - halvRamme} y={senterYmm - halvRamme} width={RAMME_MM} height={RAMME_MM}
            fill="none" stroke="#C9A57A" strokeWidth={0.5} strokeDasharray="2 2"
          />
          {data.stingblokker.map((b, i) => (
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
        {data.fargekjoringer.map((k, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <span className="text-xs text-stone-400 w-5 text-right flex-shrink-0">{i + 1}</span>
            <span
              className="w-6 h-6 rounded-md border border-stone-200 flex-shrink-0"
              style={{ backgroundColor: k.farge_hex }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-stone-700 truncate">
                {k.tradnavn_auto || <span className="text-stone-400 italic">Ukjent trådnavn</span>}
              </p>
              <p className="text-xs text-stone-400">
                {k.farge_hex} · {k.antall_blokker} del{k.antall_blokker === 1 ? '' : 'er'}
              </p>
            </div>
            <span className="text-xs text-stone-500 flex-shrink-0">{k.antall_sting} sting</span>
          </div>
        ))}
      </div>
    </div>
  )
}
