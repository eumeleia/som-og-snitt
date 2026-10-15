'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { BROTHER_PALETT, snappTilPalett } from './broderPalett'
import { visningsnavn, sammenlignFargetone, sokTreffer } from './tradvisning'
import {
  hentPalett, leggIPalett, fjernFraPalett, registrerBrukt,
  abonnerSistBrukte, sistBrukteSnapshot, sistBrukteServerSnapshot, type PalettFarge,
} from './fargepalett'
import type { MinTrad } from './minTraadpalett'

type Fane = 'mine' | 'brother' | 'alle'
// leggTil: et trykk i «Mine tråder» eller Brother-rutenettet legger fargen TIL paletten i
// stedet for å velge den — onVelg kalles ikke i det hele tatt. rediger: × på palettrutene.
type Modus = 'velg' | 'leggTil' | 'rediger'

function ruteCls(valgt: boolean): string {
  return `w-7 h-7 rounded-lg border-2 transition-all flex-shrink-0 ${
    valgt ? 'border-stone-800 scale-110' : 'border-stone-200 hover:border-stone-400'
  }`
}

function faneCls(aktiv: boolean): string {
  return `px-3 py-1.5 rounded-lg text-xs border transition-colors ${
    aktiv ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
  }`
}

interface Fargevalg {
  key: string
  hex: string
  tittel: string
  under: string
  sokefelter: string[]
  pec: { hex: string; navn: string }
  trad?: MinTrad
}

function fraTrad(t: MinTrad): Fargevalg {
  const pec = snappTilPalett(t.hex)
  return {
    key: `t-${t.id}`,
    hex: t.hex,
    tittel: visningsnavn(t.navn, t.merke),
    under: t.merke,
    sokefelter: [t.navn, t.tradkode, t.merke, t.hex],
    pec,
    trad: t,
  }
}

const PEC_VALG: Fargevalg[] = BROTHER_PALETT.map(f => ({
  key: `p-${f.hex}`, hex: f.hex, tittel: f.navn, under: 'Brother PEC',
  sokefelter: [f.navn, f.hex, 'pec'], pec: f,
}))

