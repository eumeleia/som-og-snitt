import { byggPecTilEkteMap, byggHexTilEkteMap, type MinTrad } from './minTraadpalett'
import { fordelPecFarger } from './pecFordeling'
import type { SekvensKontekst } from './sekvens'
import type { BroderiMotivData, PlassertMotiv, SekvensElement } from './types'

export interface Tradoppslag {
  pecTilEkte: Map<string, MinTrad>
  hexTilEkte: Map<string, MinTrad>
}

export function byggTradoppslag(mineTrader: MinTrad[]): Tradoppslag {
  return { pecTilEkte: byggPecTilEkteMap(mineTrader), hexTilEkte: byggHexTilEkteMap(mineTrader) }
}

// ENESTE vei til en SekvensKontekst i appen. Lerret, sekvensliste, simulator, eksport og
// miniatyr må alle bruke denne — bygger en komponent sin egen ctx, mangler den PEC-
// tildelingen og viser/eksporterer andre farger enn resten. Tildelingen regnes fra
// AKKURAT den sekvensen som sendes inn (miniatyren: sekvensen i lagre-snapshotet).
export function byggSekvensKontekst(
  motiver: PlassertMotiv[],
  resolved: Record<string, BroderiMotivData>,
  tradoppslag: Tradoppslag | undefined,
  sekvens: SekvensElement[],
): SekvensKontekst {
  const grunn: SekvensKontekst = { motiver, resolved, ...tradoppslag }
  return { ...grunn, pecTildeling: fordelPecFarger(sekvens, grunn) }
}
