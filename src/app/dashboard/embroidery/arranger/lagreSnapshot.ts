import type { PlassertMotiv, SekvensElement } from './types'

// Det ENE stedet som avgjør om en komposisjon er "endret" — se lagre()-kommentaren i
// KomposisjonEditor.tsx. Ikke et dirty-flagg satt av hver enkelt handling (flytting,
// nytt motiv, sekvensendring …) — et slikt flagg glemmer alltid én handling før eller
// senere. Sammenligning skjer i stedet på et helt øyeblikksbilde av det som faktisk
// lagres, tatt på nytt hver gang.
export interface KomposisjonSnapshot {
  navn: string
  motiver: PlassertMotiv[]
  sekvens: SekvensElement[]
}

// miniatyrSvg er MED VILJE utelatt fra denne typen og fra sammenligningen: den er
// avledet (byggMiniatyrSvg, se miniatyr.ts) og fylles asynkront etter hvert som motiver
// blir tolket (KomposisjonEditor sin resolved-state) — en komposisjon som ellers er
// helt uendret ville blitt regnet som "endret" bare fordi miniatyren ble klar i
// bakgrunnen, og da autolagret uten at brukeren har gjort noe.
export function serialiserSnapshot(s: KomposisjonSnapshot): string {
  return JSON.stringify({ navn: s.navn, motiver: s.motiver, sekvens: s.sekvens })
}

export function erEndret(forrige: KomposisjonSnapshot, na: KomposisjonSnapshot): boolean {
  return serialiserSnapshot(forrige) !== serialiserSnapshot(na)
}
