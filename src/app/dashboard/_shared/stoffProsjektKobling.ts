// Koblingen mellom et stoff og prosjektene det er tiltenkt bor bare på stoffet
// (inventory.data.tiltenktProsjekter). Prosjektsiden leser den via lesKoblinger,
// den dupliserer den ikke i ProjectData. All bakoverkompatibilitet mot de gamle
// enkeltfeltene (tiltenktProsjektId/tiltenktProsjektNavn) bor her og bare her.

export interface ProsjektKobling {
  id: string
  navn: string
}

interface DataMedProsjektfelt {
  tiltenktProsjekter?: ProsjektKobling[]
  tiltenktProsjektId?: string
  tiltenktProsjektNavn?: string
}

export function lesKoblinger(data: DataMedProsjektfelt | null | undefined): ProsjektKobling[] {
  if (!data) return []
  if (data.tiltenktProsjekter) return data.tiltenktProsjekter
  if (data.tiltenktProsjektId) {
    return [{ id: data.tiltenktProsjektId, navn: data.tiltenktProsjektNavn ?? '' }]
  }
  return []
}

export function skrivKoblinger<T extends DataMedProsjektfelt>(
  data: T,
  liste: ProsjektKobling[],
): Omit<T, 'tiltenktProsjektId' | 'tiltenktProsjektNavn'> & { tiltenktProsjekter: ProsjektKobling[] } {
  const sett = new Set<string>()
  const dedupert: ProsjektKobling[] = []
  for (const k of liste) {
    if (sett.has(k.id)) continue
    sett.add(k.id)
    dedupert.push(k)
  }
  const next = { ...data, tiltenktProsjekter: dedupert }
  delete next.tiltenktProsjektId
  delete next.tiltenktProsjektNavn
  return next
}
