import { describe, it, expect } from 'vitest'
import { byggEksportSegmenter, type EksportKjoringSegment } from './eksport'
import { tellOmtredninger, type SekvensKontekst } from './sekvens'
import { byggPecTilEkteMap, type MinTrad } from './minTraadpalett'
import type { BroderiBbox, BroderiMotivData, SekvensElement } from './types'

const BBOX: BroderiBbox = { min_x: 0, max_x: 10, min_y: 0, max_y: 10 }

function kjoring(farge_hex: string, idx: number) {
  return { farge_hex, tradnavn_auto: null, fra_index: idx, til_index: idx, antall_blokker: 1, antall_sting: 2 }
}

function kontekst(mineTrader: MinTrad[] = []): SekvensKontekst {
  const farger = ['#10140c', '#111111', '#ed171f', '#1a1a1a']
  const data: BroderiMotivData = {
    enhet: 'mm', bbox: BBOX, total_sting: 8,
    stingblokker: farger.map(farge_hex => ({ farge_hex, tradnavn_auto: null, antall_sting: 2, sting: [[0, 0], [10, 10]], bbox: BBOX })),
    fargekjoringer: farger.map(kjoring),
  }
  return {
    motiver: [{ id: 'pm', embroideryId: 'e', sizeId: 's', navn: 'Motiv', posisjonXTiendedelMm: 0, posisjonYTiendedelMm: 0, rotasjonGrader: 0 }],
    resolved: { 'e:s': data },
    pecTilEkte: byggPecTilEkteMap(mineTrader),
  }
}

const SEKVENS: SekvensElement[] = [0, 1, 2, 3].map(i => ({ id: `el${i}`, type: 'kjoring', plassertMotivId: 'pm', fargekjoringIndex: i }))

const EGEN_TRAD: MinTrad = { id: 't', hex: '#10140c', navn: '747 Dark Grey', merke: 'Brother', tradkode: 'CYT-747' }

describe('byggEksportSegmenter', () => {
  it('sender den snappede PEC-fargen, ikke egen trådhex, til Python', () => {
    const segmenter = byggEksportSegmenter(SEKVENS, kontekst([EGEN_TRAD]))!
    const farger = segmenter.map(s => (s as EksportKjoringSegment).farge_hex)
    expect(farger).toEqual(['#000000', '#000000', '#ed171f', '#000000'])
  })

  it('antall fargekjøringer etter sammenslåing er likt på skjermen og i segmentene', () => {
    const ctx = kontekst([EGEN_TRAD])
    const segmenter = byggEksportSegmenter(SEKVENS, ctx)!
    let iFila = 0
    let forrige: string | null = null
    for (const s of segmenter) {
      if (s.type !== 'kjoring') { forrige = null; continue }
      if (s.farge_hex !== forrige) iFila++
      forrige = s.farge_hex
    }
    expect(tellOmtredninger(SEKVENS, ctx)).toBe(3)
    expect(iFila).toBe(3)
  })

  it('en PEC-farge valgt direkte sendes uendret', () => {
    const sekvens: SekvensElement[] = [{ id: 'el0', type: 'kjoring', plassertMotivId: 'pm', fargekjoringIndex: 2, fargeOverrideHex: '#293133' }]
    const segmenter = byggEksportSegmenter(sekvens, kontekst())!
    expect((segmenter[0] as EksportKjoringSegment).farge_hex).toBe('#293133')
  })
})
