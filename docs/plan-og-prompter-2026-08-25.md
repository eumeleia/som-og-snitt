# Ønskeliste og plan — 25.08.2026

Tolv punkter fra deg, skrevet ut, sjekket mot koden i HEAD (`c7344f9`), og delt i ni
steg som kan gis til Claude Code én om gangen.

**Merking:** «Sjekket» = lest i koden og linjehenvist. «Ikke verifisert» = ikke sjekket,
eller ikke mulig å sjekke uten å kjøre appen/basen.

## Fire spørsmål som må besvares før de stegene de gjelder

Planen har valgt et svar på hvert av dem og gått videre, men et annet svar endrer arbeidet.
Steget det gjelder er merket i Del 2.

| # | Spørsmål | Planen antar | Rammer |
|---|---|---|---|
| 1 | «Endre et motiv i biblioteket» — motivets data (navn/kategori/stjerner), eller åpne det i editoren? | Motivets data. «Åpne i editoren» finnes allerede. | Steg 5, oppgave 3 |
| 2 | Heter det fjerde menypunktet «Legg til broderi» eller «Last opp motiv»? Du skrev begge. | «Legg til broderi» | Steg 4b |
| 3 | Bildet du viste til under «last ned»-punktet fulgte ikke med. | Knappen står i topplinja, ved siden av «Rediger» | Steg 5, oppgave 2 |
| 4 | Skal et enkeltmotiv åpnet fra biblioteket lagres av seg selv? | Nei — det ville gitt én komposisjon per motiv du ser på | Steg 2, regel 4 |

---

## Del 1 — Ønskene, skrevet ut

### 1. Komposisjonen skal lagres av seg selv når jeg forlater den

I dag lagres en komposisjon bare på to måter: trykk på **Lagre**, eller forlat navnefeltet
etter å ha endret navnet (`onNavnBlur`, `KomposisjonEditor.tsx:449`). Flytter jeg et motiv,
legger til et nytt, endrer farge eller rekkefølge — og trykker tilbake — er alt borte, uten
varsel. **Sjekket:** `onBack` er `closeToBase` (`arranger/page.tsx:226`), som bare kaller
`history.back()`; ingenting kaller `lagre()` på veien ut.

Jeg vil at det å forlate editoren lagrer det jeg har gjort.

To feller som må håndteres, ikke omgås:

- En **ny, tom** komposisjon som åpnes og forlates uten at noe legges til, skal ikke bli en
  rad i basen.
- Et **enkeltmotiv åpnet fra biblioteket** (`startMotiv`, `arranger/page.tsx:221`) bruker
  samme editor. Autolagring der ville lagt igjen én komposisjon per motiv jeg tar en titt
  på. Se steg 2 for regelen jeg foreslår.

### 2. Tekst/font — hvor ligger jeg an?

Planen er `docs/fontplan-2026-08-13.md` + prompt 3 og 4 i `docs/plan-og-prompter-2026-08-13.md`.

**Landet (sjekket i kode og logg):**