function FargeKort({ v, valgt, iPalett, leggTilModus, onClick }: {
  v: Fargevalg
  valgt: boolean
  iPalett: boolean
  leggTilModus: boolean
  onClick: () => void
}) {
  const snapperAnnerledes = v.pec.hex !== v.hex.toLowerCase()
  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-2 p-1.5 rounded-lg border text-left transition-colors min-w-0 ${
        valgt ? 'border-stone-800 bg-stone-50' : 'border-stone-100 hover:border-stone-300'
      }`}
    >
      <span className="w-8 h-8 rounded-md border border-stone-200 flex-shrink-0" style={{ backgroundColor: v.hex }} />
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-stone-700 leading-tight line-clamp-2 break-words">{v.tittel}</span>
        <span className="block text-[10px] text-stone-400 truncate">{v.under}</span>
        {snapperAnnerledes && (
          <span className="block text-[10px] truncate text-stone-400">
            syr som {v.pec.navn}
          </span>
        )}
      </span>
      {v.trad?.forbruksniva === 'oppbrukt' && <span className="text-[10px] text-red-500 flex-shrink-0">Oppbrukt</span>}
      {leggTilModus && iPalett && <span className="text-sm text-stone-700 flex-shrink-0" aria-label="I paletten">✓</span>}
    </button>
  )
}

export function FargePicker({ nuvarendeHex, harOverstyring, mineTrader = [], onVelg, onNullstill, onClose }: {
  nuvarendeHex: string
  // Om "Nullstill til original" skal vises — styrt av om KJØRINGEN faktisk har en
  // brukeroverstyring (fargeOverrideHex), IKKE av om nuvarendeHex tilfeldigvis avviker
  // fra en snappet PEC-farge. De to er ikke det samme lenger: en ekte tråd-substitusjon
  // (se minTraadpalett.ts) endrer nuvarendeHex uten at brukeren har overstyrt noe —
  // sammenligning av hex-verdier ville da feilaktig vist "Nullstill" for enhver kjøring
  // med en ekte tråd i paletten, selv uberørte.
  harOverstyring: boolean
  // Brukerens egne tråder fra Lageret (InventoryItemData sine hex/merke/tradkode-felt,
  // se minTraadpalett.ts) — valgfri prop, siden ikke alle kallere (i dag) har den
  // tilgjengelig. Uten den vises rett og slett bare "Brother 64"-fanen, som før.
  mineTrader?: MinTrad[]
  onVelg: (hex: string) => void
  onNullstill: () => void
  onClose: () => void
}) {
  const [fane, setFane] = useState<Fane>(mineTrader.length > 0 ? 'mine' : 'brother')
  const [palett, setPalett] = useState<PalettFarge[]>([])
  const [modus, setModus] = useState<Modus>('velg')
  const [palettFeil, setPalettFeil] = useState<string | null>(null)
  const [sok, setSok] = useState('')
  const sistBrukte = useSyncExternalStore(abonnerSistBrukte, sistBrukteSnapshot, sistBrukteServerSnapshot)

  useEffect(() => {
    let aktiv = true
    hentPalett().then(p => { if (aktiv) setPalett(p) })
    return () => { aktiv = false }
  }, [])

  const iPalett = useMemo(() => new Set(palett.map(f => f.hex.toLowerCase())), [palett])
  const erValgt = (hex: string) => hex.toLowerCase() === nuvarendeHex.toLowerCase()

  // Eneste vei til onVelg, så «sist brukte» registreres uansett hvor fargen ble valgt fra.
  function velg(hex: string) {
    if (modus === 'leggTil') return
    registrerBrukt(hex)
    onVelg(hex)
  }

  async function leggTil(farge: Omit<PalettFarge, 'id'>) {
    if (iPalett.has(farge.hex.toLowerCase())) return
    try {
      const ny = await leggIPalett(farge)
      setPalett(p => (p.some(f => f.id === ny.id) ? p : [...p, ny]))
      setPalettFeil(null)
    } catch (err) {
      setPalettFeil(err instanceof Error ? err.message : 'Klarte ikke legge til fargen')
    }
  }

  async function fjern(id: string) {
    setPalett(p => p.filter(f => f.id !== id))
    try {
      await fjernFraPalett(id)
      setPalettFeil(null)
    } catch (err) {
      setPalettFeil(err instanceof Error ? err.message : 'Klarte ikke fjerne fargen')
      setPalett(await hentPalett())
    }
  }

  const mineValg = useMemo(() => mineTrader.map(fraTrad), [mineTrader])

  const synlige = useMemo(() => {
    const kilde = fane === 'mine' ? mineValg : fane === 'brother' ? PEC_VALG : [...mineValg, ...PEC_VALG]
    return kilde.filter(v => sokTreffer(sok, v.sokefelter)).sort((a, b) => sammenlignFargetone(a.hex, b.hex))
  }, [fane, mineValg, sok])

  function klikkValg(v: Fargevalg) {
    if (modus !== 'leggTil') { velg(v.hex); return }
    if (v.trad) leggTil({ hex: v.trad.hex, navn: v.trad.navn, tradkode: v.trad.tradkode, merke: v.trad.merke, kilde: 'lager' })
    else leggTil({ hex: v.hex, navn: v.tittel, tradkode: '', merke: '', kilde: 'brother' })
  }

  // Fast høyde (ikke bare maks), så lista får all plass som er igjen under toppen og
  // dialogen ikke hopper i høyde mellom fanene eller mens det søkes.
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col h-[85dvh] sm:h-[80vh]">
        <div className="px-4 pt-3 pb-2 border-b border-stone-100 flex-shrink-0 space-y-2">
          <h3 className="font-serif text-lg text-stone-800">Velg trådfarge</h3>
          <div className="flex gap-1.5">
            <button onClick={() => setFane('mine')} className={faneCls(fane === 'mine')}>Mine tråder</button>
            <button onClick={() => setFane('brother')} className={faneCls(fane === 'brother')}>Brother 64 (PEC)</button>
            <button onClick={() => setFane('alle')} className={faneCls(fane === 'alle')}>Alle</button>
          </div>

          {palett.length > 0 && (
            <div className={`flex items-center gap-1.5 ${modus === 'leggTil' ? 'opacity-40' : ''}`}>
              <span className="text-[10px] font-medium text-stone-400 uppercase tracking-wide w-14 flex-shrink-0">Palett</span>
              <div className="flex gap-1.5 overflow-x-auto py-1 px-0.5 flex-1 [scrollbar-width:none]">
                {palett.map(f => (
                  <div key={f.id} className="relative flex-shrink-0">
                    <button
                      title={f.navn || f.hex}
                      onClick={() => { if (modus === 'velg') velg(f.hex) }}
                      className={ruteCls(erValgt(f.hex))}
                      style={{ backgroundColor: f.hex }}
                    />
                    {modus === 'rediger' && (
                      <button
                        onClick={() => fjern(f.id)}
                        aria-label={`Fjern ${f.navn || f.hex} fra paletten`}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-stone-800 text-white text-[10px] leading-none flex items-center justify-center"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {modus !== 'leggTil' && (
                <button
                  onClick={() => setModus(modus === 'rediger' ? 'velg' : 'rediger')}
                  className="text-xs text-stone-500 hover:text-stone-700 flex-shrink-0"
                >
                  {modus === 'rediger' ? 'Ferdig' : 'Rediger'}
                </button>
              )}
            </div>
          )}

          {sistBrukte.length > 0 && (
            <div className={`flex items-center gap-1.5 ${modus === 'leggTil' ? 'opacity-40' : ''}`}>
              <span className="text-[10px] font-medium text-stone-400 uppercase tracking-wide w-14 flex-shrink-0">Sist brukt</span>
              <div className="flex gap-1.5 overflow-x-auto py-1 px-0.5 flex-1 [scrollbar-width:none]">
                {sistBrukte.map(hex => (
                  <button
                    key={hex}
                    title={hex}
                    onClick={() => { if (modus !== 'leggTil') velg(hex) }}
                    className={ruteCls(erValgt(hex))}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-1.5">
            <input
              type="search"
              value={sok}
              onChange={e => setSok(e.target.value)}
              placeholder="Søk navn eller nummer"
              aria-label="Søk i trådfarger"
              className="flex-1 min-w-0 px-3 py-1.5 text-base sm:text-sm rounded-lg border border-stone-200 focus:outline-none focus:border-stone-400"
            />
            <button
              onClick={() => { setModus(modus === 'leggTil' ? 'velg' : 'leggTil'); setPalettFeil(null) }}
              className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors flex-shrink-0 ${
                modus === 'leggTil'
                  ? 'bg-stone-800 text-white border-stone-800'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
              }`}
            >
              {modus === 'leggTil' ? 'Ferdig' : '+ Palett'}
            </button>
          </div>
          {palettFeil && <p className="text-xs text-amber-700">{palettFeil}</p>}
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-3">
          {fane === 'mine' && mineTrader.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-8">
              Ingen tråder i Lageret ennå. Legg inn farge på en broderitråd under Lager
              for å se den her.
            </p>
          ) : synlige.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-8">Ingen farger passer søket.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {synlige.map(v => (
                <FargeKort
                  key={v.key}
                  v={v}
                  valgt={erValgt(v.hex)}
                  iPalett={iPalett.has(v.hex.toLowerCase())}
                  leggTilModus={modus === 'leggTil'}
                  onClick={() => klikkValg(v)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 flex-shrink-0 flex gap-2">
          {harOverstyring && (
            <button
              onClick={onNullstill}
              className="flex-1 py-2 text-sm text-stone-500 hover:text-stone-700 border border-stone-200 rounded-xl transition-colors"
            >
              Nullstill til original
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm text-white bg-stone-800 hover:bg-stone-700 rounded-xl transition-colors"
          >
            Lukk
          </button>
        </div>
      </div>
    </div>
  )
}
