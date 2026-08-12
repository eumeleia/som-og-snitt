// Rene funksjoner for motivvalg — flyttet ut av KomposisjonEditor.tsx (2026-08-12) slik at
// de kan testes uten å dra med seg React, Supabase eller next/navigation. Ren flytting:
// ingen atferdsendring, bare et annet hjem. KomposisjonEditor.tsx importerer alt herfra.
import type { Embroidery, EmbroideryBundle, VirtuelMotiv, VirtuelStorrelse } from './types'
import { getCoverImage, getKatsMedArv } from './types'
import { utledTomme, utledTommeFraSizeLabel, trekktUtKarakter } from './tomme'

// DEN ene rammegrensen — den fysiske 100×100 mm-rammen selv slik Python-eksporten (og
// selvsjekken der) forstår den. Eksportert slik at lerretet, tekstverktøyet og
// størrelsesvarselen alle regner mot nøyaktig samme tall, ikke tre uavhengige 100-tall
// som kunne drevet fra hverandre.
export const RAMME_MM = 100

// Bevisst 2 mm STRENGERE enn selve rammen (RAMME_MM) — en sikkerhetsmargin i velgerens
// "passer i rammen"-filter, ikke en egen, uavhengig grense. Uendret verdi (98), bare
// nå uttrykt i forhold til RAMME_MM slik at de to aldri kan drive fra hverandre ved en
// senere endring et av stedene.
export const RAMME_GRENSE_MM = RAMME_MM - 2

export type BboxMm = { widthMm: number; heightMm: number; miniatyrSvg: string | null }

// Størst størrelse som passer i rammen, som standardvalg ved flervalg — samme "passer"-regel
// som resten av velgeren (< RAMME_GRENSE_MM i begge retninger). Passer ingen, brukes den med
// MINST STØRSTE DIMENSJON (bredde eller høyde, den som er størst av de to) — det er den
// dimensjonen som avgjør om motivet kommer inn i rammen, ikke arealet, så "minst ille" måles
// på den, ikke på areal. Er ingenting målt ennå, brukes ganske enkelt den første — samme som
// ved enkeltvalg kan et umålt motiv fortsatt legges til, målet løses uansett først når det
// faktisk skal tegnes (sikreMotivData i selve komposisjonseditoren). Har raden ingen størrelser
// i det hele tatt, er det ingenting å velge — returnerer undefined, og kallstedet
// (leggTilValgte) må filtrere disse bort.
export function velgStandardStorrelse(vm: VirtuelMotiv, bboxCache: Map<string, BboxMm | null>): VirtuelStorrelse | undefined {
  const medMaal = vm.sizes
    .map(s => ({ s, b: bboxCache.get(`${s.embroideryId}:${s.sizeId}`) }))
    .filter((x): x is { s: VirtuelStorrelse; b: BboxMm } => x.b != null)
  const somPasser = medMaal.filter(x => x.b.widthMm < RAMME_GRENSE_MM && x.b.heightMm < RAMME_GRENSE_MM)
  if (somPasser.length > 0) {
    return somPasser.reduce((best, cur) =>
      cur.b.widthMm * cur.b.heightMm > best.b.widthMm * best.b.heightMm ? cur : best
    ).s
  }
  if (medMaal.length > 0) {
    return medMaal.reduce((best, cur) =>
      Math.max(cur.b.widthMm, cur.b.heightMm) < Math.max(best.b.widthMm, best.b.heightMm) ? cur : best
    ).s
  }
  return vm.sizes[0]
}

