# Plan, rekkefølge og prompter — 13.08.2026

Status etter gjennomgang av begge samtalene, koden i HEAD, vurderingen av 12.08 og de fire
vedlagte filene.

---

## Hva som allerede er gjort (ikke gjør om igjen)

| Fra | Punkt | Status |
|---|---|---|
| Vurdering 12.08, pkt 1 | Tester tilbake | **Gjort.** `broderPalett.test.ts`, `motivvalg.test.ts`, `sekvens.test.ts`, `npm test` = vitest. |
| Vurdering 12.08, pkt 3 | `tommeLabel` for STANDARD-grenen | **Gjort** i `ee95b3e` (`motivvalg.ts:133`). Tekstverktøyet får nå tommestørrelser for BX Floral. |
| Vurdering 12.08, pkt 4 | `byggKategoriGrupper` død kode | **Gjort.** Brukes nå av `arranger/page.tsx`. |
| Forrige Code-økt, del B | 36 Brother-tråder inn i Lageret | **Gjort**, men hex-verdiene skal nå erstattes, se oppgave 2. |
| Denne økten | Enkelttegn fra font-bundle | **Kodet, ikke verifisert i nettleser.** |
| Denne økten | Redigering av enkeltmotiv | **Kodet, ikke verifisert i nettleser.** |

Gjenstår fra vurderingen 12.08: pkt 2 (dokumentér to-stegs-koblingen i `eksport.ts` + test),
og rydding pkt 5–8.

---

## Rekkefølge, med begrunnelse

1. **Verifisér og commit de to kodeendringene fra i dag.** De ligger ukommittert i
   arbeidstreet. Den ene løser blokkeringen din: Floral Font er kategorisert som «font», og
   da fantes det ingen vei til enkelttegn i det hele tatt. Går først fordi den er ferdig, er
   liten, og fordi ukommittert kode blir rot når neste oppgave starter.
2. **Lageret: bildegalleri per vare.** Dette er nøyaktig der forrige Code-økt stoppet — du
   svarte på spørsmålet, og så tok usage slutt. Kortest vei til å bli ferdig med noe påbegynt.
3. **Lageret: trådfarger for alle 60 tråder.** Data ligger klar i
   `design/mine-trader-alle.json`. Uten dette treffer trådpaletten fortsatt bare Brother, og
   du ser feil farger på lerretet for Gunold, Gütermann og FUFU.
4. **Font, steg A + B:** mål grunnlinjen på ekte tegn, kalibrer terskelen, skriv den rene
   funksjonen med tester. Ingen UI. Se `docs/fontplan-2026-08-13.md`.
5. **Font, steg C–F:** koble inn, lagre på bundlen, forhåndsvisning med grunnlinje, visuell
   kontroll, sy én.
6. **Rydding:** to-stegs-koblingen i `eksport.ts` dokumenteres og testes, rå `farge_hex` i
   `arranger/page.tsx:762` merkes eller snappes, `capHeight` fjernes.

Punkt 2 og 3 kan slås sammen i én økt (samme fil, `inventory/page.tsx`). Punkt 4 bør stå
alene — det er der det er lett å bygge noe som ser riktig ut og er feil.

**Kan hentes fram tidligere:** stingtelleren (prompt 4, punkt 1). Skitch PP1 tar maks
30 000 sting og 63 farger per design, og appen viser ikke stingantallet før ETTER at fila er
bygget. Eksporterer du noe stort i mellomtiden, oppdager du taket først når Artspira eller
maskinen avviser fila. Oppgaven er liten — tallet finnes allerede i dataene editoren har.

---

## Prompt 1 — kopier denne til Claude Code

````
Tre oppgaver i denne rekkefølgen. Ikke start på neste før forrige er verifisert.

## 0. Gjennomgå og commit endringene som allerede ligger i arbeidstreet

Ukommittert nå: `arranger/KomposisjonEditor.tsx`, `arranger/page.tsx` (mine, fra i dag) og
`embroidery/page.tsx` (`pesPath`-feltet, additivt, fra en tidligere økt).