| Del | Bevis |
|---|---|
| Steg A: grunnlinjen målt på ekte tegn i begge fonter | `cc0f507`, `docs/fontmaling-2026-08-13.md` |
| Beslutningen: automatikk forkastet, fast standard + øyet | `5a0acd2`, `types.ts:54-65` |
| `fontMetrikk` lagret på bundlen, som andel av tegnhøyde | `FontMetrikk` i `types.ts:63` |
| «Lagre grunnlinje for denne fonten» med per-tegn-avkryssing | `KomposisjonEditor.tsx:516` |
| Bokstavklassifisering rettet (`z` ut av underlengder, r/u/v/w/x inn) | `fontUtils.ts:10-22` |
| Målt xHeight brukt for underlengder | `0cbc874` |
| Ny standard `tracking` = 0,08 × xHøyde | `KomposisjonEditor.tsx:1091` |
| Stingteller mot 30 000 sting / 63 farger, før eksport | `KomposisjonEditor.tsx:471-479` |
| BX Floral: spenn-etiketter («1.5-2"») gir tomme | `motivvalg.ts:134-142` |
| Enkelttegn fra tekstverktøyet | `e7a5272` |

**Gjenstår:**

- **Prompt 4, oppgave 2 er ikke gjort.** Det finnes ingen `eksport.test.ts`, og
  to-stegs-koblingen mellom `byggEksportSegmenter` og `byggPecTilEkteMap` er ikke skrevet
  ned der den gjelder. **Sjekket** (fire testfiler i `arranger/`, ingen for eksport). Se
  steg 7.
- **Kalibrer de to fontene med øyet.** Ditt arbeid, ikke kode.
- **Sy én tekst.** «Happy» i Seraphine 2″. Grunnlinjen er ikke bekreftet før den er sydd.
- Om vedlikeholdskjøringene («Parse N størrelser», «Forny alle miniatyrer») er kjørt tomme:
  **ikke verifisert** — det krever basen.

Kort svar: koden er ferdig for det som var planlagt, bortsett fra én test. Det som står
igjen er kalibrering og én sydd prøve.

### 3. Endre et motiv i biblioteket også

**Trenger avklaring.** To lesninger, og de gir helt ulikt arbeid:

- **(a) Endre motivets data** — navn, kategori, stjerner — fra biblioteksvisningen, slik
  jeg kan i «Mine motiver» i dag (`EmbroideryDetail`, `embroidery/page.tsx:1962`).
- **(b) Åpne motivet i komposisjonseditoren** — det finnes allerede: «Rediger» i
  `MotivVisning` (`arranger/page.tsx:675`), landet i `e7a5272`.

Siden (b) allerede finnes, leser jeg punktet som **(a)**, og planen i steg 5 er skrevet for
(a). Er det (b) du mener, er punktet allerede løst og steg 5 krymper.

### 4. «Broderikomposisjon» på forsiden skal gå til komposisjoner, ikke bibliotek

**Sjekket:** kortet lenker til `/dashboard/embroidery/arranger`
(`dashboard/page.tsx:110`), og den siden åpner alltid på `tab = 'bibliotek'`
(`arranger/page.tsx:39`). Derfor havner jeg i biblioteket.

### 5. «Fortsett der du slapp» mangler synlig lenke til oppskriften

**Sjekket:** kortene viser navn, mottaker og størrelse, og har én knapp («Fortsett →») som
åpner prosjektet. `ProjectData` har allerede både `recipeId` og `recipeName`
(`projects/page.tsx:71-72`), og landingssiden henter hele `data`-kolonnen — så dataene er
der, de vises bare ikke.

Veien til en oppskrift finnes også: `sessionStorage.setItem('openRecipeId', id)` +
naviger til `/dashboard/recipes` (samme mønster som `inventory/page.tsx:732`).

### 6. Feste prosjekter (og oppskrifter) til forsiden

Jeg vil kunne merke et prosjekt eller en oppskrift slik at det er lett å finne igjen — både
øverst i sin egen liste og på forsiden.

**Sjekket:** ingen slik funksjon finnes. `ProjectData` og `RecipeData` har begge
`sortOrder?`, brukt til manuell drag-sortering. Landingssiden henter kun `projects`, aldri
`recipes`.

**Konflikt å være klar over:** har du sortert en liste manuelt, og festede elementer alltid
legges øverst, overstyrer festingen din egen sortering. Det er sannsynligvis det du vil —
men det er et valg, ikke en selvfølge.

### 7. «Hei Maria», ikke «Hei» + brukernavn

**Sjekket:** navnet hentes fra `user_metadata.full_name` (eller `name`), med e-postprefikset
som reserve (`dashboard/page.tsx:34-45`). Står ikke `full_name` i Supabase, vises
«Hei maria» med liten m.

**Billigste riktige fiks er ikke kode:** sett `full_name = "Maria"` på brukeren i Supabase,
så virker både forsiden, sidemenyen og kontomenyen med én gang, uten at noe hardkodes. Vil
du heller ha det i koden, er det én linje — men da må det endres to steder
(`dashboard/page.tsx` og `layout.tsx:27`), og de kan drive fra hverandre.

### 8. «Logg ut» nederst i sidemenyen, under Innstillinger

**Sjekket:** utlogging finnes bare i kontomenyen oppe til høyre (`layout.tsx:handleLogout`).
Sidemenyens bunn har «Innstillinger» og en brukerrad som også går til Innstillinger
(`DashboardNav.tsx`, `SidebarContent`-bunnen) — to lenker til samme sted, og ingen utlogging.

### 9. Motivvelgeren bruker VELDIG lang tid — hovedbiblioteket gjør ikke det

**Dette er den mest verifiserbare av alle sakene, og forklaringen ligger i koden.**

`MotivPicker` monteres på nytt hver gang velgeren åpnes (`KomposisjonEditor.tsx:890` —
`{showPicker && <MotivPicker …>}`), og første effekt henter **alle rader** i
`broderi_motiv` (~3000 ifølge kommentaren i `api/broderi-motiv/generer-miniatyrer/route.ts`),
inkludert kolonnen `miniatyr_svg` — en hel SVG som tekst, per rad
(`KomposisjonEditor.tsx:1447-1451`). Det hentes i sider på 1000, **etter hverandre**
(`hentAllePaginert` venter på hver side før neste), altså minst tre serielle rundturer med
et stort tekstfelt i hver.

Hovedbiblioteket (`/dashboard/embroidery`) rører aldri `broderi_motiv`. Det henter
`embroidery` + `embroidery_bundles` — noen hundre rader der bildene er URL-er, ikke innhold.
Det er hele forskjellen.

Verdt å merke: migrasjon 007 flyttet bbox UT av den TOAST-komprimerte `data`-kolonnen
nettopp for å slippe denne kostnaden. Migrasjon 008 la så `miniatyr_svg text` inn i samme
tabell, og velgeren ber om den — kostnaden kom delvis tilbake samme vei.

**Ikke verifisert:** faktisk radantall og antall byte over nettet. Det måles i steg 3, før
noe endres.

### 10. «Last ned» ved siden av «Rediger» i biblioteket

**Sjekket:** `MotivVisning` har bare «Rediger» i topplinja (`arranger/page.tsx:675`).
PES-fila ligger allerede på `size.pesUrl` i typen biblioteket bruker (`types.ts:7`), og
hovedbiblioteket har en ferdig nedlastingsknapp å kopiere stil og oppførsel fra
(`embroidery/page.tsx:2224`). Ingen nye data trengs.

**Merk:** du skrev «Se bilde», men det fulgte ikke noe bilde med. Jeg har antatt at knappen
skal stå i topplinja, ved siden av «Rediger», og gjelde den størrelsen som er valgt.

### 11. Vis stjernene i biblioteket

**Sjekket:** vurderingen ligger på `EmbroideryData.rating` og vises allerede i
hovedbiblioteket (`EmbroideryCard`, `embroidery/page.tsx:1539`). Men arrangørens egen
`EmbroideryData` (`arranger/types.ts:13`) har **ikke** `rating`, og `VirtuelMotiv` bærer den
ikke videre. `StarRating` (`embroidery/page.tsx:538`) er ikke eksportert.

Så: feltet finnes i basen, men ingen av flatene i arrangøren kan se det ennå.

### 12. Del Broderi i fire sider, i denne rekkefølgen

Ny meny under Broderi:

1. **Bibliotek** — biblioteksdelen av dagens arrangør, som egen side
2. **Broderikomposisjon** — komposisjonsdelen, som egen side
3. **Bilde til broderi** — uendret
4. **Legg til broderi** — dagens «Mine motiver» (`/dashboard/embroidery`)

**Sjekket:** dagens meny er «Mine motiver» / «Broderikomposisjon» / «Bilde til broderi»
(`DashboardNav.tsx`, `MENU`), og `arranger/page.tsx` holder begge deler i én side med en
faneknapp (`type Tab = 'bibliotek' | 'komposisjoner'`).

**Trenger avklaring:** du skrev både «Last opp motiv» og «Legg til broderi» om det samme
punktet. Jeg har brukt **«Legg til broderi»** i planen, siden det står i rekkefølgen din —
si fra hvis det skal være det andre.

---

## Del 2 — Ni steg for Claude Code

Rekkefølgen er valgt slik at ingen steg venter på et senere steg, og hvert steg kan
committes alene.

| Kjør | Steg | Innhold | Punkter | Størrelse |
|---|---|---|---|---|
| 1. | Steg 1 | Tre små ting på forsiden og i menyen | 5, 7, 8 | liten |
| 2. | Steg 4a | Flytt biblioteket ut i egen rute | 12 | middels |
| 3. | Steg 4b | Meny, navn og rekkefølge | 12, 4 | liten |
| 4. | Steg 2 | Autolagring av komposisjon | 1 | middels |
| 5. | Steg 3 | Motivvelgerens lastetid | 9 | middels |
| 6. | Steg 5 | Biblioteksiden: stjerner, last ned, rediger | 3, 10, 11 | middels |
| 7. | Steg 6 | Feste prosjekter og oppskrifter | 6 | middels |
| 8. | Steg 7 | Restanse fra forrige plan | (2) | liten |
| 9. | Steg 8 | Sluttkontroll på tvers av alt | alle | liten |

**Hvorfor strukturendringen er nummer to og ikke i midten.** Steg 4a deler
`arranger/page.tsx`, og steg 2 endrer den samme fila. Gjøres 2 først, flyttes kode som nettopp
er endret. Gjøres 4a først, forsvinner kollisjonen helt, steg 5 er ikke lenger blokkert, og
forsidekortet i punkt 4 løses gratis av 4b i stedet for med en linje som kastes igjen.

Prisen er at den første ordentlige økten er en omstrukturering uten noe synlig å vise fram.
Er det uaktuelt, kjør steg 2 før 4a — men da MÅ steg 2 være committet før 4a starter.

**Grein.** Repoet bruker feature-greiner fra før (`feat/sidemeny`, `fix/pes-rammeflagg`).
Kjør minst steg 4a på en egen grein — det er den ene endringen som er vond å reversere fra
main når fem commits ligger oppå. De små stegene kan gå rett på main.

**Før du starter:** `git status` viser fire uversjonerte dokumenter i `docs/`, mappa
`design/`, og `Floral Font.zip` (5,1 MB). Zip-fila hører ikke hjemme i repoet — legg den i
`.gitignore` eller flytt den ut før noen committer «alt».

**Ikke kode, men gjenstår (punkt 2):** kalibrer Seraphine og BX Floral med øyet, og sy
«Happy» i 2″. Grunnlinjen er ikke bekreftet før den er sydd. Dette er ditt eget arbeid og
kan gjøres når som helst, uavhengig av stegene over.

---

### Steg 1 — tre små ting

````
Tre uavhengige småendringer. Hver av dem committes for seg.

## 1. «Hei Maria» på forsiden — oppslag, ikke kodeendring

`dashboard/page.tsx:34-45` henter navnet fra `user_metadata.full_name`, ellers
e-postprefikset. Er `full_name` tom, står det «Hei maria» med liten m.

GJØR INGEN KODEENDRING her. Slå opp hva `full_name` faktisk er på brukeren, og rapportér
verdien til meg. Er den tom, setter jeg den i Supabase — da virker forsiden, sidemenyen og
kontomenyen med én gang, uten at et navn hardkodes to steder som kan drive fra hverandre.

Får du ikke lest den (mangler nøkkel, mangler tilgang): si det, ikke gjett, og ikke fall
tilbake på å hardkode.

For meg, når svaret kommer: verdien settes i Supabase → Authentication → Users → brukeren →
«User Metadata» → `full_name: "Maria"`. Ingen utrulling nødvendig; den leses ved neste
innlogging eller sidelast.

Reserveløsning HVIS jeg sier at feltet ikke lar seg sette: da — og bare da — settes navnet
i koden, men ÉTT sted. Legg en eksportert konstant, la både `dashboard/page.tsx` og
`layout.tsx` lese den, og skriv i kommentaren at dette er en reserveløsning for
`full_name`. To hardkodede strenger som kan drive fra hverandre er ikke et alternativ.

## 2. «Logg ut» nederst i sidemenyen

`SidebarContent` (`_shared/DashboardNav.tsx`) har i dag to lenker i bunnen som begge går
til Innstillinger: «Innstillinger» og brukerraden. Utlogging finnes bare i kontomenyen
oppe til høyre (`layout.tsx`, `handleLogout`).

- Legg til «Logg ut» som siste punkt i bunnseksjonen, under Innstillinger.
- `handleLogout` bor i `layout.tsx` og skal bli der — send den inn som ny prop
  `onLogout: () => void` til `SidebarContent`, på linje med `onNavigate`/`onClose`.
  `SidebarContent` brukes to steder i `layout.tsx` (fast sidemeny og mobiloverlegg) —
  begge må få proppen, ellers virker knappen bare på den ene.
- Samme visuelle form som «Innstillinger»-lenken (ikon + tekst, samme padding), men som
  `<button>`, ikke `<Link>`. Bruk et eksisterende ikon fra `DashboardIcons` hvis det
  finnes et som passer; ikke tegn et nytt uten å si fra.
- Kontomenyen i toppen beholdes uendret.

## 3. Oppskriftslenke på «Fortsett der du slapp»-kortene

`dashboard/page.tsx` henter hele `data`-kolonnen, og `ProjectData` har `recipeId` og
`recipeName` (`projects/page.tsx:71-72`) — dataene er der allerede.

- Utvid `LandingProject.data`-typen med `recipeId?: string` og `recipeName?: string`.
- Har kortet en `recipeId`: vis oppskriftsnavnet som en klikkbar lenke i kortet, under
  navnet, ved siden av (eller i stedet for) `recipientName · size`-linja. Vurder plassen —
  kortet er smalt, og prosjektnavnet skal fortsatt være det som leses først.
- Klikk skal åpne oppskriften, ikke prosjektet: `sessionStorage.setItem('openRecipeId', id)`
  og `router.push('/dashboard/recipes')` — samme mønster som `inventory/page.tsx:732`.
  Husk `e.stopPropagation()` så «Fortsett»-knappen ikke utløses.
- Ingen `recipeId`: ingen lenke, ingen tom plassholder.
- Et prosjekt kan ha `recipeId` mot en oppskrift som siden er slettet. Da åpner
  `/dashboard/recipes` uten å finne noe. Sjekk hva den siden faktisk gjør med en ukjent
  `openRecipeId` i dag, og la den oppføre seg likt her — ikke bygg en ny feilhåndtering.

## Kontroll

`npm test` og `npx tsc --noEmit`. I nettleseren:
- Sidemeny → «Logg ut» logger faktisk ut og lander på /login. Test BÅDE fra desktop-menyen
  og fra mobiloverlegget (smalt vindu).
- Et prosjekt med koblet oppskrift viser lenken og åpner riktig oppskrift; ett uten viser
  ingenting

(Punkt 4 på ønskelista — forsidekortet skal åpne komposisjoner, ikke bibliotek — er ikke
her. Det løses av steg 4b, der fanene forsvinner og `/arranger` bare ER komposisjoner.
Å endre startfanen nå ville vært en linje som kastes igjen tre steg senere.)
````

---

### Steg 2 — autolagring av komposisjon

````
Les først kommentaren over `lagre()` i `arranger/KomposisjonEditor.tsx:407-450`. Den
forklarer hvorfor navnefeltets `onBlur` allerede kaller `lagre()` — samme kall, annen
utløser. Denne oppgaven utvider akkurat det prinsippet, den finner ikke opp noe nytt.

Problemet: flytter man et motiv, legger til et nytt eller endrer sekvensen og trykker
tilbake, er alt borte uten varsel. `onBack` er `closeToBase` (`arranger/page.tsx:226`),
som bare kaller `history.back()`.

## Reglene — les hele lista før du skriver noe

1. **Én sannhet om «endret».** Hold en ref med et JSON-serialisert øyeblikksbilde av
   `{ navn, motiver, sekvens }` slik det var ved siste vellykkede lagring (og ved
   åpning, for en lagret komposisjon). «Endret» = dagens serialisering er ulik den.
   Ikke bruk et `dirty`-flagg satt av hver enkelt handling — et slikt flagg glemmer alltid
   én handling, og den ene blir et stille tap av arbeid.
   `miniatyrSvg` holdes UTENFOR sammenligningen: den er avledet, og `resolved` fylles
   asynkront, så den ville gjort en uendret komposisjon «endret» av seg selv.
2. **Autolagring kaller `lagre()`.** Ikke en parallell lagringsvei.
3. **Aldri opprett en tom rad.** Er `id === null` (ikke lagret før) og `motiver.length === 0`,
   gjør ingenting.
4. **Enkeltmotiv fra biblioteket lagres ALDRI av seg selv.** (Spørsmål 4.) Er `startMotiv` satt og
   `id === null`, skal autolagringen ikke gjøre noe — ellers får jeg én komposisjon i lista
   per motiv jeg tar en titt på. Endre knappeteksten i den tilstanden fra «Lagre» til
   «Lagre som komposisjon», så det er tydelig at ingenting skjer av seg selv.
   Er du uenig i denne regelen, si fra FØR du bygger noe annet.
5. **En lagret komposisjon lagres alltid ved endring**, også om den er tømt for motiver —
   å slette alle motivene er en ekte redigering, ikke en tom komposisjon.

## Tre hull som gir DOBBEL eller ØDELAGT lagring — les før du skriver kode

**Hull 1: navnefeltets `onBlur` fyrer på vei ut.** Trykker jeg tilbake mens markøren står i
navnefeltet, fyrer `onNavnBlur` → `lagre()` FØRST, og deretter utgangslagringen. For en ny
komposisjon (`id === null`) blir det to POST-er og to rader, fordi `setId` ikke har rukket å
sette id-en mellom dem.

Avgrensning: `onNavnBlur` lagrer bare når navnet ER endret siden sist lagring
(`navn !== lagretNavnRef.current`, `:449`), så dette treffer bare når jeg har skrevet et nytt
navn og går rett ut. Løpet finnes allerede i dag mellom `onNavnBlur` og «Lagre»-knappen —
autolagring gjør det bare lett å treffe. Løsning: én lagring om gangen. Hold en ref til den
pågående lagringen (`Promise | null`) og la et nytt kall vente på den i stedet for å starte
sitt eget. Det dekker også dobbelttrykk på tilbakeknappen.

**Hull 2: miniatyren kan bli lagret med hull.** `lagre()` bygger `miniatyrSvg` fra
`resolved` slik den står akkurat da, og hopper over motiver som mangler der
(`miniatyr.ts`, `if (!motivBbox) continue`). Forlater jeg editoren før et nylagt motiv er
parset, lagres miniatyren uten det, til neste gang jeg lagrer.

Realistisk vindu: er størrelsen allerede i `broderi_motiv`-cachen, er det et par hundre
millisekunder og skjer nesten aldri. Er den IKKE parset fra før, går det en runde til
`/api/broderi-motiv/parse`, og da er vinduet sekunder. Konsekvensen er kosmetisk — feil
miniatyr i komposisjonslista, ingen tapte data — men den er lett å unngå.
Løsning: er det motiver i `motiver` som mangler i `resolved`, IKKE overskriv en eksisterende
`miniatyrSvg` med en dårligere. Behold den forrige. For en helt ny komposisjon: lagre uten
miniatyr heller enn med en gal — den regnes uansett på nytt ved neste lagring.

**Hull 3: React StrictMode.** `next.config.ts` setter ingenting, og standarden i nyere
Next er at StrictMode er PÅ i dev (ikke verifisert for 16.2.6 — sjekk selv). Da monteres
effekter dobbelt, og en opprydding-basert utgangslagring fyrer én gang med det samme
editoren åpnes. Dette er dev-bare og synes med én gang, så det er en tidstyv, ikke en
produksjonsfeil. Er den på: ikke stol på cleanup alene — legg en `harMontertRef`, eller styr
lagringen fra selve navigasjonshendelsen.

## Utløserne

- **Tilbakeknappen i editoren:** gjør `onBack`-veien asynkron — `await lagre()` før
  `onBack()`. Vis «Lagrer…» på knappen mens det står på, og deaktiver den.
- **Nettleserens tilbakeknapp / navigasjon i sidemenyen:** editoren avmonteres. Bruk
  et opprydningskall i en effekt, med ferske verdier via ref — ikke lukkede variabler fra
  første rendring. Klarer du ikke gjøre dette pålitelig uten å endre `useHistoryVisning`,
  STOPP og rapportér i stedet for å bygge om hooken.
- **Lukking av fanen:** dekkes IKKE av lagring. `beforeunload` kan ikke vente på en fetch.
  Registrer i stedet en `beforeunload`-lytter som setter `preventDefault()` når det er
  ulagrede endringer, slik at nettleseren spør. `sendBeacon` er vurdert og valgt bort:
  den kan bare POST-e, og oppdatering av en eksisterende komposisjon er en PUT.

## Feilhåndtering

Feiler lagringen på vei ut, skal navigeringen IKKE skje. Vis feilen (`saveErrorDetails` og
`ErrorDetailsView` finnes) og bli stående i editoren. Å navigere bort etter en feilet
lagring er nøyaktig det tapet denne oppgaven skal fjerne.

## Test

Ren funksjon for «er dette endret» (den som sammenligner to øyeblikksbilder), med tester:
uendret, flyttet motiv, endret navn, endret sekvens, og at `miniatyrSvg` alene ikke teller.

## Kontroll i nettleseren

- Ny komposisjon → legg til ett motiv → flytt det → tilbake → åpne den igjen: motivet står
  der du slapp det
- Ny komposisjon → åpne og gå rett tilbake: ingen ny rad i lista
- Bibliotek → et motiv → «Rediger» → flytt det → tilbake: INGEN ny komposisjon
- Lagret komposisjon → flytt et motiv → nettleserens tilbakeknapp → åpne igjen: lagret
- Lagret komposisjon → endre noe → prøv å lukke fanen: nettleseren spør
- Lagret komposisjon → gjør ÉN endring → tilbake → åpne → tilbake igjen uten å røre noe:
  det skal IKKE gå en ny lagring på den siste turen
- Ny komposisjon → skriv et navn → trykk tilbake MENS markøren står i navnefeltet: nøyaktig
  ÉN rad i lista, ikke to (hull 1)
- Ny komposisjon → legg til et motiv → trykk tilbake med det samme, før motivet er tegnet
  ferdig → åpne igjen: motivet er der, og miniatyren i lista lyver ikke om innholdet (hull 2)
- Åpne en tom, ny komposisjon i dev og la den stå: ingen lagring skal fyre av seg selv
  (hull 3)

`npm test` og `npx tsc --noEmit` før du sier deg ferdig.
````

---

### Steg 3 — motivvelgerens lastetid

**Oppfrisket 11.09.2026:** linjenumrene i den opprinnelige prompten var fra 25. august og
pekte ca. 900 linjer feil etter arbeidet i `dd0bfe7`, `9a02be0`, `c1e85cf` og `a7236ad`.
Numrene under er sjekket i koden 11.09. Årsaken er også funnet siden den gang og skrevet
inn i punkt 1, så steget ikke starter som en åpen undersøkelse.

````
Motivvelgerens lastetid.

## 1. Mål først — ett tall, ikke en utredning

Årsaken er kjent, så dette er ikke en åpen undersøkelse. Kommentaren i
`src/lib/pesMiniatyr.ts:4-14` sier, målt mot 25 ekte motiver, at `miniatyr_svg` utgjør ca.
37 MB til sammen for alle 2967 radene i `broderi_motiv`. `lastAlleRader`
(`KomposisjonEditor.tsx:2349`) henter alle de radene INKLUDERT den kolonnen (`:2352`), i
serielle sider på 1000, hver gang velgeren åpnes.

Det som IKKE er målt, og som du skal måle, er hva som faktisk krysser nettet — svaret er
komprimert, og SVG-tekst komprimerer godt. Åpne en komposisjon, åpne motivvelgeren med
nettverksfanen åpen, og noter:

- antall forespørsler mot `broderi_motiv`, og overførte byte per forespørsel
- tid fra velgeren åpnes til rutenettet er tegnet (midlertidig `console.time`/`timeEnd`
  rundt `lastAlleRader`)
- det samme for hovedbiblioteket `/dashboard/embroidery`, som oppleves raskt

Rapportér de tallene til meg før du endrer noe. De er «før»-kolonnen i punkt 6.

## 2. Hva fiksen angriper

To uavhengige ting, og de gir hvert sitt symptom:

- **Grunnlasten er for tung.** Kolonnen `miniatyr_svg` hentes for alle rader selv om bare
  de synlige kortene trenger den. Det er førstegangs-tregheten.
- **Cachen dør når velgeren lukkes.** `bboxCache` er komponent-state (`:2317`), så hele
  lasten betales på nytt hver gang. Det er grunnen til at det er like tregt hver gang.

Viser målingen i punkt 1 noe annet — for eksempel at den komprimerte overføringen er liten
og tiden går med til noe helt annet — følger du målingen. Den vinner over det som står her.

## 3. Målet fiksen skal treffe

Ingen oppdiktede millisekundtall — målet er definert mot det DU målte i punkt 1:

- **Første åpning:** antall overførte byte ned i samme størrelsesorden som
  hovedbiblioteket, og ingen serielle sider på 1000 rader med et tekstfelt i.
- **Andre åpning i samme økt:** null nye forespørsler mot `broderi_motiv` for grunnlasten.
  Det er en telling i nettverksfanen, ikke en følelse.

Treffer fiksen ikke dette, IKKE legg på flere lag for å komme dit. Rapportér hva du kom
til, og hva målingen sier at den gjenværende tiden går med til. En halv fiks med et ærlig
tall er bedre enn tre lag med cache som ingen forstår.

## 4. Fiksen, i to deler

**a) Ikke hent `miniatyr_svg` for alle rader.** Grunnlasten trenger bare
`embroidery_id, size_id, bredde_tiendedel_mm, hoyde_tiendedel_mm` — tre heltall per rad,
ikke-TOASTede kolonner etter migrasjon 007. Miniatyrene hentes ETTERPÅ, kun for de
størrelsene som faktisk er synlige, med en `.in(...)`-spørring på de nøklene.

