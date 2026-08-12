'use client'

import { useMemo, useState } from 'react'
import { describeError, type ErrorDetails } from '@/lib/error-details'
import { ErrorDetailsView } from '@/components/ErrorDetailsView'
import { byggEksportSegmenter, type EksportSegment } from './eksport'
import { tellOmtredninger, type SekvensKontekst } from './sekvens'
import type { BroderiMotivData, PlassertMotiv, SekvensElement } from './types'

interface SelvsjekkFarge {
  farge_hex: string
  antall_deler: number
  antall_sting: number
}

interface Selvsjekk {
  antall_fargekjoringer: number
  farger: SelvsjekkFarge[]
  total_sting: number
  bredde_mm: number
  hoyde_mm: number
}

type Status = 'idle' | 'bygger' | 'ferdig' | 'feil'

function sanitizerFilnavn(navn: string): string {
  const trimmet = navn.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ')
  return trimmet || 'komposisjon'
}

export function EksportPanel({ sekvens, motiver, resolved, navn }: {
  sekvens: SekvensElement[]
  motiver: PlassertMotiv[]
  resolved: Record<string, BroderiMotivData>
  navn: string
}) {
  // Utviklerflagg for PES-versjon — bevisst IKKE i det vanlige grensesnittet, bare synlig
  // med ?dev=1 i URL-en. window.location leses direkte (ikke Next sin useSearchParams)
  // for å unngå Suspense-krav for en så liten, rent kosmetisk detalj.
  const [utviklerModus] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('dev') === '1',
  )
  const [pesVersjon, setPesVersjon] = useState(1)

  const [status, setStatus] = useState<Status>('idle')
  const [selvsjekk, setSelvsjekk] = useState<Selvsjekk | null>(null)
  const [pesBase64, setPesBase64] = useState<string | null>(null)
  const [avvik, setAvvik] = useState<string[] | null>(null)
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null)
  // Grunnlaget den nåværende pesBase64 faktisk ble bygget FRA — ikke det nåværende grunnlaget.
  // byggetFra er REFERANSEN til segmenter-arrayen som var i bruk ved siste vellykkede bygg
  // (ikke en kopi eller et innhold å sammenligne verdi mot); byggetVersjon er pesVersjon på
  // samme tidspunkt. Sammenlignet mot de LEVENDE verdiene (segmenter, pesVersjon) i erFersk
  // under, uten en useEffect — se kommentaren der for hvorfor.
  const [byggetFra, setByggetFra] = useState<EksportSegment[] | null>(null)
  const [byggetVersjon, setByggetVersjon] = useState<number | null>(null)

  const ctx: SekvensKontekst = useMemo(() => ({ motiver, resolved }), [motiver, resolved])
  const omtredninger = useMemo(() => tellOmtredninger(sekvens, ctx), [sekvens, ctx])
  const segmenter = useMemo(() => byggEksportSegmenter(sekvens, ctx), [sekvens, ctx])
  const klar = segmenter !== null && sekvens.length > 0

  // Ren utledning i render, ikke en useEffect+setState — «fersk» betyr at pesBase64 faktisk
  // stammer fra AKKURAT det grunnlaget (segmenter, pesVersjon) som gjelder akkurat nå.
  // segmenter er en NY array fra byggEksportSegmenter hver gang sekvens/motiver/resolved
  // endres (useMemo over), så referanselikhet her er nok til å oppdage enhver endring i
  // fargevalg, dra-og-slipp, posisjon/rotasjon eller pause — uten å måtte sammenligne
  // innholdet felt for felt. Fail mot rebuild: usikker på om noe endret seg → ikke fersk.
  const erFersk = pesBase64 !== null && byggetFra === segmenter && byggetVersjon === pesVersjon

  async function bygg() {
    if (!segmenter) return
    setStatus('bygger')
    // Nullstiller EKSISTERENDE bytes/selvsjekk ved START, ikke bare ved suksess — en mislykket
    // ny bygging skal aldri kunne etterlate forrige (nå potensielt utdaterte) fil nedlastbar.
    setPesBase64(null)
    setSelvsjekk(null)
    setAvvik(null)
    setErrorDetails(null)
    try {
      const res = await fetch('/api/export-pes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmenter, pes_versjon: pesVersjon }),
      })
      const body = await res.json()
      if (!res.ok) {
        if (Array.isArray(body.avvik)) {
          setAvvik(body.avvik)
          setStatus('feil')
          return
        }
        throw new Error(body.error ?? 'Klarte ikke bygge PES-filen')
      }
      setSelvsjekk(body.selvsjekk)
      setPesBase64(body.pes_base64)
      setByggetFra(segmenter)
      setByggetVersjon(pesVersjon)
      setStatus('ferdig')
    } catch (err) {
      setErrorDetails(describeError(err))
      setStatus('feil')
    }
  }

  function lastNed() {
    if (!pesBase64) return
    const bytes = atob(pesBase64)
    const buffer = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
    const blob = new Blob([buffer], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizerFilnavn(navn)}.pes`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg text-stone-700">Eksporter til PES</h3>
        {(status !== 'ferdig' || !erFersk) && (
          <button
            onClick={bygg}
            disabled={!klar || status === 'bygger'}
            className="h-9 px-4 rounded-xl bg-stone-800 text-white text-sm hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {status === 'bygger' ? 'Bygger…' : 'Bygg fil'}
          </button>
        )}
      </div>

      <p className="text-xs text-stone-400">
        Motivenes innbyrdes avstand bevares, men hele komposisjonen sentreres i rammen ved eksport.
      </p>

      {!klar && sekvens.length > 0 && (
        <p className="text-xs text-stone-400">Venter på at alle motiver skal tolkes ferdig…</p>
      )}

      {utviklerModus && (
        <label className="flex items-center gap-2 text-xs text-stone-500">
          PES-versjon (utviklerflagg)
          <select
            value={pesVersjon}
            onChange={e => setPesVersjon(Number(e.target.value))}
            className="border border-stone-200 rounded-lg px-2 py-1"
          >
            <option value={1}>1 (standard)</option>
            <option value={6}>6</option>
          </select>
        </label>
      )}

      {status === 'feil' && avvik && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <p className="font-medium mb-1">Selvsjekk feilet — filen ble ikke lastet ned:</p>
          <p className="text-xs text-red-600 mb-2">
            Appen bygger PES-filen og leser den tilbake for å sjekke at hver kjøring faktisk
            ble som sekvensen ba om. Det stemte ikke under — derfor stoppet nedlastingen.
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            {avvik.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}

      {status === 'feil' && errorDetails && (
        <ErrorDetailsView details={errorDetails} context="Eksporter PES" />
      )}

      {status === 'ferdig' && selvsjekk && (
        <div className="space-y-3">
          <div className={`text-sm space-y-1 ${erFersk ? 'text-stone-600' : 'text-stone-400'}`}>
            <p>
              <span className="font-medium text-stone-800">{omtredninger}</span> omtredning{omtredninger === 1 ? '' : 'er'}
              {!erFersk && <span className="text-xs text-stone-400"> · tall fra forrige bygg</span>}
            </p>
            <p className="text-xs text-stone-500">
              {selvsjekk.bredde_mm.toFixed(1)} × {selvsjekk.hoyde_mm.toFixed(1)} mm · {selvsjekk.total_sting} sting totalt · {selvsjekk.antall_fargekjoringer} fargekjøring{selvsjekk.antall_fargekjoringer === 1 ? '' : 'er'} i selve fila
            </p>
          </div>

          {erFersk && selvsjekk.antall_fargekjoringer !== omtredninger && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              Fila har {selvsjekk.antall_fargekjoringer} fargekjøring{selvsjekk.antall_fargekjoringer === 1 ? '' : 'er'}, men sekvensen viser {omtredninger} omtredning{omtredninger === 1 ? '' : 'er'}.
              To eller flere nabokjøringer har farger som Brother-paletten gjør til samme tråd — maskinen stopper ikke mellom dem, og den andre formen sys i den første tråden.
              Sekvenspanelet regner nå selv med samme palett-snappede farge som fila, så dette avviket betyr at noe uventet har skjedd — stol ikke på denne fila uten å undersøke det først.
            </div>
          )}

          <div className={erFersk ? '' : 'opacity-50'}>
            <p className="text-xs text-stone-400 mb-1">Fargene slik de ligger i fila — kan avvike fra fargene i sekvenspanelet.</p>
            <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden">
              {selvsjekk.farger.map((f, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-xs text-stone-400 w-5 text-right flex-shrink-0">{i + 1}</span>
                  <span className="w-5 h-5 rounded border border-stone-200 flex-shrink-0" style={{ backgroundColor: f.farge_hex }} />
                  <span className="flex-1 text-sm text-stone-600">{f.farge_hex}</span>
                  <span className="text-xs text-stone-500 flex-shrink-0">{f.antall_sting} sting</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-stone-400">
            Miniatyrbildet i Artspira kan bli blankt — det er normalt, ikke et tegn på at noe er feil.
          </p>
          {!erFersk && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Sekvensen er endret etter at fila ble bygget — bygg på nytt før du laster ned.
            </p>
          )}
          <button
            onClick={lastNed}
            disabled={!erFersk}
            className="w-full py-2.5 bg-stone-800 text-white text-sm rounded-xl hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Last ned {sanitizerFilnavn(navn)}.pes
          </button>
          <button
            onClick={() => setStatus('idle')}
            className="w-full py-2 text-xs text-stone-400 hover:text-stone-600 transition-colors"
          >
            Bygg på nytt
          </button>
        </div>
      )}
    </div>
  )
}
