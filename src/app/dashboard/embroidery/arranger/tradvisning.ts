import { hexTilLab } from './fargeavstand'

// Navnefeltet i Lageret er fritekst limt inn fra butikker, så produsenten står ofte FØR
// fargen («Brother Country Embroidery Thread, 255 Light Brown»). Velgeren viser fargen
// først og produsenten (merke-feltet) i liten tekst under. Reglene er laget mot de faktiske
// navnene i Lageret per 2026-10-14 — se tradvisning.test.ts.
export function visningsnavn(navn: string, merke: string): string {
  let s = navn.trim()
  const komma = s.lastIndexOf(',')
  if (komma !== -1) s = s.slice(komma + 1).trim()
  s = s.replace(/^fv\.\s*/i, '')
  s = s.replace(/\s*\([^)]*\)\s*$/, '')
  if (merke) {
    const suffiks = ` - ${merke}`
    if (s.toLowerCase().endsWith(suffiks.toLowerCase())) s = s.slice(0, -suffiks.length)
  }
  return s.trim() || navn.trim()
}

// Under denne kromaen (CIELAB C*) regnes fargen som grå — fargetonen er da bare støy.
const GRA_KROMA = 8

// Sorteringsnøkkel etter fargetone (CIELAB-hue), så like farger havner ved siden av
// hverandre. Gråtoner samles til slutt, fra lys til mørk.
export function fargetoneNokkel(hex: string): [number, number] {
  const [L, a, b] = hexTilLab(hex)
  const kroma = Math.hypot(a, b)
  if (kroma < GRA_KROMA) return [1000, -L]
  const hue = (Math.atan2(b, a) * 180) / Math.PI
  return [hue < 0 ? hue + 360 : hue, -L]
}

export function sammenlignFargetone(hexA: string, hexB: string): number {
  const [ha, la] = fargetoneNokkel(hexA)
  const [hb, lb] = fargetoneNokkel(hexB)
  return ha - hb || la - lb
}

function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Alle ord i søket må finnes i minst ett av feltene (navn, trådkode, merke, hex).
export function sokTreffer(sok: string, felter: string[]): boolean {
  const ord = normaliser(sok).split(/\s+/).filter(Boolean)
  if (ord.length === 0) return true
  const tekst = normaliser(felter.join(' '))
  return ord.every(o => tekst.includes(o))
}
