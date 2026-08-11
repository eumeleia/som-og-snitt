// Brothers 64-fargers PEC-palett — hentet direkte fra pyembroiderys egen
// EmbThreadPec.get_thread_set() (indeks 1-64, indeks 0 er en tom plassholder).
// Dette er den SAMME paletten PEC-blokken snapper til når en fil lagres/leses,
// så en fri hex-velger ville vist en annen farge enn det Artspira faktisk syr.
// Ikke legg til/fjern farger her uten å sjekke mot samme kilde.

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

// Nøyaktig samme algoritme som pyembroiderys EmbThread.find_nearest_color_index /
// color_distance_red_mean (installert under pyembroidery/EmbThread.py, linje ~46-88 —
// samme kode PesWriter kaller ved skriving, via _snap_til_palett i api/export-pes/index.py).
// IKKE euklidsk RGB-avstand, men compuphase sin røde-middel-vektede avstand. Målet er
// BIT-IDENTISK resultat med Python, ikke en tilnærming — se docs/broderivurdering-
// uavhengig-20260811.md punkt A2 for kryssjekken mot en ekte kjøring av Python-koden.
//
// To detaljer i Python-koden er lette å overse og gir feil svar om de hoppes over:
//  1. `round((r1+r2)/2)` i Python 3 er BANKERS ROUNDING — halve verdier rundes til
//     nærmeste PARTALL, ikke oppover. Math.round i JS runder .5 oppover, og gir en annen
//     palettfarge for 21 av 79 507 farger i et tett rutenett over hele RGB-kuben.
//  2. Løkken i Python bruker `dist <= current_closest_value` — ved eksakt likhet vinner
//     den SISTE (høyeste indeks) av de like nære, ikke den første. En naiv `<` gir feil
//     svar for 17 av de samme 79 507 fargene.

function bankersRound(x: number): number {
  const gulv = Math.floor(x)
  const diff = x - gulv
  if (diff < 0.5) return gulv
  if (diff > 0.5) return gulv + 1
  return gulv % 2 === 0 ? gulv : gulv + 1 // eksakt .5 -> nærmeste partall
}

function hexTilRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// compuphase sin røde-middel-vektede fargeavstand. Alle mellomregninger holder seg godt
// innenfor 32-bits heltall (maks sum er langt under 2^31), så `>> 8` (ikke `/ 256`) er
// trygt og eksakt her, akkurat som i Python.
function fargeavstandRodMidde(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const rodMidde = bankersRound((r1 + r2) / 2)
  const r = r1 - r2, g = g1 - g2, b = b1 - b2
  return (((512 + rodMidde) * r * r) >> 8) + 4 * g * g + (((767 - rodMidde) * b * b) >> 8)
}

// Snapper en rå hex-farge til nærmeste farge i BROTHER_PALETT — samme resultat som
// PesWriter kommer til å gi når fila faktisk bygges. Returnerer hele palettoppføringen
// (hex OG navn), ikke bare hex, siden navnet skal vises i grensesnittet. Idempotent:
// alle 64 palettfargene snapper til seg selv (bekreftet i kryssjekken), så det er trygt
// at Python snapper en gang til på en verdi som allerede er snappet her.
export function snappTilPalett(hex: string): { hex: string; navn: string } {
  const [r, g, b] = hexTilRgb(hex)
  let bestDist = Infinity
  let bestIdx = 0
  for (let i = 0; i < BROTHER_PALETT.length; i++) {
    const [r2, g2, b2] = hexTilRgb(BROTHER_PALETT[i].hex)
    const dist = fargeavstandRodMidde(r, g, b, r2, g2, b2)
    if (dist <= bestDist) { bestDist = dist; bestIdx = i } // <= : sist vinner ved likhet, se over
  }
  return BROTHER_PALETT[bestIdx]
}
