# Uavhengig vurdering av broderifunksjonen — 2026-08-11

Andrehåndsgjennomgang av `docs/broderirevisjon20260811.md` og koden den viser til.
Metode: rapportens påstander er stikkprøvd, og der jeg mistenkte noe rapporten ikke lette
etter, er den ekte koden **kjørt** — `api/export-pes/index.py` importert direkte med
pyembroidery installert, og `sekvens.ts`/`geometri.ts` kjørt med `tsx`. Alt som står under
«bekreftet ved kjøring» er faktisk kjørt, ikke lest.

---

## Karakter: 4/10

Rapportens 6 hviler på én setning: **«Ingenting her risikerer å ødelegge et broderi.»**
Den setningen holder ikke. Jeg fant to bekreftede stier der fila du syr ikke er den fila
skjermen viste — begge stille, begge på hovedveien gjennom verktøyet, ingen av dem funnet
av rapporten.

Kjernen rapporten faktisk testet, er like solid som den sier: sekvens-invarianten,
rotasjonen, rammegeometrien, klipp/stopp gjennom en sammenslåing, at ingen sting skaleres,
og at `broderPalett.ts` er bit-for-bit identisk med pyembroiderys egen 64-fargers PEC-palett
(alle 64 kryssjekket, 0 avvik — snapping av en palettfarge er idempotent, så en farge du
selv velger overlever eksporten urørt). Det er ikke pyntearbeid, og det er verdt en god
karakter i seg selv.

Men revisjonen stilte gjennomgående spørsmålet «er denne mekanismen riktig implementert?»
og nesten aldri «stemmer det brukeren ser med det maskinen gjør?». Der de to spørsmålene
gir ulikt svar, er det det andre som ødelegger et broderi. Fargeløypa ble sjekket for om
det finnes et fritekst-hexfelt (punkt 1.4) — ikke for om fargen på skjermen er fargen som
sys. Eksportpanelet ble aldri lest. Overlapptesten ble kalt «presis» uten at det ble
undersøkt hva den rasteriserer.

Ikke 2 eller 3: PES-containeren blir aldri korrupt, selvsjekken finnes og fanger ekte
regresjoner, og hver enkelt feil under er en liten, lokal fiks — ingenting krever
omskriving. Men ikke 6 heller, for tre av funnene under må du oppdage ved å sy, ikke ved å
se.

---

## Der jeg er uenig med rapporten

### 1. «Kan ødelegge/forringe et broderi: Ingen funnet» — feil, det er to

Rapportens egen viktigste konklusjon er den ene jeg må avvise. Se punkt A1 og A2 i lista
under; begge er bekreftet ved kjøring av den ekte koden.

### 2. Punkt 1.4 (fargevelger) er stilt feil spørsmål

Rapporten konkluderer «det finnes strukturelt ingen kodevei til en fri hex-verdi» og gir
seg der. Det er riktig, og det er ikke det som er risikoen. Risikoen er at hele frontend —
sekvenspanelet, stingsimulatoren, lerretet, den lagrede miniatyren — regner og tegner med
**rå** hex fra PES-parsingen, mens `api/export-pes/index.py:131` snapper hver farge til
paletten *før* mønsteret bygges. De to er aldri sammenlignet noe sted.

### 3. Punkt 4 (PES-eksport) reviderte Python-koden, ikke eksporten

Alle fire underpunktene handler om `index.py`. `EksportPanel.tsx` — de 184 linjene som
avgjør hvilke bytes som havner i nedlastingsmappa di — er ikke nevnt med et ord. Det er
der A1 ligger.

### 4. Punkt 3.1/3.2 er underdrevet

Rapporten beskriver kollisjonen som «brukeren kan ikke velge liten «a» uavhengig av stor
«A»». Det er den mildeste av konsekvensene. Den sammenslåtte raden får `sizes` fra **to
forskjellige design** (`KomposisjonEditor.tsx:1104-1109`), og `velgStandardStorrelse` velger
deretter på målt areal på tvers av begge — så velgeren kan gi deg fila for et annet tegn
enn det du trykket på. Navn, forsidebilde og kategorier tas fra `items[0]`, altså fra en
vilkårlig av de to (`:1092`, `:1100-1101`).

### 5. Punkt 2.1 er riktig, men rammesjekken finnes i tre uenige utgaver

98 mm i velgeren (`:864`), 100 mm på lerretet (`:23-24`), hardkodet 100 i tekstverktøyet
(`:697`). Rapporten testet bare lerretets.

---

## Prioritert utbedringsliste

### A. Kan ødelegge et broderi

