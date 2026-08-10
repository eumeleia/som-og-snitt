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
  coverImage: string
  bmpPreview: string
  customImage: string
  useCustomImage: boolean
  sizes: EmbroiderySize[]
}

export interface Embroidery {
  id: string
  created_at: string
  data: EmbroideryData
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
}

export interface BroderiKomposisjon {
  id: string
  created_at: string
  data: BroderiKomposisjonData
}

export function getCoverImage(d: EmbroideryData): string {
  return d.useCustomImage ? d.customImage : (d.coverImage || d.bmpPreview)
}
