# Kvitteringsimport fra Selfmade — 11.09.2026

Lageret kan importere én vare fra en Selfmade-URL i dag. Ønsket er å importere et helt
kjøp fra et bilde av kvitteringen i stedet, fordi det tar lang tid å legge inn ti varer
etter en handletur.

Alt under er lest av seks ekte kvitteringer (jan 2026, mai 2026, apr 2026, nov 2025 × 2,
sep 2025) og sjekket mot selfmade.com og mot koden 11.09.2026. Det som ikke er verifisert
er merket.

---

## Det som finnes i dag

`/api/import-fabric` tar en produkt-URL, henter HTML-en, trekker ut JSON-LD og
properties-seksjonen (`extractSections`) og lar Claude returnere navn, materiale, bredde,
vekt, krymp, vask, sertifisering og bilde. `apiImportFabric` i `inventory/page.tsx:114`
bruker den, men returnerer bare seks av feltene — **krymp og sertifisering hentes og
kastes**.

`InventoryItemData` (`inventory/page.tsx:20`) har `kjopsdato`, `kilde`, `bredde`,
`materiale`, `vask`, `farge`, `mengde` og `antall`, men **ingen** felter for pris,
produktnummer, produkt-URL eller kjøp.

`@anthropic-ai/sdk ^0.95.1` og `googleapis` ligger i `package.json`. Ingen bildebibliotek.

Drive-mappe og opplasting finnes ferdig: `POST /api/drive/ensure-folder` med
`{ folderName }` returnerer en `folderId` via `getOrCreateSubfolder` (idempotent), og
`/api/drive/upload` laster opp. Begge brukes av `recipes/page.tsx:629-691`.
`settings/page.tsx` viser Drive-koblingen, men har ingen mappelenker.

---

## Det som står på kvitteringen

- **Produktnummeret står på linjen OVER navnet.** Hver vare er to linjer.
- **Bilagsnummeret har ledende null** (`02400100381832`) og må lagres som streng. Serien
  sier hvilken kasse: `024001…` er POS 001, `024002…` er POS 002.
- **Datoformatet er DD-MM-YYYY.** `30-05-2026` er 30. mai — entydig, siden 30 ikke kan
  være en måned.
- **Navnene er kuttet ved 29 tegn.** Telt på 36 navn fra de seks kvitteringene: ingen er
  lengre, 21 er nøyaktig 29. «Vevet jacquard med stretch og» stopper midt i setningen.
- **«Line discount» finnes som egen linje** og trekker fra på totalen uten å høre synlig
  til noen bestemt vare. 30.05.2026: varelinjene summerer til 867,56, rabatten er −26,40,
  SUM er 841,16.
- **Tallet i antall-kolonnen betyr ikke «stykk».** «Tyll, hvit» har 1 til 34,95 — det er
  én meter. «Sateng fór petrol» har 2, altså to meter.
- **Samme navn kan være ulike varer.** Én kvittering har fire linjer «Gütermann sew all
  sytråd 200m» med numrene 19246, 19386, 19132 og 19351 — fire trådfarger. En annen har
  «Modul til click boks PRYM tra» som både 46293 (69,00) og 46294 (79,00).
- **Kvitteringen bruker danske navn på norske varer:** «Vævet hvid med blomster», «Vævet
  hørlook blå træ & fugl», «Vævet hvid m vandfarve blomst».
- **Prisen endrer seg over tid.** 9001 «Lerret m lim hvit 90x100cm» kostet 142,95 i
  september 2025 og 159,95 i mai 2026.
- **Varer går igjen på flere kvitteringer** — 9001, 46294 og Gütermann-tråd. Importen vil
  ofte treffe noe som allerede ligger i lageret.

---

## Det Selfmade-oppslaget gir

`https://www.selfmade.com/nb-no/search?search=<produktnummer>` fant riktig produkt for alle
seks numrene på januarkvitteringen. Det finnes ingen nummer-bare-adresse:
`https://www.selfmade.com/nb-no/7043/` gir 404, og URL-en trenger navne-slugen i tillegg.

