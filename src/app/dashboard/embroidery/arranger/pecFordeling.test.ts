import { describe, it, expect } from 'vitest'
import { fordelPecFarger, MAKS_OMFORDELING_DE } from './pecFordeling'
import { BROTHER_PALETT, snappTilPalett } from './broderPalett'
import { deltaE2000Hex } from './fargeavstand'
import { byggSekvensKontekst, byggTradoppslag } from './kontekst'
import { byggEksportSegmenter, type EksportKjoringSegment } from './eksport'
import { effektivTradfarge, tellOmtredninger, type SekvensKontekst } from './sekvens'
import type { MinTrad } from './minTraadpalett'
import type { BroderiBbox, BroderiMotivData, SekvensElement, SekvensKjoring } from './types'

// Kjøringer med overstyrt farge trenger ingen motivdata for å ha en rå farge.
const TOM_CTX: SekvensKontekst = { motiver: [], resolved: {} }

function kjoringer(...hexer: string[]): SekvensKjoring[] {
  return hexer.map((hex, i) => ({ id: `el${i}`, type: 'kjoring', plassertMotivId: 'pm', fargekjoringIndex: 0, fargeOverrideHex: hex }))
}

const BLACK = '#000000'

// Nærmeste PEC-farge som ikke er i `opptatt` — fasiten testene sammenligner mot.
function naermesteLedige(hex: string, opptatt: string[]): string {
  let best = ''
  let bestDe = Infinity
  for (const f of BROTHER_PALETT) {
    if (opptatt.includes(f.hex)) continue
    const de = deltaE2000Hex(hex, f.hex)
    if (de < bestDe) { bestDe = de; best = f.hex }
  }
  return best
}

describe('fordelPecFarger', () => {
  it('uten kollisjon: hver tråd får sin vanlige snappede farge', () => {
    const traader = ['#ed171f', '#0a55a3', '#10140c', '#fd566e']
    const ut = fordelPecFarger(kjoringer(...traader), TOM_CTX)
    expect(ut.size).toBe(4)
    for (const hex of traader) expect(ut.get(hex)).toEqual(snappTilPalett(hex))
  })

  it('to tråder i samme gruppe: den nærmeste beholder fargen, den andre flyttes til nærmeste ledige', () => {
    // Begge snapper til Black; #111111 ligger nærmest.
    expect(snappTilPalett('#10140c').hex).toBe(BLACK)
    expect(snappTilPalett('#111111').hex).toBe(BLACK)
    expect(deltaE2000Hex('#111111', BLACK)).toBeLessThan(deltaE2000Hex('#10140c', BLACK))

    const ut = fordelPecFarger(kjoringer('#10140c', '#111111'), TOM_CTX)
    expect(ut.get('#111111')!.hex).toBe(BLACK)
    expect(ut.get('#10140c')!.hex).toBe(naermesteLedige('#10140c', [BLACK]))
    expect(ut.get('#10140c')!.hex).not.toBe(BLACK)
  })

  it('tre tråder i samme gruppe får tre ulike farger', () => {
    const traader = ['#10140c', '#111111', '#1a1a1a']
    for (const hex of traader) expect(snappTilPalett(hex).hex).toBe(BLACK)
    const ut = fordelPecFarger(kjoringer(...traader), TOM_CTX)
    const farger = traader.map(h => ut.get(h)!.hex)
    expect(new Set(farger).size).toBe(3)
    expect(ut.get('#111111')!.hex).toBe(BLACK)
  })

  it('samme tråd i flere kjøringer teller som én (også med ulik skrivemåte av hex)', () => {
    const ut = fordelPecFarger(kjoringer('#10140c', '#ED171F', '#10140C', '#ed171f'), TOM_CTX)
    expect([...ut.keys()].sort()).toEqual(['#10140c', '#ed171f'])
    expect(ut.get('#10140c')!.hex).toBe(BLACK)
  })

  it('gir samme resultat uansett rekkefølge i sekvensen', () => {
    const traader = ['#10140c', '#111111', '#1a1a1a', '#ed171f', '#e70268', '#fd566e', '#2a1301', '#260605']
    const fasit = fordelPecFarger(kjoringer(...traader), TOM_CTX)
    const rekkefolger = [
      [...traader].reverse(),
      [traader[3], traader[6], traader[0], traader[7], traader[2], traader[5], traader[1], traader[4]],
    ]
    for (const r of rekkefolger) {
      const ut = fordelPecFarger(kjoringer(...r), TOM_CTX)
      expect(Object.fromEntries(ut)).toEqual(Object.fromEntries(fasit))
    }
  })

  it('en tråd som bare kan flyttes lenger enn MAKS_OMFORDELING_DE beholder kollisjonen', () => {
    // Alle palettfarger er opptatt av eksakte tråder unntatt Yellow, som er langt unna #010101.
    const yellow = '#ffff00'
    expect(deltaE2000Hex('#010101', yellow)).toBeGreaterThan(MAKS_OMFORDELING_DE)
    const opptatte = BROTHER_PALETT.map(f => f.hex).filter(h => h !== yellow)
    const ut = fordelPecFarger(kjoringer(...opptatte, '#010101'), TOM_CTX)
    expect(ut.get('#010101')!.hex).toBe(BLACK)
    expect(ut.get(BLACK)!.hex).toBe(BLACK)
  })

  it('uten noen ledig farge igjen beholder tråden kollisjonen', () => {
    const alle = BROTHER_PALETT.map(f => f.hex)
    const ut = fordelPecFarger(kjoringer(...alle, '#010101'), TOM_CTX)
    expect(ut.get('#010101')!.hex).toBe(BLACK)
  })
})