**A1. Nedlastingsknappen kan gi deg forrige fil.**
`EksportPanel.tsx:56-83`. `bygg()` nullstiller `avvik` og `errorDetails`, men **aldri**
`pesBase64`/`selvsjekk`, og ingen `useEffect` invaliderer `status` når `sekvens`, `motiver`
eller `resolved` endres. Samtidig skjules «Bygg fil» så snart status er `'ferdig'`
(`:105`), og panelet blir stående med den store, tydelige «Last ned …»-knappen (`:168-173`).

Konkret: bygg fila → oppdag at du vil bytte en farge eller flytte en kjøring → gjør det →
trykk «Last ned». Du får **bytene fra før endringen**, med samme filnavn. Verre: linja rett
over knappen (`:150`) er en `useMemo` på `sekvens` og oppdaterer seg live, så panelet viser
det *nye* omtredningstallet over den *gamle* fila. Eneste vei ut er en grå 10-pikslers
tekstlenke, «Bygg på nytt» (`:174-179`).

Fiks: `useEffect` som setter `status`/`pesBase64`/`selvsjekk` til null når `segmenter`
endres. Alternativt: hash `segmenter` ved bygging, og deaktiver nedlastingen når hashen
ikke stemmer. **Omfang: liten** — 5–10 linjer.

**A2. To farger du ser som ulike kan bli én tråd i fila, uten at maskinen stopper.**
`_snap_til_palett()` (`index.py:11-27`) snapper hver farge til nærmeste av 64 før bygging,
og `bygg_monster():133-138` gir bare `color_change()` når den **snappede** fargen er ny.
`tellOmtredninger()` (`sekvens.ts:103-114`) sammenligner rå hex. Bekreftet ved kjøring av
den ekte eksportkoden:

```
Segmenter inn      : kjøring #900000 (mørkerød), kjøring #d800cc (magenta)
Sekvenspanelet viser: 2 omtredninger, to tydelig ulike fargeprikker
Fila inneholder    : 0 fargeskift, 1 klipp, 1 tråd — ['#c70156']
Selvsjekk          : ok=True
```

Maskinen stopper aldri. Magenta-formen sys i mørkerød tråd. Selvsjekken *kan ikke* fange
det, fordi `bygg_forventet_fargekjoringer():99` snapper på sin side av sammenligningen
også — fasit og fil er enige, det er frontend som står utenfor.

Avstanden mellom to farger som kollapser kan være stor. Verste par jeg fant i et
rutenettsøk over hele RGB-kuben: 216 RGB-enheter. Realistisk trigger er skyggelegging —
to nabotoner av samme grønn i et blomsterdesign faller lett i samme palettcelle.

Merk hva som **ikke** er utsatt: farger du selv velger i `FargePicker` er palettfarger og
snapper til seg selv (kryssjekket, alle 64 idempotente). Risikoen gjelder ikke-overstyrte
kjøringer i filer som har sin egen trådtabell — PES v5+ fra PE-Design og de fleste
tredjeparts-digitizere. For PES v1–v4 leser pyembroidery fargene fra selve 64-charten, og
snappingen er en no-op. Jeg har ikke kunnet lese versjonsbytet i dine faktiske filer
herfra, så hvor mange av bundlene dine dette treffer, er ubekreftet.

Fiks, i økende omfang: (1) vis `selvsjekk.antall_fargekjoringer` — feltet er
*deklarert* på `EksportPanel.tsx:17` og brukes ingen steder i hele `src/` — og advar når
det ikke stemmer med `omtredninger`. (2) Snapp i frontend også, paletten ligger allerede i
`broderPalett.ts` og er verifisert identisk. Da blir prikken du ser fargen du får, og
omtredningstallet blir sant. **Omfang: liten** for (1), **liten til middels** for (2).

### B. Feil du ikke kan se

**B1. Lerretet viser aldri fargene du har valgt.**
`KomposisjonEditor.tsx:631` tegner `stroke={b.farge_hex}` — rå blokkfarge. `PlassertMotivGruppe`
(`:577-584`) får aldri sekvensen inn, bare `data.stingblokker`, så `fargeOverrideHex` finnes
ikke i den kodeveien. Samme i den lagrede miniatyren (`miniatyr.ts:48`). Overstyrer du en
farge, endrer prikken i sekvenslista og stingsimulatoren seg — hovedvisningen og
komposisjonsminiatyren gjør det ikke. Du kan altså ikke lese fargeplanen din av det bildet
du faktisk ser på mens du arbeider. **Omfang: liten til middels** — send sekvensen inn og
slå opp override per (motiv, kjøringsindeks).

