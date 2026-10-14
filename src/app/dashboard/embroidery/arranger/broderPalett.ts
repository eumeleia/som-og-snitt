// Brothers 64-fargers PEC-palett — hentet direkte fra pyembroiderys egen
// EmbThreadPec.get_thread_set() (indeks 1-64, indeks 0 er en tom plassholder).
// Dette er den SAMME paletten PEC-blokken snapper til når en fil lagres/leses,
// så en fri hex-velger ville vist en annen farge enn det Artspira faktisk syr.
// Ikke legg til/fjern farger her uten å sjekke mot samme kilde.

// Ligger her og ikke i minTraadpalett.ts fordi denne fila bare importerer den rene
// fargeavstand.ts — server-ruta /api/broderi-fargepalett bruker den også, og skal ikke
// dra med seg anon-klienten.
import { hexTilLab, deltaE2000, type Lab } from './fargeavstand'

export const HEX_RE = /^#[0-9a-fA-F]{6}$/

export const BROTHER_PALETT: { hex: string; navn: string }[] = [
  { hex: '#0e1f7c', navn: 'Prussian Blue' },
  { hex: '#0a55a3', navn: 'Blue' },
  { hex: '#008777', navn: 'Teal Green' },
  { hex: '#4b6baf', navn: 'Cornflower Blue' },
  { hex: '#ed171f', navn: 'Red' },
  { hex: '#d15c00', navn: 'Reddish Brown' },
  { hex: '#913697', navn: 'Magenta' },
  { hex: '#e49acb', navn: 'Light Lilac' },
  { hex: '#915fac', navn: 'Lilac' },
  { hex: '#9ed67d', navn: 'Mint Green' },
  { hex: '#e8a900', navn: 'Deep Gold' },
  { hex: '#feba35', navn: 'Orange' },
  { hex: '#ffff00', navn: 'Yellow' },
  { hex: '#70bc1f', navn: 'Lime Green' },
  { hex: '#ba9800', navn: 'Brass' },
  { hex: '#a8a8a8', navn: 'Silver' },
  { hex: '#7d6f00', navn: 'Russet Brown' },
  { hex: '#ffffb3', navn: 'Cream Brown' },
  { hex: '#4f5556', navn: 'Pewter' },
  { hex: '#000000', navn: 'Black' },
  { hex: '#0b3d91', navn: 'Ultramarine' },
  { hex: '#770176', navn: 'Royal Purple' },
  { hex: '#293133', navn: 'Dark Gray' },
  { hex: '#2a1301', navn: 'Dark Brown' },
  { hex: '#f64a8a', navn: 'Deep Rose' },
  { hex: '#b27624', navn: 'Light Brown' },
  { hex: '#fcbbc5', navn: 'Salmon Pink' },
  { hex: '#fe370f', navn: 'Vermilion' },
  { hex: '#f0f0f0', navn: 'White' },
  { hex: '#6a1c8a', navn: 'Violet' },
  { hex: '#a8ddc4', navn: 'Seacrest' },
  { hex: '#2584bb', navn: 'Sky Blue' },
  { hex: '#feb343', navn: 'Pumpkin' },
  { hex: '#fff36b', navn: 'Cream Yellow' },
  { hex: '#d0a660', navn: 'Khaki' },
  { hex: '#d15400', navn: 'Clay Brown' },
  { hex: '#66ba49', navn: 'Leaf Green' },
  { hex: '#134a46', navn: 'Peacock Blue' },
  { hex: '#878787', navn: 'Gray' },
  { hex: '#d8ccc6', navn: 'Warm Gray' },
  { hex: '#435607', navn: 'Dark Olive' },
  { hex: '#fdd9de', navn: 'Flesh Pink' },
  { hex: '#f993bc', navn: 'Pink' },
  { hex: '#003822', navn: 'Deep Green' },
  { hex: '#b2afd4', navn: 'Lavender' },
  { hex: '#686ab0', navn: 'Wisteria Violet' },
  { hex: '#efe3b9', navn: 'Beige' },
  { hex: '#f73866', navn: 'Carmine' },
  { hex: '#b54b64', navn: 'Amber Red' },
  { hex: '#132b1a', navn: 'Olive Green' },
  { hex: '#c70156', navn: 'Dark Fuchsia' },
  { hex: '#fe9e32', navn: 'Tangerine' },
  { hex: '#a8deeb', navn: 'Light Blue' },
  { hex: '#00673e', navn: 'Emerald Green' },
  { hex: '#4e2990', navn: 'Purple' },
  { hex: '#2f7e20', navn: 'Moss Green' },
  { hex: '#ffcccc', navn: 'Flesh Pink' },
  { hex: '#ffd911', navn: 'Harvest Gold' },
  { hex: '#095ba6', navn: 'Electric Blue' },
  { hex: '#f0f970', navn: 'Lemon Yellow' },
  { hex: '#e3f35b', navn: 'Fresh Green' },
  { hex: '#ff9900', navn: 'Orange' },
  { hex: '#fff08d', navn: 'Cream Yellow' },
  { hex: '#ffc8c8', navn: 'Applique' },
]

// Snapping med perseptuell avstand (CIEDE2000 i CIELAB), ikke pyembroiderys egen
// rødmiddel-avstand (EmbThread.find_nearest_color_index). Rødmiddel sendte mørke farger
// til feil nabo: #10140c ble Dark Brown, ikke Black. Eksporten (eksport.ts) sender
// derfor den ferdig snappede palettverdien til Python — PesWriter snapper en eksakt
// palettfarge til seg selv, så PesWriter sin egen snapping endrer ingenting.
//
// Dette er den ENESTE snappefunksjonen i frontend. Visning, omtredningstelling,
// sammenslåingsforslag og eksport går alle via den (gjennom effektivTradfarge i
// sekvens.ts), så tallene på skjermen og fila kan ikke sprike.


let palettLab: Lab[] | null = null
const snappCache = new Map<string, { hex: string; navn: string }>()

// En farge som allerede er i paletten (valgt direkte fra Brother 64-fanen) returneres
// uendret, uten avstandsberegning. Ellers: lavest ΔE2000, første vinner ved likhet.
export function snappTilPalett(hex: string): { hex: string; navn: string } {
  const nokkel = hex.toLowerCase()
  const cachet = snappCache.get(nokkel)
  if (cachet) return cachet

  let treff = BROTHER_PALETT.find(f => f.hex === nokkel)
  if (!treff) {
    palettLab ??= BROTHER_PALETT.map(f => hexTilLab(f.hex))
    const lab = hexTilLab(nokkel)
    let bestDist = Infinity
    let bestIdx = 0
    for (let i = 0; i < palettLab.length; i++) {
      const dist = deltaE2000(lab, palettLab[i])
      if (dist < bestDist) { bestDist = dist; bestIdx = i }
    }
    treff = BROTHER_PALETT[bestIdx]
  }
  snappCache.set(nokkel, treff)
  return treff
}
