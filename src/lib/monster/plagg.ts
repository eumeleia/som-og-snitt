/**
 * PLAGGKATALOG — hvilke blokker finnes, og hvilke mål hver av dem krever.
 *
 * `bok` / `side` peker til Aldrich, så konstruksjonen kan slås opp og verifiseres.
 * `status` sier om formlene faktisk er kodet og kontrollert mot boka.
 *
 *   'verifisert' = kodet OG kryssjekket mot bokas tekst og diagram
 *   'kodet'      = kodet, men ikke sjekket mot diagram
 *   'katalogisert' = bare målkravene er kjent, konstruksjonen ikke skrevet
 *
 * `ferdigLengde` er bevisst ikke i `maal`-lista. Aldrich oppgir ingen
 * standardlengde i sine måloppstillinger — fallet er et designvalg.
 * Verdien utledes fra `plaggmaal.ferdigLengde(m)` og presenteres som forslag.
 *
 * `minStr` / `maksStr` angir gyldige kroppshøyder (cm). Dame-blokker
 * bruker personlige mål og har null — de filtreres på `malgruppe === 'dame'`.
 */

export type Status = 'verifisert' | 'kodet' | 'katalogisert'
export type Malgruppe = 'baby' | 'barn' | 'ungjente' | 'dame'
export type Stoff = 'jersey' | 'vevd' | 'begge'

export interface Blokk {
  id: string
  navn: string
  undertittel: 'Grunnmønster'
  malgruppe: Malgruppe
  stoff: Stoff
  stroelse: string          // visningstekst
  minStr: number | null     // nedre grense, kroppshøyde cm (null = dame/personlig)
  maksStr: number | null    // øvre grense
  maal: string[]            // id-er fra MAAL
  /** Beregnede mål som ikke er i Aldrichs måloppstillinger (designvalg). */
  plaggmaal?: Record<string, (m: Record<string, number>) => number>
  /** Referansebilder under public/pattern/, f.eks. ['skulderklaff.jpg']. */
  illustrasjon?: string[]
  bok: 'barn' | 'dame'
  side: number              // boksidetall
  status: Status
  merknad?: string
}

