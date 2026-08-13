// Motiv-formen speiler kun de feltene arrangeringsverktøyet trenger fra det
// eksisterende biblioteket på /dashboard/embroidery — se `embroidery`-tabellen.

export interface EmbroiderySize {
  id: string
  sizeLabel: string
  pesUrl: string
  pesFilename: string
  widthMm?: number
  heightMm?: number
}

export interface EmbroideryData {
  navn: string
  kategori?: string
  kategorier?: string[]
  bundleId?: string
  coverImage: string
  bmpPreview: string
  customImage: string
  useCustomImage: boolean
  sizes: EmbroiderySize[]
}

export function getKats(data: { kategori?: string; kategorier?: string[] }): string[] {
  if (data.kategorier && data.kategorier.length > 0) return data.kategorier
  if (data.kategori) return [data.kategori]
  return []
}

// Kategori settes i dag på bundelen, ikke på hver enkelt fil — uten dette blir de aller
// fleste motivene i en bundle stående som ukategoriserte. Arver bundelens kategori bare når
// motivet ikke har en egen (aldri kopiert ved opplasting, så en senere endring på bundelen
// slår gjennom til alle filene som ikke har overstyrt den selv).
export function getKatsMedArv(
  motivData: { kategori?: string; kategorier?: string[] },
  bundleData?: { kategori?: string; kategorier?: string[] },
): { kats: string[]; arvet: boolean } {
  const eget = getKats(motivData)
  if (eget.length > 0) return { kats: eget, arvet: false }
  if (bundleData) {
    const arvet = getKats(bundleData)
    if (arvet.length > 0) return { kats: arvet, arvet: true }
  }
  return { kats: [], arvet: false }
}

export interface Embroidery {
  id: string
  created_at: string
  data: EmbroideryData
}

// Grunnlinje-kalibrering med øyet (docs/plan-og-prompter-2026-08-13.md, "Beslutning etter
// steg A"): målt automatikk (finnGrunnlinjeFraSting) ble forkastet — den rettet 2 av 10
// ekte underlengder og forskyvet 7 tegn som allerede var riktige. I stedet: fast standard
// (tegnets egen bunn) + manuell korreksjon lagret HER, per tegn, som ANDEL av tegnets egen
// høyde (ikke mm) — det gjør korreksjonen gyldig i alle tommestørrelser, ikke bare den man
// kalibrerte i. Ingen tomme-nøkkel av samme grunn. underlengdeAndel er alltid regnet mot
// den NAIVE standarden (bif = heightMm, andel 0) — se KomposisjonEditor sin
// "Lagre grunnlinje"-handling — så gjentatt kalibrering overskriver i stedet for å
// akkumulere.
export interface FontMetrikk {
  tegn: { [tegn: string]: { underlengdeAndel: number; kilde: 'manuell'; oppdatert: string } }
}

export interface EmbroideryBundleData {
  navn: string
  kategori?: string
  kategorier?: string[]
  coverImage: string
  customImage: string
  useCustomImage: boolean
  fontMetrikk?: FontMetrikk
}

export interface EmbroideryBundle {
  id: string
  created_at: string
  data: EmbroideryBundleData
}