De to første gjør to ting:

a) Font-bundles var låst til tekstverktøyet. `BundleKort.handleClick` sender «font»-bundles
   rett til `{ type: 'tekst' }`, og der fantes ingen vei videre til enkelttegn — så Floral
   Font kunne ikke brukes til å sette inn én bokstav mens tekstfunksjonen er halvferdig.
   Nå: knapp «Sett inn enkelttegn» i tekstverktøyets topptekst → tegnrutenettet
   (`{ type: 'tegn', fraTekst: true }`), og «Skriv tekst» tilbake derfra. Tilbakeknappen i
   tegnrutenettet går til tekstverktøyet når man kom derfra, ellers til kategorien som før.

b) `MotivVisning` i arrangørens bibliotek var kun lesing. Nå: «Rediger»-knapp som åpner
   motivet i `KomposisjonEditor` med den størrelsen som er valgt i visningen, via ny
   valgfri prop `startMotiv`. Bevisst valg: ÉN editor, ikke en halv kopi av den for
   enkeltmotiv — all farge-, sekvens- og eksportlogikk følger med gratis, og lagrer man,
   blir det en helt vanlig komposisjon. Ny historikk-visning `{ v: 'nyFraMotiv', id, sizeId }`
   så nettleserens tilbakeknapp virker.

`npx tsc --noEmit` er kjørt og er ren. `npm test` er IKKE kjørt (min sandkasse har ikke
riktige native moduler) — kjør den. `npx eslint` gir tre feil i `arranger/page.tsx`, alle
`react-hooks/set-state-in-effect` på `load()`/`loadKomposisjoner()` i effekter; de er eldre
enn disse endringene, ikke rør dem her.

Verifisér i nettleser:
- Floral Font → åpner tekstverktøyet → «Sett inn enkelttegn» → trykk «E» → E havner på
  lerretet som ett motiv, med farger og sekvens som normalt.
- Bibliotek → et hvilket som helst motiv → velg en størrelse → «Rediger» → editoren åpnes med
  motivet plassert i midten → tilbakeknappen i nettleseren fører tilbake til motivvisningen.

Commit de to arrangør-filene for seg. `embroidery/page.tsx` (`pesPath`) committer du separat
med sin egen melding.

## 1. Lageret: flere bilder per vare (galleri)

Slik prosjekter og oppskrifter allerede virker: ett hovedbilde på kortet, flere bilder inne
på varen. `InventoryItemData.bilde` er én streng i dag.

- Legg til `bilder?: string[]` ved siden av `bilde`. `bilde` forblir hovedbildet som vises på
  kortet i oversikten — ikke bytt ut feltet, og ikke migrer eksisterende rader.
- I redigeringsskjemaet: last opp flere, vis dem som et rutenett, la meg sette hvilket som er
  hovedbilde og slette enkeltbilder.
- Gjenbruk opplastingsveien og lagringsbøtta oppskrifter/prosjekter bruker; ikke lag en ny.
- Se på hvordan `ProjectData.images` (`projects/page.tsx`) er løst og følg det mønsteret der
  det passer, i stedet for å finne opp et nytt.

## 2. Lageret: trådfarger for alle 60 tråder

Kilden er `design/mine-trader-alle.json` (60 tråder: 40 Brother Country, 11 FUFU,
7 Gütermann Sulky, 2 Gunold). Den er bygget fra min egen fargeoversikt, og HEX-verdiene der
er fasit — også for Brother-trådene, der de avviker fra PEC-palettens verdier. Eksempel:
CYT-149 Red skal være `#e70268`, ikke `#ed171f`.

Regler:

- Matching mot eksisterende `inventory`-rader (kategori `Tilbehør`, underkategori
  `Broderitråd`/`Broderigarn`): først eksakt på `data.tradkode`, deretter på trådkoden som
  helt ord i `data.navn`. For Brother teller også det bare tallet («122» i «Brother Country
  Embroidery Thread, 122 Salmon Pink»). Krev at merket stemmer før du matcher på et bart
  tall — «1005» må ikke kunne treffe en Brother-rad.
