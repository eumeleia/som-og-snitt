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

    // IKKE nødvendigvis den snappede PEC-fargen — med en treffende egen tråd (ctx.pecTilEkte,
    // se minTraadpalett.ts) er dette brukerens EGEN trådhex, ikke palettverdien. To steg, ikke
    // ett idempotent: (1) Python snapper uansett DENNE hex-en til nærmeste PEC-farge ved
    // skriving, (2) det gir riktig svar BARE fordi byggPecTilEkteMap nøkler sin ekte-tråd på
    // nøyaktig snappTilPalett(trad.hex) — samme snap Python selv ville kommet til. Frontend
    // viste FØR eksport (og selvsjekkens fasit ETTER) stemmer derfor overens fordi begge
    // ender opp i samme PEC-bøtte, ikke fordi verdien herfra allerede ER den bøtta.
    const fargeHex = effektivTradfarge(ctx, el)?.hex
    if (!fargeHex) return null

    segmenter.push({ type: 'kjoring', farge_hex: fargeHex, blokker })
  }

  return segmenter
}
