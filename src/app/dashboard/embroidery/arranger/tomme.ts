// Utledning av tomme-størrelse og motividentitet fra PES-filnavn,
// samt gjenkjenning av enkelt-tegn i alfabetbundles.

export interface TommeResultat {
  tomme: string      // tomme-verdien: "2", "3.5", "1.5" osv.
  identitet: string  // filnavnbase uten tomme-indikator og prefiks
}

export interface Karakter {
  tegn: string
  type: 'stor' | 'liten' | 'tall' | 'symbol'
}

// Tegnsettingsnavn brukt av bl.a. Seraphine-fonten → faktiske tegn
export const TEGNSETTING_NAVN: Record<string, string> = {
  Amperzand: '&', AtSign: '@', Comma: ',', Dash: '-',
  DollarSign: '$', Exclamation: '!', Hashtag: '#', Period: '.',
  QuestionMark: '?', Quotation: '"', Apostrophe: "'", Slash: '/',
  Star: '*', Plus: '+', Equals: '=', Tilde: '~', Caret: '^',
}

// Trekker ut tomme-verdi og motividentitet fra et PES-filnavn.
// To mønstre (prøves i rekkefølge):
//   _N_Minch  → N.M tommer (f.eks. 3_5inch = 3.5") — krever "inch" for å unngå
//              falske treff mot _02_6in-former der 02 er motivnummer
//   _Nin/_N.Min → N tommer (f.eks. _5in, _4.5in)
// Returnerer null hvis ingen tomme-indikator er funnet.
export function utledTomme(pesFilename: string): TommeResultat | null {
  const fn = pesFilename.replace(/\\/g, '/').split('/').pop() ?? pesFilename
  const base = fn.replace(/\.pes$/i, '')

  // Mønster 1: enkelt-siffer_enkelt-siffer + inch (f.eks. 3_5inch, 1_5inch)
  const p1 = /_(\d)_(\d)inch(?=[_.]|$)/i.exec(base)
  if (p1) {
    const tomme = `${p1[1]}.${p1[2]}`
    const identitet = (base.slice(0, p1.index) + base.slice(p1.index + p1[0].length))
      .replace(/^_+|_+$/g, '')
    return { tomme, identitet }
  }

  // Mønster 2: desimaltall + in/inch (f.eks. _5in, _4in, _2inch, _3.5in)
  const p2 = /_(\d+(?:\.\d+)?)in(?:ch)?(?=[_.]|$)/i.exec(base)
  if (p2) {
    const tomme = p2[1]
    const identitet = (base.slice(0, p2.index) + base.slice(p2.index + p2[0].length))
      .replace(/^_+|_+$/g, '')
    return { tomme, identitet }
  }

  return null
}

// Utleder tomme-verdi(er) fra en sizeLabel, f.eks. BX Floral sin «1.5"», «2"», «3.5"» —
// eller et SPENN som BX Florals småbokstaver bruker («1.5-2"», «2-2.5"»), der én fil er
// ment for begge endepunktene. 12Berries sine «Smallest»/«Small»/«Medium»/«Large»/«Largest»
// har ingen siffer og treffer aldri dette — tom liste. Brukes bare når
// utledTomme(pesFilename) ikke fant noe (BX Floral sine filnavn er bare «A.PES», uten
// tomme-indikator).
export function utledTommeFraSizeLabel(sizeLabel: string): string[] {
  const enkelt = /^(\d+(?:\.\d+)?)"$/.exec(sizeLabel)
  if (enkelt) return [enkelt[1]]
  const spenn = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)"$/.exec(sizeLabel)
  if (spenn) return [spenn[1], spenn[2]]
  return []
}

// Gjenkjenner enkelt-tegn fra en motividentitet.
// Håndterer:
//   - Direkte enkelt-tegn: "J", "a", "3"
//   - _Upper_X / _lower_x (Seraphine-stil)
//   - _Number_N (Seraphine-stil for tall)
//   - _Punct_Navn (Seraphine-stil for tegnsetting)
//   - "X (stor)" / "X (liten)" (bibliotek-navngiving)
export function trekktUtKarakter(identitet: string): Karakter | null {
  if (identitet.length === 1) {
    if (/[A-ZÆØÅ]/.test(identitet)) return { tegn: identitet, type: 'stor' }
    if (/[a-zæøå]/.test(identitet)) return { tegn: identitet, type: 'liten' }
    if (/\d/.test(identitet)) return { tegn: identitet, type: 'tall' }
  }

  const upperM = /_[Uu]pper_([A-ZÆØÅ])$/.exec(identitet)
  if (upperM) return { tegn: upperM[1], type: 'stor' }

  const lowerM = /_[Ll]ower_([a-zæøå])$/.exec(identitet)
  if (lowerM) return { tegn: lowerM[1], type: 'liten' }

  const numM = /_[Nn]umber_(\d)$/.exec(identitet)
  if (numM) return { tegn: numM[1], type: 'tall' }

  const punctM = /_[Pp]unct_(.+)$/.exec(identitet)
  if (punctM) {
    const tegn = TEGNSETTING_NAVN[punctM[1]] ?? null
    if (tegn) return { tegn, type: 'symbol' }
  }

  const storM = /^(.) \(stor\)$/.exec(identitet)
  if (storM) return { tegn: storM[1], type: 'stor' }

  const litenM = /^(.) \(liten\)$/.exec(identitet)
  if (litenM) return { tegn: litenM[1], type: 'liten' }

  return null
}
