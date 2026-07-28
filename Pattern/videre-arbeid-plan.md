# Videre arbeid med mønstergeneratoren — plan etter gjennomgang av kropp-str80

Skrevet etter en uavhengig kontroll av `kropp-str80-2026-07-28.svg` (Overdel,
baby, str. 80) og koden bak den. Kontrollen kjørte tallene gjennom
`babyblokk.ts`/`generator.ts` på nytt i et fristilt script, sammenlignet hvert
punkt med filen, og testet konturene med `shapely` (Python) for selvkryss og
at sømmonnet faktisk ligger utenpå. Funnene og to rettede filer
(`generator.ts`, `plagg.ts`) er allerede lagt inn i denne mappa.

## Hva som ble funnet og rettet

1. **Sømmonn-funksjonen kunne vende innover.** `sommonn()` i `generator.ts`
   antar én bestemt omløpsretning på punktlisten. Ermet var talt opp i motsatt
   retning av bak-/forstykket (tilfeldig, ikke med vilje), så sømmonnlinja for
   ermet lå delvis *inni* konturen i stedet for utenpå — bekreftet med et
   selvkryss og et areal mindre enn selve ermdelen. Rettet: funksjonen fjerner
   nå duplikatpunkt, retter omløpsretningen automatisk ut fra polygonets
   fortegn, og bruker et avfaset (ikke skarpt mitret) hjørne der vinkelen er
   spiss. Testet på nytt: alle tre deler er nå gyldige, enkle polygon der
   sømmonnet ligger korrekt utenpå.
2. **Katalogen (`plagg.ts`) hadde drevet fra koden.** `baby-kropp` sto som
   `status: 'katalogisert'` («konstruksjon ikke skrevet»), mens
   `babyblokk.ts` sin egen filhode sier «VERIFISERT mot tekst og diagram for
   begge stofftyper» — og en fil var jo allerede generert. Rettet til
   `verifisert`, og navnet rettet fra «Flat kroppsblokk, baby» til «Overdel,
   baby» (navnet gjennomgangsnotatet fra sist alt hadde bestemt, men som ikke
   var ført inn i katalogen).
3. **Halsåpningen går ikke over hodet.** Koden har allerede en sjekk for dette
   (`sjekkHode`), men den vises ingen steder — verken i UI eller på selve
   arket. For str. 80, jersey, uten vid hals: halsåpning strukket ca. 33 cm
   mot et hode på 48,5 cm. Med vid hals (bok s. 38, alternativet finnes
   allerede i koden): ca. 44 cm — bedre, men fortsatt ikke nok. Uten
   skulderklaff eller en bakåpning kommer ikke plagget over hodet på et
   spedbarn. Dette er nå skrevet rett inn i underteksten på det rettede
   arket, så det ikke bare ligger i en konsoll ingen ser.

Se `kropp-str80-2026-07-28-rettet.svg` for resultatet.

## Er det reelt at generatoren kan lage en fil som er klar til å sy?

Ja, med presiseringer. Den delen som ble testet uavhengig her — punktene,
kurvene, sømmonnet, at tilstøtende kanter faktisk matcher i lengde — holder
mål. Målene er kildebelagt til en anerkjent metrisk konstruksjonsbok og
kryssjekket mot regneeksemplene i teksten (str. 64 er nevnt eksplisitt i
`stoerrelser.ts`). Det er ikke en naiv «det går sikkert bra»-vurdering:
tallene i denne filen ble regnet ut på nytt fra bunnen av og sammenlignet
punkt for punkt.

Men to ting bør prege forventningen framover:

- **Feil av denne typen skjer stille.** Sømmonn-bugen har sannsynligvis
  ligget i alle tidligere genererte filer med et erm, uten at noe i
  brukergrensesnittet varslet om det — en polygonvalidering (shapely-metoden
  brukt her) fant den umiddelbart. Uten en tilsvarende sjekk innebygd i
  prosjektet vil neste geometrifeil også gå upåaktet hen.