**B2. Lagrekkefølge-advarselen har blind flekk i alt som er satengsydd.**
`rasterCeller()` (`geometri.ts:107-113`) rasteriserer **stingpunktene**, ikke strekene
mellom dem, med 1 mm celler (`sekvens.ts:63`). En satengkolonne har nålestikk bare langs de
to kantene — hele innsiden er tomme celler. Alt som er bredere enn ~2 mm har derfor et hull
i midten der testen er blind. Bekreftet ved kjøring av den ekte `finnSammenslaingsforslag`:

```
Satengkolonne (hvit, 8 mm bred, 62 stikk): celler bare i kolonne -4 og +4
Rød detalj (3 mm) FYSISK INNI kolonnen    : celler 20..22 — ingen overlapp
cellerKolliderer()                         : false
Forslaget som ble vist                     : endrerLagrekkefolge: false  ← «trygt»
```

Sammenslåingen flytter den hvite satengen foran den røde detaljen, altså snur
lagrekkefølgen der de dekker hverandre, og verktøyet melder det som trygt. Detaljen blir
sydd over i stedet for under, eller motsatt.

Fiks: rasteriser linjesegmentene, ikke bare endepunktene — interpoler punkter langs hvert
sting med steg ≤ cellestørrelsen før `rasterCeller`. **Omfang: liten** — en løkke i
`plassertFargekjoringPunkter`, resten av kjeden er uendret. Tetting av denne gjør også
overlapptesten riktig for tekstplanen i del 2, der kursive svalehaler skal gripe inn i
neste bokstav.

**B3. `velgStandardStorrelse` velger den største for store, ikke den minste.**
`KomposisjonEditor.tsx:1322-1332`. Kommentaren over sier «Passer ingen, brukes den minst
for store (minst ille)», men `reduce`-en bruker `>` på areal i **begge** grener — når ingen
størrelse passer, velges den aller største. Ingenting blokkerer tilleggingen; du får bare
et «⚠ Utenfor»-merke etterpå. Og siden `velgVM()` (som har «spør når flere passer»-logikken)
bare kalles fra alfabetrutenettet (`:1688`), er dette den **eneste** veien for alle vanlige
motiver. Rapportens punkt 5 beskriver symptomet, men ikke at valget som tas i stedet er
det verst mulige. **Omfang: én linje.**

**B4. Identitetskollisjon blander to design til ett kort.**
`:1081-1087` faller tilbake til filnavnbasen når `utledTomme()` returnerer null, og
`:1097` gjør `${bundleId}:${identitet}` til nøkkel. To rader i samme bundle med samme
filnavn (`A.PES` under både `CAPITAL/` og `SMALL/` — nøyaktig tilfellet
`embroidery/page.tsx:246` er skrevet for) blir ett kort med størrelser fra begge. Sammen
med B3 kan velgeren da levere fila for et annet tegn.

Motsatt feil finnes også: `tomme.ts:42` krever understrek foran tallet, så `A_2in.PES`
grupperes og `A3in.PES` gjør det ikke — begge stilene er dokumentert i samme pakke i
`page.tsx:264`. Da splittes én rads størrelser over flere kort, og de umålte kortene mangler
`karakter`, som igjen drar `alfabetBundles`-terskelen på 0.5 (`:1146`) nedover og kan gjøre
at en alfabetpakke ikke lenger gjenkjennes som alfabet.

Dette er rapportens punkt 1 og 3 i én rot. Riktig fiks er ikke å porte `SIZE_WORDS_ORDERED`
til velgeren — det er å lagre `pesFile.path` ved opplasting (`page.tsx:970` lagrer i dag
bare `.name`) og gruppere på mappe, slik biblioteket allerede gjør. Da slutter velgeren å
gjette. **Omfang: middels**, men den lukker tre funn samtidig og fjerner en hel feilklasse
i stedet for å flytte den.

### C. Gjør verktøyet upålitelig

**C1. Ingenting hindrer eksport av en komposisjon som ligger utenfor rammen.**
`utenforRammeIder` regnes ut (`:254`) og brukes bare til varsler; den sendes ikke til
`EksportPanel` (`:559`). `klar` er bare `segmenter !== null && sekvens.length > 0`
(`EksportPanel.tsx:54`). Selvsjekkens bbox-sjekk (`index.py:226-232`) kjører **etter**
`move_center_to_origin()` og måler derfor bare STØRRELSE, aldri POSISJON. Bekreftet ved
kjøring: ett motiv plassert på x 70–90 mm, langt utenfor ±50 mm, ga `ok=True`.