- Treff: OPPDATER raden med `hex`, `merke`, `tradkode`, `iBroderipalett: true`. Ikke rør
  `navn`, `notater`, `plassering`, `forbruksniva` eller andre felt jeg har fylt ut selv.
- Ingen treff: sett inn ny rad med `kategori: 'Tilbehør'`, `underkategori: 'Broderitråd'`,
  `navn` fra `navnIOversikten`, og de samme fire feltene.
- **Ikke rør `BROTHER_PALETT` i `broderPalett.ts`.** Den er PEC-fasiten eksporten snapper mot,
  og skal forbli bit-identisk med pyembroidery. Trådfargene er visningsfarger; snappingen
  skjer i `effektivTradfarge`/`_snap_til_palett` som før.

Rapportér tre grupper hver for seg: oppdaterte, nye, og de som ikke lot seg matche entydig.
Skriv ingenting til basen for den siste gruppen — spør meg i stedet.

Til slutt: åpne en komposisjon, sjekk at FargePicker → «Mine tråder» viser alle fire merkene,
og at en FUFU- eller Sulky-farge nå gir ekte farge på lerretet i stedet for PEC-fargen.
````

---

## Prompt 2 — font, steg A + B (måling og ren funksjon)

````
Les `docs/fontplan-2026-08-13.md` først. Denne økten er BARE steg A og B: måling og en ren
funksjon med tester. Ikke rør `fontUtils.ts`, `TextVerktoy` eller noe UI. Ikke skriv til
databasen.

Bakgrunnen, kort: hvert tegn i en digitalisert font er sin egen PES-fil med sitt eget
nullpunkt — det finnes ingen felles grunnlinje i koordinatene. Dagens kode gjetter
grunnlinjen fra en hardkodet bokstavliste (`DESCENDER_LETTERS` i `fontUtils.ts:5`), og den
lista er feil: `z` står oppført som underlengde (det har den normalt ikke), `j` mangler at
prikken ligger over x-høyden, og i skriftfonter stikker ofte `f`, `Q`, `J` og komma under
grunnlinjen uten å stå i lista. Målet er å MÅLE grunnlinjen fra stingdataene i stedet.

## Steg A — kalibrering mot ekte tegn

Skriv et engangsskript (temp-fil, slettes etterpå — samme mønster som
`thread-import-tmp.mjs`) som henter stingdata og skriver ut båndprofiler.

Data: `broderi_motiv`-cachen (`embroidery_id`, `size_id` → `data.stingblokker[].sting`).
Mangler en rad, kall `POST /api/broderi-motiv/parse` for den ene og fortsett.
Koordinatene er 1/10 mm i filas egne koordinater, `+y` NEDOVER. Bekreft det siste selv på
ett tegn før du stoler på det — hele algoritmen avhenger av retningen.

Fonter og størrelse:
- SC Seraphine_Satin ved 2″ (kursiv/script — den vanskeligste)
- BX FLORAL ALPHABET PINK ved 2″ (rettere former)

Tegn som skal med, fordi hvert av dem tester sin egen feilklasse:

  H, O, A       ingen underlengde, versalhøyde
  o, c, e, x    ingen underlengde, x-høyde (o/c/e har litt optisk oversving — det er riktig)
  g, p, y, q    underlengde, skal gi dybde > 0
  j             underlengde MED prikk over kroppen
  z             skal gi dybde ≈ 0 (her tar dagens kode feil)
  f, Q, J       fontavhengig — dette er svaret vi ikke har
  l, 1, i       tynne tegn, tester vernet mot falske utslag
  komma         hvis fonten har det

For hvert tegn: del høyden i bånd på 0,5 mm (5 enheter) og skriv ut BEGGE disse profilene,
normalisert mot sin egen maksverdi:

  (1) breddeprofil    — `max_x − min_x` for punktene i båndet
  (2) masseprofil     — antall stingpunkter i båndet