| Nr. | Treff | Landet på | Pris på siden | Betalt |
|---|---|---|---|---|
| 7043 | 2 treff | `blank-sateng-sort-7043` | 139,95 /m | 129,95 |
| 4074320 | rett til produktsiden | `ykk-glidelaas-4mm-usynlig-spiral-sort-z40743` | 34,95 /stk | 34,95 |
| 9299 | 4 treff | `vlieseline-vliesofix-…-719-9299` | 129,95 /m | 119,00 |
| 400388 | rett til produktsiden | `vevet-jacquard-med-stretch-og-lurex-sand-400388` | 225,00 /m | 168,75 |
| 61043 | 2 treff | `skraabaand-sateng-18-mm-sort-5m-61043` | 76,00 /pakke (5 m) | 76,00 |
| 46097 | rett til produktsiden | `magnetisk-soemguide-til-symaskinen-46097` | 89,00 /stk | 74,00 |

Produktsiden gir to ting kvitteringen ikke har:

- **Brødsmulestien** sier varetypen: «Sytilbehør > Glidelåser», «Innlegg & vatt», «Sateng»,
  «Bånd og snor», «Sytilbehør > Verktøy». Bruk den til `kategori`, ikke navnet.
- **Enheten står eksplisitt**: «kr/m», «per stk», «per pakke (5 meter)». Det er fasiten for
  om tallet på kvitteringen er meter eller antall.

---

## Fem feller i sammenligningen

1. **Kvitteringsnavnet er kuttet ved 29 tegn.** Sammenlign de første 29 tegnene av
   produktnavnet mot kvitteringsnavnet, aldri hele strengen.
2. **Navnet kan være dansk selv om siden er norsk.** «Vævet hvid med blomster» mot «Vevet
   hvit med blomster». Eksakt strengsammenligning feiler — bruk en ulikhetsterskel.
3. **Samme navn, ulikt nummer, ulik vare.** Nummeret er identiteten, aldri navnet.
4. **Kvitteringsnummeret kan være et VARIANTnummer.** Glidelåsen har 4074320 på
   kvitteringen; produktsiden oppgir basisnummer 4074355 og lengdene 20–60 cm. De to siste
   sifrene er lengden i cm. Siden søket lander på viser altså feil variant — leses lengden
   av siden, får du 55 cm på en glidelås kjøpt i 20 cm.
   **Ikke verifisert:** at dette gjelder hele katalogen. Grunnlaget er to tall på ett
   produkt. Håndter defensivt: er kvitteringsnummeret lengre enn nummeret i URL-en,
   behandle halen som variantverdi og ikke stol på variantverdien siden viser.
5. **Enheten kommer fra produktsiden, aldri fra tallet.** Et helt tall betyr ingenting.

Det finnes ikke noe mønster i sifferantallet: 7-sifrede numre er glidelås (4074320) og
strikk (3502001), mens både 400388 (6 siffer) og 7043 (4 siffer) er stoff.

---

## Beslutninger

- **Betalt pris er fasiten.** Prisen hentes ikke fra nettsiden med mindre kvitteringen
  mangler den. Fire av seks priser på januarkvitteringen avvek fra listeprisen.
- **Det ekte navnet kommer fra produktsiden**, ikke fra kvitteringen.
- **Produktnummeret lagres** — ikke fordi URL-en er upålitelig, men fordi fire trådfarger
  deler navn, og fordi variantnummeret ikke finnes i URL-en.
- **Antall 1 med «5m» i navnet er greit.** Produktsidens eget navn er «Skråbånd sateng
  18 mm sort 5m», så pakkeinnholdet ligger allerede i navnet.
- **Bilagsnummeret lagres** for å hindre at samme kvittering importeres to ganger.
- **Kvitteringsbildet lagres i Drive** i en egen mappe, med snarvei under Innstillinger.
- **Ingenting skrives til lageret uten at jeg har sett og godkjent det.**

## Taket

Avlesning av et krøllete kvitteringsbilde i skrå sol kan ikke garanteres. Summeringssjekken
i prompt 1 fanger en feillesing, men kan ikke reparere den.

---

## Rekkefølge

1. **Prompt 1** — les kvitteringen og vis resultatet. Ferdig, `596d861`. Alle seks
   kvitteringene lest riktig, summeringssjekken eksakt på alle.
2. **Prompt 2** — oppslag mot Selfmade og import til lageret. Ferdig, `d3ca933`.
   Glidelåsen fikk 20 cm og ikke produktsidens 55, og jacquarden fikk betalt pris.
3. **Prompt 3** — kvitteringsbildet til Drive og snarvei i Innstillinger. Ferdig, `02a0940`.
   Skilt ut av prompt 2 for å holde den ferdiggjørbar.

