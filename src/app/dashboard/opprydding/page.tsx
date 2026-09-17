'use client'

import { useState } from 'react'

// Opprydding i project-images. Ingenting skjer uten at du huker av og bekrefter,
// og serveren sjekker lista på nytt før den sletter — den kan være minutter gammel.

interface ForeldreloseFil { navn: string; bytes: number }
interface Oppskriftskopi {
  recipeId: string; oppskrift: string; pdfId: string
  filnavn: string; objektnavn: string; driveFileId: string
}

function mb(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} kB`
}

async function kall(body: Record<string, unknown>) {
  const r = await fetch('/api/opprydding', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

export default function OppryddingPage() {
  const [laster, setLaster]           = useState(false)
  const [feil, setFeil]               = useState('')
  const [melding, setMelding]         = useState('')
  const [foreldrelose, setForeldrelose] = useState<ForeldreloseFil[] | null>(null)
  const [oppskrifter, setOppskrifter]   = useState<Oppskriftskopi[] | null>(null)
  const [valgteFiler, setValgteFiler]   = useState<Set<string>>(new Set())
  const [valgtePdfer, setValgtePdfer]   = useState<Set<string>>(new Set())
  const [jobber, setJobber]             = useState('')

  async function analyser() {
    setLaster(true); setFeil(''); setMelding('')
    try {
      const j = await kall({ handling: 'analyse' })
      setForeldrelose(j.foreldrelose)
      setOppskrifter(j.oppskrifter)
      setValgteFiler(new Set((j.foreldrelose as ForeldreloseFil[]).map(f => f.navn)))
      setValgtePdfer(new Set())
    } catch (e) {
      setFeil(e instanceof Error ? e.message : 'Analysen feilet')
    } finally { setLaster(false) }
  }

  async function slettValgte() {
    setJobber('Sletter…'); setFeil(''); setMelding('')
    try {
      const j = await kall({ handling: 'slett-foreldrelose', navn: [...valgteFiler] })
      setMelding(j.hoppetOver?.length
        ? `${j.slettet} filer slettet. ${j.hoppetOver.length} ble hoppet over — de er tatt i bruk siden analysen.`
        : `${j.slettet} filer slettet.`)
      await analyser()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : 'Sletting feilet')
    } finally { setJobber('') }
  }

  async function flyttValgte() {
    setJobber('Flytter til Drive…'); setFeil(''); setMelding('')
    try {
      const j = await kall({ handling: 'flytt-oppskrifter', pdfIder: [...valgtePdfer] })
      const res = j.resultat as { ok: boolean; feil?: string }[]
      const ok = res.filter(r => r.ok).length
      const feilet = res.filter(r => !r.ok)
      setMelding(feilet.length
        ? `${ok} flyttet. ${feilet.length} feilet: ${feilet.map(f => f.feil).join('; ')}`
        : `${ok} oppskrifter ligger nå bare i Drive.`)
      await analyser()
    } catch (e) {
      setFeil(e instanceof Error ? e.message : 'Flyttingen feilet')
    } finally { setJobber('') }
  }

  const valgtBytes = (foreldrelose ?? [])
    .filter(f => valgteFiler.has(f.navn))
    .reduce((s, f) => s + f.bytes, 0)

  const knapp = 'px-3 py-2 text-sm rounded-xl transition-colors disabled:opacity-40'

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-serif text-2xl text-stone-800 mb-1">Opprydding</h1>
      <p className="text-sm text-stone-500 mb-6">
        Bøtta <code className="text-xs">project-images</code>. Ingenting slettes uten at du bekrefter.
      </p>

      <button onClick={analyser} disabled={laster || !!jobber}
        className={`${knapp} bg-stone-800 text-white hover:bg-stone-700`}>
        {laster ? 'Analyserer…' : 'Analyser'}
      </button>

      {feil && <p className="mt-4 text-sm text-red-600">{feil}</p>}
      {melding && <p className="mt-4 text-sm text-emerald-700">{melding}</p>}
      {jobber && <p className="mt-4 text-sm text-stone-500">{jobber}</p>}

      {oppskrifter && (
        <section className="mt-8">
          <h2 className="font-serif text-lg text-stone-800 mb-1">
            Oppskrifter som kan flyttes til Drive ({oppskrifter.length})
          </h2>
          <p className="text-xs text-stone-500 mb-3">
            Disse har original i Drive, men ligger fortsatt som fast kopi her. Etter
            flytting hentes filen inn automatisk når du setter et prosjekt til aktiv,
            og slettes igjen når det fullføres. Merknadene dine berøres ikke.
          </p>
          {oppskrifter.length === 0 ? (
            <p className="text-sm text-stone-400">Ingen igjen.</p>
          ) : (
            <>
              <ul className="divide-y divide-stone-100 border-y border-stone-100">
                {oppskrifter.map(o => (
                  <li key={o.pdfId} className="py-2 flex items-center gap-3">
                    <input type="checkbox" checked={valgtePdfer.has(o.pdfId)}
                      onChange={e => setValgtePdfer(s => {
                        const n = new Set(s)
                        if (e.target.checked) n.add(o.pdfId); else n.delete(o.pdfId)
                        return n
                      })} />
                    <span className="text-sm text-stone-700 truncate flex-1">{o.oppskrift}</span>
                    <span className="text-xs text-stone-400 truncate max-w-[40%]">{o.filnavn}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setValgtePdfer(new Set(oppskrifter.map(o => o.pdfId)))}
                  className={`${knapp} border border-stone-200 text-stone-600 hover:bg-stone-50`}>
                  Velg alle
                </button>
                <button onClick={flyttValgte} disabled={valgtePdfer.size === 0 || !!jobber}
                  className={`${knapp} bg-stone-800 text-white hover:bg-stone-700`}>
                  Flytt {valgtePdfer.size} til Drive
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {foreldrelose && (
        <section className="mt-10">
          <h2 className="font-serif text-lg text-stone-800 mb-1">
            Filer ingen bruker ({foreldrelose.length})
          </h2>
          <p className="text-xs text-stone-500 mb-3">
            Ingen rad i basen nevner disse. Sammenligningen går mot hele radens tekst i
            alle tabeller, ikke mot utvalgte felter.
          </p>
          {foreldrelose.length === 0 ? (
            <p className="text-sm text-stone-400">Ingen rester.</p>
          ) : (
            <>
              <ul className="divide-y divide-stone-100 border-y border-stone-100 max-h-96 overflow-y-auto">
                {foreldrelose.map(f => (
                  <li key={f.navn} className="py-2 flex items-center gap-3">
                    <input type="checkbox" checked={valgteFiler.has(f.navn)}
                      onChange={e => setValgteFiler(s => {
                        const n = new Set(s)
                        if (e.target.checked) n.add(f.navn); else n.delete(f.navn)
                        return n
                      })} />
                    <span className="text-xs text-stone-600 font-mono truncate flex-1">{f.navn}</span>
                    <span className="text-xs text-stone-400 flex-shrink-0">{mb(f.bytes)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2 items-center">
                <button onClick={slettValgte} disabled={valgteFiler.size === 0 || !!jobber}
                  className={`${knapp} bg-red-500 text-white hover:bg-red-600`}>
                  Slett {valgteFiler.size} filer
                </button>
                <span className="text-xs text-stone-400">frigjør {mb(valgtBytes)}</span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