Tre steder leser `miniatyrSvg` fra `bboxCache` i dag, og alle må dekkes av den late
hentingen. Kjør `grep -n "miniatyrSvg" KomposisjonEditor.tsx` og sjekk selv at lista er
komplett før du begynner. Disse tre:
- kategoriflisenes forsidebilder — `kategoriData`, `:2570`
- `MotivKort` sitt forsidebilde — `:2935`
- miniatyren i størrelses-rutenettet — `:3076`

**b) La ikke cachen dø når velgeren lukkes. Legg den på MODULNIVÅ.** `bboxCache` er
komponent-state i dag (`:2317`). Å løfte den til `KomposisjonEditor` fikser gjentatte
åpninger INNI samme komposisjon, men editoren avmonteres når jeg går tilbake til
komposisjonslista (`arranger/page.tsx:279` og `:305` er tidlige returer), så åpne A → velg
→ tilbake → åpne B betaler full pris igjen. Modulnivå dekker begge og koster ikke mer å
skrive. Derfor modulnivå.

Si i kommentaren hva som gjør cachen utdatert. Genererer jeg nye miniatyrer i samme økt,
må den kunne friskes opp — `lasterVersjon` (`:2325`, brukt som dependency på `:2433` og
`:2442`) finnes allerede som den utløseren.