- **Geometrisk gyldighet og sybarhet er to forskjellige spørsmål.**
  Halsåpnings-saken viser det tydelig: et mønster kan være perfekt konstruert
  etter boka og likevel ikke være til å ta på et barn. Katalogens
  status-felt (`verifisert`/`kodet`/`katalogisert`) dekker bare det første.

Konklusjon: prosjektet er ikke urealistisk — det er på god vei, med ett
tydelig sydd og geometrisk korrekt plagg som bevis. Det som gjenstår er ikke
tvil om metoden, men vanlig gjenstående arbeid: én manglende konstruksjon
(skulderklaffen), én manglende automatisk sjekk (geometrivalidering), og en
katalog som trenger en runde til for å stemme med koden.

## Prioritert videre arbeid

1. **Regresjonstest sømmonn-fiksen på alle kodede blokker.**
   `kroppsblokk.ts` (barn 80–170) har nøyaktig samme mønster i filhodet sitt
   («Status: VERIFISERT») som `plagg.ts` motsier på samme måte som
   `baby-kropp` gjorde — samme sjekk bør kjøres der, og på `bukseblokk.ts`
   og `tskjorte.ts`. Billig å gjøre, bør gjøres først siden fiksen påvirker
   alle delene som bruker `sommonn()`.
2. **Kod skulderklaffen** (Aldrich barneboka, bokside 38, kapittel 3 «9 Tee
   shirts»). Uten den er ikke `baby-kropp` i jersey reelt brukbar for et
   spedbarn som skal ha plagget over hodet. Konstruksjonstrinnene står
   already utredet i `monstergenerator-gjennomgang.md` (punkt 5). Den vevde
   varianten har allerede et eget forstykke med egen skulderlinje (`P[17]` i
   `babyblokk.ts`) som kan brukes som mal for hvordan geometrien bygges.
3. **Bygg inn en geometrisk selvsjekk** som del av generatoren eller som en
   liten test som kjøres når `generator.ts` endres: lukket, enkel kontur,
   sømmonn utenfor kontur, ingen selvkryss. Metoden som ble brukt i denne
   gjennomgangen (Python + shapely) kan gjøres om til et fast skript i
   repoet, eller tilsvarende logikk i TypeScript.
4. **Rett resten av `plagg.ts`** mot navnetabellen og
   status-reglene i `monstergenerator-gjennomgang.md` (punkt 3). Bare
   `baby-kropp` er rettet her — resten av de ~30 blokkene er ikke sjekket i
   denne runden.

## Tillegg: dette var ikke "fikset" — det var én smal feil rettet

Etter denne planen ble skrevet, pekte Maria på noe jeg hadde oversett: jeg
hadde kalt filen "rettet" etter å ha løst sømmonn-bugen, men hadde ikke
faktisk vurdert om arket var *brukelig*. Tre ting til, funnet ved å
rendre filen som bilde og se etter — samme metode som burde vært brukt
første gang:

1. **Navnelinjen og underteksten lå oppå mønsterets fald/søm**, ikke i ledig
   plass under det. `tilSvg()` antok 6 cm klaring der koden bare satt av
   2,5 cm. Rettet: egen tekststripe nederst, reservert i tillegg til vanlig
   marg.
2. **Kalibreringsruta (5×5 cm) lå oppå halskurven** på bakstykket, fordi den
   sto på en fast posisjon uansett hvor mønsteret faktisk startet. Rettet:
   egen stripe øverst, reservert til ruta.
3. **«trådretning»-teksten stakk inn i nabodelen** fordi ordet er bredere enn
   avstanden mellom to deler i et tettpakket ark. Rettet: teksten roteres nå
   90° og følger pilen i stedet for å stikke rett ut til siden.

Alle tre er rettet i `generator.ts` og i den oppdaterte
`kropp-str80-2026-07-28-rettet.svg`. Ingen av dem var synlige i konsollen —
bare i selve bildet. **Lærdom: en fil skal renderes og ses på, ikke bare
valideres matematisk, før den kalles fikset.**

