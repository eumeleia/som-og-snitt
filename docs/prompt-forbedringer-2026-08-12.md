# Forbedringer i Søm og Snitt — oppgaveliste til Claude Code

Ni uavhengige forbedringer. Ta dem gjerne én og én, og la meg godkjenne underveis.
Følg `AGENTS.md`: denne Next.js-versjonen har brytende endringer — les relevant guide i
`node_modules/next/dist/docs/` før du skriver kode. Kjør `npm run build` og lint før du sier deg ferdig.

Filreferansene under er sjekket mot koden 12.08.2026, men les alltid filen selv før du endrer.

---

## 1. Hele navnet må vises på lagerkortene (kun i Lager)

**Hvor:** `src/app/dashboard/inventory/page.tsx`, `InventoryCard` (ca. linje 133–215).

**Nå:** Navneoverlegget er låst til `h-14 overflow-hidden`, og både `<h3>` (navn) og `<p>` (undertittel)
har `truncate`. Lange navn som «Brother Country Embroidery Thread, 122 Salmon Pink» kuttes.

**Ønsket:** Navnet skal kunne gå over flere linjer (f.eks. `line-clamp-3` i stedet for `truncate`,
og la overlegget vokse oppover i stedet for fast høyde). Det gjør ingenting om overlegget dekker mer
av bildet — les gjerne navnet på bekostning av bildet. Behold lesbarheten (gradient/bakgrunn bak teksten).

**Viktig:** Gjelder **kun** Lager. Ikke rør kortene i Oppskrifter, Prosjekter eller Broderi
(`EmbroideryCard` eksporteres fra `src/app/dashboard/embroidery/page.tsx` og gjenbrukes i arrangøren —
den skal være uendret).

---

## 2. Nettleserens tilbakeknapp skal gå ett steg tilbake, ikke ut av seksjonen

**Nå:** Detaljvisninger åpnes som React-state uten egen history-oppføring. Er jeg inne på en sytråd i
Lager og trykker tilbake i nettleseren, havner jeg i Teknikker (forrige *rute*), ikke i lagerlista.

**Ønsket:** Åpning av en detaljvisning, et redigeringsskjema eller en modal skal legge en oppføring i
history, og tilbakeknappen skal lukke akkurat det jeg åpnet og sette meg tilbake nøyaktig der jeg var —
samme fane, samme filter, helst samme skrollposisjon.

**Mønster som allerede finnes:** `src/app/dashboard/embroidery/page.tsx` gjør dette riktig i dag —
`window.history.replaceState({ emb: 'gallery' })` (linje ~2733), `pushState` ved åpning
(linje ~2936–2949) og `popstate`-lytter (linje ~2726–2757).

**Oppgave:** Trekk mønsteret ut i en gjenbrukbar hook (foreslått: `src/app/dashboard/_shared/useHistoryVisning.ts`),
og ta den i bruk i minst:

- `inventory/page.tsx` — `currentItem`, redigeringsskjema, `showAdd`-modaler
- `recipes/page.tsx`
- `projects/page.tsx`
- `techniques/page.tsx`
- `embroidery/arranger/page.tsx` — `selected` (motivvisning) og `aktivKomposisjon`/`nyKomposisjon`

Skriv om `embroidery/page.tsx` til samme hook hvis det ikke gir regresjon. Sjekk at dobbelt tilbake fra
en detaljvisning tar meg ut av seksjonen (som før), og at fram-knappen fungerer.

---

## 3. Bibliotek-fanen i broderi-arrangøren må grupperes på bundles og kategorier

**Hvor:** `src/app/dashboard/embroidery/arranger/page.tsx` (fane `bibliotek`, ca. linje 112–200).

**Nå:** Flat liste over **alle** rader i `embroidery`, sortert på `created_at`, med kun fritekstsøk på navn.
Med en alfabet-bundle på 250+ motiver er det helt uoversiktlig.