**C2. Plasseringen i rammen overlever ikke eksporten.**
`index.py:157` sentrerer hele mønsteret. Bekreftet ved kjøring: en komposisjon lerretet
viste med senter 10 mm til venstre for og 11,5 mm over rammemidten, kom ut av eksporten med
senter nøyaktig i rammemidten. Innbyrdes
avstand mellom motivene er bevart, absolutt plassering er ikke. For et enkelt motiv er det
ønsket oppførsel; men lerretets ramme antyder en presisjon som fila ikke har, og
rammevarselet er derfor et falskt positiv oftere enn det er en reell sperre. Verdt en
setning i grensesnittet, ikke en kodeendring.

**C3. «Fasesorter» og «Tilbakestill sekvens» sletter alle pauser uten et ord.**
`sekvens.ts:271-292` bygger en helt ny liste med bare `kjoring`-elementer.
`SekvensPanel.tsx:229-230` sin tooltip nevner ikke pauser, og det finnes ingen
bekreftelsesdialog noe sted i `arranger/`. For en applikasjonspause — der maskinen skal
stoppe så du får lagt på stoffet — er det en pause som forsvinner uten spor.
Angre-stacken redder deg, men det står ingen steder. (Knappen er for øvrig korrekt
deaktivert når fasesortering ikke er mulig, `:228` — rapporten hadde rett der.)

**C4. Krasj når en rad står uten størrelser.**
`:1328` returnerer `vm.sizes[0]` = `undefined` når `sizes` er tom, og `:1363` gjør deretter
`s.embroideryId` → `TypeError`. Nåbart fordi `removeSize` i biblioteket mangler sperren
`splitSize` har. **Omfang: én linje** hver vei.

### D. Kosmetikk

- `MotivKort:1644` foretrekker `miniatyr_svg` over det ekte forsidebildet, mens
  kategoriflisene (`:1237-1256`) gjør det motsatte — de to stedene er uenige om samme
  prioritet.
- Tre ulike rammegrenser (98 / 100 / hardkodet 100). Samle dem i én konstant.
- Avvikstekstene fra selvsjekken vises rått («forventet 3 klipp-deler, fikk 4») — riktige,
  men ikke til å forstå uten koden foran seg.
- `handleTilbakestill`/automatisk `synkroniserSekvens` utenfor angre-stacken, som rapporten
  påpeker. Enig i at det sannsynligvis er riktig.

---

## Om implementeringsplanen for tekst (del 2)

Grunnlaget er målt og ser riktig ut, og jeg har ikke funnet noe å utsette på
grunnlinjemodellen. To merknader:

1. Steg 2 i planen («prøv `trekktUtKarakter(m.data.navn)` før filnavn-fallbacken») behandler
   symptomet. `pesFile.path` ved opplasting løser samme sak i roten og fjerner behovet for å
   gjette fra navn i det hele tatt — se B4.
2. Planen sier bokstaver «normalt ikke overlapper», så overlapptesten sjelden vil slå ut, og
   at den «korrekt fanger DET» hvis de gjør det. Med B2 utestet gjør den ikke det: Seraphine
   er kursiv satengskrift, og satengens innside er nettopp den blinde flekken. Fiks B2 før
   tekst bygges, ikke etter.

---

## Hva jeg ikke har verifisert

- PES-versjonen i dine faktiske filer, som avgjør hvor mye av A2 som treffer i praksis.
  Jeg kom ikke til Supabase/Storage herfra.
- Ingenting er klikket gjennom i en kjørende app. Alle funn er lest i koden eller kjørt som
  isolerte moduler.
- Migrasjonene og tallene mot basen (696/2967 osv.) har jeg ikke sjekket på nytt — jeg har
  ingen grunn til å tvile på rapporten der.
- Selvsjekken sammenligner antall, farger, klipp-deler og stingsum, men **aldri
  koordinater**. En feil i rotasjon eller plassering ville passert selvsjekken uoppdaget.
  Geometrien er verifisert separat og er riktig i dag, så dette er en grense ved
  sikkerhetsnettet, ikke en feil — men det er verdt å vite at selvsjekken ikke vokter den
  delen.

---

## Rekkefølge jeg ville tatt dem i

1. **A1** (5–10 linjer, fjerner den farligste feilen i verktøyet)
2. **A2 (1)** — vis og sammenlign `antall_fargekjoringer`, så blir resten synlig av seg selv
3. **B3** (én linje)
4. **B2** (interpoler stingene — må ligge før tekstfunksjonen)
5. **B1** (send sekvensen til lerretet)
6. **A2 (2)** — snapping i frontend
7. **B4** (lagre `path` ved opplasting, grupper på mappe — lukker rapportens punkt 1 og 3)
8. C1, C3, C4, deretter D