Skriv så ut, for hver profil og hver terskel i {0,2 · 0,3 · 0,4}: hvor grunnlinjen havner når
du går NEDENFRA og opp så lenge båndverdien er under terskelen × maks, og hvor dyp den
resulterende underlengden blir i mm.

**Dette er en måling, ikke en tuning.** Ikke juster terskelen til tallene ser fine ut.
Kriteriet er: finnes det ÉN terskel og ÉN profil som gir riktig svar for ALLE tegnene over,
i BEGGE fontene? Riktig betyr:
- H, O, A, o, c, e, x, z, l, 1, i → dybde ≤ 0,5 mm (ett bånd)
- g, p, y, q, j → dybde > 1 mm

Kjent risiko du må se etter, ikke tune bort: i en skriftfont kan halen på `j`, `y` eller `g`
være en dekorativ krøll som er BREDERE enn selve kroppen. Da vil breddeprofilen svare feil,
mens masseprofilen fortsatt kan treffe (en krøll er tynt blekk selv når den er bred). Det er
derfor du dumper begge. Slår begge feil på et tegn, si det rett ut — det tegnet får manuell
korreksjon senere (steg D i planen), og det er en akseptabel utgang.

Rapportér tilbake til meg FØR du går videre til steg B:
- valgt profil og terskel, med tabellen som viser at den holder for alle tegn i begge fonter
- hvilke tegn som eventuelt ikke lot seg måle
- svar på om Seraphines «p» virkelig henger ~26 mm under grunnlinjen ved 2″ (v1-planen målte
  det og flagget det selv som mistenkelig)

Skriv tallene ned i `docs/fontmaling-2026-08-13.md` slik at neste økt slipper å måle på nytt.

## Steg B — ren funksjon + tester

Først når steg A er rapportert og jeg har sagt ja.

Ny fil `src/app/dashboard/embroidery/arranger/fontGrunnlinje.ts`, ingen React, ingen
Supabase, ingen import fra `fontUtils.ts`:

```ts
export function finnGrunnlinjeFraSting(
  punkter: [number, number][],
  opts?: { radHoydeTiendedelMm?: number; terskel?: number; maksAndel?: number },
): { grunnlinjeY: number; underlengdeDybde: number; sikker: boolean }
```

- Standardverdiene for `terskel` og profilvalg er DE MÅLTE fra steg A, med en kommentar som
  sier hvor tallet kommer fra og hvilke tegn det ble målt på.
- Ingen underlengde funnet → `grunnlinjeY = bbox.max_y` (tegnets egen bunn). Det er per
  definisjon riktig for tegn uten underlengde, og gjenskaper dagens korrekte oppførsel for
  versaler og x-høydebokstaver uten noen bokstavliste.
- Vern: målt dybde > `maksAndel` (0,6) av tegnets høyde → `sikker: false`, og
  `grunnlinjeY = bbox.max_y`. Kalleren skal da bruke tegnets egen bunn, ALDRI dagens
  `DESCENDER_LETTERS`-regel.
- Tom punktliste eller ett enkelt bånd → `sikker: false`, ikke krasj.

`fontGrunnlinje.test.ts` med:
- syntetisk tegn uten hale (rektangel av punkter) → dybde 0, `sikker: true`
- syntetisk tegn med smal hale under en bred kropp → dybde = halens høyde, `sikker: true`
- syntetisk tynt tegn (én kolonne hele veien) → `sikker: false`
- minst fire EKTE tegn fra steg A som faste punktlister (H, o, g, z), med de målte fasitene
- tomt/degenerert input

Kjør `npm test` og `npx tsc --noEmit`. Ingen andre filer skal endres i denne økten.
````

## Beslutning etter steg A (13.08)

Målingen i `docs/fontmaling-2026-08-13.md` er solid, men konklusjonen der — «bruk
bredde/0,3 som standard, korriger de 14 avvikene manuelt» — går ikke opp når man ser på
HVILKE tegn som treffer.