Delingen er der fordi lesing, oppslag og skriving i samme prompt blir gjort halvveis alle
tre.

---

## Prompt 1 — les kvitteringen  (sendt 11.09, `596d861`)

````
Ny funksjon, del 1 av 2: les en Selfmade-kvittering fra bilde og vis hva som står på den.
Denne delen skriver INGENTING til lageret. Det kommer i del 2, når lesingen er bekreftet.

Alle fakta under er lest av seks ekte kvitteringer. Bildene ligger klare i
`docs/kvitteringer-test/`, navngitt `<dato>-<bilagsnummer>`, og mappa står allerede i
`.gitignore` — kvitteringene skal ikke commites.

## Hva som skal bygges

1. Knapp «Importer kvittering» på lagersiden (`src/app/dashboard/inventory/page.tsx`), ved
   siden av måten man legger til en vare på i dag. Ikke i sidemenyen.
2. Ny rute `POST /api/les-kvittering`: tar et bilde, returnerer JSON.
3. En tabell på skjermen som viser det som ble lest. Ingen «Importer»-knapp ennå.

## Ruta

Bruk `@anthropic-ai/sdk` (allerede i `package.json`, `^0.95.1`) med `ANTHROPIC_API_KEY` fra
`.env.local`. Samme oppsett som `src/app/api/import-fabric/route.ts`, men med bildeinnhold
i stedet for tekst.

**Bildeformatet er en reell felle.** Bildene kommer fra iPhone og kan være HEIC. Jeg har
testet: ImageMagick (`convert`) og `ffmpeg` klarer IKKE disse filene — bare et ekte
libheif-basert bibliotek gjør det. `package.json` har ingen bildeavhengighet i dag. Legg
til `heic-convert` (ren JS, ingen native build) og konverter til JPEG før bildet sendes
videre. Andre formater sendes som de er. Avvis filer som ikke er bilder med en tydelig
feilmelding, ikke en stack trace.

Skaler ned til maks 1568 px på lengste side før sending — Claude skalerer uansett ned dit,
og et 4284×5712-bilde koster bare tokens uten å gi bedre lesing.

### Retur

{
  "bilagsnummer": "02400100381832",
  "dato": "2026-05-30",
  "butikk": "Selfmade Barstølveien 80, Kristiansand",
  "sum": 841.16,
  "linjer": [
    { "produktnummer": "502164", "navn": "Musselin 2-lags støvet flaske",
      "antall": 1.8, "enhetspris": 79.20, "linjesum": 142.56 }
  ],
  "rabatter": [{ "tekst": "Line discount", "belop": -26.40 }]
}

## Leseregler, alle sett i de seks kvitteringene

**Produktnummeret står på linjen OVER navnet**, ikke ved siden av. Hver vare er to linjer.

**Bilagsnummer er en STRENG.** `02400100381832` — den ledende nullen må overleve. Parses
det som tall, er det ødelagt. Serien sier også hvilken kasse: `024001…` er POS 001,
`024002…` er POS 002.

**Datoformatet er DD-MM-YYYY.** `30-05-2026` er 30. mai. Det er entydig fordi 30 ikke kan
være en måned. Returner ISO (`2026-05-30`), som er formatet `kjopsdato` bruker i dag.

**Navnene er kuttet ved 29 tegn.** Jeg har telt 36 navn fra de seks kvitteringene: ingen er
lengre enn 29, og 21 er nøyaktig 29. «Vevet jacquard med stretch og» stopper midt i
setningen. Returner navnet slik det står — ikke prøv å gjette resten. Det ekte navnet
hentes fra produktsiden i del 2.

**«Line discount» er en egen linje** som trekker fra på totalen, og den hører ikke synlig
til noen bestemt vare. Den skal IKKE legges på en varelinje. Legg den i `rabatter`.

**Tallet i antall-kolonnen betyr ikke alltid «stykk».** «Tyll, hvit» har 1 til 34,95 — det
er én METER. «Sateng fór petrol» har 2, som er to meter. Ikke tolk tallet, bare les det.
Enheten avgjøres i del 2, fra produktsiden.

**Samme navn kan være ulike varer.** Én kvittering har fire linjer «Gütermann sew all
sytråd 200m» med numrene 19246, 19386, 19132 og 19351 — fire trådfarger. En annen har
«Modul til click boks PRYM tra» som både 46293 (69,00) og 46294 (79,00). Slå aldri sammen
linjer på navn. Hver linje på kvitteringen blir én linje i `linjer`.