export const BLOKKER: Blokk[] = [
  // ══════════ BABY, 56–92 cm ══════════
  { id: 'baby-kropp', navn: 'Overdel, baby', undertittel: 'Grunnmønster',
    malgruppe: 'baby', stoff: 'jersey', stroelse: '56–92', minStr: 56, maksStr: 92,
    bok: 'barn', side: 24, status: 'verifisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','ermegapDybde','nakkeTilMidje','ermelengde','haandledd'],
    plaggmaal: { ferdigLengde: m => (m.nakkeTilMidje ?? 0) + (m.midjeTilHofte ?? 0) + 1.5 },
    merknad: 'Jersey og vevd. To varianter. Vid hals (bok s.38) for plagg uten åpning.' },

  { id: 'baby-yttertoy', navn: 'Jakke og yttertøy, baby', undertittel: 'Grunnmønster',
    malgruppe: 'baby', stoff: 'vevd', stroelse: '56–92', minStr: 56, maksStr: 92,
    bok: 'barn', side: 26, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','ermegapDybde','nakkeTilMidje','ermelengde'],
    plaggmaal: { ferdigLengde: m => (m.nakkeTilMidje ?? 0) + (m.midjeTilHofte ?? 0) + 1.5 } },

  { id: 'baby-bukse', navn: 'Bukse, baby', undertittel: 'Grunnmønster',
    malgruppe: 'baby', stoff: 'begge', stroelse: '56–92', minStr: 56, maksStr: 92,
    bok: 'barn', side: 28, status: 'katalogisert',
    maal: ['hofte','skrittdybde','innsideBen'], merknad: 'Har bleievidde innebygget.' },

  { id: 'baby-heldress', navn: 'Heldress', undertittel: 'Grunnmønster',
    malgruppe: 'baby', stoff: 'jersey', stroelse: '56–92', minStr: 56, maksStr: 92,
    bok: 'barn', side: 30, status: 'katalogisert',
    maal: ['hofte','skrittdybde','innsideBen','fotlengde'] },

  // ══════════ BARN, 80–170 cm — FLAT KONSTRUKSJON ══════════
  { id: 'barn-kropp', navn: 'Overdel og skjorte', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'begge', stroelse: '80–170', minStr: 80, maksStr: 170,
    bok: 'barn', side: 40, status: 'verifisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','ermegapDybde','nakkeTilMidje','midjeTilHofte','ermelengde'],
    plaggmaal: { ferdigLengde: m => (m.nakkeTilMidje ?? 0) + (m.midjeTilHofte ?? 0) + 2 },
    merknad: 'Kroppsblokk eller skjorteblokk. Jersey forkorter ermet 3 cm. Til hofte eller til midje.' },

  { id: 'barn-kropp-ermelos', navn: 'Ermeløs overdel', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'begge', stroelse: '80–170', minStr: 80, maksStr: 170,
    bok: 'barn', side: 42, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','ermegapDybde','nakkeTilMidje'] },

  { id: 'barn-tskjorte', navn: 'T-skjorte', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'jersey', stroelse: '98–170', minStr: 98, maksStr: 170,
    bok: 'barn', side: 48, status: 'verifisert',
    maal: ['bryst','ryggbredde','halsvidde','ermegapDybde','nakkeTilMidje','ermelengde','haandledd'],
    plaggmaal: { ferdigLengde: m => (m.nakkeTilMidje ?? 0) + (m.midjeTilHofte ?? 0) + 2 },
    merknad: 'Tre varianter: ribbet, basis, romslig. Ikke brukbar under 98 cm uten halsåpning — bruk baby-kropp.' },

  { id: 'barn-bukse-1', navn: 'Bukse uten sidesøm', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'begge', stroelse: '80–170', minStr: 80, maksStr: 170,
    bok: 'barn', side: 50, status: 'verifisert',
    maal: ['hofte','skrittdybde','innsideBen'],
    merknad: 'Ingen sidesøm. Tre varianter: leggings, basis, romslig.' },

  { id: 'barn-bukse-2', navn: 'Bukse med sidesøm', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'begge', stroelse: '80–170', minStr: 80, maksStr: 170,
    bok: 'barn', side: 52, status: 'katalogisert',
    maal: ['hofte','skrittdybde','innsideBen','buksevidde'],
    merknad: 'Bedre benform og mer skrittrise bak enn endelsvarianten.' },

  { id: 'barn-skjort', navn: 'Skjørt', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '80–170', minStr: 80, maksStr: 170,
    bok: 'barn', side: 52, status: 'katalogisert',
    maal: ['midje','hofte','midjeTilHofte','skjoertelengde'] },

  { id: 'barn-jeans', navn: 'Jeans', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '98–170', minStr: 98, maksStr: 170,
    bok: 'barn', side: 54, status: 'katalogisert',
    maal: ['hofte','midje','innsideBen','buksevidde','midjeTilHofte','skrittdybde','linningsbredde'] },

  { id: 'barn-pyjamas', navn: 'Pyjamas', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'begge', stroelse: '80–170', minStr: 80, maksStr: 170,
    bok: 'barn', side: 90, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','ermegapDybde','nakkeTilMidje','ermelengde','haandledd'],
    plaggmaal: { ferdigLengde: m => (m.nakkeTilMidje ?? 0) + (m.midjeTilHofte ?? 0) + 4 } },

  { id: 'barn-hette', navn: 'Hette', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'begge', stroelse: '56–170', minStr: 56, maksStr: 170,
    bok: 'barn', side: 120, status: 'katalogisert',
    maal: ['hoeyde','nakkehoeyde','hodeomkrets'],
    merknad: 'Nakke til isse = høyde minus nakkehøyde. Krever også halsringningsmål fra kroppsblokken.' },

  // ══════════ BARN — FORMKONSTRUKSJON (finere plagg) ══════════
  { id: 'barn-klassisk-skjort', navn: 'Skjørt, formsydd', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '98–164', minStr: 98, maksStr: 164,
    bok: 'barn', side: 122, status: 'katalogisert',
    maal: ['midje','hofte','midjeTilHofte','midjeTilKne'] },

  { id: 'barn-klassisk-bukse', navn: 'Bukse, formsydd', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '98–170', minStr: 98, maksStr: 170,
    bok: 'barn', side: 124, status: 'katalogisert',
    maal: ['hofte','midje','skrittdybde','innsideBen','buksevidde','midjeTilHofte','linningsbredde'],
    merknad: 'Egne varianter for jente (s. 124) og gutt (s. 126). 1 cm vidde i midjen skal holdes inn mot linningen.' },

  { id: 'barn-skjorte', navn: 'Skjorte, formsydd', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '98–170', minStr: 98, maksStr: 170,
    bok: 'barn', side: 130, status: 'katalogisert',
    maal: ['bryst','ermegapDybde','nakkeTilMidje','ryggbredde','halsvidde','ermelengde','mansjett'] },

  { id: 'barn-yttertoy', navn: 'Jakke og kåpe', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '98–170', minStr: 98, maksStr: 170,
    bok: 'barn', side: 132, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','ermegapDybde','nakkeTilMidje'] },

  { id: 'barn-livdel', navn: 'Livdel', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '98–164', minStr: 98, maksStr: 164,
    bok: 'barn', side: 138, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','ermegapDybde','nakkeTilMidje'] },

  { id: 'barn-erm-1', navn: 'Erme, ettdelt', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '98–170', minStr: 98, maksStr: 170,
    bok: 'barn', side: 144, status: 'katalogisert',
    maal: ['ermegapOmkrets','ermelengde','haandledd'],
    merknad: 'Ermegapomkretsen måles på den ferdige kroppsblokken, ikke på barnet.' },

  { id: 'barn-erm-2', navn: 'Erme, todelt', undertittel: 'Grunnmønster',
    malgruppe: 'barn', stoff: 'vevd', stroelse: '98–170', minStr: 98, maksStr: 170,
    bok: 'barn', side: 146, status: 'katalogisert',
    maal: ['ermegapOmkrets','ermelengde','mansjett'] },

  // ══════════ UNGJENTE 146–164 cm (bryst begynner å utvikles) ══════════
  { id: 'ungjente-livdel', navn: 'Livdel, ungjente', undertittel: 'Grunnmønster',
    malgruppe: 'ungjente', stoff: 'vevd', stroelse: '146–164', minStr: 146, maksStr: 164,
    bok: 'barn', side: 178, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','nakkeTilMidje','ermegapDybde','innsnitt','midjeTilHofte'],
    merknad: 'Første blokk med brystinnsnitt. Krever innsnittsrotasjon.' },

  { id: 'ungjente-jakke', navn: 'Jakke og yttertøy, ungjente', undertittel: 'Grunnmønster',
    malgruppe: 'ungjente', stoff: 'vevd', stroelse: '146–164', minStr: 146, maksStr: 164,
    bok: 'barn', side: 182, status: 'katalogisert',
    maal: ['bryst','ryggbredde','halsvidde','skulder','nakkeTilMidje','ermegapDybde','innsnitt','midjeTilHofte'] },

  { id: 'ungjente-bukse', navn: 'Bukse, ungjente', undertittel: 'Grunnmønster',
    malgruppe: 'ungjente', stoff: 'vevd', stroelse: '146–164', minStr: 146, maksStr: 164,
    bok: 'barn', side: 184, status: 'katalogisert',
    maal: ['hofte','midje','skrittdybde','innsideBen','buksevidde','midjeTilHofte'] },

  { id: 'ungjente-skjort', navn: 'Skjørt, ungjente', undertittel: 'Grunnmønster',
    malgruppe: 'ungjente', stoff: 'vevd', stroelse: '146–164', minStr: 146, maksStr: 164,
    bok: 'barn', side: 186, status: 'katalogisert',
    maal: ['hofte','midje','midjeTilHofte','skjoertelengde'] },

  // ══════════ DAME ══════════
  { id: 'dame-skjort', navn: 'Skjørt', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 24, status: 'katalogisert',
    maal: ['midje','hofte','midjeTilHofte','skjoertelengde'] },

  { id: 'dame-bukse', navn: 'Bukse', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 44, status: 'katalogisert',
    maal: ['midje','hofte','skrittdybde','midjeTilGulv','midjeTilHofte','ankel','buksevidde'] },

  { id: 'dame-livdel-tett', navn: 'Livdel, tettsittende', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 62, status: 'katalogisert',
    maal: ['bryst','midje','ryggbredde','brystbredde','skulder','halsvidde','innsnitt','nakkeTilMidje','skulderTilMidjeForan','ermegapDybde'] },

  { id: 'dame-livdel-romslig', navn: 'Livdel, romslig', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 64, status: 'katalogisert',
    maal: ['bryst','midje','ryggbredde','brystbredde','skulder','halsvidde','nakkeTilMidje','ermegapDybde'] },

  { id: 'dame-jakke', navn: 'Jakke, skreddersydd', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 66, status: 'katalogisert',
    maal: ['bryst','midje','hofte','ryggbredde','brystbredde','skulder','halsvidde','innsnitt','nakkeTilMidje','ermegapDybde','midjeTilHofte'] },

  { id: 'dame-kaape', navn: 'Kåpe', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 68, status: 'katalogisert',
    maal: ['bryst','midje','hofte','ryggbredde','brystbredde','skulder','halsvidde','nakkeTilMidje','ermegapDybde','midjeTilHofte'] },

  { id: 'dame-erm-1', navn: 'Erme, ettdelt', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 70, status: 'katalogisert',
    maal: ['ermegapOmkrets','ermelengde','overarm','haandledd'] },

  { id: 'dame-erm-2', navn: 'Erme, todelt', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 72, status: 'katalogisert',
    maal: ['ermegapOmkrets','ermelengde','overarm','haandledd'] },

  { id: 'dame-bukse-romslig', navn: 'Bukse, romslig', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'begge', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 166, status: 'katalogisert',
    maal: ['midje','hofte','skrittdybde','midjeTilGulv','midjeTilHofte','buksevidde'] },

  { id: 'dame-skjorte', navn: 'Skjorte', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'vevd', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 176, status: 'katalogisert',
    maal: ['bryst','ryggbredde','brystbredde','skulder','halsvidde','nakkeTilMidje','ermegapDybde','ermelengde','mansjett'] },

  { id: 'dame-tskjorte', navn: 'T-skjorte og joggedress', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'jersey', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 186, status: 'katalogisert',
    maal: ['bryst','midje','hofte','ryggbredde','halsvidde','nakkeTilMidje','ermegapDybde','ermelengde','haandledd'] },

  { id: 'dame-strikk', navn: 'Genser til strikk', undertittel: 'Grunnmønster',
    malgruppe: 'dame', stoff: 'jersey', stroelse: 'personlige mål', minStr: null, maksStr: null,
    bok: 'dame', side: 194, status: 'katalogisert',
    maal: ['bryst','midje','hofte','ryggbredde','halsvidde','nakkeTilMidje','ermegapDybde','ermelengde','haandledd'],
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