**Fullhentingen av bbox-kolonnene blir stående, og det er med vilje.** `kategoriData`
(`:2516`) regner `passerCount` per kategoriflis ved å kalle `vmStatus(vm, bboxCache)` for
HVERT motiv i kategorien (`:2547-2549`). Den tellingen trenger mål for alle rader. Skriv
det ned i koden, ellers prøver neste økt å fjerne fullhentingen og ødelegger tallene på
kategoriflisene uten at det ser feil ut.

**Den dyre fellen i lat lasting:** `bboxCache` står i dependency-arrayen til `kategoriData`
(`:2578`), som går gjennom alle virtuelle motiver. Fyller du cachen kort-for-kort, kjører
den om for hvert kort. Oppdater cachen i ÉN samlet skriving per visning — hent alle
nøklene visningen trenger i én `.in(...)`, og sett state én gang.

**Fallback-veien som ikke fantes da planen ble skrevet:** `:2359-2362` fanger `42703` og
laster uten `miniatyr_svg` når migrasjon 008 ikke er kjørt. Når grunnlasten slutter å hente
kolonnen, kan den fallbacken forenkles der — men den late hentingen må fortsatt tåle at
kolonnen mangler, uten å blokkere rutenettet.

## 5. Fellen du kommer til å gå i

`ParseBunnlinje` (`:2815`) teller hvor mange rader som MANGLER miniatyr ved å gå gjennom
`bboxCache` og telle `miniatyrSvg === null` (`:2817`) — det er tallet «Generer
miniatyrer»-knappen viser. Slutter vi å hente kolonnen for alle rader, blir det tallet
feil, og det ser ikke feil ut: det ser ut som om alt er generert.

