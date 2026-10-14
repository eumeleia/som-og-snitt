import { describe, it, expect } from 'vitest'
import { snappTilPalett, BROTHER_PALETT } from './broderPalett'

describe('snappTilPalett (CIEDE2000)', () => {
  it('snapper mørke nesten-svarte farger til Black, ikke Dark Brown/Olive Green', () => {
    for (const hex of ['#10140c', '#111111', '#1a1a1a']) {
      expect(snappTilPalett(hex)).toEqual({ hex: '#000000', navn: 'Black' })
    }
  })

  it('en PEC-farge valgt direkte forblir uendret — alle 64', () => {
    for (const f of BROTHER_PALETT) {
      expect(snappTilPalett(f.hex)).toBe(f)
    }
  })

  it('godtar store bokstaver i hex', () => {
    expect(snappTilPalett('#ED171F').hex).toBe('#ed171f')
  })
})
