import { supabase } from '@/lib/supabase'
import { HEX_RE } from './broderPalett'

// Hurtigradene øverst i FargePicker (punkt B, docs/onsker-2026-10-02.md).
//
// FELLE: det finnes nå TRE ting som alle kan kalles «mine farger», og de gjør tre
// forskjellige ting. Ikke slå dem sammen:
// - iBroderipalett på en vare i Lageret — avgjør bare om tråden i det hele tatt vises i
//   «Mine tråder»-fanen (se hentMineTrader i minTraadpalett.ts).
// - «Mine tråder»-fanen — hele trådbeholdningen.
// - Min palett (her) — en håndplukket kortliste på maks 8, som kan inneholde Brother-farger
//   som ikke finnes i Lageret i det hele tatt.
//
// To lagringssteder med vilje: paletten er varig og skal følge med mellom enheter →
// Supabase (broderi_fargepalett, migrasjon 011). «Sist brukte» er et spor av hva som nettopp
// ble gjort, per enhet, og ikke noe tap å miste → localStorage.

export const MAKS_PALETT = 8
export const MAKS_SIST_BRUKTE = 6

// En palettfarge er en KOPI av hex og navn, ikke en referanse til varen i Lageret. Slettes
// tråden fra Lageret, blir fargen stående i paletten — med vilje.
export interface PalettFarge {
  id: string
  hex: string
  navn: string
  tradkode: string
  merke: string
  kilde: 'lager' | 'brother'
}

type PalettData = Omit<PalettFarge, 'id'>

// Anon har SELECT på tabellen, så lesing går direkte — bare skriving trenger API-ruta.
export async function hentPalett(): Promise<PalettFarge[]> {
  const { data, error } = await supabase
    .from('broderi_fargepalett')
    .select('id, data, created_at')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[fargepalett] henting av paletten feilet', error)
    return []
  }
  const ut: PalettFarge[] = []
  for (const r of (data ?? []) as Array<{ id: string; data: Partial<PalettData> | null }>) {
    const d = r.data
    if (!d?.hex || !HEX_RE.test(d.hex)) continue
    ut.push({
      id: r.id,
      hex: d.hex,
      navn: d.navn ?? '',
      tradkode: d.tradkode ?? '',
      merke: d.merke ?? '',
      kilde: d.kilde === 'lager' ? 'lager' : 'brother',
    })
  }
  return ut
}

async function svarEllerKast(res: Response): Promise<unknown> {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
  return json
}

// Kaster med rutas egen feiltekst (f.eks. «Paletten er full …») så kalleren kan vise den.
export async function leggIPalett(farge: PalettData): Promise<PalettFarge> {
  const res = await fetch('/api/broderi-fargepalett', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(farge),
  })
  const rad = await svarEllerKast(res) as { id: string; data: PalettData }
  return { id: rad.id, ...rad.data }
}

export async function fjernFraPalett(id: string): Promise<void> {
  const res = await fetch(`/api/broderi-fargepalett?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  await svarEllerKast(res)
}

const SIST_BRUKTE_NOKKEL = 'som-og-snitt:sist-brukte-farger'

// localStorage kaster i privat modus i Safari og finnes ikke under server-rendering —
// derfor try/catch rundt HVER lesing og skriving, og [] ved enhver feil.
export function lesSistBrukte(): string[] {
  try {
    const raa = localStorage.getItem(SIST_BRUKTE_NOKKEL)
    if (!raa) return []
    const verdi: unknown = JSON.parse(raa)
    if (!Array.isArray(verdi)) return []
    return verdi.filter((h): h is string => typeof h === 'string' && HEX_RE.test(h)).slice(0, MAKS_SIST_BRUKTE)
  } catch {
    return []
  }
}

export function registrerBrukt(hex: string): string[] {
  const ny = [hex, ...lesSistBrukte().filter(h => h.toLowerCase() !== hex.toLowerCase())].slice(0, MAKS_SIST_BRUKTE)
  try {
    localStorage.setItem(SIST_BRUKTE_NOKKEL, JSON.stringify(ny))
  } catch {
    // Privat modus: lista lever bare i minnet til siden lastes på nytt.
  }
  sistBrukteCache = ny
  for (const lytter of lyttere) lytter()
  return ny
}

// For useSyncExternalStore i FargePicker. Snapshot MÅ være samme array-referanse mellom
// kall så lenge ingenting er endret — en ny array hver gang gir en uendelig render-løkke.
// Serveren får alltid TOM_LISTE, så første klient-render og server-HTML-en er like.
let sistBrukteCache: string[] | null = null
const lyttere = new Set<() => void>()
const TOM_LISTE: string[] = []

export function abonnerSistBrukte(lytter: () => void): () => void {
  lyttere.add(lytter)
  return () => { lyttere.delete(lytter) }
}

export function sistBrukteSnapshot(): string[] {
  if (sistBrukteCache === null) sistBrukteCache = lesSistBrukte()
  return sistBrukteCache
}

export function sistBrukteServerSnapshot(): string[] {
  return TOM_LISTE
}