**Kvitteringen kan bruke danske navn på norske varer:** «Vævet hvid med blomster», «Vævet
hørlook blå træ & fugl». Returner dem som de står.

## Summeringssjekken — obligatorisk

`sum(linjesum) + sum(rabatt)` må stemme med `sum` fra kvitteringen, med 0,05 i slingring
for øreavrunding. Stemmer det ikke, er avlesningen feil: si det tydelig i svaret og i
tabellen, og ikke lat som resultatet er brukbart.

Dette er den eneste billige kontrollen på at et krøllete bilde i skrå sol er lest riktig.
Eksempel fra 30.05.2026: varelinjene summerer til 867,56, rabatten er −26,40, og SUM er
841,16.

## Tabellen på skjermen

Én rad per kvitteringslinje: produktnummer, navn, antall, enhetspris, linjesum. Over
tabellen: bilagsnummer, dato, butikk, SUM, og om summeringssjekken gikk. Under: eventuelle
rabattlinjer.

Ingen importknapp. Ingen skriving til lageret. Ingen nye felter i `InventoryItemData` ennå.

En kort hjelpetekst ved opplastingen: kvitteringen bør fylle mest mulig av bildet. På de
bildene mine der kvitteringen dekker under halve rammen, blir teksten liten.

## Ren logikk med tester

Legg det som kan testes uten nettkall i en egen fil med tester:

- summeringssjekken: én kvittering med rabattlinje, én uten, og én som ikke går opp
- `30-05-2026` → `2026-05-30`, og `05-01-2026` → `2026-01-05`
- bilagsnummer med ledende null overlever som streng gjennom hele veien

## Rapporter til meg før du går videre

Kjør ruta mot alle seks bildene i `docs/kvitteringer-test/` og rapporter per kvittering:
antall leste linjer, om summeringssjekken gikk, og hva som eventuelt ble lest feil. Ikke
begynn på oppslag mot selfmade.com eller på skriving til lageret — det er del 2.

`npm test`, `npx tsc --noEmit`, `npx eslint`. De fire kjente eslint-feilene i
`arranger/` er eldre enn dette arbeidet og skal ikke røres.
````

---

## Prompt 2 — oppslag og import  (sendt 11.09, `d3ca933`)

Sendes når prompt 1 er bekreftet. Juster den hvis lesingen avdekket noe som ikke står her.

````
Del 2 av 2: slå opp varene på selfmade.com og importer dem til lageret. Del 1 (lesing av
bildet) er bekreftet. Les `docs/kvitteringsimport-2026-09-11.md` først, særlig «Fem feller
i sammenligningen».

## 1. Oppslagsruta

Ny rute `POST /api/slaa-opp-vare`: tar `{ produktnummer, kvitteringsnavn }` og returnerer
produktdata. Gjenbruk `extractSections` og Claude-kallet fra
`src/app/api/import-fabric/route.ts` — ikke skriv en ny HTML-uttrekker.

Oppslaget er `https://www.selfmade.com/nb-no/search?search=<produktnummer>`. Verifisert på
alle seks numrene fra januarkvitteringen. To utfall, begge må håndteres:

- **Ett eksakt treff** → siden er selve produktsiden.
- **En treffliste** → for `9299` kom fire treff, og tre av dem var gratis DIY-oppskrifter
  uten sammenheng med varen. Velg rad ved å sammenligne kvitteringsnavnet med
  produktnavnet, etter reglene i «Fem feller».

Returner kanonisk URL, ekte navn, brødsmulesti, enhet, hovedbilde, og for stoff også
materiale, bredde, vekt, vask, krymp og sertifisering. `/api/import-fabric` henter allerede
krymp og sertifisering, men `apiImportFabric` (`inventory/page.tsx:114`) kaster dem — ta
dem med denne gangen.

Feiler oppslaget, returner det som en TILSTAND, ikke en exception. En linje skal aldri
forsvinne stille.

## 2. Nye felter i `InventoryItemData` (`inventory/page.tsx:20`)

- `produktUrl?: string`
- `produktnummer?: string` — nummeret fra KVITTERINGEN, ikke det fra URL-en (felle 4)
- `betaltPris?: string` — linjesummen fra kvitteringen
- `bilagsnummer?: string`
- `krymp?: string`
- `sertifisering?: string`

