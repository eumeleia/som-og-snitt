import type { PostgrestError } from '@supabase/supabase-js'

// PostgREST/Supabase svarer maks 1000 rader per spørring, uansett hvor stort .range() man ber
// om - stille, uten feilkode, bare et halvfullt resultat. Enhver tabell som passerer 1000 rader
// vil derfor stille miste resten fra klienten med en enkelt .select(). Denne hjelpefunksjonen
// henter i blokker til en blokk kommer tilbake kortere enn blokkstørrelsen.
//
// sorterPaKolonner er ikke pyntedata - uten en fast sortering garanterer ikke Postgres samme
// radrekkefølge fra side til side, og paginering over et datasett i bevegelse kan da både hoppe
// over rader og se samme rad flere ganger. lagSide MÅ selv kjede .order() for akkurat disse
// kolonnene (i samme rekkefølge) før .range() - denne funksjonen kaster hvis lista er tom, som
// en påminnelse om det, men kan ikke se etter at .order() faktisk ble kalt i lagSide.
export async function hentAllePaginert<T>(
  lagSide: (fra: number, til: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  sorterPaKolonner: string[],
  pageSize = 1000,
): Promise<{ data: T[]; error: PostgrestError | null }> {
  if (sorterPaKolonner.length === 0) {
    throw new Error(
      'hentAllePaginert: sorterPaKolonner kan ikke være tom - paginering uten en fast sortering ' +
      'er ikke deterministisk. lagSide må kjede .order() for disse kolonnene før .range().'
    )
  }
  const alle: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await lagSide(offset, offset + pageSize - 1)
    if (error) return { data: alle, error }
    if (!data || data.length === 0) break
    alle.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return { data: alle, error: null }
}