// Bygger virtuelle motiver fra biblioteket. STANDARD er regelen: én embroidery-rad blir
// ETT VirtuelMotiv, med radens egne data.sizes urørt. Grupperingen ligger allerede riktig
// i basen (embroidery/page.tsx setter én rad per motiv med alle dets størrelser) — å
// utlede identitet fra pesFilename og gruppere på nytt her var selve feilen: det splittet
// 12Berries (5 størrelser i én rad ble 5 kort) og kollapset BX Floral («A (stor)» og
// «a (liten)» er to rader med samme filnavn «A.PES», ble ett kort).
//
// UNNTAKET er fontrader: en rad der sizes[] i virkeligheten er ULIKE TEGN, ikke ulike
// størrelser (Seraphine: én rad per tommestørrelse, alle tegn enumerert som "størrelser").
// Bare DE splittes per tegn og grupperes PÅ TVERS av rader innad i samme bundle, slik at
// «a» i 2" og «a» i 3" blir ett kort med to størrelser. Deteksjon: utled identitet per
// størrelse som før (utledTomme sin identitet, ellers filnavnbasen), kjør
// trekktUtKarakter på hver — MINST TO ulike ikke-null tegn utløser fontrad-grenen. null
// (ikke gjenkjent som noe tegn) teller aldri som en forskjell, ellers ville f.eks.
// 12Berries (fem ukarakteriserte størrelsesnavn, alle null) blitt feilklassifisert.
// Fontrad-deteksjon gjelder kun rader i en bundle — et standalone-motiv kan ikke være det.
export function byggVirtuelleMotiver(
  biblioteket: Embroidery[],
  bundlerMap: Map<string, EmbroideryBundle>,
): VirtuelMotiv[] {
  const enkeltrader: VirtuelMotiv[] = []

  for (const m of biblioteket) {
    const bid = m.data.bundleId
    const bundle = bid ? bundlerMap.get(bid) : undefined
    const sizes = m.data.sizes ?? []

    const perStorrelse = sizes.map(s => {
      const t = utledTomme(s.pesFilename)
      const identitet = t?.identitet
        ?? s.pesFilename.replace(/\.pes$/i, '').split(/[\\/]/).pop()
        ?? s.pesFilename
      return { s, tomme: t?.tomme ?? null, identitet, karakter: trekktUtKarakter(identitet) }
    })
    const ulikeIkkeNullTegn = new Set(
      perStorrelse.map(p => p.karakter?.tegn).filter((t): t is string => t != null),
    )
    const erFontrad = bundle !== undefined && ulikeIkkeNullTegn.size >= 2

    if (erFontrad) {
      const { kats, arvet } = getKatsMedArv(m.data, bundle.data)
      for (const p of perStorrelse) {
        enkeltrader.push({
          key: `${bid}:${p.identitet}`,
          bundleId: bid!,
          identitet: p.identitet,
          navn: p.karakter ? p.karakter.tegn : (p.tomme !== null ? (m.data.navn || p.identitet) : p.identitet),
          coverImage: getCoverImage(m.data),
          kats, katArvet: arvet,
          karakter: p.karakter ?? undefined,
          sizes: [{ embroideryId: m.id, sizeId: p.s.id, tommeLabel: p.tomme, sizeLabel: p.s.sizeLabel }],
        })
      }
      continue
    }

    // STANDARD: ett kort per rad. Prøv karakter fra selve motivnavnet FØR
    // filnavn-identiteten — det er der «A (stor)» / «a (liten)» står (BX Floral), og
    // mønsteret finnes i tomme.ts men ble aldri kalt med navn før denne fiksen. Faller
    // navnet ikke til et tegn, men ALLE størrelsene i raden likevel enes om ETT og samme
    // tegn (blandet filnavnsstil i samme rad, se page.tsx:264), brukes det tegnet — raden
    // splittes uansett ikke, den er fortsatt ett kort.
    const karakterFraNavn = trekktUtKarakter(m.data.navn)
    const enkeltTegnFraFilnavn = ulikeIkkeNullTegn.size === 1
      ? perStorrelse.find(p => p.karakter)!.karakter
      : null
    const karakter = karakterFraNavn ?? enkeltTegnFraFilnavn
    const { kats, arvet } = bundle ? getKatsMedArv(m.data, bundle.data) : getKatsMedArv(m.data)
    enkeltrader.push({
      key: m.id,
      bundleId: bid && bundle ? bid : null,
      identitet: m.id,
      navn: karakter ? karakter.tegn : (m.data.navn || 'Uten navn'),
      coverImage: getCoverImage(m.data),
      kats, katArvet: arvet,
      karakter: karakter ?? undefined,
      // tommeLabel her (til tekstverktøyet): filnavnet vinner der utledTomme fant en
      // indikator, ellers sizeLabel — men KUN når HELE etiketten er en tommeangivelse
      // («1.5"», «2"», BX Floral). 12Berries sine «Smallest»/«Small»/«Medium»/… har ingen
      // siffer og treffer aldri utledTommeFraSizeLabel, så de forblir null som før — dette
      // er bevisst IKKE samme felt som brukes til fontrad-gjenkjenning (p.tomme der er
      // fortsatt ren utledTomme, urørt).
      sizes: perStorrelse.map(p => ({
        embroideryId: m.id, sizeId: p.s.id,
        tommeLabel: p.tomme ?? utledTommeFraSizeLabel(p.s.sizeLabel),
        sizeLabel: p.s.sizeLabel,
      })),
    })
  }

  // Slå sammen fontrad-VM-er fra SAMME bundle med SAMME tegn-identitet på tvers av rader
  // (forskjellige tommestørrelser). STANDARD-VM-er sin identitet ER rad-id-en (m.id), unik
  // per rad og kolliderer derfor aldri — denne sammenslåingen er et rent no-op for dem.
  const sett = new Map<string, VirtuelMotiv>()
  const resultat: VirtuelMotiv[] = []
  for (const vm of enkeltrader) {
    if (vm.bundleId === null) { resultat.push(vm); continue }
    const gruppeKey = `${vm.bundleId}:${vm.identitet}`
    const eksisterende = sett.get(gruppeKey)
    if (eksisterende) {
      eksisterende.sizes.push(...vm.sizes)
    } else {
      const kopi: VirtuelMotiv = { ...vm, sizes: [...vm.sizes] }
      sett.set(gruppeKey, kopi)
      resultat.push(kopi)
    }
  }
  return resultat
}

