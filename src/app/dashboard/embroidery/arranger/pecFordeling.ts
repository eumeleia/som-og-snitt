import { BROTHER_PALETT, snappTilPalett } from './broderPalett'
import { deltaE2000Hex } from './fargeavstand'
import { effektivFargeRaa, type SekvensKontekst } from './sekvens'
import type { SekvensElement } from './types'

// En tråd som må flyttes lenger enn dette til en ledig PEC-farge, får ikke ny farge. Den
// beholder kollisjonen, og varselet «Samme tråd som neste kjøring» tar over.
export const MAKS_OMFORDELING_DE = 30

type PecFarge = { hex: string; navn: string }

// Gir hver DISTINKTE tråd i komposisjonen sin egen PEC-farge, så maskinen ber om trådskift
// mellom to ulike tråder som ellers ville snappet til samme farge. Nøkkelen er tråden slik
// brukeren valgte den: rå hex (overstyring, ellers kildefilens farge), små bokstaver.
//
// Resultatet avhenger bare av MENGDEN tråder, ikke rekkefølgen i sekvensen — sammenslåings-
// forslagene simulerer omrokkeringer med samme tildeling og ville ellers regnet feil.
export function fordelPecFarger(sekvens: SekvensElement[], ctx: SekvensKontekst): Map<string, PecFarge> {
  const traader = new Set<string>()
  for (const el of sekvens) {
    if (el.type !== 'kjoring') continue
    const raa = effektivFargeRaa(ctx, el)
    if (raa) traader.add(raa.toLowerCase())
  }

  const ut = new Map<string, PecFarge>()
  const grupper = new Map<string, { hex: string; avstand: number }[]>()
  for (const hex of [...traader].sort()) {
    const pec = snappTilPalett(hex)
    ut.set(hex, pec)
    const gruppe = grupper.get(pec.hex) ?? []
    gruppe.push({ hex, avstand: deltaE2000Hex(hex, pec.hex) })
    grupper.set(pec.hex, gruppe)
  }

  // Den nærmeste i hver gruppe beholder plassen; resten skal flyttes.
  const flyttes: string[] = []
  for (const gruppe of grupper.values()) {
    if (gruppe.length < 2) continue
    gruppe.sort((a, b) => a.avstand - b.avstand || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0))
    flyttes.push(...gruppe.slice(1).map(m => m.hex))
  }
  if (flyttes.length === 0) return ut

  // Grådig over alle (tråd, ledig farge)-par, korteste avstand først. Likhet brytes på
  // trådens hex og så på indeks i BROTHER_PALETT, så svaret er deterministisk.
  const opptatt = new Set(grupper.keys())
  const kandidater: { hex: string; idx: number; avstand: number }[] = []
  for (const hex of flyttes) {
    BROTHER_PALETT.forEach((f, idx) => {
      if (opptatt.has(f.hex)) return
      const avstand = deltaE2000Hex(hex, f.hex)
      if (avstand <= MAKS_OMFORDELING_DE) kandidater.push({ hex, idx, avstand })
    })
  }
  kandidater.sort((a, b) => a.avstand - b.avstand || (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0) || a.idx - b.idx)

  const flyttet = new Set<string>()
  for (const k of kandidater) {
    const farge = BROTHER_PALETT[k.idx]
    if (flyttet.has(k.hex) || opptatt.has(farge.hex)) continue
    ut.set(k.hex, farge)
    opptatt.add(farge.hex)
    flyttet.add(k.hex)
  }
  return ut
}
