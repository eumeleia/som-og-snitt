/**
 * MÅLREGISTER — Søm & Snitt mønstergenerator
 *
 * Kanonisk liste over alle kroppsmål som Aldrich-blokkene bruker.
 * Kilder: barneboka (kap. 1–14) og dameboka (kap. 15, bokside 214–215).
 *
 * `kilde: 'maalt'`   = tas på kroppen
 * `kilde: 'tabell'`  = Aldrich oppgir dette som standardmål fra tabell,
 *                      ikke noe man måler. Vi lar det overstyres likevel.
 * `kilde: 'valgt'`   = designvalg, ikke et kroppsmål (f.eks. skjørtlengde)
 */

export type Kilde = 'maalt' | 'tabell' | 'valgt'
export type Gjelder = 'barn' | 'voksen' | 'begge'

export interface MaalDef {
  id: string
  navn: string            // norsk
  engelsk: string         // Aldrichs term, for oppslag i boka
  kilde: Kilde
  gjelder: Gjelder
  /** Bokstav i Aldrichs måldiagram (Body_measurement_method.png). */
  bokstav?: string
  slik: string            // hvordan målet tas
}

export const MAAL: MaalDef[] = [
  // ---------- OMKRETSER, OVERKROPP ----------
  { id: 'bryst', navn: 'Brystvidde', engelsk: 'chest / bust', bokstav: 'B', kilde: 'maalt', gjelder: 'begge',
    slik: 'Rundt det fyldigste. På voksen: over bysten, pass på at båndet ikke siger ned i ryggen. På barn: under armene, rundt brystkassen.' },
  { id: 'midje', navn: 'Midjevidde', engelsk: 'waist', bokstav: 'C', kilde: 'maalt', gjelder: 'begge',
    slik: 'Rundt naturlig midje, behagelig. Bind en tråd rundt midjen etterpå — alle loddrette mål tas fra den.' },
  { id: 'lavMidje', navn: 'Lav midje', engelsk: 'low waist', kilde: 'maalt', gjelder: 'voksen',
    slik: '5 cm under naturlig midje.' },
  { id: 'hofte', navn: 'Hofte- og setevidde', engelsk: 'hips / hip-seat', bokstav: 'D', kilde: 'maalt', gjelder: 'begge',
    slik: 'Rundt det bredeste. På voksen ca. 21 cm under midjen.' },
  { id: 'halsvidde', navn: 'Halsvidde', engelsk: 'neck size', bokstav: 'F', kilde: 'maalt', gjelder: 'begge',
    slik: 'Rundt halsroten, båndet berører kragebenet foran.' },
  { id: 'ryggbredde', navn: 'Ryggbredde', engelsk: 'across back', bokstav: 'E', kilde: 'maalt', gjelder: 'begge',
    slik: 'Voksen: 15 cm ned fra nakkeknokkelen, fra ærmegab til ærmegab. Barn: tilsvarende, proporsjonalt lavere.' },
  { id: 'brystbredde', navn: 'Brystbredde foran', engelsk: 'chest (across front)', kilde: 'maalt', gjelder: 'voksen',
    slik: '7 cm ned fra halspunktet foran, fra ærmegab til ærmegab.' },
  { id: 'skulder', navn: 'Skulderbredde', engelsk: 'shoulder', bokstav: 'G–H', kilde: 'maalt', gjelder: 'begge',
    slik: 'Fra halsen ut til skulderknokkelen.' },
  { id: 'aermegabDybde', navn: 'Ærmegabdybde', engelsk: 'scye depth / armscye depth', bokstav: 'K–L', kilde: 'tabell', gjelder: 'begge',
    slik: 'Aldrich oppgir dette som tabellmål. Kan måles: fra nakkeknokkelen rett ned til armhulenivå.' },
  { id: 'aermegabOmkrets', navn: 'Ærmegabomkrets', engelsk: 'armscye girth', kilde: 'maalt', gjelder: 'begge',
    slik: 'Måles på det ferdige mønsteret, ikke på kroppen. Brukes til todelt erm.' },
  { id: 'innsnitt', navn: 'Innsnittsvidde', engelsk: 'dart', kilde: 'tabell', gjelder: 'voksen',
    slik: 'Standardmål fra tabell. Avhenger av bystestørrelse.' },

  // ---------- LENGDER, OVERKROPP ----------
  { id: 'nakkeTilMidje', navn: 'Nakke til midje bak', engelsk: 'back neck to waist / nape to waist', bokstav: 'K–M', kilde: 'maalt', gjelder: 'begge',
    slik: 'Fra nakkeknokkelen midt bak, ned til tråden rundt midjen.' },
  { id: 'skulderTilMidjeForan', navn: 'Skulder til midje foran', engelsk: 'front shoulder to waist', kilde: 'maalt', gjelder: 'voksen',
    slik: 'Fra midt på skulderen, over brystpunktet, ned til midjen.' },
  { id: 'midjeTilHofte', navn: 'Midje til hofte', engelsk: 'waist to hip', bokstav: 'M–N', kilde: 'tabell', gjelder: 'begge',
    slik: 'Aldrich oppgir som tabellmål. Kan måles: fra midjetråden ned til bredeste punkt.' },

  // ---------- ARM ----------
  { id: 'ermelengde', navn: 'Ermelengde', engelsk: 'arm length / sleeve length', bokstav: 'H–T', kilde: 'maalt', gjelder: 'begge',
    slik: 'Hånden på hoften så armen er bøyd. Fra skulderknokkelen over albuen til håndleddsknokkelen ved lillefingeren.' },
  { id: 'overarm', navn: 'Overarmsvidde', engelsk: 'top arm', bokstav: 'I', kilde: 'maalt', gjelder: 'begge',
    slik: 'Armen bøyd. Rundt biceps.' },
  { id: 'haandledd', navn: 'Håndleddsvidde', engelsk: 'wrist', bokstav: 'J', kilde: 'maalt', gjelder: 'begge',
    slik: 'Rundt håndleddet med litt slakk.' },
  { id: 'mansjett', navn: 'Mansjettvidde', engelsk: 'cuff size', kilde: 'valgt', gjelder: 'begge',
    slik: 'Ferdig mansjettvidde. Designvalg, ikke kroppsmål.' },

  // ---------- UNDERKROPP ----------
  { id: 'bodyRise', navn: 'Skrittdybde (sittende)', engelsk: 'body rise', bokstav: 'Q–R', kilde: 'maalt', gjelder: 'begge',
    slik: 'Sitt på hard stol. Mål på siden fra midjen ned til stolsetet.' },
  { id: 'innsideBen', navn: 'Innside ben', engelsk: 'inside leg', bokstav: 'S–O', kilde: 'maalt', gjelder: 'begge',
    slik: 'Fra skrittet ned til ankelen, langs innsiden av benet.' },
  { id: 'midjeTilGulv', navn: 'Midje til gulv', engelsk: 'waist to floor', kilde: 'maalt', gjelder: 'begge',
    slik: 'Fra midjetråden midt bak, rett ned til gulvet. Mål også foran for å sjekke balansen.' },
  { id: 'midjeTilKne', navn: 'Midje til kne', engelsk: 'waist to knee', bokstav: 'M–P', kilde: 'maalt', gjelder: 'begge',
    slik: 'Fra midjetråden ned til midt på kneskålen.' },
  { id: 'ankel', navn: 'Ankelvidde', engelsk: 'ankle', bokstav: 'W', kilde: 'maalt', gjelder: 'begge',
    slik: 'Rundt ankelen rett over ankelknokkelen.' },
  { id: 'buksevidde', navn: 'Buksevidde nederst', engelsk: 'trouser / jeans bottom width', kilde: 'valgt', gjelder: 'begge',
    slik: 'Ønsket ferdig bredde nederst. Designvalg.' },
  { id: 'linningsbredde', navn: 'Linningsbredde', engelsk: 'waistband depth', kilde: 'valgt', gjelder: 'begge',
    slik: 'Ferdig bredde på linningen. Designvalg, typisk 3–3,5 cm.' },
  { id: 'skjortlengde', navn: 'Skjørtlengde', engelsk: 'skirt length', kilde: 'valgt', gjelder: 'begge',
    slik: 'Fra midjetråden ned til ønsket fald. Designvalg.' },

  // ---------- SPESIELT FOR BARN ----------
  { id: 'hodeomkrets', navn: 'Hodeomkrets', engelsk: 'head girth', bokstav: 'U', kilde: 'maalt', gjelder: 'barn',
    slik: 'Rundt hodet over ørene, det største omfanget. Kritisk for plagg uten åpning.' },
  { id: 'hoyde', navn: 'Kroppshøyde', engelsk: 'height', bokstav: 'A', kilde: 'maalt', gjelder: 'barn',
    slik: 'Barnet barbeint mot vegg. Styrer hvilke konstanter blokkene bruker.' },
  { id: 'nakkehoyde', navn: 'Nakkehøyde', engelsk: 'cervical height', bokstav: 'K–O', kilde: 'maalt', gjelder: 'barn',
    slik: 'Fra gulvet opp til nakkeknokkelen. Brukes til hette: høyde minus nakkehøyde.' },
  { id: 'fotlengde', navn: 'Fotlengde', engelsk: 'foot length', bokstav: 'X–Y', kilde: 'maalt', gjelder: 'barn',
    slik: 'Hæl til tåspiss. Brukes til heldress med fot.' },

  { id: 'vertikalOmkrets', navn: 'Vertikal kroppsomkrets', engelsk: 'vertical trunk', bokstav: 'V', kilde: 'maalt', gjelder: 'barn',
    slik: 'Fra midjen foran, opp over skulderen, ned over ryggen og tilbake til midjen foran. Avgjørende for heldress og romper — for kort mål gir plagg som trekker i skrittet.' },
  { id: 'mansjettSkjorte', navn: 'Mansjettvidde, skjorte', engelsk: 'cuff size, shirts', kilde: 'valgt', gjelder: 'begge',
    slik: 'Ferdig mansjettvidde for skjorte. Videre enn mansjett til todelt erm.' },
  { id: 'hoyAnkel', navn: 'Høy ankel', engelsk: 'high ankle', kilde: 'maalt', gjelder: 'voksen',
    slik: 'Rundt leggen rett over ankelen, litt høyere enn ankelmålet.' },
  { id: 'ermelengdeJersey', navn: 'Ermelengde, jersey', engelsk: 'sleeve length (jersey)', kilde: 'tabell', gjelder: 'begge',
    slik: 'Kortere enn ermelengde for vevd, fordi jersey strekker seg når armen bøyes. Ca. 4 cm kortere hos voksen.' },
  { id: 'jeansvidde', navn: 'Jeansvidde nederst', engelsk: 'jeans bottom width', kilde: 'valgt', gjelder: 'begge',
    slik: 'Ønsket ferdig bredde nederst på jeans. Smalere enn vanlig buksevidde.' },
]

export const maalById = Object.fromEntries(MAAL.map(m => [m.id, m]))