**Ønsket:** Samme struktur som resten av appen — bundles vises som ett kort, kategorier som filtre,
løse motiver for seg. Klikk på en bundle åpner innholdet.

**Gjenbruk heller enn å finne opp på nytt:**

- `src/app/dashboard/embroidery/page.tsx` har allerede galleri-gruppering (`GalleryItem`, `sortBundleMotifs`)
- `KomposisjonEditor.tsx` har `MotivPicker` (ca. linje 1167+) med ferdige visninger for
  `kategorier` → `kategori` → `bundle-innhold`, samt `byggVirtuelleMotiver`, `getKats`, `getKatsMedArv`

Vurder å trekke ut den delte grupperingslogikken i stedet for å kopiere den.

---

## 4. Sekvenspanelet ved siden av lerretet

**Hvor:** `src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx` — lerretet ca. linje 443–474,
`<SekvensPanel>` ca. linje 571–589.

**Nå:** Alt ligger i én kolonne: lerret → «Legg til motiv» → valgt motiv → motivliste → sekvens →
simulator → eksport. Trådrekkefølgen havner så langt ned at jeg må bla opp og ned for å se hva jeg redigerer.

**Ønsket:** To kolonner på store skjermer (`lg:` og opp): lerret + motivkontroller til venstre,
sekvens/trådrekkefølge til høyre, side om side. Lerretet gjerne `sticky` så det står stille mens jeg
skroller i sekvensen. Én kolonne som før på mobil/nettbrett. Dra-og-slipp i sekvensen må fortsatt virke.

---
## 5. Trådpaletten skal vise trådene jeg faktisk har — også de som ikke er Brother

**Mål:** Når jeg fargelegger en komposisjon, vil jeg velge blant *mine egne* tråder og se dem i
noenlunde riktig farge på skjermen. At fargen er millimeterpresis i Brothers egen app er mindre
viktig enn at jeg kjenner igjen hvilken snelle jeg skal hente. Det holder at grønt er grønt og at to
blåtoner er til å skille fra hverandre.

### Hva som gjelder teknisk (les dette før du designer løsningen)

- `broderPalett.ts` er Brothers 64-fargers PEC-palett, og `snappTilPalett()` er en bit-eksakt port av
  pyembroiderys snapping. **Den skal ikke endres** — verken hex-verdier eller rekkefølge. Den er
  fasit for selvsjekken i `api/export-pes/index.py`.
- `_snap_til_palett()` (`api/export-pes/index.py`, linje 11–27) snapper **hver eneste** trådfarge til
  nærmeste PEC-farge når fila skrives. Det skjer uansett hva appen viser. Å vise ekte trådfarge på
  skjermen er derfor helt trygt for eksporten — eneste konsekvens er at fargen i Artspira/på maskinen
  kan avvike litt fra skjermen. Det er en avveining jeg har tatt bevisst.
- **Fella som må håndteres:** i `bygg_monster()` (samme fil, ca. linje 109–150) får to *påfølgende*
  segmenter som snapper til samme PEC-farge **ingen** `color_change()` — bare en `trim()`. Da ber ikke
  maskinen om trådskift, og to ulike tråder blir sydd som én farge. Det må appen advare om, se punkt 5 under.

### Ønsket

1. **Trådbiblioteket bor i Lageret.** Utvid `InventoryItemData` (`inventory/page.tsx`) for varer med
   `underkategori` ∈ {`Broderitråd`, `Broderigarn`} med: `hex` (visningsfarge), `merke`, `tradkode`
   (f.eks. `CYT-122`) og `iBroderipalett: boolean`. Fargen skal kunne redigeres av meg — fargevelger
   pluss fritt hex-felt — og vises som en fargeprikk på lagerkortet.
   Tråder som ikke er Brother legges inn på nøyaktig samme måte.