Erstatt tellingen med en `count`-spørring med `.is('miniatyr_svg', null)`. Samme
`head: true`-mønster som `passerPromise`/`passerIkkePromise` i samme fil.

## 6. Mål igjen

Samme tall som i punkt 1, før og etter, i en tabell.

`npm test`, `npx tsc --noEmit`, `npx eslint`. De fire kjente eslint-feilene
(`KomposisjonEditor.tsx` static-components, `SekvensPanel.tsx:707`, `page.tsx:110` og
`:183`) er eldre enn dette arbeidet. I nettleseren: åpne velgeren, bla i kategorier, åpne
en bundle, lukk og åpne velgeren igjen — miniatyrene skal vises alle stedene de vises i
dag, og «Generer miniatyrer» skal vise samme tall som før endringen.
````

---

### Steg 4a — flytt biblioteket ut i egen rute

````
Ren flytting. Ingen forbedringer underveis: funker noe dårlig etter flyttingen, skal det
virke NØYAKTIG like dårlig som før, og fikses i et eget steg. Menyens navn og rekkefølge
kommer i steg 4b — her legges bare til ett punkt.

Steg 2 må være committet før du starter. Begge rører `arranger/page.tsx`.

## Delingen

`arranger/page.tsx` (803 linjer) holder i dag begge deler bak `type Tab`. Del den:

- **Ny fil** `src/app/dashboard/embroidery/bibliotek/page.tsx`: alt som i dag ligger bak
  `tab === 'bibliotek'`, pluss `MotivVisning`, `MotivDetaljer`, `BiblioTile`,
  `KategoriTile`, `KategoriInnhold`, `BundleInnhold`, `kategoriThumbnail`, `TilbakeKnapp`,
  og lastingen av `motifs` + `bundlerMap`.
- **`arranger/page.tsx` beholder** komposisjonslista, `KomposisjonEditor`, sletting og
  kopiering. At begge sidene laster `embroidery` hver for seg er det samme som skjer i dag
  når man bytter fane; ikke bygg en delt cache som en «forbedring» på si.
- **Men:** komposisjonssiden trenger `motifs` bare fordi editoren tar det som `biblioteket`.
  Selve LISTA bruker det ikke. Etter delingen betaler lista for en full henting av
  `embroidery` + `embroidery_bundles` den ikke rører. Utsett den hentingen til editoren
  faktisk åpnes. Dette er en liten kostnad — radene er små, `coverImage` er en URL og ikke
  et innebygd bilde (sjekket) — men den er gratis å bli kvitt akkurat her, mens du likevel
  flytter koden.
- Biblioteksiden importerer `KomposisjonEditor` fra `../arranger/KomposisjonEditor` for
  «Rediger»-veien. Ikke lag en kopi.
- `EmbroideryCard` og `KATEGORIER` importeres i dag fra `../page`. Fra den nye mappa er det
  fortsatt `../page` — sjekk at stien faktisk løser til `embroidery/page`, ikke to nivåer opp.
- Faneknappene fjernes fra `arranger/page.tsx`, og `type Tab` med dem.

## Historikk

`useHistoryVisning` brukes med navnerommet `'arr'` i dag, og `ArrVisning` dekker begge
deler. Del den:
- biblioteksiden: navnerom `'bib'`, visninger `liste | motiv | nyFraMotiv`
- komposisjonssiden: navnerom `'komp'`, visninger `liste | komposisjon | ny`

`libView` (kategori/bundle-nivået) er lokal state uten historikk i dag. Behold det slik —
ikke gjør den historikk-sporet som en «forbedring» på si.

## Menyen (bare tillegget)

Legg «Bibliotek» inn som nytt underpunkt under Broderi i `_shared/DashboardNav.tsx`,
`MENU`. Rekkefølge og de andre navnene rører du ikke her.

Sjekk om `isSectionActive` fortsatt uthever riktig: `/dashboard/embroidery` er prefiks for
alle de andre rutene, så «Mine motiver» kan komme til å se aktiv ut også på den nye siden.
Blir det feil, fiks utheving-regelen — den er en del av denne oppgaven.

## Kontroll

`npm test`, `npx tsc --noEmit`, `npm run build`. Produksjonsbygget er ikke valgfritt her:
det fanger Suspense/`useSearchParams`-feil som `next dev` ikke gjør, og det er nøyaktig det
som gikk galt sist en side ble delt (se commit `c7344f9`).

I nettleseren:
- Bibliotek: kategorier → bundle → motiv → «Rediger» åpner editoren → nettleserens
  tilbakeknapp fører tilbake til motivvisningen
- Søk i biblioteket gir flate treff som før
- Broderikomposisjon: lista, ny komposisjon, åpne en eksisterende, kopier, slett
- Fram- og tilbakeknappen virker på begge sider, uavhengig av hverandre
````

---

### Steg 4b — meny, navn og rekkefølge