**Format — ikke bytt til PDF.** Overleveringsnotatet fra forrige økt er
eksplisitt: Maria projiserer, skriver ikke ut. SVG med mm-mål og en
kalibreringsrute er det riktige valget for den arbeidsflyten, og PDF ville
gjeninnført akkurat den fliselegging/utskrift-problematikken notatet sier
er unngått. Det som trolig gjorde det vanskelig å zoome er at filen ble
åpnet direkte i en generisk bildeviser i stedet for i **Pattern Projector**
(gratis, nettbasert, laget nettopp for kalibrering/panorering/zoom av
projiserte mønstre — allerede navngitt i overleveringsnotatet). Prøv den
før noe annet.

**Ligner det en t-skjorte? Nei — og det er forventet, ikke en feil.**
Aldrichs metode (og standard mønsterfaget for øvrig) skiller mellom en
**blokk** (grunnform, med bevegelsesvidde, men uten designlinjer,
halsutvidelse eller fasong — det som er generert her) og et **ferdig
mønster** (klart til å klippe og sy, med all fasong og alle detaljer på
plass). En blokk SKAL se enkel og firkantet ut. Det er nøyaktig det
overleveringsnotatet fra forrige økt selv sier: «En blokk er ikke et plagg.
Blokkens halsringning er med vilje trang; alle faktiske t-skjorter utvider
den.» Det som generatoren produserer nå, er blokken — steget som gjør
blokken om til et faktisk plagg (utvidet hals, fasongen som får det til å
ligne en t-skjorte) er ikke bygget ennå. Det er samme åpne punkt som
skulderklaffen over, bare litt større i omfang: appen bør enten (a) tydelig
merke disse filene som «grunnmønster/blokk, ikke ferdig plagg» i UI-et, eller
(b) bygge selve manipulasjonssteget som lager et faktisk t-skjorte-/
body-mønster fra blokken. Uten én av delene risikerer appen å gi Maria noe
som ser ferdig ut, men ikke er det.

## Tillegg 2: referansebildet fra boka (s. 40-41) — og hvilken blokk hører str. 80 til?

Maria delte selve diagrammet «The 'flat' body block and shirt block» — det er
Aldrichs s. 40–41, kilden til **`kroppsblokk.ts`** (barn-kropp, 80–170), IKKE
kilden til `babyblokk.ts` (baby-kropp, 56–92, s. 24–27+38) som filen jeg
gjennomgikk faktisk ble generert fra.

Jeg kjørte `kroppsblokk.ts` på nytt for str. 80 (samme mål som før) og
rendret den, for å sjekke punkt for punkt mot bildet i stedet for å gjette.
Den treffer godt: tydelig skulderspiss, en armhulekurve med et synlig knekk
akkurat der boka merker «pitch point» (punkt 13/17), og en ermkule som
smalner mot håndleddet som i referansebildet. Dette er en helt annen, langt
mer formfull silhuett enn baby-blokken.

**Én reell mangel funnet ved sammenligningen, rettet:** boka markerer pitch
point både på kroppen (13/17) og ermet, men `kroppsblokk.ts` sin `del()`-
funksjon hadde bare hakk ved midjelinjen (punkt 1) — ikke ved pitch point.
Ermet hadde sitt eget pitch-hakk, men ingenting på kroppsdelen til å feste
det mot. Uten et hakk begge steder er det ingen måte å se på papiret hvor
ermet skal festes. Lagt til hakk ved P[13]/P[17] i `kroppsblokk.ts`.