// Enkelt rutenett med luft mellom — ikke stablet i samme punkt som enkelt-tilleggets
// kaskade. Selve posisjonene, ETTER at beregnRutenettCelle (under) har avgjort hvor stor
// hver celle skal være.
export function beregnRutenettPosisjoner(n: number, celleTiendedelMm: number): Array<{ x: number; y: number }> {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const pos: Array<{ x: number; y: number }> = []
  for (let i = 0; i < n; i++) {
    const rad = Math.floor(i / cols)
    const kol = i % cols
    pos.push({
      x: Math.round((kol - (cols - 1) / 2) * celleTiendedelMm),
      y: Math.round((rad - (rows - 1) / 2) * celleTiendedelMm),
    })
  }
  return pos
}

// Cellestørrelsen (avstand mellom cellesentre) rutenettet over trenger, og om det i det
// hele tatt er MULIG å holde alle n kvadratiske celler (sidelengde storsteDimMm — den
// STØRSTE kjente utstrekningen blant de valgte standardstørrelsene) innenfor ±halve
// RAMME_GRENSE_MM samtidig, uten at noen av dem overlapper (celle < storsteDimMm ville
// vært overlapp, og er derfor aldri tillatt, uansett hvor trangt det blir). Bruker
// RAMME_GRENSE_MM (98), ikke selve RAMME_MM (100) — to motiver som akkurat fyller cellen
// ville ellers havnet med ytterkant nøyaktig på rammekanten, uten klaring til foten.
//
// INVARIANTEN: er det geometrisk mulig for alle n å ligge innenfor rammen samtidig,
// strammes cellestørrelsen inn fra den ønskede 1.25×-margin til akkurat det som trengs
// for å holde ytterste cellekant innenfor rammen — aldri under 1×, som ville vært
// overlapp. Er det umulig (selv tett i tett, celle = storsteDimMm, ryker rammen),
// brukes likevel den tetteste cellen (fortsatt ALDRI overlapp) — kalleren viser da en
// melding i stedet for stille å late som det gikk bra.
export function beregnRutenettCelle(n: number, storsteDimMm: number): { celleMm: number; umulig: boolean } {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)

  // Størst celle DENNE aksen tillater for at ytterste cellekant skal holde seg innenfor
  // rammen. Uendelig (cellestørrelsen er irrelevant for denne aksen) når aksen bare har
  // ÉN celle, siden avstanden fra origo da er storsteDimMm/2 uansett celle. Er selv DET
  // for stort, er aksen umulig uansett cellestørrelse — signalisert med -Infinity, som
  // garantert taper i Math.min under.
  function maxCelleForAkse(antallCeller: number): number {
    if (antallCeller <= 1) return storsteDimMm <= RAMME_GRENSE_MM ? Infinity : -Infinity
    return (RAMME_GRENSE_MM - storsteDimMm) / (antallCeller - 1)
  }

  const maxCelle = Math.min(maxCelleForAkse(cols), maxCelleForAkse(rows))
  const umulig = maxCelle < storsteDimMm
  const celleMm = umulig ? storsteDimMm : Math.min(storsteDimMm * 1.25, maxCelle)
  return { celleMm, umulig }
}