`kjopsdato` og `kilde` finnes og skal fylles («Selfmade Kristiansand»).

**Betalt pris er fasiten.** Prisen fra produktsiden skal aldri overskrive den. Har
kvitteringen en rabattlinje, vis den i gjennomgangstabellen og la meg avgjøre — `betaltPris`
er linjesummen, ikke en fordelt andel av rabatten.

Mengde: metervare fyller `mengde` («1,8 m»), stykkvare fyller `antall` («1»). Hvilken av
dem avgjøres av enheten fra produktsiden, aldri av om tallet er helt.

`kategori` settes fra brødsmulestien.

## 3. Gjennomgangstabellen — ingenting skrives uten at jeg har sett det

Resultatet havner i en tabell, ikke i lageret. Én rad per kvitteringslinje: det som ble
lest, det som ble funnet, og en avkryssing. Jeg huker av og trykker «Importer de valgte».

Fire tilstander må vises, ikke skjules:

- **Ikke funnet** → vis kvitteringslinjen som den er, la meg lime inn en URL selv eller
  hoppe over.
- **Flere mulige treff** → vis dem, la meg velge.
- **Finnes fra før** → samme `produktnummer` ligger i lageret. Si det i raden og la meg
  velge: ny rad, eller hopp over. Ikke slå sammen automatisk.
- **Kvitteringen er importert før** → samme `bilagsnummer` finnes i lageret. Si fra øverst
  og krev en bekreftelse før noe legges til.

## 4. Kvitteringsbildet til Drive

Når importen er bekreftet: `POST /api/drive/ensure-folder` med
`{ folderName: "Kvitteringer" }`, så `/api/drive/upload`. Samme to kall som
`recipes/page.tsx:629-691` gjør for mønster-PDF-er. Filnavn: `<dato>-<bilagsnummer>.<endelse>`,
der endelsen kommer fra originalfila, ikke en fast `.jpg`.

Under Innstillinger (`dashboard/settings/page.tsx`), rett under Google Drive-blokka: en
snarvei til `https://drive.google.com/drive/folders/<folderId>`. `getOrCreateSubfolder` er
idempotent, så siden kan kalle `ensure-folder` hver gang den lastes uten å lage duplikater.

## 5. Tester uten nettkall

- navnesammenligning: «Vævet hvid med blomster» skal treffe «Vevet hvit med blomster»
- sammenligningen bruker de første 29 tegnene av produktnavnet
- fire varer som deler navnet «Gütermann sew all sytråd 200m» holdes fra hverandre på
  nummer
- variantutledning: 4074320 mot basis 4074355 → variant «20»
- enhet «kr/m» → `mengde`, «per stk» → `antall`

## Kontroll i nettleseren

Importer januarkvitteringen. Alle seks linjene skal finne riktig produkt. Glidelåsen skal
få 20 cm, ikke 55. Jacquarden skal få betalt 455,63, ikke listeprisen 225,00 × 2,7.
Importer den samme kvitteringen på nytt → appen skal si fra at den er importert før.

`npm test`, `npx tsc --noEmit`, `npx eslint`.
````

---

## Prompt 3 — kvitteringsbildet til Drive  (sendt 11.09, `02a0940`)

````
Fullfør prompt 3 av kvitteringsimporten — kvitteringsbildet til Drive og snarvei i
Innstillinger. Arbeidet er PÅBEGYNT og ligger ucommitet i arbeidstreet; en tidligere økt
ble avbrutt midt i. Ikke start på nytt, ikke skriv om det som allerede står, og ikke lag
en ny plan — det som gjenstår er lite og presist beskrevet under. Les
`docs/kvitteringsimport-2026-09-11.md` og `git diff` først.

Del 1 (`596d861`) og del 2 (`d3ca933`) er ferdige og commitet.

## Det som allerede er gjort — verifisert, la det stå

- `src/app/api/drive/upload/route.ts` tar nå en valgfri `folderId` i formData. Sjekket:
  de tre eksisterende kallerne (`oppskrifter/ny/page.tsx:592`, `projects/page.tsx:1770`,
  `recipes/page.tsx:1609`) sender ingen `folderId`, så utvidelsen er bakoverkompatibel.
- `src/lib/kvittering.ts`: `byggKvitteringsfilnavn(dato, bilagsnummer, originaltFilnavn)`
  med tre tester i `kvittering.test.ts`.