**Åpent spørsmål jeg ikke kan svare på selv:** str. 80 dekkes av *begge*
blokkene (baby-kropp 56–92 og barn-kropp 80–170). Filen som ble vurdert
brukte baby-blokken, som er boksete med vilje — det er en enklere
jerseykonstruksjon laget for babyer som ikke kan løfte armene for å kle på
seg (derfor VID_HALS/skulderklaff-behovet). Barn-blokken over ligner mye mer
på en vanlig t-skjorte, men er trolig tenkt for barn som kler på seg mer
selvstendig, og trenger nok en åpning (den er ikke bygget for å strekkes
over hodet på samme måte). **Hvilken av de to skal Ellinor (1 år, str. 80)
faktisk bruke?** Det er ikke noe jeg bør avgjøre selv — det er et designvalg
boka trolig sier noe om (verdt å sjekke hvor Aldrich selv trekker grensen
for når babyblokken slutter å være riktig), ikke en kodefeil.

Jeg har ikke fått referansebildet for baby-blokkens egne sider (s. 24–27+38),
så jeg har ikke kunnet gjøre samme punkt-for-punkt-sjekk der. Del gjerne de
sidene også, så kan jeg gjøre samme sammenligning for babyblokka.

## Tillegg 3: Aldrichs punktnumre er nå synlige i SVG-en (verifiseringsmodus)

Maria vil sammenligne mot boka med målebånd via projektor — da må Aldrichs
egne punktnumre (0, 1, 2 …) vises direkte i mønsteret, ikke bare den ferdige
konturen.

Lagt til i `generator.ts`: `Del` har nå et valgfritt felt `punkter: { navn,
punkt }[]`, og `tilSvg()` tegner dem som røde prikker med tall når
`visPunkter: true` sendes inn. `babyblokk.ts` sin `del()` og `ermDel()`
fyller nå ut alle punktene fra `k.P` / `k.erm` (også de som ikke ligger på
selve klippelinjen, som 6, 8, 9, 10 — akkurat de trengs for å måle enkeltmål
mot boka).

Se `kropp-str80-verifisering-med-punkter.svg` — samme konstruksjon som før,
men med alle 16 punktene merket på bak- og forstykke, og 0–4 på ermet.

**Ikke gjort ennå:** dette er bare koblet opp i `babyblokk.ts`. `kroppsblokk.ts`,
`bukseblokk.ts` og `tskjorte.ts` har ikke fått samme `punkter`-felt lagt til.
Og selve app-en (siden/komponenten som kaller `tilSvg()` i produksjon) må få
en avkrysningsboks som sender `visPunkter: true` — det er ikke gjort her,
bare i testskriptet. Stå i Claude Code-prompten under.

**Én lesbarhetsbegrensning å vite om:** noen punkter ligger svært tett (10/11
er bare 0,5 cm fra hverandre; 6/7 likeså), så tallene kan overlappe hverandre
i en flatt eksportert PNG. I selve SVG-filen er det ikke et problem — zoom inn
i Pattern Projector eller nettleseren, så skiller punktene seg fra hverandre.

## Prompt til Claude Code (oppdatert, klar til bruk)

Alt under «Hva som ble funnet og rettet» + Tillegg 1–3 er allerede gjort i
denne økta (sømmonn-fiksen, layout-fiksene, `baby-kropp`- og `barn-kropp`-
status/navn i `plagg.ts`, pitch-hakket i `kroppsblokk.ts`, og
`punkter`/`visPunkter`-verifiseringsvisningen i `generator.ts`+`babyblokk.ts`).
Denne prompten dekker det som står igjen.