Automatikken kan bare tilføre verdi på tegn som faktisk HAR underlengde. For alle andre er
standarden (tegnets egen bunn) allerede riktig per definisjon. Regnestykket ved bredde/0,3:

- **Ekte underlengder, 10 stk:** treffer på Seraphine `p` og `q`, og BX `y` (1,5 mm ved
  0,3, men 6,0 ved 0,4 — ustabil, altså ikke til å stole på). De sju andre (Ser `g`, `y`,
  `j`; BX `g`, `p`, `q`, `j`) måles til 0,0–0,5 mm, altså ingen korreksjon.
- **Tegn uten underlengde:** her ØDELEGGER automatikken svar som allerede var riktige.
  Seraphine `H` 3,0 mm, `A` 2,5, `x` 2,0, `O` 1,5 — og `1` med **19,5 mm**. En dato som
  «2026» ville fått ettallet nesten to centimeter for høyt.

Automatikken retter altså 2 av 10 tegn og forskyver 7 som var riktige, ett av dem
katastrofalt. Netto negativ. **Den skal ikke slås på som standard.**

Én ting til fra rapporten er verdt å ta inn: fasiten i planen min antok latinsk
typografi-norm, men Seraphine er en monogramstil der versaler FAKTISK svinger under
grunnlinjen. Da er ikke «H = 3,0 mm» nødvendigvis en målefeil — det kan være riktig svar på
et spørsmål fasiten stilte feil. Tallene alene kan ikke avgjøre det. Det kan øyet.
Derfor flyttes tyngdepunktet dit.

**Vedtatt retning:** fast, forutsigbar standard (tegnets egen bunn) + korreksjon med øyet,
lagret på fonten én gang og gjenbrukt i alle størrelser. Målingene fra steg A beholdes som
forslag i kalibreringen — synlige, men de flytter aldri et tegn av seg selv.

---

## Prompt 3 — fontgrunnlinje: standard + kalibrering med øyet

````
Les `docs/fontmaling-2026-08-13.md` og avsnittet «Beslutning etter steg A» i
`docs/plan-og-prompter-2026-08-13.md` først.

Beslutningen: `finnGrunnlinjeFraSting` skal IKKE bygges som automatikk. Målingen viser at
den retter 2 av 10 ekte underlengder og forskyver 7 tegn som allerede var riktige — verst
Seraphines «1» med 19,5 mm. Vi bygger i stedet en fast standard pluss kalibrering med øyet.
Fire oppgaver, i rekkefølge.

## 1. Datafeil først: BX Floral kan ikke skrive små bokstaver i dag

Steg A avdekket at BX Florals småbokstaver har `sizeLabel` som spenn («1.5-2"», «2-2.5"»),
mens versaler og tall har «2"». `utledTommeFraSizeLabel` (`tomme.ts:58`) avviser spenn og
returnerer null, så småbokstavene får `tommeLabel: null` og finnes ikke for tekstverktøyet.
Konsekvens: skriver du «Ada» i BX Floral ved 2", finnes bare «A».

Bekreft dette i basen først (`sizeLabel`-verdiene for et par små bokstaver i den bundlen),
og fiks så:

- `utledTommeFraSizeLabel` returnerer i dag `string | null`. Endre til `string[]` — et spenn
  «1.5-2"» dekker BÅDE «1.5» og «2», fordi det er én fil som er ment for begge. En ren
  «2"» gir `['2']`. Ingen treff gir `[]`.
- `byggVirtuelleMotiver` (`motivvalg.ts:133`) må da lage én `VirtuelStorrelse` per tomme
  spennet dekker, ikke én per rad.
- Tester i `motivvalg.test.ts`: «2"» → `['2']`, «1.5-2"» → `['1.5','2']`, «Smallest» → `[]`,
  «3.5"» → `['3.5']`. Og en test på at en BX-lignende rad gir en tomme som matcher
  versalenes.

