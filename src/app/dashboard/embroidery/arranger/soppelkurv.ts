// Søppelkurv for komposisjoner (docs/onsker-2026-09-08.md, punkt D). slettet_tid ligger i
// en egen kolonne, ikke i data-jsonb-en — se migrasjon 009 for hvorfor. DAGER_I_KURVEN
// brukes både i UI-teksten og i erUtlopt/tom-soppelkurv-ruta, så løftet «minst 30 dager»
// ikke kan avvike mellom klient og server.
export const DAGER_I_KURVEN = 30

const MS_PER_DOGN = 24 * 60 * 60 * 1000

// Løftet er «minst 30 dager», ikke «nøyaktig 30» — nøyaktig 30 døgn er derfor IKKE utløpt.
export function erUtlopt(slettetTid: string, naa: Date): boolean {
  const slettetMs = Date.parse(slettetTid)
  if (Number.isNaN(slettetMs)) return false
  return naa.getTime() > slettetMs + DAGER_I_KURVEN * MS_PER_DOGN
}

// Grensetidspunktet erUtlopt bruker, uttrykt som en dato i stedet for et per-rad-tjek —
// til bruk i en SQL-spørring (tom-soppelkurv-ruta) der radene ikke er hentet ennå.
export function beregnGrense(naa: Date): Date {
  return new Date(naa.getTime() - DAGER_I_KURVEN * MS_PER_DOGN)
}

// Rader uten slettet_tid er aktive. En ugyldig datostreng skal også havne i aktive —
// forsvinner den stille, ser brukeren en komposisjon mangle uten forklaring.
export function delKomposisjoner<T extends { slettet_tid: string | null }>(
  rader: T[],
): { aktive: T[]; iKurven: T[] } {
  const aktive: T[] = []
  const iKurven: T[] = []
  for (const rad of rader) {
    if (rad.slettet_tid !== null && !Number.isNaN(Date.parse(rad.slettet_tid))) {
      iKurven.push(rad)
    } else {
      aktive.push(rad)
    }
  }
  iKurven.sort((a, b) => Date.parse(b.slettet_tid!) - Date.parse(a.slettet_tid!))
  return { aktive, iKurven }
}
