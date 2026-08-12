import { describe, it, expect, vi } from 'vitest'
import { slaOppMedGjentakelse, byggQ, type FunnetFil } from './route'

// Verner 36cfb7a («Åtte brukerønsker…»), som la til sessionStartetVed-tidsstempelet i
// byggQ for å skille DENNE opplastingssesjonens fil fra et tidligere forsøks fil med
// samme navn — uten det kunne en reopplasting finne førsteforsøkets fil og etterlate en
// dublett i Drive. venterMs sendes med bare nuller i disse testene for å hoppe over de
// ekte pausene (økende ventetid mellom forsøk er ikke selve det som testes her).
describe('slaOppMedGjentakelse', () => {
  it('returnerer på tredje forsøk med en falsk oppslagsfunksjon', async () => {
    let kall = 0
    const oppslag = vi.fn(async (): Promise<FunnetFil | null> => {
      kall++
      if (kall < 3) return null
      return { id: 'fil-abc', webViewLink: 'https://example.com/abc' }
    })

    const { fil, forsok } = await slaOppMedGjentakelse(oppslag, [0, 0, 0, 0, 0])

    expect(fil?.id).toBe('fil-abc')
    expect(forsok).toBe(3)
    expect(oppslag).toHaveBeenCalledTimes(3)
  })

  it('gir 404 (fil: null) etter at alle forsøk er brukt opp', async () => {
    const oppslag = vi.fn(async (): Promise<FunnetFil | null> => null)

    const { fil, forsok } = await slaOppMedGjentakelse(oppslag, [0, 0, 0, 0, 0])

    expect(fil).toBeNull()
    expect(forsok).toBe(5)
    expect(oppslag).toHaveBeenCalledTimes(5)
  })
})

describe('byggQ', () => {
  it('bygger q-strengen uten tidsstempel når sessionStartetVed er utelatt', () => {
    expect(byggQ('Mønster A.pdf', 'folder123')).toBe(
      "name = 'Mønster A.pdf' and 'folder123' in parents and trashed = false",
    )
  })

  it('escaper apostrofer i filnavnet', () => {
    expect(byggQ("O'Brien's mønster.pdf", 'folder123')).toBe(
      "name = 'O\\'Brien\\'s mønster.pdf' and 'folder123' in parents and trashed = false",
    )
  })

  it('legger til createdTime-leddet med riktig margin når sessionStartetVed er med', () => {
    const sessionStartetVed = Date.parse('2026-08-12T10:00:00.000Z')
    const q = byggQ('Mønster A.pdf', 'folder123', sessionStartetVed)
    const forventetGrense = new Date(sessionStartetVed - 10_000).toISOString()
    expect(q).toBe(
      `name = 'Mønster A.pdf' and 'folder123' in parents and trashed = false and createdTime > '${forventetGrense}'`,
    )
  })
})