Verifisér i UI: BX Floral → tekstverktøy → 2" → skriv «Ada» → alle tre tegnene finnes.

## 2. Fast standard: tegnets egen bunn

I `fontUtils.ts`:

- Slett `DESCENDER_LETTERS` og `baselineInFileMm`. Lista er feil (`z` har ingen underlengde,
  `j` har prikk over x-høyden), og den gjetter på noe vi nå håndterer eksplisitt.
- Ny standard for ALLE tegn: grunnlinjen er tegnets egen bunn (`heightMm`). Forutsigbart,
  riktig for flertallet, og feilene som gjenstår er SYNLIGE — et tegn med underlengde henger
  tydelig for høyt, i stedet for å være subtilt feilplassert.
- Slett `capHeight` (regnes ut, leses aldri) og rett doc-kommentaren som påstår at
  `buildFontData` kan returnere `null`. Behold `X_HEIGHT_REF`/`xHeight` — den brukes
  fortsatt til mellomromsbredde.
- Ny standard `tracking`: `0,08 × xHøyde` i stedet for 0. Filene har ingen sidelagre
  (`min_x = 0` for alle tegn), så 0 mm gir bokstaver som berører hverandre.

## 3. Kalibrering med øyet, lagret på fonten

Dette er selve funksjonen, og den skal gjenbruke det som finnes — ikke bli en ny editor.

Flyt: skriv tekst → legg den på lerretet → dra bokstavene loddrett til ordet står riktig
(fungerer allerede, hver bokstav er et vanlig `PlassertMotiv`) → én knapp: **«Lagre
grunnlinje for denne fonten»**.

Knappen skal:
- regne differansen mellom hvert tegns faktiske `posisjonYTiendedelMm` og den y-en
  `layoutTekst` foreslo,
- vise hva som blir lagret FØR det lagres («p +2,1 mm · g +1,4 mm · 1 −0,3 mm»), med
  mulighet til å hoppe over enkelttegn — jeg kan ha flyttet en bokstav av rent estetiske
  grunner, og det skal ikke bli fontens grunnlinje,
- lagre som ANDEL av tegnets egen høyde, ikke millimeter: `underlengdeAndel = dybdeMm /
  heightMm`. Da gjelder kalibreringen i alle tommestørrelser, ikke bare den jeg kalibrerte i.

Lagres i `embroidery_bundles.data.fontMetrikk`:

```ts
fontMetrikk?: {
  tegn: { [tegn: string]: { underlengdeAndel: number; kilde: 'manuell'; oppdatert: string } }
}
```

Merk: ingen `tomme`-nivå, siden andelen er størrelsesuavhengig. Feltet er valgfritt — en
bundle uten `fontMetrikk` oppfører seg nøyaktig som etter oppgave 2.

`buildFontData` leser `fontMetrikk` når den finnes: `bif = heightMm × (1 − underlengdeAndel)`.
Ingen lagret verdi → tegnets egen bunn.

Vis også de målte tallene fra steg A som et FORSLAG i lagringsdialogen der de finnes
(«målt hale: 20,5 mm») — som noe jeg kan trykke på, aldri som noe som er forhåndsutfylt.

## 4. Grunnlinje synlig på lerretet

Uten en strek å se mot er kalibrering gjetning. Tegn en tynn, stiplet vannrett linje på
y = 0 i lerretet i `KomposisjonEditor`, kun mens en tekst-kalibrering er aktiv (ikke
permanent støy i vanlige komposisjoner).

## Kontroll før du sier deg ferdig

`npm test` og `npx tsc --noEmit`. Deretter, i nettleseren:
- BX Floral, «Ada» ved 2" — alle tegn finnes (oppgave 1)
- Seraphine, «zoo» — z skal IKKE henge under lenger (regresjon for dagens feil)
- Seraphine, «jazz» — j og z sammen
- Seraphine, «Happy» — kalibrer p, lagre, skriv «Happy» på nytt: p skal komme riktig med én gang
- Skriv «2026» i Seraphine og sjekk at ettallets dekorative hale ikke flytter sifferet

