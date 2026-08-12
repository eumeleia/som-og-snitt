import { describe, it, expect } from 'vitest'
import { snappTilPalett, BROTHER_PALETT } from './broderPalett'

// Verner 36cfb7a («Åtte brukerønsker…»), som innførte snappTilPalett med compuphase sin
// røde-middel-vektede avstand — MÅLET var bit-identisk resultat med pyembroiderys egen
// Python-implementasjon, ikke en tilnærming (se docs/broderivurdering-uavhengig-
// 20260811.md punkt A2). To detaljer i den runden er lette å regressere ubemerket:
// bankers rounding og `<=`-tie-break — begge har egne feller under.
describe('snappTilPalett', () => {
  it('snapper de fire kjente verdiene til riktig palettfarge', () => {
    expect(snappTilPalett('#00fcfc').hex).toBe('#a8deeb')
    expect(snappTilPalett('#900000').hex).toBe('#c70156')
    expect(snappTilPalett('#d800cc').hex).toBe('#c70156')
    expect(snappTilPalett('#0042de').hex).toBe('#0a55a3')
  })

  it('er idempotent — alle 64 palettfarger snapper til seg selv', () => {
    for (const { hex } of BROTHER_PALETT) {
      expect(snappTilPalett(hex).hex).toBe(hex)
    }
  })

  it('feller: bankers rounding — #0042de skal IKKE gi #095ba6 (naiv Math.round-felle)', () => {
    const resultat = snappTilPalett('#0042de').hex
    expect(resultat).not.toBe('#095ba6')
    expect(resultat).toBe('#0a55a3')
  })

  it('feller: likhetsregelen <= — #0000de skal gi #0b3d91 (siste like nære vinner), ikke #0e1f7c (første)', () => {
    const resultat = snappTilPalett('#0000de').hex
    expect(resultat).not.toBe('#0e1f7c')
    expect(resultat).toBe('#0b3d91')
  })
})
