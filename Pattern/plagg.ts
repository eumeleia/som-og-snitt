/**
 * PLAGGKATALOG — hvilke blokker finnes, og hvilke mål hver av dem krever.
 *
 * `bok` / `side` peker til Aldrich, så konstruksjonen kan slås opp og verifiseres.
 * `status` sier om formlene faktisk er kodet og kontrollert mot boka.
 *
 *   'verifisert' = kodet OG kryssjekket mot bokas tekst og diagram
 *   'kodet'      = kodet, men ikke sjekket mot diagram
 *   'katalogisert' = bare målkravene er kjent, konstruksjonen ikke skrevet
 */

export type Status = 'verifisert' | 'kodet' | 'katalogisert'
export type Malgruppe = 'baby' | 'barn' | 'ungjente' | 'dame'
export type Stoff = 'jersey' | 'vevd' | 'begge'

export interface Blokk {
  id: string
  navn: string
  malgruppe: Malgruppe
  stoff: Stoff
  stroelse: string          // gyldig størrelsesområde
  maal: string[]            // id-er fra MAAL
  bok: 'barn' | 'dame'
  side: number              // boksidetall
  status: Status
  merknad?: string
}

export const BLOKKER: Blokk[] = [
  // ══════════ BABY, 56–92 cm ══════════
  { id: 'baby-kropp', navn: 'Overdel, baby', malgruppe: 'baby', stoff: 'jersey',
    stroelse: '56–92', bok: 'barn', side: 24, status: 'verifisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','aermegabDybde','nakkeTilMidje','ermelengde','haandledd'],
    merknad: 'Hovedtall gir jerseyblokk, parentes gir romsligere form. Uten halsåpning som går over hodet på str. 80 med normal jersey-strekk — se sjekkHode() i babyblokk.ts. Krever vid hals (bok s.38) eller åpning/knapper til plagget er brukbart.' },
  { id: 'baby-yttertoy', navn: 'Flat yttertøysblokk, baby', malgruppe: 'baby', stoff: 'vevd',
    stroelse: '56–92', bok: 'barn', side: 26, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','aermegabDybde','nakkeTilMidje','ermelengde'] },
  { id: 'baby-bukse', navn: 'Todelt bukseblokk, baby', malgruppe: 'baby', stoff: 'begge',
    stroelse: '56–92', bok: 'barn', side: 28, status: 'katalogisert',
    maal: ['hofte','bodyRise','innsideBen'], merknad: 'Har bleievidde innebygget.' },
  { id: 'baby-heldress', navn: 'Heldress i ett stykke', malgruppe: 'baby', stoff: 'jersey',
    stroelse: '56–92', bok: 'barn', side: 30, status: 'katalogisert',
    maal: ['hofte','bodyRise','innsideBen','fotlengde'] },

  // ══════════ BARN, 80–170 cm — FLAT KONSTRUKSJON ══════════
  { id: 'barn-kropp', navn: 'Overdel og skjorte', malgruppe: 'barn', stoff: 'begge',
    stroelse: '80–170', bok: 'barn', side: 40, status: 'verifisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','aermegabDybde','nakkeTilMidje','midjeTilHofte','ermelengde'],
    merknad: 'Hovedtall = kroppsblokk. Parentes = skjorteblokk. Verifisert mot bokas diagram s.40-41 (skulderspiss, pitch point, ermkule) 2026-07-28.' },
  { id: 'barn-kropp-ermelos', navn: 'Flat ermeløs kroppsblokk', malgruppe: 'barn', stoff: 'begge',
    stroelse: '80–170', bok: 'barn', side: 42, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','aermegabDybde','nakkeTilMidje'] },
  { id: 'barn-tskjorte', navn: 'T-skjorteblokk', malgruppe: 'barn', stoff: 'jersey',
    stroelse: '80–170', bok: 'barn', side: 48, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','aermegabDybde','nakkeTilMidje','ermelengde','haandledd'],
    merknad: 'Tre varianter: tettsittende ribb, basis, romslig. Ermelengden kortes fordi jersey strekker seg.' },
  { id: 'barn-bukse-1', navn: 'Flat bukseblokk i ett stykke', malgruppe: 'barn', stoff: 'begge',
    stroelse: '80–170', bok: 'barn', side: 50, status: 'verifisert',
    maal: ['hofte','bodyRise','innsideBen'],
    merknad: 'Ingen sidesøm. Tre varianter: leggings, basis, romslig. FERDIG KODET.' },
  { id: 'barn-bukse-2', navn: 'Flat bukseblokk i to deler', malgruppe: 'barn', stoff: 'begge',
    stroelse: '80–170', bok: 'barn', side: 52, status: 'katalogisert',
    maal: ['hofte','bodyRise','innsideBen','buksevidde'],
    merknad: 'Bedre benform og mer skrittrise bak enn endelsvarianten.' },
  { id: 'barn-skjort', navn: 'Flat skjørtblokk', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '80–170', bok: 'barn', side: 52, status: 'katalogisert',
    maal: ['midje','hofte','midjeTilHofte','skjortlengde'] },
  { id: 'barn-jeans', navn: 'Jeansblokk, tettsittende', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '98–170', bok: 'barn', side: 54, status: 'katalogisert',
    maal: ['hofte','midje','innsideBen','buksevidde','midjeTilHofte','bodyRise','linningsbredde'] },
  { id: 'barn-pyjamas', navn: 'Flat pyjamasblokk', malgruppe: 'barn', stoff: 'begge',
    stroelse: '80–170', bok: 'barn', side: 90, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','aermegabDybde','nakkeTilMidje','ermelengde','haandledd'] },
  { id: 'barn-hette', navn: 'Hette', malgruppe: 'barn', stoff: 'begge',
    stroelse: '56–170', bok: 'barn', side: 120, status: 'katalogisert',
    maal: ['hoyde','nakkehoyde','hodeomkrets'],
    merknad: 'Nakke til isse = høyde minus nakkehøyde. Krever også halsringningsmål fra kroppsblokken.' },

  // ══════════ BARN — FORMKONSTRUKSJON (finere plagg) ══════════
  { id: 'barn-klassisk-skjort', navn: 'Klassisk skjørtblokk', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '98–164', bok: 'barn', side: 122, status: 'katalogisert',
    maal: ['midje','hofte','midjeTilHofte','midjeTilKne'] },
  { id: 'barn-klassisk-bukse', navn: 'Klassisk bukseblokk', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '98–170', bok: 'barn', side: 124, status: 'katalogisert',
    maal: ['hofte','midje','bodyRise','innsideBen','buksevidde','midjeTilHofte','linningsbredde'],
    merknad: 'Egne varianter for jente (s. 124) og gutt (s. 126). 1 cm vidde i midjen skal holdes inn mot linningen.' },
  { id: 'barn-skjorte', navn: 'Skjorteblokk', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '98–170', bok: 'barn', side: 130, status: 'katalogisert',
    maal: ['bryst','aermegabDybde','nakkeTilMidje','ryggbredde','halsvidde','ermelengde','mansjett'] },
  { id: 'barn-yttertoy', navn: 'Klassisk yttertøysblokk (jakke, kåpe)', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '98–170', bok: 'barn', side: 132, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','aermegabDybde','nakkeTilMidje'] },
  { id: 'barn-livdel', navn: 'Klassisk livdelsblokk', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '98–164', bok: 'barn', side: 138, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','aermegabDybde','nakkeTilMidje'] },
  { id: 'barn-erm-1', navn: 'Endelt ermeblokk', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '98–170', bok: 'barn', side: 144, status: 'katalogisert',
    maal: ['aermegabOmkrets','ermelengde','haandledd'],
    merknad: 'Ærmegabomkretsen måles på den ferdige kroppsblokken, ikke på barnet.' },
  { id: 'barn-erm-2', navn: 'Todelt ermeblokk', malgruppe: 'barn', stoff: 'vevd',
    stroelse: '98–170', bok: 'barn', side: 146, status: 'katalogisert',
    maal: ['aermegabOmkrets','ermelengde','mansjett'] },

  // ══════════ UNGJENTE 146–164 cm (bryst begynner å utvikles) ══════════
  { id: 'ungjente-livdel', navn: 'Klassisk livdelsblokk, ungjente', malgruppe: 'ungjente', stoff: 'vevd',
    stroelse: '146–164', bok: 'barn', side: 178, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','nakkeTilMidje','aermegabDybde','innsnitt','midjeTilHofte'],
    merknad: 'Første blokk med brystinnsnitt. Krever innsnittsrotasjon.' },
  { id: 'ungjente-jakke', navn: 'Jakke- og yttertøysblokk, ungjente', malgruppe: 'ungjente', stoff: 'vevd',
    stroelse: '146–164', bok: 'barn', side: 182, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','nakkeTilMidje','aermegabDybde','innsnitt','midjeTilHofte'] },
  { id: 'ungjente-bukse', navn: 'Klassisk bukseblokk, ungjente', malgruppe: 'ungjente', stoff: 'vevd',
    stroelse: '146–164', bok: 'barn', side: 184, status: 'katalogisert',
    maal: ['hofte','midje','bodyRise','innsideBen','buksevidde','midjeTilHofte'] },
  { id: 'ungjente-skjort', navn: 'Klassisk skjørtblokk, ungjente', malgruppe: 'ungjente', stoff: 'vevd',
    stroelse: '146–164', bok: 'barn', side: 186, status: 'katalogisert',
    maal: ['hofte','midje','midjeTilHofte','skjortlengde'] },

  // ══════════ DAME ══════════
  { id: 'dame-skjort', navn: 'Skjørtblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 24, status: 'katalogisert',
    maal: ['midje','hofte','midjeTilHofte','skjortlengde'] },
  { id: 'dame-bukse', navn: 'Grunnleggende bukseblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 44, status: 'katalogisert',
    maal: ['midje','hofte','bodyRise','midjeTilGulv','midjeTilHofte','ankel','buksevidde'] },
  { id: 'dame-livdel-tett', navn: 'Tettsittende livdelsblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 62, status: 'katalogisert',
    maal: ['bryst','midje','ryggbredde','brystbredde','skulder','halsvidde','innsnitt','nakkeTilMidje','skulderTilMidjeForan','aermegabDybde'] },
  { id: 'dame-livdel-romslig', navn: 'Romslig livdelsblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 64, status: 'katalogisert',
    maal: ['bryst','midje','ryggbredde','brystbredde','skulder','halsvidde','nakkeTilMidje','aermegabDybde'] },
  { id: 'dame-jakke', navn: 'Skreddersydd jakkeblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 66, status: 'katalogisert',
    maal: ['bryst','midje','hofte','ryggbredde','brystbredde','skulder','halsvidde','innsnitt','nakkeTilMidje','aermegabDybde','midjeTilHofte'] },
  { id: 'dame-kaape', navn: 'Klassisk kåpeblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 68, status: 'katalogisert',
    maal: ['bryst','midje','hofte','ryggbredde','brystbredde','skulder','halsvidde','nakkeTilMidje','aermegabDybde','midjeTilHofte'] },
  { id: 'dame-erm-1', navn: 'Endelt ermeblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 70, status: 'katalogisert',
    maal: ['aermegabOmkrets','ermelengde','overarm','haandledd'] },
  { id: 'dame-erm-2', navn: 'Todelt ermeblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 72, status: 'katalogisert',
    maal: ['aermegabOmkrets','ermelengde','overarm','haandledd'] },
  { id: 'dame-bukse-romslig', navn: 'Romslig bukseblokk', malgruppe: 'dame', stoff: 'begge',
    stroelse: 'personlige mål', bok: 'dame', side: 166, status: 'katalogisert',
    maal: ['midje','hofte','bodyRise','midjeTilGulv','midjeTilHofte','buksevidde'] },
  { id: 'dame-skjorte', navn: 'Grunnleggende skjorteblokk', malgruppe: 'dame', stoff: 'vevd',
    stroelse: 'personlige mål', bok: 'dame', side: 176, status: 'katalogisert',
    maal: ['bryst','ryggbredde','brystbredde','skulder','halsvidde','nakkeTilMidje','aermegabDybde','ermelengde','mansjett'] },
  { id: 'dame-tskjorte', navn: 'T-skjorte-, joggedress- og jerseyblokk', malgruppe: 'dame', stoff: 'jersey',
    stroelse: 'personlige mål', bok: 'dame', side: 186, status: 'katalogisert',
    maal: ['bryst','midje','hofte','ryggbredde','halsvidde','nakkeTilMidje','aermegabDybde','ermelengde','haandledd'] },
  { id: 'dame-strikk', navn: 'Strikkeplaggblokk (genser)', malgruppe: 'dame', stoff: 'jersey',
    stroelse: 'personlige mål', bok: 'dame', side: 194, status: 'katalogisert',
    maal: ['bryst','midje','hofte','ryggbredde','halsvidde','nakkeTilMidje','aermegabDybde','ermelengde','haandledd'],
    merknad: 'Rutenettbasert konstruksjon, egen logikk.' },
]

/** Hvilke mål trengs for et sett med valgte plagg? */
export function maalFor(blokkIder: string[]): string[] {
  const s = new Set<string>()
  for (const id of blokkIder) {
    BLOKKER.find(b => b.id === id)?.maal.forEach(m => s.add(m))
  }
  return [...s]
}

/** Alle blokker som kan lages av en gitt profil, gitt hvilke mål som finnes. */
export function tilgjengelige(harMaal: string[]): Blokk[] {
  const h = new Set(harMaal)
  return BLOKKER.filter(b => b.maal.every(m => h.has(m)))
}