Ikke eksporter eller sy noe i denne økten — det er neste steg, og det skal gjøres når
kalibreringen står.
````

## Prompt 4 — stingteller og rydding

`capHeight` og doc-kommentaren i `fontUtils.ts` ble ryddet i prompt 3 (`5a0acd2`) og står
derfor ikke her lenger.

````
Fire oppgaver. Den første er den viktigste — de tre andre er opprydding etter vurderingen
av 12.08 og kan gjøres raskt.

## 1. Stingteller mot maskinens grenser

Brother Skitch PP1 tar maks **30 000 sting** og **63 farger** per design. Appen viser
stingantallet først i selvsjekken ETTER at fila er bygget (`EksportPanel.tsx:184`), så en
komposisjon over taket oppdages først når Artspira eller maskinen avviser den. Med
satengtekst er 30 000 en grense man treffer fort.

- Summér `sting.length` over alle blokker i sekvensen fra `resolved` — samme data lerretet
  allerede har. Ingen ny henting, ingen serverrunde.
- Vis «N av 30 000 sting» i editoren, sammen med målene. Gul over 25 000, rød over 30 000.
- Tell også farger slik fila FAKTISK får dem: etter `snappTilPalett`, og etter at like
  nabofarger er slått sammen (samme regel som `bygg_monster` i `api/export-pes/index.py`
  bruker — to nabokjøringer med samme snappede farge blir ÉN kjøring uten fargeskift).
  Advar over 63.
- Advar, ikke blokkér. Samme prinsipp som rammevarselet: jeg skal kunne bygge ferdig en fil
  jeg har tenkt å dele i to hoopinger.
- Legg en test på tellingen (ren funksjon, samme mønster som de andre testene).

## 2. Dokumentér to-stegs-koblingen i eksporten

`byggEksportSegmenter` (`eksport.ts`) sender MIN egen trådfarge til Python, ikke
palettfargen. Det gir riktig resultat bare fordi `byggPecTilEkteMap` nøkler oppslaget på
`snappTilPalett(trad.hex)`, slik at Python snapper tilbake til samme PEC-farge. Det er to
steg, ikke én idempotent operasjon, og korrektheten avhenger av nøkkelvalget i en annen fil.

Skriv avhengigheten ned der den faktisk gjelder, og legg en test som feiler hvis
`snappTilPalett(effektivTradfarge(...).hex) !== pecHex`. Endrer noen nøkkelen senere — for
eksempel for å la meg knytte en tråd manuelt til en PEC-farge den ikke snapper til — skal
testen si fra, ikke eksporten stille gi feil farge.

## 3. Rå farge i motivvisningen

`arranger/page.tsx:762` er den siste flaten som tegner rå, usnappet `farge_hex`. Merk den
slik resten av appen gjør: «Kildefila har X — maskinen syr Y».

## 4. Kjør ferdig vedlikeholdet

Kjør «Parse N størrelser» og «Forny alle miniatyrer» til begge er tomme, og rapportér hvor
mange rader som ble behandlet.

`npm test` og `npx tsc --noEmit` før du sier deg ferdig.
````

---

## Etter prompt 4 — det som gjenstår, og som er mitt eget arbeid

1. **Kalibrer de to fontene med øyet.** Skriv et ord med hver font, dra bokstavene på plass,
   lagre grunnlinjen. Bare de tegnene jeg faktisk bruker trenger det — resten står riktig
   som de er. Kalibrering i én tommestørrelse gjelder alle, siden den lagres som andel.
2. **Merk:** allerede lagrede tekstkomposisjoner beholder plasseringen sin. Y-en er bakt inn
   i hvert `PlassertMotiv` da teksten ble lagt til. Vil jeg ha den kalibrerte versjonen, må
   teksten settes inn på nytt.
3. **Sy én tekst.** Grunnlinjen er ikke bekreftet før den er sydd. Seraphine «Happy» i 2″ er
   testordet — versal, x-høyde og to underlengder i ett.
