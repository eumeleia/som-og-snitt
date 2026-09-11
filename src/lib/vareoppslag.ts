// Ren logikk for oppslag av kvitteringsvarer mot selfmade.com — ingen nettkall, se
// vareoppslag.test.ts. Selve HTTP-fetchingen og Claude-kallet ligger i
// src/app/api/slaa-opp-vare/route.ts (gjenbruker src/app/api/import-fabric/route.ts).

export interface Kandidat {
  url:  string
  navn: string
}

export type Kandidatvalg =
  | { utfall: 'valgt';      kandidat: Kandidat }
  | { utfall: 'flereTreff'; kandidater: Kandidat[] }
  | { utfall: 'ikkeFunnet' }

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const kost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + kost)
    }
  }
  return d[m][n]
}

/**
 * Likhet 0..1 mellom kvitteringsnavnet og produktnavnet. Kvitteringsnavnet er kuttet ved
 * 29 tegn av kvitteringsskriveren — derfor sammenlignes bare de første 29 tegnene av
 * PRODUKTnavnet, aldri hele strengen. Bruker Levenshtein-avstand (en ulikhetsterskel),
 * ikke likhet, fordi kvitteringen kan bruke danske stavemåter («Vævet hvid» mot
 * «Vevet hvit»).
 */
export function sammenlignNavn(kvitteringsnavn: string, produktnavn: string): number {
  const a = kvitteringsnavn.trim().toLowerCase()
  const b = produktnavn.trim().toLowerCase().slice(0, 29)
  if (!a || !b) return 0
  const dist = levenshtein(a, b)
  return 1 - dist / Math.max(a.length, b.length)
}

export function erSammeVare(kvitteringsnavn: string, produktnavn: string, terskel = 0.7): boolean {
  return sammenlignNavn(kvitteringsnavn, produktnavn) >= terskel
}

/**
 * Velger riktig rad blant flere søketreff. Går ALDRI på navn alene med mindre ett
 * kandidatnavn peker klart bedre enn de andre — ellers overlates valget til brukeren
 * (flereTreff), for eksempel når to kandidater ligger nær hverandre i likhet.
 */
export function velgKandidat(kvitteringsnavn: string, kandidater: Kandidat[], terskel = 0.7): Kandidatvalg {
  if (kandidater.length === 0) return { utfall: 'ikkeFunnet' }
  if (kandidater.length === 1) return { utfall: 'valgt', kandidat: kandidater[0] }

  const rangert = kandidater
    .map(k => ({ k, score: sammenlignNavn(kvitteringsnavn, k.navn) }))
    .sort((a, b) => b.score - a.score)

  const beste = rangert[0]
  const nestBeste = rangert[1]
  if (beste.score >= terskel && beste.score - nestBeste.score >= 0.15) {
    return { utfall: 'valgt', kandidat: beste.k }
  }
  return { utfall: 'flereTreff', kandidater }
}

/**
 * Kvitteringsnummeret kan være et variantnummer (glidelåsen: 4074320 på kvitteringen,
 * 4074355 på produktsiden — de to siste sifrene er lengden i cm). Finner lengste felles
 * prefiks og returnerer HALEN av kvitteringsnummeret hvis det er lengre enn prefikset.
 * Ikke verifisert for hele katalogen — derfor returneres null (ingen gjetning) med mindre
 * det faktisk er en hale å hente ut.
 */
export function utledVariantHale(kvitteringsnummer: string, sidenummer: string): string | null {
  if (kvitteringsnummer === sidenummer) return null
  let i = 0
  while (i < kvitteringsnummer.length && i < sidenummer.length && kvitteringsnummer[i] === sidenummer[i]) i++
  if (i === 0) return null
  if (kvitteringsnummer.length <= i) return null
  return kvitteringsnummer.slice(i)
}

/**
 * Enheten kommer fra produktsidens eget «Pris pr …»-tekst, aldri fra om kvitteringens
 * antall-tall er helt. «Pris pr meter»/«kr/m» → mengde, alt annet («Pris pr stk», pakke
 * o.l.) → antall.
 */
export function avgjorEnhetsfelt(enhetstekst: string): 'mengde' | 'antall' {
  return /meter|kr\s*\/\s*m\b/i.test(enhetstekst) ? 'mengde' : 'antall'
}

/** Formaterer kvitteringens antall-tall til visningsstrengen InventoryItemData bruker. */
export function formaterMengdeAntall(antallTall: number, felt: 'mengde' | 'antall'): string {
  const tekst = antallTall.toLocaleString('nb-NO', { maximumFractionDigits: 2 })
  return felt === 'mengde' ? `${tekst} m` : tekst
}

/**
 * `kategori` settes fra brødsmulestien, ikke fra varenavnet. «Handle etter kategori» og
 * «Hjem» er generiske mellomsteg selfmade.com alltid har med, og filtreres bort.
 */
export function tolkBrodsmulesti(segmenter: string[]): {
  kategori: 'Stoff' | 'Tilbehør' | 'Utstyr'
  underkategori?: string
  utstyrstype?:   string
} {
  const meningsfulle = segmenter.filter(s => s && s !== 'Hjem' && s !== 'Handle etter kategori')
  const top  = meningsfulle[0] ?? ''
  const leaf = meningsfulle[meningsfulle.length - 1] || undefined

  if (/metervarer/i.test(top)) return { kategori: 'Stoff' }
  if (/sytilbehør/i.test(top)) return { kategori: 'Tilbehør', underkategori: leaf }
  return { kategori: 'Utstyr', utstyrstype: leaf }
}

/**
 * Unike produktnumre i lesingen, i rekkefølge. Samme nummer slås bare opp én gang — men
 * ulike numre med SAMME varenavn (fire Gütermann-trådfarger) holdes fra hverandre, siden
 * grupperingen skjer på nummeret, aldri på navnet.
 */
export function unikeProduktnumre(linjer: { produktnummer: string }[]): string[] {
  const sett = new Set<string>()
  const rekkefolge: string[] = []
  for (const l of linjer) {
    if (!sett.has(l.produktnummer)) { sett.add(l.produktnummer); rekkefolge.push(l.produktnummer) }
  }
  return rekkefolge
}