2. **`FargePicker.tsx` får et valg** øverst: «Mine tråder» (standard) / «Brother 64 (PEC)» / «Alle».
   I «Mine tråder» vises ekte farge, navn, kode og merke, gruppert på merke. Brother-paletten blir
   liggende urørt som eget valg.

3. **Ekte farge skal brukes overalt i visningen** — lerret, sekvenspanel, miniatyr og stingsimulator.

4. **Vis konsekvensen, ikke skjul den:** under valgt tråd, skriv «Syr som *Amber Red* `#b54b64` i
   fila» ved hjelp av eksisterende `snappTilPalett()`.

5. **Varsel ved kollisjon:** når to kjøringer som ligger etter hverandre i sekvensen snapper til samme
   PEC-farge, vis en tydelig melding om at maskinen ikke vil be om trådskift mellom dem — og tilby
   «sett inn pause». Pause-elementet finnes allerede (`types.ts` linje ~129, `{ type: 'pause' }`) og
   eksporten gir `pattern.stop()`, som faktisk bryter kjeden. Ikke blokker noe, bare gjør det synlig.

6. **Frivillig, hvis det er lett:** «hent farge fra bilde» — jeg tar bilde av snella og plukker en
   piksel. Da slipper jeg å skrive hex.

### Startverdier for Brother CYT 40

37 av de 40 fargene har eksakt navnetreff i PEC-paletten (normaliser `Grey`→`Gray`,
`Ultra Marine`→`Ultramarine`). Bruk PEC-hexen som startverdi for disse — det er Brothers egen
definisjon av akkurat de fargenavnene:

| Navn | Kode | Start-hex | Navn | Kode | Start-hex |
|---|---|---|---|---|---|
| White | CYT-000 | `#f0f0f0` | Tangerine | CYT-336 | `#fe9e32` |
| Wisteria Violet | CYT-003 | `#686ab0` | Deep Gold | CYT-354 | `#e8a900` |
| Cornflower Blue | CYT-015 | `#4b6baf` | Cream Brown | CYT-70 | `#ffffb3` |
| Deep Rose | CYT-024 | `#f64a8a` | Lime Green | CYT-444 | `#70bc1f` |
| Salmon Pink | CYT-122 | `#fcbbc5` | Leaf Green | CYT-463* | `#66ba49` |
| Dark Fuchsia | CYT-126 | `#c70156` | Dark Olive | CYT-473* | `#435607` |
| Red | CYT-149 | `#ed171f` | Teal Green | CYT-483 | `#008777` |
| Light Lilac | CYT-133* | `#e49acb` | Emerald Green | CYT-485 | `#00673e` |
| Sky Blue | CYT-150 | `#2584bb` | Seacrest | CYT-505 | `#a8ddc4` |
| Carmine | CYT-158 | `#f73866` | Light Blue | CYT-512 | `#a8deeb` |
| Clay Brown | CYT-224* | `#d15400` | Electric Blue | CYT-564 | `#095ba6` |
| Khaki | CYT-242* | `#d0a660` | Ultra Marine | CYT-575 | `#0b3d91` |
| Light Brown | CYT-255 | `#b27624` | Blue | CYT-586 | `#0a55a3` |
| Reddish Brown | CYT-264* | `#d15c00` | Lilac | CYT-604 | `#915fac` |
| Clay Brown | CYT-322 | `#d15400` | Violet | CYT-624* | `#6a1c8a` |
| Cream Brown | CYT-331* | `#ffffb3` | Purple | CYT-635 | `#4e2990` |
| Harvest Gold | CYT-334 | `#ffd911` | Warm Grey | CYT-706 | `#d8ccc6` |
| | | | Dark Brown | CYT-717 | `#2a1301` |
| | | | Pewter | CYT-745* | `#4f5556` |
| | | | Dark Grey | CYT-747 | `#293133` |

**De tre uten treff** — verdiene under er målt fra swatch-fotoene i
`design/Embroidery thread guide.pdf` (side 2) og hvitbalansert. Bruk dem som startverdi; jeg justerer
selv mot ekte snelle etterpå:

