import { plassertPunkter } from './geometri'
import { finnFargekjoring, effektivTradfarge, type SekvensKontekst } from './sekvens'
import type { SekvensElement } from './types'

export interface EksportKjoringSegment {
  type: 'kjoring'
  farge_hex: string
  blokker: [number, number][][]
}

export interface EksportPauseSegment {
  type: 'pause'
}

export type EksportSegment = EksportKjoringSegment | EksportPauseSegment

// Bygger den ordnede segmentlisten Python-eksportfunksjonen skriver PES fra. Koordinatene
// er allerede rotert+plassert her — via plassertPunkter, nøyaktig samme transformasjon
// (roterLokalePunkter + translasjon) som rendringen og bbox-sjekken i steg 3 bruker, ikke
// en egen variant for eksport. Stingblokkene innad i en kjøring beholder sin egen
// rekkefølge urørt (fra_index..til_index, uendret). Returnerer null hvis noe motiv i
// sekvensen ikke er tolket ferdig ennå — eksport skal ikke kunne startes med hull i dataen.
export function byggEksportSegmenter(sekvens: SekvensElement[], ctx: SekvensKontekst): EksportSegment[] | null {
  const segmenter: EksportSegment[] = []

  for (const el of sekvens) {
    if (el.type === 'pause') {
      segmenter.push({ type: 'pause' })
      continue
    }

    const funn = finnFargekjoring(ctx, el)
    if (!funn) return null
    const { pm, data, kjoring } = funn
    const motivBbox = data.bbox
    if (!motivBbox) return null

    const blokker: [number, number][][] = []
    for (let i = kjoring.fra_index; i <= kjoring.til_index; i++) {
      const blokk = data.stingblokker[i]
      if (!blokk) continue
      blokker.push(plassertPunkter(blokk.sting, motivBbox, pm.rotasjonGrader, pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm))
    }
    if (blokker.length === 0) continue

    // Den ferdig snappede PEC-fargen, ikke brukerens egen trådhex (tradfarge.hex). Python
    // snapper med pyembroiderys rødmiddel-avstand, som sender en egen trådhex til en annen
    // PEC-farge enn snappTilPalett (CIEDE2000) gjør — en palettverdi snapper derimot til
    // seg selv, så fila får akkurat den fargen skjermen viser.
    const fargeHex = effektivTradfarge(ctx, el)?.pecHex
    if (!fargeHex) return null

    segmenter.push({ type: 'kjoring', farge_hex: fargeHex, blokker })
  }

  return segmenter
}