**Avhenger av spørsmål 2.**

````
Forutsetter steg 4a. Ren omdøping og omrokering — ingen ny funksjonalitet.

## Målet

Undermenyen for Broderi skal bli, i denne rekkefølgen:

1. Bibliotek                → `/dashboard/embroidery/bibliotek`
2. Broderikomposisjon       → `/dashboard/embroidery/arranger`
3. Bilde til broderi        → `/dashboard/embroidery/bilde-til-broderi`
4. Legg til broderi         → `/dashboard/embroidery` (dagens «Mine motiver»)

Ruta `/arranger` beholdes for komposisjoner i stedet for å døpes om — det er ingen gevinst
i en ny URL, og bokmerker og historikk-state slutter ikke å virke.

## Gjør

- `MENU` i `_shared/DashboardNav.tsx`: ny rekkefølge, «Mine motiver» → «Legg til broderi».
  Velg ikon for Bibliotek fra `DashboardIcons`; `leaf` blir ledig når «Mine motiver» endrer
  navn.
- Overskriften i `/arranger` endres fra «Arranger broderimotiver» til «Broderikomposisjon»,
  og ingressteksten under den justeres — den snakker i dag om biblioteket, som ikke er der
  lenger.
- **Punkt 4 på ønskelista løses her.** Når fanene er borte og `/arranger` bare er
  komposisjoner, går forsidekortet «Broderikomposisjon» rett dit av seg selv. Bekreft det i
  nettleseren — det er hele fiksen, ingen egen kodeendring trengs.

## Lenker som må følge med

Kjør `grep -rn "embroidery/arranger\|dashboard/embroidery" src/` og gå gjennom HVER treff
før du endrer noe. Minst disse:
- forsidekortet «Broderikomposisjon» (`dashboard/page.tsx`) — skal peke på `/arranger`
- den tomme-tilstands-lenken i biblioteket som peker til `/dashboard/embroidery` og sier
  «Last opp under Broderi» — teksten skal si det nye navnet

## Kontroll

`npm run build`, og i nettleseren: klikk deg gjennom alle fire menypunktene, og bekreft at
riktig punkt er uthevet på hver av dem — også når du kommer dit via en lenke og ikke via
menyen.
````

---

### Steg 5 — biblioteksiden: stjerner, last ned, rediger

````
Forutsetter steg 4a. Alt under skjer i `dashboard/embroidery/bibliotek/page.tsx` med mindre
noe annet står.

## 1. Stjerner

`rating` ligger på `EmbroideryData` i `embroidery/page.tsx` og vises i `EmbroideryCard`
(`:1539`). Arrangørens egen `EmbroideryData` (`arranger/types.ts:13`) mangler feltet, og
`VirtuelMotiv` bærer det ikke videre.

- Legg `rating?: number` på `EmbroideryData` og `EmbroideryBundleData` i `arranger/types.ts`.
  Additivt, ingen migrering — feltet finnes allerede i basen.
- Ta med `rating` i `VirtuelMotiv` i `byggVirtuelleMotiver` (`motivvalg.ts`). For en
  fontrad-VM som er slått sammen på tvers av rader: bruk radens rating slik den er, og la
  være å finne på en sammenslåingsregel. Legg en test på at feltet følger med.
- Vis stjernene på `BiblioTile` (motiv- OG bundlefliser) og i `MotivVisning`s topplinje.
  Ingen rating: vis ingenting, ikke fem grå stjerner.
- `StarRating` (`embroidery/page.tsx:538`) er ikke eksportert i dag. Eksportér den —
  `EmbroideryCard` og `KATEGORIER` eksporteres allerede derfra, så mønsteret finnes.
  Ikke skriv en ny stjernekomponent.
- Kun visning her. Å SETTE vurderingen hører til oppgave 3 under.

## 2. Last ned  (se spørsmål 3)

I `MotivVisning`s topplinje, ved siden av «Rediger»: en «Last ned»-knapp for den størrelsen
som er valgt akkurat nå. Fila ligger på `size.pesUrl` / `size.pesFilename` (`types.ts:7`).

Kopiér stil og oppførsel fra den ferdige knappen i `embroidery/page.tsx:2224`
(`<a href={…} download={…}>` med `e.stopPropagation()`). Ingen ny nedlastingsvei.

Topplinja har allerede tilbakeknapp, tittel og «Rediger». Med en fjerde ting blir den trang
på mobil — sjekk i et smalt vindu, og la tittelen få lov til å kuttes før knappene gjør det.

## 3. Rediger motivets data fra biblioteket  (avhenger av spørsmål 1)

Målet: kunne endre navn, kategorier og stjerner uten å gå til «Legg til broderi».

**Vedtatt vei: et lite redigeringsfelt i `MotivVisning`**, ikke gjenbruk av
`EmbroideryDetail`. Begrunnelse: `EmbroideryDetail` (`embroidery/page.tsx:1962-2252`) er
knyttet til den sidens opplasting, oppdeling, flytting av størrelser og bundle-håndtering.
Å trekke den ut er en større jobb enn selve funksjonen, og den drar med seg knapper som
ikke hører hjemme i en biblioteksvisning. Er du uenig etter å ha lest den, si fra før du
bygger — men ikke gjør begge deler.

- Tre felt: navn (tekst), kategorier (gjenbruk `KategoriEditor`, `embroidery/page.tsx:789`
  — eksportér den), stjerner (`StarRating` med `onRate`).
- Lagring: `supabase.from('embroidery').update({ data: … })` med HELE `data`-objektet,
  spredt fra det eksisterende — ikke bare de tre feltene, ellers slettes resten.
  Følg samme mønster som `update()` gjør i `EmbroideryDetail`.
- Etter lagring må biblioteklista vise det nye navnet uten full omlasting. Oppdater
  `motifs`-state i biblioteksiden med den lagrede raden.

## Kontroll

`npm test` og `npx tsc --noEmit`. I nettleseren:
- Et motiv med rating viser stjerner i flisa, i søketreffene og i motivvisningen
- «Last ned» gir riktig PES-fil for den valgte størrelsen, og en annen fil når du bytter
  størrelse
- Endre navn på et motiv → tilbake til lista → nytt navn står der
- Endre kategori på et motiv → gå til kategorinivået → motivet ligger i den nye kategorien
- Åpne «Legg til broderi» og bekreft at endringen er den samme der
````

---

### Steg 6 — feste prosjekter og oppskrifter