| Navn | Kode | Foreslått hex | Rå måling | Snapper til |
|---|---|---|---|---|
| Linen | CYT-025 | `#f5ccb5` | `#d3ab8c` | Applique `#ffc8c8` |
| Rose | CYT-155 | `#bd5470` | `#a34657` | Amber Red `#b54b64` |
| Flesh Pink | CYT-152 | `#eb9ab7` | `#cb818e` | Pink `#f993bc` |

`Flesh Pink CYT-152` traff to PEC-oppføringer med samme navn (`#fdd9de` og `#ffcccc`, begge blekere
enn fotoet). Legg inn `#eb9ab7`, men gjør det lett for meg å bytte.

**To navnepar går igjen med ulik kode** — Clay Brown 224/322 og Cream Brown 70/331 — og peker på samme
PEC-farge. Nå som fargen er min egen, skal de kunne ha hver sin nyanse: legg dem inn som to separate
tråder, og la meg justere den ene.

### Om målemetoden (viktig hvis du vurderer å hente flere farger fra PDF-en)

Side 2 i `design/Embroidery thread guide.pdf` er **fotografier** av tråd, ikke rene fargeflater — matte,
mørke og varme i tonen. Målingene over er median av midtre 60 % av swatchen ved 200 dpi, hvitbalansert
mot `White CYT-000` (gain 1,16 / 1,19 / 1,29). Kontrollert mot de 43 CYT-fargene som har navnetreff i
PEC-paletten er snittavviket ca. 75 RGB-enheter, og verste tilfelle over 130. 12 av CYT 40 lot seg ikke
pare automatisk i det hele tatt fordi swatchen ikke ligger rett til venstre for etiketten
(CYT-70, 133, 224, 242, 264, 331, 336, 463, 473, 505, 624, 745).

Konklusjon: PDF-en duger til å *finne en farge som mangler*, ikke til å overstyre kjente verdier. Ikke
bytt ut PEC-hexene med målte verdier, og ikke bruk automatisk uttrekk uten å se på resultatet.

### Kobling mot Lageret

Trådene ligger allerede i Lager med navn på formen «Brother Country Embroidery Thread, 122 Salmon Pink».
Match tallet i navnet mot CYT-koden ved seeding, slik at eksisterende varer får `hex`, `merke` og
`tradkode` uten at jeg må legge dem inn på nytt. Vis også i fargevelgeren om tråden er oppbrukt
(`forbruksniva`), så jeg ikke velger en jeg ikke har igjen.


## 6. Mer normale koordinater i 100×100 mm-rammen

**Hvor:** `KomposisjonEditor.tsx`, X/Y-feltene ca. linje 498–514 (og `viewBox` ca. linje 296–305).

**Nå:** Feltene viser posisjon i mm målt fra rammens **sentrum**, så verdiene er negative i øvre
venstre halvdel: fra ca. X −35,6 / Y −37,4 til X +40,3 / Y +36,6. Riktig internt (eksporten sentrerer
komposisjonen om origo), men uleselig når jeg skal plassere noe.

**Ønsket:** Vis koordinater som 0–100 mm målt fra rammens **øvre venstre hjørne** (visX = X + 50,
visY = Y + 50), én desimal. Lagringsformatet (`posisjonXTiendedelMm`, tiendedels mm om origo) skal
være helt uendret — dette er kun en visnings- og innskrivingskonvertering.

Legg gjerne til et svakt 10 mm-rutenett i lerretet med tall langs kantene, så feltene og lerretet
snakker samme språk. Merk av på lerretet hvor origo er, hvis det gjør noe lettere.

---

## 7. Talifeltene må gå an å skrive i

**Hvor:** Først og fremst X, Y og rotasjon i `KomposisjonEditor.tsx` (ca. linje 498–522). Gå gjennom
`SekvensPanel.tsx` og `TextVerktoy` for samme mønster.