describe('koblingen gjennom byggSekvensKontekst', () => {
  const BBOX: BroderiBbox = { min_x: 0, max_x: 10, min_y: 0, max_y: 10 }
  // To av brukerens egne tråder som begge snapper til Black, pluss en rød.
  const MINE: MinTrad[] = [
    { id: 'a', hex: '#1d1803', navn: '717 Dark Brown', merke: 'Brother', tradkode: 'CYT-717' },
    { id: 'b', hex: '#10140c', navn: '747 Dark Grey', merke: 'Brother', tradkode: 'CYT-747' },
  ]
  const data: BroderiMotivData = {
    enhet: 'mm', bbox: BBOX, total_sting: 6,
    stingblokker: ['#1d1803', '#10140c', '#ed171f'].map(farge_hex => ({ farge_hex, tradnavn_auto: null, antall_sting: 2, sting: [[0, 0], [10, 10]], bbox: BBOX })),
    fargekjoringer: ['#1d1803', '#10140c', '#ed171f'].map((farge_hex, i) => ({ farge_hex, tradnavn_auto: null, fra_index: i, til_index: i, antall_blokker: 1, antall_sting: 2 })),
  }
  const motiver = [{ id: 'pm', embroideryId: 'e', sizeId: 's', navn: 'M', posisjonXTiendedelMm: 0, posisjonYTiendedelMm: 0, rotasjonGrader: 0 }]
  const resolved = { 'e:s': data }
  const el = (i: number): SekvensKjoring => ({ id: `k${i}`, type: 'kjoring', plassertMotivId: 'pm', fargekjoringIndex: i })

  it('to ulike egne tråder som før kolliderte, får ulike PEC-farger, vises som seg selv og gir to fargeskift', () => {
    expect(snappTilPalett('#1d1803').hex).toBe(BLACK)
    expect(snappTilPalett('#10140c').hex).toBe(BLACK)
    const sekvens: SekvensElement[] = [el(0), el(1), el(2)]
    const ctx = byggSekvensKontekst(motiver, resolved, byggTradoppslag(MINE), sekvens)

    const a = effektivTradfarge(ctx, el(0))!
    const b = effektivTradfarge(ctx, el(1))!
    expect(a.navn).toBe('717 Dark Brown')
    expect(b.navn).toBe('747 Dark Grey')
    expect(a.pecHex).not.toBe(b.pecHex)

    const segmenter = byggEksportSegmenter(sekvens, ctx)! as EksportKjoringSegment[]
    expect(segmenter.map(s => s.farge_hex)).toEqual([a.pecHex, b.pecHex, '#ed171f'])
    expect(tellOmtredninger(sekvens, ctx)).toBe(3)
  })

  it('samme tråd i to kjøringer etter hverandre har fortsatt samme PEC-farge (kollisjonsvarselet slår inn)', () => {
    const sekvens: SekvensElement[] = [el(1), { ...el(1), id: 'k1b' }, el(2)]
    const ctx = byggSekvensKontekst(motiver, resolved, byggTradoppslag(MINE), sekvens)
    expect(effektivTradfarge(ctx, sekvens[0] as SekvensKjoring)!.pecHex).toBe(effektivTradfarge(ctx, sekvens[1] as SekvensKjoring)!.pecHex)
    expect(tellOmtredninger(sekvens, ctx)).toBe(2)
  })

  it('uten kollisjon eksporteres nøyaktig samme farger som uten tildeling', () => {
    const sekvens: SekvensElement[] = [el(1), el(2)]
    const uten = byggEksportSegmenter(sekvens, { motiver, resolved, ...byggTradoppslag(MINE) })!
    const med = byggEksportSegmenter(sekvens, byggSekvensKontekst(motiver, resolved, byggTradoppslag(MINE), sekvens))!
    expect(med).toEqual(uten)
  })

  it('en egen tråd som er flyttet, vises ikke på en annen rad som har tråden sin opprinnelige PEC-farge', () => {
    // 255 Light Brown (#682408) snapper til Dark Brown, men kildefargen #2a1301 ER Dark Brown
    // og beholder plassen. Tråden flyttes; kilderaden skal da ikke vise «255 Light Brown».
    const egen: MinTrad = { id: 'c', hex: '#682408', navn: '255 Light Brown', merke: 'Brother', tradkode: 'CYT-255' }
    expect(snappTilPalett('#682408').hex).toBe('#2a1301')
    const sekvens: SekvensElement[] = kjoringer('#682408', '#2a1301')
    const ctx = byggSekvensKontekst([], {}, byggTradoppslag([egen]), sekvens)
    const traden = effektivTradfarge(ctx, sekvens[0] as SekvensKjoring)!
    const kilden = effektivTradfarge(ctx, sekvens[1] as SekvensKjoring)!
    expect(traden.navn).toBe('255 Light Brown')
    expect(traden.pecHex).not.toBe('#2a1301')
    expect(kilden.pecHex).toBe('#2a1301')
    expect(kilden.navn).toBe('Dark Brown')
  })
})