```
Les Pattern/videre-arbeid-plan.md i sin helhet først (alle tre tilleggene
også), og Pattern/monstergenerator-gjennomgang.md. Begge dokumenterer arbeid
som allerede er gjort i denne mappa: generator.ts har fått en fikset
sommonn()-funksjon (omløpsretning normaliseres, duplikatpunkt fjernes,
avfasede hjørner) og en ny layout for kalibreringsrute/tekststripe/
trådretningstekst, og et nytt valgfritt punkter-felt på Del + visPunkter i
SvgValg som tegner Aldrichs egne punktnumre (0,1,2…) oppå mønsteret — brukt
til å måle mot boka med målebånd via projektor. plagg.ts har fått status og
navn rettet for baby-kropp og barn-kropp. kroppsblokk.ts har fått et
pitch-point-hakk (P13/P17) det manglet. Ikke rull noe av dette tilbake.

Gjør i rekkefølge:

1. Legg samme punkter-felt (som babyblokk.ts sin del()/ermDel() allerede
   har) inn i kroppsblokk.ts, bukseblokk.ts og tskjorte.ts sine tilsvarende
   funksjoner — alle punktene fra konstruksjonens P-record (og eventuelt
   erm-record), inkludert de som ikke ligger på selve klippelinjen. Mens du
   er inne i hver fil: kjør en rask geometrisk selvsjekk på resultatet
   (samme metode som i denne økta — signert areal for omløpsretning, sjekk
   at sømmonn-konturen omslutter grunnkonturen og ikke krysser seg selv) for
   en standardstørrelse i hver, siden sommonn()-fiksen ikke er
   regresjonstestet mot disse tre ennå. Rett eventuelle funn.

2. Finn siden/komponenten i src/ som faktisk kaller tilSvg() i appen (ikke i
   Pattern/-mappa), og legg til en avkrysningsboks «Vis konstruksjonspunkter
   (verifisering)» koblet til visPunkter. Skal være av som standard — dette
   er et verktøy for å sjekke mønsteret mot boka, ikke noe som skal på et
   klippeklart ark.

3. babyblokk.ts sin bakHals()-funksjon bruker punkt 6 bare til å regne ut et
   omtrentlig kontrollpunkt for kurven — kurven går ikke gjennom punkt 6 slik
   fremreHals() gjør for forstykket. Les teksten (ikke bare diagrammet) som
   hører til jerseyblokken for baby (rundt bokside 24-25 i den trykte boka,
   render siden som bilde i høy oppløsning, stol ikke på tekstlaget i PDF-en)
   og avgjør om det er riktig at bak- og framkurven konstrueres ulikt der,
   eller om punkt 6 skal være et ekte kurvepunkt også bak. Rett kun hvis
   teksten sier noe annet enn koden gjør nå.

4. Kod skulderklaffen fra Aldrich barneboka bokside 38 (kapittel 3, «9 Tee
   shirts») inn i babyblokk.ts, som et tredje alternativ ved siden av
   dagens VidHals-opsjon (f.eks. skulderklaff?: boolean, bygger videre på
   vidHals-geometrien). Konstruksjonstrinnene står i
   monstergenerator-gjennomgang.md punkt 5 (senk/utvid hals, finn nytt
   halspunkt A og skulderpunkt B, kvadrer ut til C, D = halve B–C, E på
   ermegapet ca. 2,5 cm fra B, D–F=D–E speilet, F–G=0,5 cm, tegn klaffen
   A–G og B–G på både for- og bakstykke). Verifiser mot referansebildet
   Pattern/skulderklaff.jpg. Kjør sjekkHode() på nytt for str. 80 etterpå og
   bekreft at plagget faktisk går over hodet med klaffen, eller forklar
   hvorfor klaffen løser det uten at halsåpningen alene trenger å strekke
   seg over hele hodeomkretsen.

5. Gå gjennom resten av plagg.ts (de ~30 gjenværende blokkene) mot
   navnetabellen i monstergenerator-gjennomgang.md punkt 3 (navn,
   undertittel, forbudte ord «blokk»/«body»). Meld fra om hvilke som ser ut
   til å ha samme status-drift som baby-kropp/barn-kropp hadde (filhode sier
   VERIFISERT, plagg.ts sier katalogisert/kodet) — ikke rett status selv med
   mindre du faktisk kryssjekker konstruksjonen mot boka først.

Ikke gjett på formler eller kurveform du ikke kan lese direkte i
Aldrich-PDF-ene i Pattern/ — OCR-en er upålitelig på brøker, og
kurveformene mellom punktene er notorisk anslått i denne kodebasen (se
OVERLEVERING.md). Spør om noe er uklart i stedet for å anta.

When done, commit all changes and push to GitHub with a descriptive commit
message.
```