**Nå:** `<input type="number">` med verdi rett fra state og `Number(e.target.value)` i `onChange`. Det gir:

- «-» kan ikke skrives manuelt — minusverdier må klikkes fram med pilene
- feltet kan ikke tømmes: siste siffer erstattes straks av «0», så jeg får «017» i stedet for «17»

**Ønsket:** Kontrollerte felt med lokal tekst-state:

- feltet får være midlertidig tomt, `-`, `-0`, `1,` osv. mens jeg skriver
- verdien tolkes og skrives til state først når den er gyldig
- ved blur/Enter normaliseres visningen (tomt felt → 0); Escape angrer
- godta både komma og punktum som desimalskilletegn
- behold piltast-opp/ned-justering

`inputMode="decimal"` (ikke `type="number"`) gir riktig tastatur på mobil uten å slåss med nettleserens
tallhåndtering.

---

## 8. Advarsel om plass skal ikke hindre meg i å legge motiver på lerretet

**Hvor:** `KomposisjonEditor.tsx` — `vmStatus` / `RAMME_GRENSE_MM` (ca. linje 904–975), `MotivPicker`
(ca. linje 1167+), `leggTilMotiverBolk` og advarselsbannerne ca. linje 431–441.

**Nå:** Motiver og størrelser klassifiseres som `passer` / `passerIkke`, og «passer ikke» skjules eller
blokkeres i velgeren (`antallSkjult`). Rutenettadvarselen dukker opp når nye motiver ikke får plass side ved side.

**Ønsket:** Advarslene beholdes akkurat som de er — de er nyttige — men de skal aldri hindre meg i å
legge motivene på lerretet. Jeg vil kunne leke, se hvordan motiver ser ut sammen, og eventuelt fjerne
noe etterpå. Konkret:

- ingenting i velgeren skal være `disabled` eller skjult på grunn av størrelse; marker heller med
  «passer ikke i rammen»
- «skjult»-telleren erstattes av et filter jeg selv slår av og på
- eksportknappen kan gjerne fortsatt advare eller blokkere — det er der grensen faktisk gjelder

---

## 9. Stoff skal kunne kobles til et planlagt prosjekt eller en oppskrift

**Hvor:** `inventory/page.tsx` — feltet `tiltenktProsjekt` (type ca. linje 33, skjema ca. linje 969–976).

**Nå:** Ren fritekst. Ingen kobling, ingen navigering, ingenting som oppdaterer seg hvis prosjektet
endrer navn.

**Ønsket:** Velg et eksisterende prosjekt (særlig de med status `Planlagt`) eller en oppskrift, i stedet
for — eller i tillegg til — fritekst:

- utvid `InventoryItemData` med `tiltenktProsjektId` / `tiltenktProsjektNavn` og
  `tiltenktOppskriftId` / `tiltenktOppskriftNavn`; behold `tiltenktProsjekt` som fritekst-fallback
  for eksisterende rader (ingen migrering som mister data)
- velger: gjenbruk `src/app/dashboard/_shared/RecipePicker.tsx` for oppskrifter, og lag tilsvarende
  for prosjekter (`projects`-tabellen, `data.status` ∈ `Planlagt` | `Aktiv` | `Fullført`)
- vis koblingen som en klikkbar chip på lagerkortet/detaljvisningen som tar meg til prosjektet/oppskriften
- se om koblingen bør gå begge veier: `ProjectData` har allerede `stoffer: FabricItem[]` og
  `recipeId`/`recipeName` — foreslå gjerne en løsning, men ikke skriv til prosjektet uten at jeg sier ja

---

## Til slutt

Oppsummer hva du endret per punkt, og si fra om noe av dette krever databaseendringer i Supabase
(nye felt i `data`-JSON trenger det ikke, men det er greit å få det bekreftet).