export interface BroderiBbox {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

export interface BroderiStingblokk {
  farge_hex: string
  tradnavn_auto: string | null
  sting: [number, number][]
  antall_sting: number
  bbox: BroderiBbox
}

export interface BroderiFargekjoring {
  farge_hex: string
  tradnavn_auto: string | null
  fra_index: number
  til_index: number
  antall_blokker: number
  antall_sting: number
}

export interface BroderiMotivData {
  enhet: string
  bbox: BroderiBbox | null
  total_sting: number
  stingblokker: BroderiStingblokk[]
  fargekjoringer: BroderiFargekjoring[]
}

// En plassert instans av et motiv+størrelse i en komposisjon. posisjon er senteret av
// motivets EGEN bbox, i 1/10 mm, på et lerret der (0,0) er lerretets midte. rotasjon er
// i grader, mot klokka rundt motivets eget bbox-senter (matcher SVG/pyembroiderys
// +y-nedover-konvensjon: en positiv vinkel roterer medklokka visuelt sett).
export interface PlassertMotiv {
  id: string
  embroideryId: string
  sizeId: string
  navn: string
  posisjonXTiendedelMm: number
  posisjonYTiendedelMm: number
  rotasjonGrader: number
  // Satt bare av TextVerktoy når motivet er ETT TEGN fra en fontbundle — aldri av
  // enkeltmotiv- eller flervalg-veiene. Grunnlaget for "Lagre grunnlinje for denne
  // fonten" (KomposisjonEditor): hvilke motiver på lerretet er kalibreringskandidater,
  // og for hvilket tegn i hvilken bundle. bundleNavn ligger med her (ikke bare bundleId)
  // for å slippe et eget oppslag i lagringspanelet — TextVerktoy har den allerede.
  fontKilde?: { bundleId: string; bundleNavn: string; tegn: string }
}

// Sekvensen er den flate, faktiske sylisten på tvers av alle plasserte motiver —
// enheten som flyttes er hele fargekjøringen (aldri enkelt-stingblokker inni).
// fargekjoringIndex peker inn i DET MOTIVETS egen fargekjoringer[] (fra broderi_motiv-
// cachen), som aldri endres — bare rekkefølgen og en eventuell fargeoverride her gjør.
export interface SekvensKjoring {
  id: string
  type: 'kjoring'
  plassertMotivId: string
  fargekjoringIndex: number
  fargeOverrideHex?: string
}

export interface SekvensPause {
  id: string
  type: 'pause'
}

export type SekvensElement = SekvensKjoring | SekvensPause

export interface BroderiKomposisjonData {
  navn: string
  motiver: PlassertMotiv[]
  sekvens: SekvensElement[]
  // Generert av byggMiniatyrSvg (miniatyr.ts) ved LAGRING, aldri utledet ved listevisning —
  // det ville krevd stingdata for hvert motiv i hver komposisjon. Eksisterende komposisjoner
  // (lagret før dette feltet fantes) har den ikke; lista viser dem uten til neste lagring.
  miniatyrSvg?: string
}

export interface BroderiKomposisjon {
  id: string
  created_at: string
  data: BroderiKomposisjonData
}

export function getCoverImage(d: EmbroideryData): string {
  return d.useCustomImage ? d.customImage : (d.coverImage || d.bmpPreview)
}

export function getBundleCoverImage(d: EmbroideryBundleData): string {
  return d.useCustomImage ? d.customImage : d.coverImage
}

// Én faktisk PES-fil (embroidery-rad + størrelse) som del av et virtuelt motiv.
// tommeLabel er utledet fra filnavnet (f.eks. "2.5"), null hvis ikke funnet.
// sizeLabel er den opprinnelige etiketten fra embroidery-tabellen.
export interface VirtuelStorrelse {
  embroideryId: string
  sizeId: string
  tommeLabel: string | null
  sizeLabel: string
}

// Et virtuelt motiv — en logisk enhet etter at tomme-regelen er brukt til å
// gruppere faktiske embroidery-rader og størrelser. For Seraphine betyr dette
// at alle 1.5"–5"-variantene av "lower_a" slås sammen til ett virtuelt motiv
// med fem størrelser. For FloralAlphabet forblir hvert tegn én rad med egne
// størrelser (allerede korrekt modellert). For ikke-alfabet-bundles er ett
// virtuelt motiv typisk én embroidery-rad.
export interface VirtuelMotiv {
  key: string               // unik: `${bundleId}:${identitet}` eller embroideryId
  bundleId: string | null
  identitet: string         // filnavnbase uten tomme-prefiks
  navn: string              // visningsnavn
  coverImage: string
  kats: string[]
  katArvet: boolean
  karakter?: import('./tomme').Karakter
  sizes: VirtuelStorrelse[]
}

export interface KategoriGruppe {
  kat: string | null   // null = "Uten kategori"
  vms: VirtuelMotiv[]
}

// Delt av MotivPicker (KomposisjonEditor.tsx) og arranger sitt Bibliotek-fane
// (arranger/page.tsx) — selve kategori-grupperingen av allerede byggede virtuelle
// motiver (byggVirtuelleMotiver), IKKE en full kopi av MotivPicker sin visning (som i
// tillegg har "passer i ramme"-telling, flervalg og parse-fremgang — konsepter som
// bare gir mening der motiver faktisk skal PLASSERES i en komposisjon, ikke ved ren
// nettlesing av biblioteket). Et motiv med flere kategorier dukker opp i HVER av dem —
// samme regel begge steder, ikke en bug. `kategoriRekkefolge` er den kjente
// KATEGORIER-rekkefølgen (embroidery/page.tsx); ukjente/brukerlagte kategorier
// kommer etter, "Uten kategori" sist.
export function byggKategoriGrupper(vms: VirtuelMotiv[], kategoriRekkefolge: string[]): KategoriGruppe[] {
  const katToVms = new Map<string | null, VirtuelMotiv[]>()
  for (const vm of vms) {
    const kats = vm.kats.length > 0 ? vm.kats : [null]
    for (const kat of kats) {
      const arr = katToVms.get(kat) ?? []
      arr.push(vm)
      katToVms.set(kat, arr)
    }
  }
  const alleKats: Array<string | null> = []
  for (const k of kategoriRekkefolge) {
    if (katToVms.has(k)) alleKats.push(k)
  }
  for (const k of katToVms.keys()) {
    if (k !== null && !alleKats.includes(k)) alleKats.push(k)
  }
  if (katToVms.has(null)) alleKats.push(null)
  return alleKats.map(kat => ({ kat, vms: katToVms.get(kat) ?? [] }))
}
