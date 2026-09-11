import { describe, it, expect } from 'vitest'
import { ryddOppEnkeltmedlemsgrupper, utvidTilGrupper, nyttUtvalgVedKlikk } from './grupper'
import type { PlassertMotiv } from './types'

function pm(id: string, overrides: Partial<PlassertMotiv> = {}): PlassertMotiv {
  return {
    id, embroideryId: `e-${id}`, sizeId: `s-${id}`, navn: id,
    posisjonXTiendedelMm: 0, posisjonYTiendedelMm: 0, rotasjonGrader: 0,
    ...overrides,
  }
}

describe('ryddOppEnkeltmedlemsgrupper', () => {
  it('en gruppe på tre medlemmer beholdes uendret', () => {
    const motiver = [pm('a', { gruppeId: 'g1' }), pm('b', { gruppeId: 'g1' }), pm('c', { gruppeId: 'g1' })]
    expect(ryddOppEnkeltmedlemsgrupper(motiver)).toEqual(motiver)
  })

  it('en gruppe som er krympet til ett medlem mister gruppeId', () => {
    const motiver = [pm('a', { gruppeId: 'g1' }), pm('b', { gruppeId: 'g2' })]
    const ryddet = ryddOppEnkeltmedlemsgrupper(motiver)
    expect(ryddet.find(m => m.id === 'a')?.gruppeId).toBeUndefined()
    expect(ryddet.find(m => m.id === 'b')?.gruppeId).toBeUndefined()
  })

  it('en gruppe på to medlemmer beholdes', () => {
    const motiver = [pm('a', { gruppeId: 'g1' }), pm('b', { gruppeId: 'g1' }), pm('c')]
    const ryddet = ryddOppEnkeltmedlemsgrupper(motiver)
    expect(ryddet.find(m => m.id === 'a')?.gruppeId).toBe('g1')
    expect(ryddet.find(m => m.id === 'b')?.gruppeId).toBe('g1')
  })

  it('rører ikke ugrupperte motiver', () => {
    const motiver = [pm('a'), pm('b')]
    expect(ryddOppEnkeltmedlemsgrupper(motiver)).toEqual(motiver)
  })

  it('fjerner også gruppeNavn når gruppen løses opp av seg selv', () => {
    const motiver = [pm('a', { gruppeId: 'g1', gruppeNavn: 'Blomsterbukett' }), pm('b')]
    const ryddet = ryddOppEnkeltmedlemsgrupper(motiver)
    expect(ryddet.find(m => m.id === 'a')?.gruppeNavn).toBeUndefined()
  })
})

describe('utvidTilGrupper', () => {
  const motiver = [
    pm('a', { gruppeId: 'g1' }), pm('b', { gruppeId: 'g1' }), pm('c', { gruppeId: 'g1' }),
    pm('d', { gruppeId: 'g2' }), pm('e', { gruppeId: 'g2' }),
    pm('f'),
  ]

  it('et id uten gruppe gir seg selv uendret', () => {
    expect(utvidTilGrupper(new Set(['f']), motiver)).toEqual(new Set(['f']))
  })

  it('ett medlem av en gruppe utvides til hele gruppen', () => {
    expect(utvidTilGrupper(new Set(['a']), motiver)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('id-er fra to ulike grupper utvides til unionen av begge', () => {
    expect(utvidTilGrupper(new Set(['a', 'd']), motiver)).toEqual(new Set(['a', 'b', 'c', 'd', 'e']))
  })

  it('blanding av gruppert og ugruppert id beholder det ugrupperte som det er', () => {
    expect(utvidTilGrupper(new Set(['a', 'f']), motiver)).toEqual(new Set(['a', 'b', 'c', 'f']))
  })
})

describe('nyttUtvalgVedKlikk', () => {
  const motiver = [
    pm('a', { gruppeId: 'g1' }), pm('b', { gruppeId: 'g1' }), pm('c', { gruppeId: 'g1' }),
    pm('d'),
  ]
  const ingenModifikator = { shiftKey: false, metaKey: false, ctrlKey: false, altKey: false }

  it('vanlig klikk på et gruppemedlem velger hele gruppen', () => {
    const resultat = nyttUtvalgVedKlikk(ingenModifikator, motiver[0], new Set(), motiver)
    expect(resultat).toEqual(new Set(['a', 'b', 'c']))
  })

  it('vanlig klikk på et ugruppert motiv erstatter utvalget med bare det ene', () => {
    const resultat = nyttUtvalgVedKlikk(ingenModifikator, pm('d'), new Set(['a', 'b', 'c']), motiver)
    expect(resultat).toEqual(new Set(['d']))
  })

  it('shift-klikk legger til hele gruppen når den ikke er valgt', () => {
    const resultat = nyttUtvalgVedKlikk({ ...ingenModifikator, shiftKey: true }, motiver[0], new Set(['d']), motiver)
    expect(resultat).toEqual(new Set(['d', 'a', 'b', 'c']))
  })

  it('shift-klikk fjerner hele gruppen når den allerede er valgt', () => {
    const resultat = nyttUtvalgVedKlikk(
      { ...ingenModifikator, shiftKey: true }, motiver[0], new Set(['a', 'b', 'c', 'd']), motiver,
    )
    expect(resultat).toEqual(new Set(['d']))
  })

  it('alt-klikk velger bare det ene motivet, uten å løse opp gruppen', () => {
    const resultat = nyttUtvalgVedKlikk({ ...ingenModifikator, altKey: true }, motiver[0], new Set(['a', 'b', 'c']), motiver)
    expect(resultat).toEqual(new Set(['a']))
  })

  it('vanlig klikk på et medlem som er del av et større, allerede valgt utvalg beholder hele utvalget', () => {
    // Flervalg på tvers av en gruppe og et løst motiv (t.d. dratt sammen på lerretet
    // tidligere) — et nytt, vanlig klikk på ett av dem skal ikke redusere utvalget.
    const resultat = nyttUtvalgVedKlikk(ingenModifikator, motiver[0], new Set(['a', 'd']), motiver)
    expect(resultat).toEqual(new Set(['a', 'b', 'c', 'd']))
  })
})