````
Målet: kunne merke et prosjekt eller en oppskrift som festet, slik at det ligger øverst i
sin egen liste OG på forsiden.

## Datamodell

`pinned?: boolean` på `ProjectData` (`projects/page.tsx:63`) og `RecipeData`
(`recipes/page.tsx:32`). Rent additivt: begge tabeller lagrer én `data`-jsonb, så ingen
migrering og ingen backfill. Fraværende felt = ikke festet.

## I listene

- Nålknapp på detaljvisningen for både prosjekt og oppskrift, og en liten nålmarkering på
  kortet i lista når det er festet.
- Festede først i lista, ellers uendret sortering innad.
- **Konflikten du må håndtere, ikke skjule:** begge listene har manuell drag-sortering
  (`sortOrder`). Festing øverst overstyrer den. Det er ønsket — men skriv en kommentar der
  sorteringen skjer som sier at det er et bevisst valg, ikke en glipp, så neste økt ikke
  «fikser» det tilbake.
- **Fellen:** dra-sorteringen skriver `sortOrder` ut fra posisjonen i den viste lista. Er
  lista omsortert av festing, kan et dra-slipp gi `sortOrder`-verdier som ikke betyr det
  samme lenger. Se på hvordan `sortOrder` faktisk settes ved slipp FØR du endrer
  sorteringen, og si fra hvis de to ikke kan leve sammen uten å skrive om dra-koden.
- Sorteringen (festet først, deretter eksisterende regel) skrives som en ren funksjon med
  test: ingen festede, én festet, flere festede med ulik `sortOrder`.

## På forsiden

`dashboard/page.tsx` henter i dag bare `projects`. Legg til en spørring mot `recipes` med
samme smale mønster som `LandingProject` — bare feltene forsiden trenger. Ikke hent hele
`RecipeData`: den har pdf-er og annoteringer i seg, og det er nøyaktig den typen unødvendig
last som gjør motivvelgeren treg (se steg 3).

Ny seksjon **«Festet»** over «Fortsett der du slapp», med festede prosjekter og oppskrifter
blandet. Ingen festede: ikke vis seksjonen i det hele tatt — ikke en tom overskrift.

Rekkefølgen i seksjonen: prosjekter først, deretter oppskrifter, og innad synkende på
`created_at` — de to listene har ingen felles sorteringsnøkkel, og uten en uttalt regel blir
rekkefølgen tilfeldig og skifter mellom hver lasting. Merk hver rad tydelig som prosjekt
eller oppskrift; et navn alene sier ikke hvilken av delene det er.

Klikk på et festet prosjekt: `openProjectId`, som i dag. På en oppskrift: `openRecipeId` +
`/dashboard/recipes`, som `inventory/page.tsx:732`.

## Kontroll

`npm test` og `npx tsc --noEmit`. I nettleseren: fest et prosjekt og en oppskrift, se at
begge dukker opp på forsiden og øverst i sine lister, dra-sortér lista etterpå og sjekk at
rekkefølgen fortsatt gir mening, løsne dem igjen, og last siden på nytt mellom hver for å
bekrefte at det faktisk er lagret.
````

---

### Steg 7 — restanse fra forrige plan

````
Én oppgave, hentet fra prompt 4 punkt 2 i `docs/plan-og-prompter-2026-08-13.md`. Den ble
aldri gjort: det finnes ingen `eksport.test.ts`.

`byggEksportSegmenter` (`arranger/eksport.ts`) sender min egen trådfarge til Python, ikke
palettfargen. Det gir riktig resultat bare fordi `byggPecTilEkteMap` nøkler oppslaget på
`snappTilPalett(trad.hex)`, slik at Python snapper tilbake til samme PEC-farge. To steg, ikke
én idempotent operasjon, og korrektheten avhenger av et nøkkelvalg i en annen fil.

- Skriv avhengigheten ned i `eksport.ts`, der den faktisk gjelder — ikke bare i en doc.
- Legg `eksport.test.ts` med en test som feiler hvis
  `snappTilPalett(effektivTradfarge(...).hex) !== pecHex`.

Endrer noen nøkkelvalget senere — for eksempel for å kunne knytte en tråd manuelt til en
PEC-farge den ikke snapper til — skal testen si fra, ikke eksporten stille gi feil farge.

`npm test` og `npx tsc --noEmit`.
````

---

### Steg 8 — sluttkontroll

````
Ingen ny kode med mindre du finner noe galt. Dette er en gjennomgang på tvers av alle
stegene, fordi hver av dem er sjekket for seg og ingen har sett dem sammen.

## 1. Bygg og tester

`npm test`, `npx tsc --noEmit`, `npx eslint`, `npm run build`. Rapportér alt som ikke er
grønt — også ting du mener er gammelt. Merk: tre eslint-feil i `arranger/page.tsx`
(`react-hooks/set-state-in-effect` på `load()`/`loadKomposisjoner()` i effekter) er kjent
og eldre enn dette arbeidet. Er de fortsatt der etter delingen i steg 4a, la dem stå, men
si hvor de havnet.

## 2. Klikk gjennom, i denne rekkefølgen

Start på forsiden hver gang, og bruk nettleserens tilbakeknapp mellom hvert punkt — ikke
menyen. Det er tilbakeknappen som er skjør etter en sidedeling.

1. Forsiden: hilsen, «Festet»-seksjonen, «Fortsett der du slapp» med oppskriftslenke
2. Forsiden → Broderikomposisjon → ny komposisjon → legg til to motiver fra velgeren →
   tilbake → åpne igjen: begge står der
3. Bibliotek → kategori → bundle → motiv → stjerner synlige → last ned → rediger navn →
   tilbake til lista: nytt navn
4. Bibliotek → motiv → «Rediger» → flytt → tilbake: ingen ny komposisjon i lista
5. Legg til broderi: uendret fra før arbeidet startet
6. Sidemeny → Logg ut

## 3. Det som er lett å ha ødelagt uten å merke det

- Antall komposisjoner i lista: har autolagringen laget rader du ikke ba om? Tell før og
  etter en økt der du bare ser på ting.
- «Generer miniatyrer»-tallet i velgeren: viser det fortsatt riktig etter steg 3?
- Uthevingen i sidemenyen på alle fire Broderi-sidene.
- Mobil: åpne alt over i et smalt vindu. Topplinja i motivvisningen har fått en knapp til.

Rapportér som tre lister: virker, virker ikke, usikker.
````
