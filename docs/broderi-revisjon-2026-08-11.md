# Revisjon av broderifunksjonen — 2026-08-11

Uavhengig gjennomgang av arrangeringsverktøyet, sekvenspanelet, motivvelgeren og
PES-eksporten. Metodikk: kildekoden er lest på nytt for hvert punkt (ingen minnefiler eller
tidligere oppsummeringer er lagt til grunn), og der det var praktisk mulig er den faktiske
logikken KJØRT — mot ekte produksjonsdata der det fantes, mot syntetiske eksempler der det
var nødvendig for å isolere et spesifikt tilfelle. Ingenting er rettet i denne runden.

**Firetrinnsskala brukt gjennomgående:**
- **verifisert** — kjørt/testet mot ekte data eller ekte kjørende kode
- **implementert** — koden finnes og ser riktig ut, men er ikke kjørt/testet av meg
- **deployet, men uverifisert** — pushet, men avhenger av noe jeg ikke kan sjekke lokalt
- **mangler**

---

## 1. Sekvens og sammenslåing

### 1.1 Den ufravikelige regelen (rekkefølge innenfor samme motiv)

**Fil/funksjon:** `bevarerMotivRekkefølge()` i
[sekvens.ts:140](../src/app/dashboard/embroidery/arranger/sekvens.ts#L140) — én felles funksjon,
ikke spredt. Kalles fra to steder:
- [sekvens.ts:189](../src/app/dashboard/embroidery/arranger/sekvens.ts#L189) i
  `finnSammenslaingsforslag()` — et forslag som ville brutt regelen blir aldri generert.
- [SekvensPanel.tsx:76](../src/app/dashboard/embroidery/arranger/SekvensPanel.tsx#L76) i
  `onDragEnd()` — dra-og-slipp som ville brutt regelen blokkeres, med en synlig feilmelding
  som navngir motivet.

`fasesorter()` ([sekvens.ts:271](../src/app/dashboard/embroidery/arranger/sekvens.ts#L271))
kaller IKKE `bevarerMotivRekkefølge()` eksplisitt — men bygger sekvensen fase for fase (kjøring
0 fra alle motiver, så kjøring 1 fra alle, osv.), noe som strukturelt garanterer stigende
rekkefølge per motiv. Bekreftet med en egen test (se under), ikke bare lest fra koden.

**Status: verifisert.** Kjørte den ekte `sekvens.ts`-koden (via `npx tsx`, CommonJS-import for
å unngå en ikke-relatert Node-verktøybegrensning med ikke-ASCII eksportnavn) mot ekte
produksjonsdata for Design 01/02/03 i 3":

- Design 01 (3") har 5 fargekjøringer: hvit, svart, rød, **hvit**, svart — hvit gjentas i
  posisjon 0 og 3, IKKE nabokjøringer. Kjørt alene: **0 forslag** (riktig — enhver
  sammenslåing her ville brutt Design 01 sin egen rekkefølge).
- Alle tre motiver plassert sammen i standard rekkefølge (15 kjøringer totalt, inkl. tre
  separate hvite og fire separate svarte kjøringer spredt over de tre motivene): **0 forslag**
  totalt, og en direkte sikkerhetssjekk (`bevarerMotivRekkefølge` kjørt på resultatet av HVER
  kandidat som i teorien kunne dukket opp) bekreftet at ingen av dem ville brutt regelen.
  Årsaken til at selv tverr-motiv-kandidater (f.eks. Design 01 sin hvite mot Design 02 sin
  hvite) ble avvist: å flytte Design 02 sin hvite kjøring tidligere i sekvensen ville dratt
  den forbi Design 02 sine EGNE foregående kjøringer — som er nøyaktig den samme regelen,
  bare anvendt på et mindre synlig tilfelle enn "samme par".
- Direkte enhetstest av `bevarerMotivRekkefølge()`: en ulovlig rekkefølge (kjøring 0 og 3 i
  Design 01 byttet om) → `false`. En lovlig rekkefølge (et annet motiv sin kjøring satt inn
  midt i Design 01 sin, uten å røre Design 01 sin EGEN orden) → `true`.
- `fasesorter()` kjørt på to syntetiske motiver med identisk fargeliste →
  `bevarerMotivRekkefølge()` på resultatet: `true`.

Jeg fant ikke akkurat scenarioet «kjøring 1 + kjøring 9» fra en tidligere sesjon (det avhenger
av nøyaktig hvilken rekkefølge motivene ble lagt til i, som jeg ikke har tilgang til) — men jeg
testet den underliggende feilklassen direkte (samme-motiv fargerepetisjon, både innad i ett
motiv og i en treere-komposisjon) med ekte data, og fant ingen brudd i noen av dem.

### 1.2 Nabokjøringer med samme farge, også innenfor samme motiv

**Status: verifisert.** Bygget en sekvens der Design 01 sin kjøring 1 (svart) og kjøring 2
(overstyrt til svart) er ekte nabo-kjøringsindekser i SAMME motiv, med en pause mellom dem.
`finnSammenslaingsforslag()` foreslo nøyaktig 1 sammenslåing, med `mellomKjoringIder: []`
(tomt — ingenting flyttes forbi noe). Etter simulert sammenslåing:
`bevarerMotivRekkefølge()` → `true`.

### 1.3 Omtredningstelling

**Fil/funksjon:** `tellOmtredninger()` i
[sekvens.ts:103](../src/app/dashboard/embroidery/arranger/sekvens.ts#L103).

**Status: verifisert.** Design 02 (3") har 6 fargekjøringer der `#fe57bd` (rosa) forekommer
to ganger, IKKE som nabokjøringer (`#400062, #fe57bd, #5bd6d4, #ffffff, #fe57bd, #000000`).
Antall UNIKE farger: 5. `tellOmtredninger()` returnerte **6** — bekrefter at funksjonen teller
kjøringer etter sammenslåing av TILSTØTENDE like farger, ikke antall unike farger (de to rosa
er ikke tilstøtende, telles som to separate omtredninger, akkurat som spesifisert).

### 1.4 Fargevelger fra Brothers 64-palett

**Fil:** [FargePicker.tsx](../src/app/dashboard/embroidery/arranger/FargePicker.tsx). Rutenettet
er bygget direkte fra `BROTHER_PALETT`
([broderPalett.ts](../src/app/dashboard/embroidery/arranger/broderPalett.ts)); det finnes ikke
noe fritekst-/hex-inputfelt noe sted i komponenten. Eneste interaktive elementer er
palett-knappene selv, pluss «Nullstill til original» og «Lukk».

**Status: implementert** (lest, ikke klikket gjennom live — men koden er lukket og
deterministisk: det finnes strukturelt ingen kodevei til en fri hex-verdi).

### 1.5 Pause som egen rad → STOP ved eksport

**Fil/funksjon:** `bygg_monster()` i
[api/export-pes/index.py:109](../api/export-pes/index.py#L109) — en pause-rad blir
`pattern.stop()`.

**Status: verifisert.** Bygget en fil med `kjøring(svart) → pause → kjøring(svart)`, leste den
tilbake med en HELT EGEN, uavhengig lesefunksjon (ikke appens egen `_les_faktiske_kjoringer`)
som teller rå PES-kommandoer direkte: fant minst én STOP-kommando i den skrevne filen, og
bekreftet separat via appens egen `_les_faktiske_kjoringer()` at de to svarte kjøringene IKKE
smeltet sammen til én ved gjenlesing (pausen brøt kjeden korrekt, som forventet).

### 1.6 Fasesortering med forklaring når grå

**Fil/funksjon:** `sjekkFasesortering()` i
[sekvens.ts:242](../src/app/dashboard/embroidery/arranger/sekvens.ts#L242),
knappen i [SekvensPanel.tsx:227-239](../src/app/dashboard/embroidery/arranger/SekvensPanel.tsx#L227).

**Status: verifisert.** Kjørt direkte: to syntetiske motiver med identisk fargeliste →
`{kan: true}`. Koden viser `faseStatus.grunn` under knappen når `kan` er `false` (f.eks. «Trenger
minst to plasserte motiver», «Motivene har ulikt antall fargekjøringer (5 mot 6)», «Motivene har
ulik fargerekkefølge») — disse tekstene ble ikke trigget i denne runden (ingen mismatch-tilfelle
ble bygget), så selve TEKSTVISNINGEN er implementert/lest, ikke selv fremkalt.

### 1.7 Angre/gjør om, og «Tilbakestill sekvens»

**Fil:** [KomposisjonEditor.tsx:91-115](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L91).
`handleSekvensChange()` pusher forrige tilstand på en `undoStack` (maks 30) før hver endring;
`handleUndo`/`handleRedo` flytter mellom stack-ene. `handleTilbakestill()` kaller
`synkroniserSekvens([], {motiver, resolved})` — bygger sekvensen fra bunnen, i motivenes egen
rekkefølge. Tastatursnarveier ⌘Z/⌘⇧Z er koblet til de samme funksjonene via en ref (unngår
stale closures).

**Status: implementert** (lest — ren, ukomplisert React state-stack-logikk, ikke klikket
gjennom live i denne runden). Én ting å være obs på: `synkroniserSekvens` som kjøres automatisk
når nye motiver blir tolket (linje 160-162) går IKKE via `handleSekvensChange`, så den
automatiske tilføyingen av et nytt motivs kjøringer havner ikke på angre-stacken. Det er
sannsynligvis riktig (en automatisk synk skal ikke være en angre-bar handling), men er verdt å
vite om.

---

## 2. Lerret og geometri

### 2.1 Rammesjekk med posisjon (ikke bare størrelse)

**Fil/funksjon:** `plasserteBbokser`/`utenforRammeIder` i
[KomposisjonEditor.tsx:244-260](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L244),
bruker `plassertBbox()` fra [geometri.ts](../src/app/dashboard/embroidery/arranger/geometri.ts)
(roterer OG forskyver). Navngir de faktiske motivene i varselbanneret
([KomposisjonEditor.tsx:396-401](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L396)).

**Status: verifisert.** Kjørte `plassertBbox()` direkte med tallverdier:
- Et 20×10 mm motiv, urotert, plassert 45 mm til høyre: korrekt oppdaget som utenfor rammen
  (max_x = 55 mm > 50 mm-grensen).
- Samme motiv rotert 90°: bredde og høyde byttet plass i den plasserte bboksen (20mm→10mm
  bredde, 10mm→20mm høyde) — beviser at rotasjonen faktisk virker på bboksen, ikke bare blir
  parkert.
- Et LITE motiv (5×5 mm) plassert langt utenfor (80, 80 mm): korrekt oppdaget som utenfor
  rammen — en rent størrelsesbasert sjekk (som bare ser på bredde/høyde) ville ALDRI fanget
  dette, siden 5×5 mm aldri er «for stort». Dette beviser at sjekken faktisk er
  posisjonsbasert, ikke størrelsesbasert.

### 2.2 Rotasjonsglider synkronisert med tallfelt

**Fil:** [KomposisjonEditor.tsx:34-49](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L34)
(`ROTASJON_SNAPP_PUNKTER = [-180, -90, 0, 90, 180]`, -180 foldes til 180 — dekker 0/90/180/270).
Gliderens `onChange` og tallfeltets `onChange` skriver til NØYAKTIG samme state-felt
(`valgtMotiv.rotasjonGrader`) — de er ikke to separate kilder som kan komme ut av synk, de er
samme kilde med to inputs.

**Status: verifisert** (deterministisk av kodestrukturen — begge inputs skriver samme felt,
kan ikke divergere — bekreftet ved lesing, snap-matematikken selv (`snappRotasjon`) er triviell
og ble indirekte øvd gjennom rammesjekk-testene i 2.1).

### 2.3 Ingen skalering av sting

**Status: verifisert** via full-tekst-søk gjennom HELE den relevante flaten
(`src/app/dashboard/embroidery/arranger/*.ts(x)`, `api/parse-pes`, `api/export-pes`,
`api/render-pes`) etter `scale`/`skaler`/`skala`. Alle treff kontrollert manuelt:

- `SCALE` i `StingSimulator.tsx` og `SekvensPanel.tsx` (forhåndsvisningsmodalen) er
  mm→piksel-visningsfaktorer for on-screen-tegning — rører aldri de lagrede/eksporterte
  stingkoordinatene.
- `nedskalertBlokk()` i `miniatyr.ts` reduserer ANTALL PUNKTER for den forenklede
  miniatyren (rent kosmetisk, aldri brukt til eksport), ikke koordinatVERDIENE.
- `{'scale': 5}` i `api/render-pes/index.py` er pyembroiderys EGEN PNG-rendringsskala for et
  forhåndsvisningsbilde — en helt annen funksjon (dekke-/forsidebilder), ikke del av
  arrangerings-/eksportløypa, og rører ikke PES-data.
- `img.thumbnail(...)` i samme fil skalerer en JPEG-forhåndsvisning, ikke sting.
- Kommentaren i `api/parse-pes/index.py` («Never scale these values; that changes stitch
  density») bekrefter den bevisste design-regelen, den er ikke bevis på et unntak.

Ingen kodevei fant en STING-koordinat multiplisert med noe annet enn en fast
enhetskonvertering (×10/÷10 mellom mm og 1/10mm, som ikke er skalering — det er en
enhetsrepresentasjon, samme avstand).

---

## 3. Motivvelger

### 3.1 Leser velgeren samme gruppering som biblioteket? — **KRITISK FUNN**

Dette var det viktigste punktet i revisjonen, og svaret er **nei, ikke for alle bundles.**

**Testet mot 12Berries** (bruker sin egen opprydding: 12 embroidery-rader i biblioteket i dag,
bekreftet med et REST-kall mot `embroidery`-tabellen). Hver av de 12 designene har 5 størrelser
med filnavn som `Design10 smallest.PES`, `Design10 small.PES`, …, `Design10 largest.PES` —
STØRRELSESORDET er skrevet rett inn i filnavnet, ikke som et tall.

Kjørte grupperingsuttrykket fra
[KomposisjonEditor.tsx:1077-1112](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L1077)
(kopiert ordrett, siden logikken ikke er skilt ut i en egen testbar funksjon) mot disse 12
ekte radene:

```
Antall embroidery-rader i biblioteket: 12
Antall VirtuelMotiv velgeren faktisk viser: 60
```

**Årsak:** `utledTomme()` i
[tomme.ts:28](../src/app/dashboard/embroidery/arranger/tomme.ts#L28) gjenkjenner KUN numeriske
tomme-mønstre (`_5in`, `_3_5inch`). Den har ingen regel for ORD som «Smallest/Small/Medium/
Large/Largest». Når mønsteret ikke treffer, faller identiteten tilbake til filnavnet selv (uten
`.pes`) — og siden størrelsesordet er en del av filnavnet, blir HVER av de 5 størrelsene sin
EGEN identitet i stedet for å grupperes til ett motiv. Brukeren ser «Design10 smallest»,
«Design10 small», «Design10 medium», «Design10 large», «Design10 largest» som FEM separate
rader (samme forsidebilde på alle fem, siden de deler `m.data`), i stedet for én rad «Design 10»
med et størrelsesvalg.

**Viktig kontekst:** Den nyeste commiten («Fire endringer i motivvelger og størrelsesutleder»,
2026-08-11 14:32) beskriver akkurat denne typen fiks — «SIZE_WORDS stripper nå suffiks fra
motivnavn... Levenshtein-toleranse for skrivefeil» — men denne nye logikken (`SIZE_WORDS_ORDERED`,
`levenshtein()`) finnes KUN i
[embroidery/page.tsx](../src/app/dashboard/embroidery/page.tsx#L116) (hovedbiblioteket), IKKE i
`KomposisjonEditor.tsx` (velgeren). De to leser altså IKKE samme gruppering — biblioteket fikk
en ordbasert størrelsesutleder, velgeren gjør fortsatt det den alltid har gjort
(`utledTomme()`, kun tall). Det er nøyaktig frykten i spørsmålet: en fiks i biblioteket løste
ikke det samme problemet i velgeren, fordi de aldri delte koden.

**Konsekvens for andre bundles:** Samme mekanisme vil treffe ETHVERT bundle der filnavn bruker
ord eller andre ikke-numeriske mønstre for størrelse, ikke bare 12Berries. Jeg testet ikke
uttømmende hvor mange bundles dette gjelder, men strukturen (`utledTomme()` sin
tall-only-begrensning) er den samme for alle.

**Status: verifisert som kritisk feil.** Se punkt 2 i den prioriterte listen under.

### 3.2 Sidefunn: samme klasse feil i BX Floral Alphabet Pink (font-bundle)

Under research for tekst-planen (se del 2) fant jeg en RELATERT, men separat, bekreftet feil:
i bundlen «BX FLORAL ALPHABET PINK» er raden «A (stor)» og raden «a (liten)» BEGGE lagret med
`pesFilename: "A.PES"` (identisk streng — bekreftet med et REST-kall). Siden identiteten
utledes fra filnavnet (ikke fra `data.navn`, som er der «(stor)»/«(liten)» faktisk står),
kollapser disse to radene til ÉN VirtuelMotiv i velgeren — brukeren kan ikke velge liten «a»
uavhengig av stor «A» for dette alfabetet. Bekreftet med et REST-kall mot `embroidery`-tabellen;
ikke kjørt gjennom selve grupperingskoden for dette spesifikke tilfellet, men mekanismen er
identisk med 3.1 og allerede bevist der.

**Status: verifisert** (datagrunnlaget), **implementert-nivå resonnement** (selve
kollaps-konsekvensen, ikke separat kjørt).

### 3.3 Kategori-først navigasjon

**Fil:** `PickerView`-typen i
[KomposisjonEditor.tsx:869-875](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L869):
`kategorier → kategori → bundle-innhold/tegn/tekst → storrelse`. Strukturelt bekreftet at dette
er nøyaktig rekkefølgen: kategorimeny, så bundles og løse motiver innenfor en kategori, så
motiv, så størrelse.

**Status: implementert** (lest strukturelt, ikke klikket gjennom live i denne runden).

### 3.4 Flervalg overalt, også i grupperte bundles

**Fil/funksjon:** `MotivKort` ([KomposisjonEditor.tsx:1576](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L1576))
med `valgt`/`onToggle` brukt konsekvent i bundle-innhold-visningen (linje ~1801, 1810),
kategori-visningen (linje ~1938, 1949) og cross-search-resultater (linje ~2028, 2044) —
samme kort, samme avkryssingsmekanisme uansett kontekst.

**VIKTIG FUNN, ikke i sjekklisten men oppdaget ved lesing:** `MotivKort` sin ENESTE
klikk-handling er `onClick={onToggle}` — det finnes ingen annen måte å klikke et motivkort på.
Det betyr at det gamle enkelt-klikk-og-legg-til-direkte-sporet (`velgVM()`, som har «spør bare
når flere passer»-logikken) IKKE lenger er tilgjengelig for vanlige motiver. `velgVM()` finnes
fortsatt i koden, men er nå BARE kalt fra `TegnGruppe` (alfabetrutenettet for skrifttyper) —
se [KomposisjonEditor.tsx:1632](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L1632).
For alt annet enn skrifttegn går ALL tillegging nå via «velg → Legg til N valgt», som alltid
bruker `velgStandardStorrelse()` — se punkt 3.5.

**Status: verifisert** (lest og kryssjekket mot flere bruksteder — mønsteret er konsistent).

### 3.5 Størrelse velges automatisk når bare én passer, spørres bare når flere passer

**Dette er delvis ikke sant lenger for vanlige motiver, som en direkte konsekvens av 3.4.**

- For SKRIFTTEGN (`TegnGruppe` → `velgVM()`,
  [KomposisjonEditor.tsx:1255-1262](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L1255)):
  stemmer fortsatt — `passende.length === 1` velger automatisk, ellers åpnes størrelsesvisningen.
- For VANLIGE motiver (den store majoriteten): enkelt-klikk-flyten som spurte finnes ikke
  lenger i UI-en. `leggTilValgte()`
  ([KomposisjonEditor.tsx:1326](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L1326))
  kaller `velgStandardStorrelse()` for HVERT valgt motiv, som ALLTID velger største som passer
  automatisk — uansett om 1 eller 5 størrelser passer. Brukeren blir aldri spurt, selv når
  flere størrelser er like gyldige og hun kanskje ville hatt den minste, ikke den største.

**Status: verifisert som regresjon** for vanlige motiver; **verifisert som riktig** for
skrifttegn. Se punkt 5 i prioritert liste.

### 3.6 Feil vises i vinduet, ikke evig spinner

**Fil:** `lasterFeil`-state i
[KomposisjonEditor.tsx:960](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L960),
satt fra flere feilkilder (mål-lasting, bundle-lasting) og vist i UI-en med en
«Prøv igjen»-knapp som inkrementerer `lasterVersjon` for å trigge en ny lasting
([KomposisjonEditor.tsx:1884-1888](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L1884)).

**Status: implementert** (lest — dekker eksplisitt nettopp den historiske
`miniatyr_svg`-manglet-kolonne-feilen, siden `select()`-kallet som henter mål OGSÅ ber om
`miniatyr_svg`, og en manglende kolonne der ville feilet HELE spørringen). Avhenger av at
migration 008 faktisk er kjørt i basen — se del 4, bekreftet der.

### 3.7 Miniatyrbilder fra egne stingdata, i egen kolonne, aldri generert ved listevisning

**Fil/funksjon:** `byggMotivMiniatyrSvg()` kalt fra
[route.ts:129-131](../src/app/api/broderi-motiv/parse/route.ts#L129), i SAMME `upsert` som
`data`/målene ([route.ts:133-146](../src/app/api/broderi-motiv/parse/route.ts#L133)) — regnes
ut av motivets EGNE stingblokker på parse-tidspunktet, aldri av listevisningen.

Det finnes en egen backfill-rute
([generer-miniatyrer/route.ts](../src/app/api/broderi-motiv/generer-miniatyrer/route.ts)) for
rader som mangler miniatyr — men den kalles KUN fra en manuell knapp
([KomposisjonEditor.tsx:1505-1521](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L1505)),
ikke automatisk når lista vises.

**Status: verifisert** (kodesti er deterministisk: ingen `useEffect` trigger backfill-ruta
automatisk). **Datapunkt:** 696 av 2967 rader i `broderi_motiv` mangler fortsatt `miniatyr_svg`
i dag (bekreftet med et count-kall mot basen) — ikke en feil i seg selv, bare et tegn på at
backfillen ikke er kjørt til den er ferdig ennå.

### 3.8 Mål lest paginert fra egne kolonner, aldri full data-jsonb

**Fil:** [KomposisjonEditor.tsx:984-990](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx#L984) —
`select('embroidery_id, size_id, bredde_tiendedel_mm, hoyde_tiendedel_mm, miniatyr_svg')` via
`hentAllePaginert()` ([supabasePaginering.ts](../src/lib/supabasePaginering.ts)). `data`-kolonnen
er ALDRI i denne spørringen.

**Status: verifisert** (provbart av selve `select()`-kallet — ingen tolkning nødvendig).

---

## 4. PES-eksport

### 4.1 Bygges fra sekvenspanelets rekkefølge

**Fil/funksjon:** `byggEksportSegmenter()` i
[eksport.ts:23](../src/app/dashboard/embroidery/arranger/eksport.ts#L23) — itererer
`for (const el of sekvens)`, altså den LEVENDE sekvens-arrayen (etter enhver dra/sammenslå/
fasesorter-operasjon), ikke motivenes egen opprinnelige rekkefølge. `EksportPanel.tsx` sender
samme `sekvens`-prop videre uendret.

**Status: verifisert** (kodesti + indirekte via 4.3 sin round-trip-test, som brukte segmenter
bygget i nøyaktig dette formatet).

### 4.2 Fargesnapping til paletten, både ved skriving og i selvsjekken

**Fil/funksjon:** `_snap_til_palett()` i
[api/export-pes/index.py:11](../api/export-pes/index.py#L11), kalt fra BÅDE `bygg_monster()`
(linje 131) og `bygg_forventet_fargekjoringer()` (linje 99, selvsjekkens fasit).

**Status: verifisert.** Snappet `#123456` (garantert ikke i paletten) og bekreftet at
resultatet faktisk finnes i `EmbThreadPec.get_thread_set()`.

### 4.3 Klippekommandoer overlever sammenslåing av nabokjøringer

**Status: verifisert**, med en HELT EGEN lesefunksjon (ikke appens egen selvsjekk-kode) som
teller rå PES-kommandoer direkte:

- Bygget to nabokjøringer med SAMME farge (som resultatet av en «Slå sammen»), hver med flere
  stingblokker (2 og 3 blokker). Forventet 4 TRIM-kommandoer (1 internt i første kjøring, 3
  rundt/i den andre — se kommentarer i testfilen for nøyaktig utledning). Uavhengig telling av
  den faktiske skrevne filen: **4 TRIM, riktig stingsum, 0 fargeskift** (riktig — ingen ny
  tråd trengs mellom to identisk-fargede kjøringer). Appens egen selvsjekk kjørt på samme data:
  `ok=True`.
- Bygget en pause mellom to like-fargede kjøringer, leste tilbake: STOP-kommando funnet, OG de
  to kjøringene forble to separate kjøringer ved gjenlesing (ikke smeltet sammen) — bekrefter
  igjen pause-regelen fra punkt 1.5, denne gangen sammen med selve klippbeviset.

Ingen data gikk tapt, ingen klipp forsvant, ingen sting ble borte i noen av testene.

---

## 5. Migrasjoner

**Filer i repoet:** 001–008 i `supabase/migrations/`. De fem relevante for broderifunksjonen:
004 (`broderi_motiv`), 005 (GRANT for 004), 006 (`broderi_komposisjon`), 007 (mål-kolonner),
008 (miniatyr-kolonne).

**Sjekket direkte mot den levende basen** (funksjonelle spørringer via anon-key, ikke et
skjema-dump):

| Migrasjon | Hva den gjør | Status i basen |
|---|---|---|
| 004 | Oppretter `broderi_motiv` | **Kjørt** — tabellen svarer |
| 005 | GRANT på `broderi_motiv` | **Kjørt** — anon kan lese |
| 006 | Oppretter `broderi_komposisjon` | **Kjørt** — tabellen svarer, har ekte rader |
| 007 | `bredde_tiendedel_mm`/`hoyde_tiendedel_mm` | **Kjørt** — 0 rader mangler mål (2967 av 2967 har verdi) |
| 008 | `miniatyr_svg`-kolonne | **Kjørt** — kolonnen finnes og har ekte SVG-data (696 av 2967 rader har den ennå ikke fylt ut — ikke en migreringsfeil, se 3.7) |

Ingen manglende migrasjoner funnet denne gangen. `miniatyr_svg`-hendelsen brukeren nevner
(kolonnen manglet, ga evig spinner) er nå LØST både i data (kolonnen finnes) og i kode
(feilen ville vist seg i vinduet i dag, se 3.6) — men jeg fant den ikke ved å lete etter NYE
manglende migrasjoner, jeg bekreftet at DEN SPESIFIKKE er rettet.

---

## Karakter: 6/10

**Begrunnelse.** Kjernen — selve sekvenslogikken, invarianten, eksporten — er solid og
faktisk bevist riktig med ekte data og uavhengige tester, ikke bare lest og trodd. Det er
ikke pyntearbeid; det er den delen som ville ha ødelagt fysiske broderier hvis den var feil,
og den holder. Geometrien (rotasjon, rammesjekk) er også korrekt og bevist med tall.

Men motivvelgeren — verktøyet du bruker FØRST, hver gang, for å velge hva som skal sys — har
et bekreftet, reproduserbart avvik fra biblioteket for bundles med ordbaserte filnavn. Det er
ikke en kant-sak; 12Berries var det brukeren selv testet og forventet skulle stemme, og det
gjør det ikke (12 vist som 60). Det er nøyaktig den typen feil som gjør at man ikke kan stole
på tallene man ser, som var hele grunnen til denne revisjonen. Og «spør bare når flere passer»
—en egen, konkret bedt-om regel — er stille forsvunnet for alle vanlige motiver i den nyeste
UI-omleggingen, uten at noen (kode eller bruker) merket det, fordi verktøyet fortsatt
«fungerer» — det bare tar en avgjørelse for deg som du aldri ba om.

Det er ikke en 3- eller 4-er, fordi ingenting her risikerer å KORRUPPERE en fil eller sy noe
i feil rekkefølge — de bekreftede feilene er i PRESENTASJON og VALG, ikke i selve
broderi-dataene. Men det er heller ikke en 8- eller 9-er, fordi den viktigste enkeltsjekken i
hele revisjonen («leser velgeren samme gruppering som biblioteket?») svarte nei, og fordi det
skjedde stille — ingen feilmelding, ingen spinner, bare et tall som er fem ganger for stort
og fem rader som ser ut som duplikater. Det er den typen feil som er lett å ikke legge merke
til før man har brukt verktøyet lenge, presis som brukeren fryktet.

---

## Prioritert utbedringsliste

Rangert etter hva som kan ødelegge et broderi først, så det som gjør verktøyet upraktisk, så
kosmetikk. Anslagene er grove — basert på hvor lokalisert endringen er, ikke på testet tid.

### Kan ødelegge/forringe et broderi
Ingen funnet i denne revisjonen. Sekvens-invarianten, geometrien og eksporten er alle
bekreftet korrekte mot ekte data.

### Gjør verktøyet upraktisk (i prioritert rekkefølge)

1. **Motivvelgeren splitter ordbaserte bundles i mange falske «motiver» (12Berries: 12→60).**
   Rot: `utledTomme()` gjenkjenner bare tall, ikke ord som Smallest/Small/Medium/Large/Largest.
   Fiks: enten porter `SIZE_WORDS_ORDERED`/`levenshtein()`-logikken fra `embroidery/page.tsx`
   inn i en delt funksjon begge steder bruker, eller la `KomposisjonEditor.tsx` sin
   identitets-utledning falle tilbake til samme ord-strippings-regel før den faller tilbake
   til rått filnavn. **Omfang: middels** — logikken finnes allerede ett sted, jobben er å
   dele den, ikke skrive den fra scratch. Bør testes mot 12Berries igjen etterpå (forvent 12).

2. **«Spør bare når flere passer» er utilgjengelig for vanlige motiver.**
   `MotivKort` sin enkelt-klikk går alltid via `velgStandardStorrelse()` (auto-velger største
   som passer), aldri via `velgVM()` (som har spørre-logikken). Fiks: gi `MotivKort` et
   enkelt-klikk-modus (åpne størrelsesvisning når >1 passer, akkurat som `velgVM()` allerede
   gjør) SEPARAT fra avkryssing-for-flervalg — f.eks. klikk på selve bildet/navnet åpner
   størrelse, en egen avkryssingsboks styrer flervalg. **Omfang: liten til middels** — logikken
   (`velgVM`) finnes allerede og fungerer, det er en UI-omkobling, ikke ny logikk.

3. **BX Floral Alphabet: «A (stor)» og «a (liten)» kollapser til én rad.**
   Samme rotårsak-klasse som punkt 1 (identitet fra filnavn, ikke fra `data.navn`). Fiks: la
   identitets-utledningen prøve `trekktUtKarakter(m.data.navn)` FØR filnavn-fallbacken, siden
   «(stor)»/«(liten)»-mønsteret allerede finnes i `trekktUtKarakter()` og er ment for nettopp
   dette. **Omfang: liten** — samme funksjon, endret prioritet på hvilken kilde den prøver
   først.

4. **696 av 2967 rader mangler fortsatt miniatyr.** Ikke en kodefeil, bare ufullstendig
   backfill. **Omfang: null kode** — klikk «Generer miniatyrer» i velgeren til den blir 0,
   eller kjør den flere ganger om den har en per-kjøring-grense.

### Kosmetikk / mindre presist
5. `handleTilbakestill()`/den automatiske `synkroniserSekvens`-tilføyingen går utenom
   angre-stacken (sannsynligvis riktig, men verdt et bevisst blikk — se 1.7).
6. `sjekkFasesortering()` sine forklaringstekster ble ikke selv fremkalt i denne runden (bare
   lest) — lavt-risiko å verifisere senere med et par ekte mismatch-motiver.

---

# Del 2: Implementeringsplan — tekst i komposisjoner med digitaliserte fonter

**Dette er en plan. Ingenting er bygget.** Grunnlaget under er MÅLT mot ekte data
(SC Seraphine_Satin, `embroidery_bundles.id = 39c01a14-e307-44f6-9224-139a5142f4f0`), ikke
antatt.

## Grunnlinje — målt, ikke antatt

Lastet ned og parset ni ekte 2"-tegn fra Seraphine direkte (samme `parse_pes()`-funksjon som
appen bruker, kjørt lokalt): tre versaler (H, A, O), tre x-høyde-bokstaver (o, c, e), tre
underlengder (g, p, y). Alle verdier i 1/10 mm, `+y` nedover, RÅ (ikke omsentrert) fil-egne
koordinater:

| Tegn | min_x | max_x | min_y | max_y | bredde | høyde |
|---|---|---|---|---|---|---|
| H | 0 | 722 | 0 | 516 | 722 | 516 |
| A | 0 | 658 | 0 | 516 | 658 | 516 |
| O | 0 | 452 | 0 | 516 | 452 | 516 |
| o | 0 | 166 | 0 | 167 | 166 | 167 |
| c | 0 | 180 | 0 | 164 | 180 | 164 |
| e | 0 | 181 | 0 | 158 | 181 | 158 |
| g | 0 | 221 | 0 | 273 | 221 | 273 |
| p | 0 | 299 | 0 | 423 | 299 | 423 |
| y | 0 | 275 | 0 | 309 | 275 | 309 |

**Funn: `min_x = min_y = 0` for ALLE ni tegn, uten unntak.** Det er IKKE en delt grunnlinje
(da ville versalenes og x-høyde-bokstavenes BUNN vært like — de er 516 mot ~160, en spredning
på 35.8 mm). Det er heller IKKE «alt ligger på null fordi hver fil er sentrert på egen bbox»
i betydningen «sentrert» — det er mer presist: **hver fil har sin egen øvre venstre hjørne
registrert som (0,0), uavhengig av de andre.** Det finnes ingen delt referanse i selve
stingkoordinatene overhodet.

**Konsekvens: forskyvningen MÅ utledes og lagres per tegn per font, én gang — akkurat som
brukeren selv formulerte som betingelse.** Uten det vil et rått «lim tegn ved siden av
hverandre med `posisjonY=0`» gi tekst der alle tegn er TOPP-justert (bokstavene henger fra
samme linje oppe, i stedet for å stå på samme linje nede) — `H` og `o` ville fått samme
TOPP-kant, ikke samme bunn-kant, og det ser umiddelbart feil ut.

**Anbefalt modell (å teste visuelt før den låses, ikke en garantert formel):**
- For tegn UTEN underlengde (H, A, O, o, c, e, …): anta at grunnlinjen er ved deres EGEN
  `max_y` (bunnen av deres egen bbox er der de «står»). Målt median for x-høyde-gruppen
  (o=167, c=164, e=158) er ~163 — brukes som grunnlinje-referanse for SMÅ bokstaver, mens
  516 er referansen for VERSALER. **Dette er to forskjellige grunnlinje-VERDIER i fil-egne
  koordinater** (versaler og x-høyde-bokstaver har ikke samme `max_y`, siden de er egne filer
  uten delt referanse) — offset for hvert tegn beregnes altså relativt til SIN EGEN gruppe
  (versal-grunnlinje vs. liten-bokstav-grunnlinje), ikke ett globalt tall.
- For tegn MED underlengde (g, p, y): deres `max_y` stikker under den lille-bokstav-grunnlinjen
  med `max_y − 163` (g: 11.0 mm, p: 26.0 mm, y: 14.6 mm ved denne 2"-størrelsen — merk at «p»
  sitt tall er stort, sannsynligvis en dekorativ svale/underlengde-krøll typisk for et
  script-/satin-font som Seraphine, ikke en feilmåling; bør sjekkes visuelt før det tas for
  gitt).
- Selve offset-en som skal LAGRES per tegn: `grunnlinjeOffsetY = maxYForDenneGruppen − tegn.bbox.min_y`
  (her: 516 for versaler, ~163 for små bokstaver, MEN denne må helst utledes fra samme fonts
  faktiske IKKE-underlengde-median per størrelse den blir bygget for, ikke hardkodes — filene
  finnes i 8 størrelser (1.5″–5″) og skalerer ikke lineært med enkel multiplikasjon nødvendigvis,
  siden det er ekte digitaliserte filer per størrelse, ikke ett skalert utgangspunkt).
- Lagres i en NY, egen liten katalog — f.eks. `fontUtils.ts` sin `buildFontData()` (som allerede
  finnes) bør regne ut og cache dette PER (bundleId, tegn, tomme), ikke per plassering. Siden
  `buildFontData()` allerede eksisterer og allerede tar `tomme` som parameter, er dette
  sannsynligvis en UTVIDELSE av en eksisterende funksjon, ikke en ny arkitektur.

## `move_center_to_origin()` — engangs-kall på hele komposisjonen

Bekreftet i eksisterende kode: `api/export-pes/index.py:157` kaller `move_center_to_origin()`
KUN ÉN GANG, etter at HELE mønsteret (alle segmenter i sekvens-rekkefølge) er bygget og
`pattern.end()` er kalt. Dette er allerede riktig for komposisjons-eksport generelt, og gjelder
derfor automatisk for tekst også — SÅ LENGE hver bokstav legges til som et vanlig plassert
motiv i den samme `motiver`-listen (se under), ikke som en egen eksportvei. Planen krever
altså ikke en kodeendring her, bare at bokstaver går gjennom den SAMME rørledningen som alt
annet — en risiko å unngå er å bygge en SEPARAT tekst-spesifikk eksportfunksjon som kaller
`move_center_to_origin()` per bokstav (feil) i stedet for å gjenbruke `byggEksportSegmenter()`.

## Oppslag fra tegn til fil — to ekte, ulike konvensjoner funnet

Undersøkte BEGGE font-bundlene som faktisk finnes i basen (`kategori`/`kategorier`
inneholder «font»):

**SC Seraphine_Satin** (id `39c01a14-…`): 5 `embroidery`-rader, ÉN PER STØRRELSE (2″, 3″, 4″,
1.5″, 2.5″ — «3-5 INCH»-raden inneholder faktisk 3.5″-filer, ikke et område). Innenfor hver
rad enumereres ALLE TEGN som separate `sizes[]`-oppføringer, med filnavn som
`SCSeraphine_Satin_2inch_Upper_H.PES` / `..._lower_a.PES` / `..._Number_3.PES` /
`..._Punct_Comma.PES`. Dette mønsteret er ALLEREDE korrekt håndtert av eksisterende kode:
`utledTomme()` gjenkjenner `_2inch`-delen (tall-mønster), og `trekktUtKarakter()` gjenkjenner
`_Upper_X`/`_lower_x`/`_Number_N`/`_Punct_Navn`-suffikset. Bekreftet ved kjøring: identiteten
for «a» ved 2″ og «a» ved 3″ blir DEN SAMME strengen (tomme-delen strippes), så de grupperes
korrekt til ett virtuelt motiv med flere størrelser.

**BX FLORAL ALPHABET PINK** (id `243697df-…`): 62 `embroidery`-rader, ÉN PER TEGN. Radens EGEN
`data.navn` er «A (stor)» / «a (liten)» — ALLEREDE korrekt og ubenyttet informasjon. Men
`pesFilename` er «A.PES» for BEGGE (bekreftet direkte: samme streng, stor bokstav, for både
stor- og liten-raden). 24 av 26 små bokstaver i dette alfabetet har denne kollisjonen; kun «r»
og «h» har filnavn som beholder små bokstaver (`r.PES`, `h.PES`) — ren tilfeldighet fra
digitaliseringsverktøyet, ikke et konsekvent mønster å stole på.

**Konklusjon, bekreftet med data — ikke en antakelse:** filnavn kan IKKE brukes alene til å
skille store og små bokstaver. Rapportert oppslags-strategi:

1. Prøv `trekktUtKarakter(m.data.navn)` FØRST for bundles med én rad per tegn (BX Floral-
   mønsteret) — funksjonen har allerede et `/^(.) \(stor\)$/`/`/^(.) \(liten\)$/`-mønster
   som matcher `data.navn` nøyaktig, det er bare aldri kalt med `navn` som input i dag (kun
   med filnavn-utledet identitet).
2. Fall tilbake til dagens filnavn-baserte utledning (`utledTomme` + `trekktUtKarakter` på
   identiteten) for bundles med én rad per størrelse (Seraphine-mønsteret) — dette fungerer
   allerede riktig og skal ikke røres.
3. Bygg tegn→fil-oppslaget PER FONT-BUNDLE ved lasting (en `Map<tegn, VirtuelStorrelse[]>`),
   ikke globalt — de to konvensjonene lever side ved side i samme bibliotek.

## Størrelse: glider mellom fontens faktiske størrelser, ingen skalering

Seraphine finnes i 8 faktiske størrelser (1.5″, 2″, 2.5″, 3″, 3.5″, 4″, 4.5″, 5″ — bekreftet
fra de 5 radenes navn/filinnhold). Planen: en glider/knapperad med disse 8 VERDIENE (utledet
fra `tommeLabel` på tegnets faktiske `VirtuelStorrelse[]`, samme mønster `TextVerktoy`
allerede bruker for `tilgjengeligeTommes` per commit `251e954`), IKKE en fritt-flytende
mm-verdi som ville krevd skalering av sting (forbudt, se del 1.2.3). Mangler en av de 8
størrelsene for et spesifikt tegn (usannsynlig men mulig hvis biblioteket er ufullstendig),
må UI-en si det tydelig i stedet for å falle tilbake til en skalert versjon.

## Sporing: bboxbredde + justerbar avstand, ingen kerning

PES har ingen kerning-metadata — bekreftet ved å lese `parse_pes()` sin retur-struktur
(`bbox`, `stingblokker`, `fargekjoringer`, ingenting annet). Sporing må derfor bygges fra
`bbox`-BREDDEN til hvert tegn (`max_x − min_x`, allerede tilgjengelig per `VirtuelStorrelse`
via `bboxCache`) pluss en brukerjusterbar fast avstand mellom tegn — nøyaktig slik
`fontUtils.ts` sin `layoutTekst()`-funksjon allerede er bygget (`tracking`,
`mellomromFaktor` — bekreftet i eksisterende kode fra `KomposisjonEditor.tsx` sin
`TextVerktoy`-komponent). Denne delen av planen krever IKKE ny arkitektur — den eksisterer
allerede og bør gjenbrukes, ikke bygges om.

## Bokstaver som vanlige plasserte motiver

Hver bokstav legges til `motiver`-listen som en ordinær `PlassertMotiv`
(`embroideryId`/`sizeId`/`posisjonX`/`posisjonY`/`rotasjonGrader`) — akkurat som et hvilket
som helst annet motiv. Dette er allerede antydet av `TextVerktoy`
([KomposisjonEditor.tsx](../src/app/dashboard/embroidery/arranger/KomposisjonEditor.tsx),
bygget i commit `251e954`) sin `onLeggTil`-callback, som kaller samme `leggTilMotiverBolk()`
som flervalg-i-velgeren bruker. **Konsekvens, allerede riktig:** X/Y-feltene i den vanlige
motiv-inspektøren fungerer automatisk for enkelt-bokstav-justering, uten noe ekstra UI —
brukeren velger bokstaven i lista under lerretet, samme boks som for alle andre motiver, og
flytter den. Grunnlinje-offset-en fra forrige punkt legges til `posisjonY` ved PLASSERING
(når teksten skrives inn og legges til), ikke lagret som et eget felt på `PlassertMotiv` —
den er bakt inn i den valgte Y-koordinaten fra start, akkurat som `kaskade`-forskyvningen
allerede gjør for vanlig flervalg-tillegging.

## Hver bokstav = egen fargekjøring — sammenslåing

Siden bokstaver normalt IKKE overlapper (ren tekst på en linje), vil den rasteriserte
overlapptesten fra del 1 nesten aldri finne kollisjon mellom to bokstavers fargekjøringer —
sammenslåingsforslag mellom identisk-fargede bokstaver (f.eks. «e» og «e» i «Ellinor», begge
samme trådfarge) vil derfor typisk vises som TRYGGE forslag, siden det ikke er noe geometrisk
overlapp å advare om. Samme-motiv-invarianten (del 1.1) gjelder fortsatt korrekt: to
forekomster av SAMME bokstav-instans (hvis brukeren skulle limt inn identisk tekst to steder)
er fortsatt to separate `PlassertMotiv`, altså to separate «motiver» for invariantens formål —
ingen spesialtilfelle å bygge. Eneste risiko: hvis bokstavene faktisk overlapper visuelt (tett
sporing, kursiv skrift med svalehaler som griper inn i neste bokstav — plausibelt for
Seraphine, som er en kursiv/script-stil), vil rastertesten korrekt fange DET, som den skal.

## Kategorien «font» på bundle

Bekreftet eksisterende og i bruk: `getKats(bundle.data).some(k => k.toLowerCase() === 'font')`
styrer allerede om en bundle åpner `TextVerktoy` i stedet for vanlig motivvalg (implementert i
commit `251e954`, bekreftet ved lesing av `handleClick`-logikken i `BundleKort`/`BundleRad`).
Begge de undersøkte font-bundlene (Seraphine, BX Floral) har `kategorier: [..., "font"]` satt
— planen krever ingen endring her, mekanismen finnes og virker allerede for minst disse to.

## Oppsummert rekkefølge for implementering (ikke bygget, bare foreslått)

1. Utvid `buildFontData()` i `fontUtils.ts` til å regne ut og cache grunnlinje-offset per
   (bundleId, tegn, tomme) — start med IKKE-underlengde-median per størrelse som antatt
   grunnlinje, juster visuelt.
2. Legg til `trekktUtKarakter(m.data.navn)`-forsøket FØR filnavn-fallbacken i identitets-
   utledningen, for å dekke BX Floral-mønsteret (og løser samtidig funn 3.2 i revisjonen).
3. Bygg tegn→fil-oppslaget per font-bundle som en egen `Map`, ikke globalt.
4. Bruk eksisterende `layoutTekst()`/`TextVerktoy`/`leggTilMotiverBolk()` uendret — de er
   allerede riktig bygget for sporing og plassering-som-vanlig-motiv.
5. Test visuelt med Seraphine (kursiv, har svalehaler — den vanskeligste av de to) FØR BX
   Floral (rettere bokstavformer) — hvis grunnlinjen ser riktig ut for Seraphine, er BX Floral
   sannsynligvis enklere.