- `inventory/page.tsx`, `KvitteringImportModal`: `arkiverKvitteringsbilde()` i EGEN
  try/catch etter importen, «Arkiverer kvitteringsbilde…»-tilstand, arkivmelding,
  «Åpne i Drive»-lenke, og `nyLesing()` nullstiller de tre nye tilstandene.
- `settings/page.tsx`: state `kvitteringsmappeUrl` og en `useEffect` som henter folderId.

`npx tsc --noEmit` går rent. `npm test` er IKKE kjørt på dette arbeidet ennå.

## Det som gjenstår

### 1. Lenka i Innstillinger rendres ingen steder
`kvitteringsmappeUrl` settes, men brukes aldri — derfor melder eslint den som ubrukt på
`settings/page.tsx:25`. Legg lenka inn i `drive.connected`-greina (:88–100), mellom
«Tilkoblet»-raden og «Koble fra»-knappen, og bare når `kvitteringsmappeUrl` er satt.
Samme visuelle språk som resten av siden.

### 2. Ny eslint-feil i den samme useEffect-en
`settings/page.tsx:32` gir `react-hooks/set-state-in-effect` fordi
`setKvitteringsmappeUrl(null)` kalles synkront i effekt-kroppen. Det er en NY feil, ikke
en arvet.

`drive.connected` går fra true til false ett eneste sted: `disconnect()`. Flytt
nullstillingen dit, og la effekten bare returnere tidlig når den ikke er tilkoblet.

### 3. Liten felle i fargevalget på arkivmeldingen
`inventory/page.tsx:1123` velger farge med
`arkivMelding.startsWith('Kvitteringen er arkivert')`. Endrer noen teksten senere, blir en
vellykket arkivering stille om til gul feilmelding. Bytt til en egen tilstand
`arkivStatus: 'ok' | 'feil' | null` ved siden av meldingen. Ingen annen endring i blokka.

## Kontroll

eslint-basislinja her er ikke ren. `npx eslint` gir i dag 36 errors og 43 warnings, og
alle unntatt `settings/page.tsx:32` er eldre enn dette arbeidet. Etter fiksene skal ingen
melding peke inn i noe dette arbeidet har rørt, med disse arvede unntakene som IKKE skal
fikses: `inventory/page.tsx` 228, 1353, 1384 (`<img>`-warnings) og 1864, 1923, 1924, 1926
(`set-state-in-effect`).

`npm test`, `npx tsc --noEmit`, `npx eslint`.

Så i nettleseren — rapporter hva du faktisk ser, ikke hva du antar:
- Importer en kvittering med Drive tilkoblet. Bildet skal ligge i «Kvitteringer» under
  «Søm og Snitt», med navn `<dato>-<bilagsnummer>.<endelse>`, og det skal være
  ORIGINALEN, ikke den nedskalerte JPEG-en som ble sendt til Claude.
- Åpne fila i Drive. Vises bildet, eller ligger den som ukjent binærfil? En HEIC fra
  iPhone kan ha tom `file.type`, og da sender ruta `application/octet-stream`. Skjer det,
  utled mimetypen fra endelsen.
- «Åpne i Drive»-lenka i bekreftelsen skal gå til riktig fil.
- Koble fra Drive, importer en til. Varene skal fortsatt havne i lageret, med beskjed om
  at arkiveringen ble hoppet over. Ingen «Import feilet».
- Åpne Innstillinger, last siden på nytt et par ganger. Lenka skal gå til riktig mappe, og
  det skal ikke dukke opp duplikatmapper i Drive.

Importerer jeg samme kvittering to ganger og bekrefter, lastes bildet opp to ganger. Det
er greit — ikke bygg dedupe mot Drive.

## Docs og commit

`docs/kvitteringsimport-2026-09-11.md`, prompt 2 seksjon 4, sier filnavnet er
`<dato>-<bilagsnummer>.jpg`. Det stemmer ikke lenger — endelsen kommer fra originalfila.
Rett den linja, og legg inn prompt 3 i sin helhet under prompt 2, i samme format som de to
andre.

To commits, fordi docs skal referere hashen til kode-commiten:

git add src && git commit -m "Add receipt import (part 3): archive the receipt image to Drive and link the folder from settings"

Ta hashen fra den commiten, skriv prompt 3 inn i docs med den, og så:

git add docs && git commit -m "Record receipt import part 3 in the planning doc" && git push
````
