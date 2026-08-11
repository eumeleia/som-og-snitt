import { plassertPunkter, plassertBbox, kombinerBbox } from './geometri'
import { motivKey } from './sekvens'
import type { BroderiBbox, BroderiMotivData, PlassertMotiv } from './types'

const RAMME_MM = 100
const HALV_RAMME_MM = RAMME_MM / 2

// "Forenklet" betyr først og fremst FÆRRE PUNKTER PER STINGBLOKK, ikke bare en nedskalert
// visning — poenget med å lagre en miniatyr er nettopp å UNNGÅ å måtte hente ekte stingdata
// (som kan være 10 000+ punkter per motiv) når komposisjonslista vises. En SVG med alle de
// samme punktene ville bare flyttet det samme problemet fra broderi_motiv til
// broderi_komposisjon, ikke løst det.
const MAKS_PUNKTER_PER_BLOKK = 40

function nedskalertBlokk(sting: [number, number][]): [number, number][] {
  if (sting.length <= MAKS_PUNKTER_PER_BLOKK) return sting
  const steg = Math.ceil(sting.length / MAKS_PUNKTER_PER_BLOKK)
  const ut: [number, number][] = []
  for (let i = 0; i < sting.length; i += steg) ut.push(sting[i])
  const siste = sting[sting.length - 1]
  if (ut[ut.length - 1] !== siste) ut.push(siste)
  return ut
}

function fmt(n: number): string {
  return (n / 10).toFixed(1)
}

// Bygger en liten, forenklet SVG av HELE komposisjonen slik den ser ut på lerretet akkurat
// nå — samme transformasjon (plassertPunkter, altså roterLokalePunkter + translasjon) som
// lerretet (PlassertMotivGruppe) og PES-eksporten (eksport.ts) bruker, ikke en tredje egen
// variant. Kalles KUN fra lagre() i KomposisjonEditor, aldri fra en listevisning — se
// miniatyrSvg-kommentaren i types.ts.
export function byggMiniatyrSvg(
  motiver: PlassertMotiv[],
  resolved: Record<string, BroderiMotivData>,
): string {
  const plasserteBbokser: BroderiBbox[] = []
  const alleBlokker: Array<{ farge_hex: string; punkter: [number, number][] }> = []

  for (const pm of motiver) {
    const data = resolved[motivKey(pm.embroideryId, pm.sizeId)]
    const motivBbox = data?.bbox
    if (!motivBbox) continue
    plasserteBbokser.push(plassertBbox(motivBbox, pm.rotasjonGrader, pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm))
    for (const blokk of data.stingblokker) {
      alleBlokker.push({
        farge_hex: blokk.farge_hex,
        punkter: plassertPunkter(
          nedskalertBlokk(blokk.sting), motivBbox, pm.rotasjonGrader,
          pm.posisjonXTiendedelMm, pm.posisjonYTiendedelMm,
        ),
      })
    }
  }

  // Samme utregning av synlig område som viewBox i KomposisjonEditor — rammen er alltid med,
  // og lerretet utvider seg hvis motiver stikker utenfor den.
  const combinedBbox = kombinerBbox(plasserteBbokser)
  const motivHalvExtentMm = combinedBbox
    ? Math.max(
        Math.abs(combinedBbox.min_x), Math.abs(combinedBbox.max_x),
        Math.abs(combinedBbox.min_y), Math.abs(combinedBbox.max_y),
      ) / 10
    : 0
  const halv = Math.max(HALV_RAMME_MM, motivHalvExtentMm) + 10

  const rammeRect =
    `<rect x="${-HALV_RAMME_MM}" y="${-HALV_RAMME_MM}" width="${RAMME_MM}" height="${RAMME_MM}" ` +
    `fill="none" stroke="#C9A57A" stroke-width="0.6" stroke-dasharray="2.5 2.5" />`

  const linjer = alleBlokker.map(b =>
    `<polyline points="${b.punkter.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ')}" ` +
    `fill="none" stroke="${b.farge_hex}" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" />`
  ).join('')

  return `<svg viewBox="${-halv} ${-halv} ${halv * 2} ${halv * 2}" xmlns="http://www.w3.org/2000/svg">` +
    rammeRect + linjer + `</svg>`
}
