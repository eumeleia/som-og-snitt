import { supabase } from '@/lib/supabase'
import { snappTilPalett } from './broderPalett'

// Bro mellom Lageret (inventory-tabellen, egen side under /dashboard/inventory) og
// broderi-arrangøren: brukerens EGNE broderitråder (kategori Tilbehør, underkategori
// Broderitråd/Broderigarn) har fått egne felt (hex/merke/tradkode/iBroderipalett) der,
// se InventoryItemData i inventory/page.tsx. Denne fila henter dem og bygger oppslaget
// arrangøren trenger for å vise EKTE trådfarge i stedet for Brothers generiske
// PEC-farge — se effektivTradfarge i sekvens.ts, som er stedet oppslaget faktisk brukes.
export interface MinTrad {
  id: string
  hex: string
  navn: string
  merke: string
  tradkode: string
  forbruksniva?: 'ubrukt' | 'lite-brukt' | 'mye-brukt' | 'oppbrukt'
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// Egen, smal spørring (ikke gjenbruk av inventory/page.tsx sin — den siden har ingen
// delt datahenting å gjenbruke herfra, og feltene vi trenger her er få). Arkiverte
// rader og rader der brukeren bevisst har slått av "vis i trådpaletten" telles ikke;
// rader uten en gyldig hex kan ikke plasseres i PEC-rutenettet i det hele tatt.
export async function hentMineTrader(): Promise<MinTrad[]> {
  const { data, error } = await supabase
    .from('inventory')
    .select('id, data')
    .eq('data->>kategori', 'Tilbehør')
    .in('data->>underkategori', ['Broderitråd', 'Broderigarn'])
  if (error) {
    console.error('[minTraadpalett] henting av mine tråder feilet', error)
    return []
  }
  const rader = (data ?? []) as Array<{
    id: string
    data: {
      hex?: string; navn?: string; merke?: string; tradkode?: string
      iBroderipalett?: boolean; arkivert?: boolean
      forbruksniva?: MinTrad['forbruksniva']
    }
  }>
  const ut: MinTrad[] = []
  for (const r of rader) {
    const d = r.data
    if (d.arkivert) continue
    if (d.iBroderipalett === false) continue
    if (!d.hex || !HEX_RE.test(d.hex)) continue
    ut.push({
      id: r.id,
      hex: d.hex,
      navn: d.navn?.trim() || 'Uten navn',
      merke: d.merke?.trim() || 'Ukjent merke',
      tradkode: d.tradkode?.trim() || '',
      forbruksniva: d.forbruksniva,
    })
  }
  return ut
}

// PEC-hex → ekte tråd. Flere av brukerens tråder kan snappe til samme PEC-farge (to
// nyanser av «samme» farge, ulik kode) — det er riktig, ikke en feil å løse bort, se
// Clay Brown/Cream Brown-eksemplene i oppgaven denne palettfunksjonen ble bygget for.
// Ved kollisjon vinner en IKKE-oppbrukt tråd over en oppbrukt; ellers vinner den første
// i lista (stabil, ikke tilfeldig — samme rekkefølge som hentMineTrader returnerte).
export function byggPecTilEkteMap(mineTrader: MinTrad[]): Map<string, MinTrad> {
  const ut = new Map<string, MinTrad>()
  for (const trad of mineTrader) {
    const pecHex = snappTilPalett(trad.hex).hex
    const eksisterende = ut.get(pecHex)
    if (!eksisterende) { ut.set(pecHex, trad); continue }
    if (eksisterende.forbruksniva === 'oppbrukt' && trad.forbruksniva !== 'oppbrukt') {
      ut.set(pecHex, trad)
    }
  }
  return ut
}
