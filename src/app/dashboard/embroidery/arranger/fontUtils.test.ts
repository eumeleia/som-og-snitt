import { describe, it, expect } from 'vitest'
import { buildFontData, layoutTekst, klassifiser } from './fontUtils'
import type { Embroidery, VirtuelMotiv } from './types'

// Ekte, målte bbokser fra Seraphine 2" (docs/fontmaling-2026-08-13.md), bredde×høyde i mm.
const SERAPHINE_2IN: Record<string, { widthMm: number; heightMm: number }> = {
  H: { widthMm: 72.2, heightMm: 51.6 },
  A: { widthMm: 65.8, heightMm: 51.6 },
  O: { widthMm: 45.2, heightMm: 51.6 },
  o: { widthMm: 16.6, heightMm: 16.7 },
  c: { widthMm: 18.0, heightMm: 16.4 },
  e: { widthMm: 18.1, heightMm: 15.8 },
  g: { widthMm: 22.1, heightMm: 27.3 },
  p: { widthMm: 29.9, heightMm: 42.3 },
  y: { widthMm: 27.5, heightMm: 30.9 },
}

function vm(tegn: string): VirtuelMotiv {
  return {
    key: tegn, bundleId: 'b-sera', identitet: tegn, navn: tegn,
    coverImage: '', kats: [], katArvet: false,
    karakter: { tegn, type: /[A-ZÆØÅ]/.test(tegn) ? 'stor' : 'liten' },
    sizes: [{ embroideryId: `e-${tegn}`, sizeId: 's', tommeLabel: '2', sizeLabel: '2"' }],
  }
}

function emb(tegn: string): Embroidery {
  const { widthMm, heightMm } = SERAPHINE_2IN[tegn]
  return {
    id: `e-${tegn}`, created_at: '',
    data: {
      navn: tegn, coverImage: '', bmpPreview: '', customImage: '', useCustomImage: false,
      sizes: [{ id: 's', sizeLabel: '2"', pesUrl: '', pesFilename: `${tegn}.pes`, widthMm, heightMm }],
    },
  }
}

const ALLE_TEGN = Object.keys(SERAPHINE_2IN)
const vms = ALLE_TEGN.map(vm)
const biblioteket = ALLE_TEGN.map(emb)

// Verner Steg 3 i fontarbeidet — grunnlinje for underlengder MÅLT fra xHeight, ikke gjettet.
describe('klassifiser', () => {
  it('z har INGEN underlengde — feilen dokumentert i docs/fontmaling-2026-08-13.md', () => {
    expect(klassifiser('z')).toBe('x-hoyde')
  })

  it('r u v w x er x-høyde — manglet i den gamle X_HEIGHT_REF-lista', () => {
    for (const tegn of ['r', 'u', 'v', 'w', 'x']) expect(klassifiser(tegn)).toBe('x-hoyde')
  })

  it('f og j behandles som underlengde (usikkert til sett visuelt, se kommentar i fontUtils.ts)', () => {
    expect(klassifiser('f')).toBe('underlengde')
    expect(klassifiser('j')).toBe('underlengde')
  })

  it('g p q y er underlengde, b d h k l t er overlengde', () => {
    for (const tegn of ['g', 'p', 'q', 'y']) expect(klassifiser(tegn)).toBe('underlengde')
    for (const tegn of ['b', 'd', 'h', 'k', 'l', 't']) expect(klassifiser(tegn)).toBe('overlengde')
  })

  it('store bokstaver og siffer klassifiseres uavhengig av bokstavlistene', () => {
    expect(klassifiser('O')).toBe('versal')
    expect(klassifiser('5')).toBe('tall')
  })
})

describe('buildFontData — målt xHeight fra Seraphine 2"', () => {
  it('xHeight = median(o, c, e) = 164 (1/10 mm), og er markert MÅLT', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    expect(Math.round(fd.metrics.xHeight * 10)).toBe(164)
    expect(fd.metrics.xHeightMalt).toBe(true)
  })

  it('H, A, O, o, c, e står på egen bunn — bifMm = heightMm, offset 0', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    for (const tegn of ['H', 'A', 'O', 'o', 'c', 'e']) {
      const t = fd.tegn[tegn]
      expect(Math.round(t.bifMm * 10)).toBe(Math.round(SERAPHINE_2IN[tegn].heightMm * 10))
    }
  })

  it('g p y får grunnlinjen ved MÅLT xHeight — offset 109/259/145 (1/10 mm)', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    const xHeightTiendedel = Math.round(fd.metrics.xHeight * 10) // 164

    for (const [tegn, forventetOffsetTiendedel] of [['g', 109], ['p', 259], ['y', 145]] as const) {
      const t = fd.tegn[tegn]
      const offsetTiendedel = Math.round(t.heightMm * 10) - Math.round(t.bifMm * 10)
      expect(offsetTiendedel).toBe(forventetOffsetTiendedel)
      expect(Math.round(t.bifMm * 10)).toBe(xHeightTiendedel) // grunnlinjen er selve xHeight
    }
  })

  it('ingen x-høyde-bokstaver i alfabetet → xHeightMalt false, underlengder faller til egen bunn', () => {
    const kunUnderlengder = ['g', 'p', 'y'].map(vm)
    const kunUnderlengderBibl = ['g', 'p', 'y'].map(emb)
    const fd = buildFontData(kunUnderlengder, '2', kunUnderlengderBibl)
    expect(fd.metrics.xHeightMalt).toBe(false)
    for (const tegn of ['g', 'p', 'y']) {
      expect(Math.round(fd.tegn[tegn].bifMm * 10)).toBe(Math.round(SERAPHINE_2IN[tegn].heightMm * 10))
    }
  })
})

describe('layoutTekst — «Hoppy»: H og o på samme grunnlinje, p og y stikker under', () => {
  it('H og o har offset 0 (samme bbox-bunn), p og y stikker 259/145 (1/10 mm) under', () => {
    const fd = buildFontData(vms, '2', biblioteket)
    const layout = layoutTekst('Hoppy', fd, { tracking: 0, mellomromFaktor: 0.6 })

    expect(layout.bokstaver.map(b => b.tegn)).toEqual(['H', 'o', 'p', 'p', 'y'])

    function offsetTiendedel(tegn: string) {
      const b = layout.bokstaver.find(x => x.tegn === tegn)!
      return Math.round(b.info.heightMm * 10) - Math.round(b.info.bifMm * 10)
    }

    expect(offsetTiendedel('H')).toBe(0)
    expect(offsetTiendedel('o')).toBe(0)
    expect(offsetTiendedel('p')).toBe(259)
    expect(offsetTiendedel('y')).toBe(145)
  })
})
