import type { PlassertMotiv } from './types'

// Varige grupper på lerretet (punkt B3, docs/onsker-2026-09-08.md). Rene funksjoner,
// brukt av KomposisjonEditor.tsx — se kommentaren på PlassertMotiv.gruppeId i types.ts
// for hva en gruppe er og hvorfor den aldri rører sekvensen.

// En gruppe på ETT medlem er ikke en gruppe. Kalles etter enhver handling som kan tømme
// en gruppe: sletting av valgte, og omgruppering (et utvalg kan stjele medlemmer fra en
// ANNEN, eksisterende gruppe og etterlate den med bare ett medlem igjen).
export function ryddOppEnkeltmedlemsgrupper(motiver: PlassertMotiv[]): PlassertMotiv[] {
  const antallPerGruppe = new Map<string, number>()
  for (const pm of motiver) {
    if (pm.gruppeId) antallPerGruppe.set(pm.gruppeId, (antallPerGruppe.get(pm.gruppeId) ?? 0) + 1)
  }
  return motiver.map(pm => {
    if (pm.gruppeId && antallPerGruppe.get(pm.gruppeId) === 1) {
      const rest = { ...pm }
      delete rest.gruppeId
      delete rest.gruppeNavn
      return rest
    }
    return pm
  })
}

// Brukt av BÅDE onPointerDownMotiv (lerretet) og motivlisten i KomposisjonEditor.tsx —
// ÉN regel for at et gruppemedlem alltid drar med seg resten av gruppen, ikke to kopier
// som kan sprike. Utvider et rått id-sett: er ETT medlem av en gruppe med i settet,
// legges HELE gruppen til.
export function utvidTilGrupper(ider: Set<string>, motiver: PlassertMotiv[]): Set<string> {
  const resultat = new Set(ider)
  for (const id of ider) {
    const pm = motiver.find(m => m.id === id)
    if (!pm?.gruppeId) continue
    for (const annen of motiver) {
      if (annen.gruppeId === pm.gruppeId) resultat.add(annen.id)
    }
  }
  return resultat
}

export interface KlikkModifikatorer {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

// Hele markeringsregelen for et klikk på ETT motiv (lerretet eller listen), samlet på
// ett sted av samme grunn som utvidTilGrupper over:
// - vanlig klikk velger HELE gruppen til pm (utvidTilGrupper),
// - shift/cmd/ctrl legger til/fjerner HELE gruppen (aldri bare det ene motivet — en
//   halvvalgt gruppe er verre enn ingen gruppe),
// - alt-klikk velger BARE pm, uten å løse opp gruppen — den eneste veien til et delvis
//   utvalg av en gruppe.
export function nyttUtvalgVedKlikk(
  e: KlikkModifikatorer,
  pm: PlassertMotiv,
  gjeldendeValgt: Set<string>,
  motiver: PlassertMotiv[],
): Set<string> {
  if (e.altKey) return new Set([pm.id])
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    const gruppe = utvidTilGrupper(new Set([pm.id]), motiver)
    const alleredeValgt = gjeldendeValgt.has(pm.id)
    const neste = new Set(gjeldendeValgt)
    for (const id of gruppe) {
      if (alleredeValgt) neste.delete(id); else neste.add(id)
    }
    return neste
  }
  const basis = gjeldendeValgt.has(pm.id) && gjeldendeValgt.size > 1 ? gjeldendeValgt : new Set([pm.id])
  return utvidTilGrupper(basis, motiver)
}
