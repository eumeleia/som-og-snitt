'use client'

import { useMemo, useState } from 'react'
import { BROTHER_PALETT } from './broderPalett'
import type { MinTrad } from './minTraadpalett'

type Fane = 'mine' | 'brother' | 'alle'

function faneCls(aktiv: boolean): string {
  return `px-3 py-1.5 rounded-lg text-xs border transition-colors ${
    aktiv ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-500 border-stone-200 hover:border-stone-400'
  }`
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

  const grupperPaMerke = useMemo(() => {
    const m = new Map<string, MinTrad[]>()
    for (const t of mineTrader) {
      const arr = m.get(t.merke) ?? []
      arr.push(t)
      m.set(t.merke, arr)
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'nb'))
  }, [mineTrader])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="px-5 py-4 border-b border-stone-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-stone-800 mb-3">Velg trådfarge</h3>
          <div className="flex gap-1.5">
            <button onClick={() => setFane('mine')} className={faneCls(fane === 'mine')}>Mine tråder</button>
            <button onClick={() => setFane('brother')} className={faneCls(fane === 'brother')}>Brother 64 (PEC)</button>
            <button onClick={() => setFane('alle')} className={faneCls(fane === 'alle')}>Alle</button>
          </div>
          {fane !== 'brother' && (
            <p className="text-xs text-stone-400 mt-2">
              Uansett hvilken farge du velger her, snapper selve PES-filen den til nærmeste
              av Brothers 64 PEC-farger når den bygges — se farge du velger er bare hva DU
              ser på skjermen, ikke en ny eksportfarge.
            </p>
          )}
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-4 space-y-4">
          {(fane === 'mine' || fane === 'alle') && (
            mineTrader.length === 0 ? (
              fane === 'mine' && (
                <p className="text-sm text-stone-400 text-center py-8">
                  Ingen tråder i Lageret ennå. Legg inn farge på en broderitråd under Lager
                  for å se den her.
                </p>
              )
            ) : (
              <>
                {fane === 'alle' && (
                  <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">Mine tråder</p>
                )}
                {grupperPaMerke.map(([merke, trader]) => (
                  <div key={merke}>
                    <p className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-1.5">{merke}</p>
                    <div className="space-y-1">
                      {trader.map(t => (
                        <button
                          key={t.id}
                          onClick={() => onVelg(t.hex)}
                          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg border text-left transition-colors ${
                            t.hex.toLowerCase() === nuvarendeHex.toLowerCase()
                              ? 'border-stone-800 bg-stone-50'
                              : 'border-transparent hover:bg-stone-50'
                          }`}
                        >
                          <span className="w-6 h-6 rounded-md border border-stone-200 flex-shrink-0" style={{ backgroundColor: t.hex }} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm text-stone-700 truncate">{t.navn}</span>
                            <span className="block text-xs text-stone-400 truncate">{t.tradkode || t.hex}</span>
                          </span>
                          {t.forbruksniva === 'oppbrukt' && (
                            <span className="text-[10px] text-red-500 flex-shrink-0">Oppbrukt</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )
          )}

          {(fane === 'brother' || fane === 'alle') && (
            <div>
              {fane === 'alle' && (
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-1.5">Brother 64 (PEC)</p>
              )}
              <div className="grid grid-cols-8 gap-2">
                {BROTHER_PALETT.map(f => (
                  <button
                    key={f.hex}
                    title={f.navn}
                    onClick={() => onVelg(f.hex)}
                    className={`w-full aspect-square rounded-lg border-2 transition-all ${
                      f.hex === nuvarendeHex ? 'border-stone-800 scale-110' : 'border-stone-200 hover:border-stone-400'
                    }`}
                    style={{ backgroundColor: f.hex }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-100 flex-shrink-0 flex gap-2">
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
