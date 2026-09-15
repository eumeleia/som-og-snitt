# Plan og prompter — 11.09.2026

Prompter til Claude Code: det som er kjørt, det som står for tur, og det som er parkert.
Bakgrunn og beslutninger for kvitteringsimporten ligger i
`docs/kvitteringsimport-2026-09-11.md` — dette dokumentet er køen, ikke planen.

---

## Kjørt

| # | Hva | Commit |
|---|---|---|
| 1 | Kvitteringsimport del 1 — les kvitteringen fra bilde | `596d861` |
| 2 | Kvitteringsimport del 2 — oppslag mot Selfmade, import til lageret | `d3ca933` |
| 3 | Kvitteringsimport del 3 — kvitteringsbildet til Drive, snarvei i Innstillinger | `02a0940` + `47ebe89` |
| 4 | Etterfylling av produktnummer på gamle lagerrader | `6fa4a10` |
| 5 | Nedskalering av kvitteringsbilder i nettleseren + feilhåndtering av ikke-JSON-svar | `139ae6f` |
| 6 | Sporing av sharps native bibliotek inn i lesefunksjonen | `304846c` |

Prompt 1–3 står i sin helhet i `docs/kvitteringsimport-2026-09-11.md`.

**Etterfyllingen er kjørt i produksjon.** 163 rader totalt: 84 fikk produktnummer, 4 ga
HTTP 404 (siden er borte fra selfmade.com), 26 har URL til en annen butikk, 43 har tom
kilde. Tørrkjøring etterpå bekreftet: 90 har nummer, 4 igjen i Selfmade-gruppa.

**Vercel-lagringen er ryddet.** Functions Storage lå på 13,12 GB mot Hobby-grensa på
10 GB. Retention er låst til 30 dager på Hobby og kan ikke stilles. Løsningen ble å slette
gamle deployments manuelt fra dashbordet — nede i 5,71 GB. Hver deployment er ~430 MB
(~37 Node-ruter à 2,75 MB + fire Python-funksjoner à 82 MB), nå ~446 MB etter at
sharp-sporingen tok `/api/les-kvittering` fra 2,75 til 19,18 MB. Regnestykket er antall
deployments × buntstørrelse, så det som holder tallet nede er å pushe sjeldnere.

**Kvitteringslesingen virker i produksjon.** Bekreftet med en ekte 14-linjers kvittering:
summeringssjekken gikk opp, og oppslagene fant riktig vare på de fleste linjene.

---

## Kostnad per kvittering

Appen bruker `claude-sonnet-4-6` — $3 per million input-tokens, $15 per million output.

| Del | Tokens | Kost |
|---|---|---|
| Lese bildet (1 kall) | ~4 000 inn, ~1 500 ut | ~$0,03 |
| Oppslag mot Selfmade (13 kall) | ~65 000 inn, ~4 000 ut | ~$0,26 |
| **Sum** | | **~$0,29** (~3 kr) |

Anslag, ikke målt. Poenget er fordelingen: bildelesingen er nesten gratis, oppslagene er
hele kostnaden. Prompt C angriper nettopp den.

---

## Klar til kjøring

Rekkefølgen er valgfri. C er den som sparer mest penger, B er ti minutter, D er størst.

### B — Vis produktnummer, betalt pris og produktlenke på varen

Feltene lagres, men rendres ingen steder i varevisningen. 90 varer har produktnummer som
ikke er synlig.

````
Vis produktnummer, betalt pris og produktlenke på varen i lageret.

Del 2 av kvitteringsimporten la inn fire felter på `InventoryItemData`
(`inventory/page.tsx:40-43`): `produktUrl`, `produktnummer`, `betaltPris`,
`bilagsnummer`. De skrives både ved kvitteringsimport og av etterfyllingsjobben, men
rendres ingen steder i varevisningen — de vises bare inne i importmodalen. 90 varer har
nå produktnummer som ikke er synlig for meg noe sted.

## Ny seksjon

I detalj-/redigeringsvisningen i `src/app/dashboard/inventory/page.tsx`, rett etter
«6. Kilde»-seksjonen (:1694) og før «7. Tenkt til»: en ny seksjon **Produkt**, i samme
mønster som resten (`SectionHeading`, `inputCls`, `upd({...})`).

Innhold:

- **Produktnummer** — redigerbart tekstfelt, `d.produktnummer ?? ''`. Skal være
  redigerbart, ikke bare lesbart: for de fire varene der produktsiden ga 404, og for varer
  jeg har lagt inn for hånd, vil jeg kunne skrive nummeret inn selv.
- **Betalt pris** — redigerbart tekstfelt, `d.betaltPris ?? ''`. Det er en streng
  («142,56 kr»), ikke et tall — ikke gjør den om til et number-felt.
- **Åpne produktsiden** — en lenke, ikke et tekstfelt. Bruk `d.produktUrl`, og fall
  tilbake til `d.kilde` hvis den ser ut som en URL. Vis ingen lenke hvis ingen av dem er
  satt.
- **Bilagsnummer** — bare lesbar, liten grå tekst, og bare når feltet er satt. Den sier
  hvilken kvittering varen kom fra, og skal ikke kunne redigeres.

## Én ting å passe på

URL-en ligger nå to steder på de etterfylte radene: i `kilde` (der URL-importen la den) og
i `produktUrl` (der etterfyllingen la den). Ikke lag et eget redigerbart felt for
`produktUrl` — da får jeg to felter som viser samme URL og som kan komme i utakt.
Kilde-feltet er allerede redigeringsstedet. Den nye seksjonen viser bare lenka.

## Omfang

Bare detaljvisningen. Ikke endre kortene i lista, ikke endre badgen, ikke rør
importmodalen, og ikke legg til nye felter i `InventoryItemData`.

Ingen ny ren logikk her, så ingen nye tester — men de eksisterende skal fortsatt gå.

## Kontroll

Åpne en vare som kom fra kvitteringsimporten: produktnummer, betalt pris, lenke og
bilagsnummer skal alle stå der. Åpne en etterfylt vare: produktnummer og lenke skal stå,
betalt pris og bilagsnummer skal være tomme/skjulte. Åpne en vare med tom kilde: seksjonen
skal vises med tomme felter og ingen lenke, og jeg skal kunne skrive inn et produktnummer
og få det lagret.

`npm test`, `npx tsc --noEmit`, `npx eslint`. eslint-basislinja er 35 errors og 42
warnings, alle eldre enn dette arbeidet — ingen ny melding skal peke inn i det du har rørt.

git add . && git commit -m "Show product number, paid price and product link on inventory items"
````

### C — Lageroppslag først, filtrerte kandidater, og en vei inn uten nettkall

Tre endringer i samme flyt: oppslagsveien i kvitteringsimporten. Den første halverer
kostnaden på en typisk kvittering, de to andre fikser feil jeg har sett i bruk.

````
Tre endringer i oppslagsveien i kvitteringsimporten. Les
`docs/kvitteringsimport-2026-09-11.md` først, særlig «Fem feller i sammenligningen».

Bakgrunn: en kvittering med 14 linjer koster ~$0,29 i API-bruk, og ~90 % av det er
oppslagene mot selfmade.com — ett Claude-kall per unike produktnummer. De fleste linjene
på en typisk kvittering er varer jeg allerede har i lageret.

## 1. Slå opp i lageret før nettet

`erProduktnummerDuplikat` (`inventory/page.tsx:795`) sjekker allerede om produktnummeret
finnes i `eksisterendeVarer`. I dag brukes det bare til å la være å huke av raden — men
oppslaget mot nettet kjøres uansett.

Snu det: finnes produktnummeret i lageret, bygg radens produktdata fra den lagrede varen
(navn, kategori, underkategori, produktUrl, materiale, bredde, vekt, vask, krymp,
sertifisering, bilde) og hopp over nettkallet helt. Vis raden som funnet, med en egen
merking som sier at treffet kom fra lageret og ikke fra selfmade.com.

To ting som IKKE skal arves fra den lagrede varen:

- **Betalt pris** kommer alltid fra kvitteringen. Prisen endrer seg over tid — 9001 kostet
  142,95 i september 2025 og 159,95 i mai 2026.
- **Kjøpsdato og bilagsnummer** kommer fra denne kvitteringen, ikke fra den gamle raden.

Enhetsfeltet utledes av den lagrede varen: har den `mengde`, er den metervare; har den
`antall`, er den stykkvare. Har den ingen av delene, fall tilbake til nettoppslag.

Finnes nummeret flere ganger i lageret, bruk den nyeste raden.

## 2. Filtrer kandidatlista

`velgKandidat` i `src/lib/vareoppslag.ts` returnerer i dag `flereTreff` med HELE
trefflista når ingen kandidat er god nok. I praksis betyr det at jeg får 25 forslag der
ingen passer — for «Sateng fór petrol» (7029, som er fjernet fra butikken) fikk jeg en
liste med DMC-broderigarn og Gütermann-tråd. En `<select>` med 25 valg inne i tabellen i
modalen blir dessuten uleselig og lar seg ikke scrolle skikkelig.

Filtrer bort kandidater under terskelen FØR utfallet avgjøres:

- ingen kandidater over terskelen → `ikkeFunnet`
- én igjen → samme «klar vinner»-regel som i dag
- flere igjen → `flereTreff`, men bare med de filtrerte

Terskelen er allerede en parameter (`terskel = 0.7`). Ikke endre verdien, bare bruk den
til å filtrere også.

Behold reglene fra «Fem feller»: sammenligningen bruker de første 29 tegnene av
produktnavnet, og danske stavemåter skal fortsatt treffe.

## 3. «Legg inn fra kvitteringen»

I dag tilbyr `ikkeFunnet` bare «lim inn en URL» eller «hopp over». Det holder ikke for et
stoff som er utgått fra butikken — da finnes det ingen URL å lime inn, men jeg vil
fortsatt ha varen i lageret.

Legg til et tredje valg på rader med `ikkeFunnet` og `flereTreff`: legg inn varen med det
kvitteringen selv oppgir, uten noe nettkall. Da settes produktnummer, navn (slik det står,
avkuttet ved 29 tegn), betalt pris, kjøpsdato, kilde og bilagsnummer.

Kategorien vet kvitteringen ingenting om, så raden må ha en liten velger — Stoff,
Tilbehør eller Utstyr. Enheten utledes av kategorien: Stoff blir `mengde`, de andre
`antall`. Begge deler kan jeg rette etterpå i varevisningen.

Ikke gjett kategori fra navnet.

## Tester, ren logikk

- `velgKandidat` med kandidater der alle skårer under terskelen → `ikkeFunnet`
- med to over og tjue under → `flereTreff` med bare de to
- «klar vinner»-regelen uendret når kandidatene faktisk er gode
- enhetsutledning fra en lagret vare: `mengde` satt → metervare, `antall` satt →
  stykkvare, ingen av delene → nettoppslag
- at betalt pris og bilagsnummer kommer fra kvitteringen og ikke fra den lagrede varen

## Kontroll

Importer en kvittering med varer jeg har fra før. De radene skal vise treff fra lageret,
og fremdriftstelleren skal gå raskere fordi det ikke gjøres nettkall på dem. Tell hvor
mange oppslag som faktisk gikk mot nettet, og rapporter det.

En rad med et nummer som ikke finnes noe sted skal vise «ikke funnet» med tre valg — lim
inn URL, legg inn fra kvitteringen, eller hopp over — og ingen nedtrekksliste med
irrelevante forslag.

`npm test`, `npx tsc --noEmit`, `npx eslint`. eslint-basislinja er 35 errors og 42
warnings, alle eldre enn dette arbeidet.

git add . && git commit -m "Look up inventory before the network, filter weak candidates, and allow receipt-only rows"
````

### D — Lagre produktbilder permanent

`bilde`-feltet peker på Selfmades server. Når en produktside forsvinner, forsvinner
bildet — «Twill, navy» og «Blank sateng petrol» viser allerede alt-tekst i lageret.

````
Lagre produktbilder permanent i stedet for å peke på selfmade.com.

`bilde`-feltet på en lagervare inneholder i dag en URL til Selfmades server. Forsvinner
produktsiden, forsvinner bildet. Det har alt skjedd: «Twill, navy» og «Blank sateng
petrol» viser alt-tekst i lageret nå.

Appen bruker allerede Supabase Storage med bucketen `project-images` — se
`inventory/page.tsx:578-592` for mønsteret (opplasting med generert filnavn, så
`getPublicUrl`).

## 1. Ved import

Når en vare importeres og produktdataene har en bilde-URL: hent bildet server-side, last
det opp til `project-images`, og lagre DEN URL-en i `bilde`. Gjelder begge veier inn —
URL-importen (`apiImportFabric`-flyten) og kvitteringsimporten.

Filnavn i samme stil som det eksisterende: `inventory-<tidsstempel>-<tilfeldig>.<endelse>`.

Skaler ned til maks 800 px på lengste side før opplasting. Et produktbilde trenger ikke å
være større i denne appen, og det holder totalen nede.

**Bildelagringen skal aldri stoppe importen.** Feiler hentingen eller opplastingen, fall
tilbake til å lagre den opprinnelige URL-en slik som i dag, og si fra i grensesnittet at
bildet ikke ble lagret permanent. Ingen exception som ruller tilbake importen.

## 2. Etterfylling av eksisterende bilder

Samme mønster som «Etterfyll produktnummer»-seksjonen i Innstillinger, som allerede
finnes og virker: en seksjon med tørrkjøring først, rapport med navngitte grupper, og en
egen knapp for å skrive.

Grupper radene: bilde allerede i Supabase (hoppes over), bilde med ekstern URL (disse
hentes), ingen bilde. Tørrkjøringen skal si hvor mange det gjelder og hvilke URL-er som
ikke lenger svarer, FØR noe lastes opp.

Rader der den eksterne URL-en er død kan ikke reddes — de skal listes med navn så jeg kan
legge inn bilde manuelt.

Et bilde som forsvinner fra butikken er tapt for godt — «Twill, navy» og «Blank sateng
petrol» er allerede der. Det går sakte (to av 163 så langt), men det går én vei, så denne
jobben blir ikke billigere av å vente. Etterfyllingen skal hente ALLE eksterne bilder som
svarer, ikke bare dem fra Selfmade.

Kjøres sekvensielt med fremdriftsteller, samme mønster som `slaaOppAlle`.

## Omfang og størrelse

163 lagervarer, produktbilder på ~800 px blir 80–150 kB hver — altså 15–25 MB totalt.
Ikke bygg noe opplegg for opprydding av ubrukte bilder i denne omgangen; det finnes en
kjent hale på 42 foreldreløse bilder i bucketen fra før, og den tar jeg separat.

## Kontroll

Tørrkjør etterfyllingen og vis meg rapporten før du skriver noe. Etter skriving: åpne
«Twill, navy» og se at bildet vises igjen, og sjekk at `bilde` peker på
supabase.co og ikke på selfmade.com.

Importer så en ny vare fra URL og bekreft at bildet havner i Supabase med en gang.

`npm test`, `npx tsc --noEmit`, `npx eslint`. eslint-basislinja er 35 errors og 42
warnings, alle eldre enn dette arbeidet.

git add . && git commit -m "Store product images in Supabase Storage instead of hotlinking"
````

---

## Parkert

Ingen av disse har en prompt skrevet ennå.

**Arkivering av store kvitteringsbilder til Drive.** `/api/drive/upload` har samme 4,5 MB-
grense som lesingen. Appen har allerede `/api/drive/upload-session` (resumabel, nettleseren
PUT-er rett til Drive) som `recipes/page.tsx` bruker til store PDF-er. Samme vei må brukes
for kvitteringsbilder.

**De 43 radene med tom kilde.** Lim inn produkt-URL på dem som er fra Selfmade og kjør
etterfyllingen på nytt — den hopper over rader som allerede har nummer, så den kan kjøres
så mange ganger du vil.

**Fjerne «Etterfyll produktnummer»-seksjonen** fra Innstillinger når den er ferdig brukt.

**Angre import.** Billig å bygge: `importerFlereVarer` får de innsatte radene tilbake, og
hver importert rad bærer `bilagsnummer`. To nivåer: angre rett etter import i modalen, og
angre en tidligere import fra en liste gruppert på `bilagsnummer` + `created_at`. Slettingen
må vise navnene med avkryssing — tabellen har ingen `updated_at`, så koden kan ikke vite om
du har redigert en rad siden.

**Legge sammen duplikater i stedet for å lage nye rader.** Riktig nøkkel er
`produktnummer`, men `mengde` er et fritekstfelt i dag. Stoff må holdes som separate biter
(«1 m + 0,4 m», ikke 1,4 m), stykkvarer kan summeres — skillet ligger allerede i
`enhetsfelt`. Krever `biter?: { mengde, kjopsdato, betaltPris, bilagsnummer }[]`, og må
bygges FØR angring, ellers må angringen skrives om.

**Variantnumre.** Glidelåser: kvitteringen har 4074320, produktsiden oppgir basisnummeret
4074355. Etterfylte rader fikk basisnummeret, og duplikatsjekken sammenligner eksakt — en
glidelås kjøpt på nytt vil derfor ikke matche.

**Slå sammen de fire Python-funksjonene til én.** Vurdert og lagt bort 15.09: venv-en er
delt på tvers av alle Python-funksjonene i samme bygg, så per-funksjon-`requirements.txt`
gjorde buntene større, ikke mindre (148/137/137/145 MB mot 82 MB før). Eneste reelle knapp
er å redusere antall Python-funksjoner, men det er en omskriving av 2600 linjer PES- og
bildebehandlingskode med funksjonell risiko, og manuell sletting av deployments løste
lagringsproblemet uten å røre koden. Tas bare opp igjen hvis lagringen klatrer på nytt.
Branchen `vercel-python-bundles` kan slettes.

**Pushe sjeldnere.** Hver push er en deployment på ~446 MB. `git.deploymentEnabled` i
`vercel.json` kan slå av automatiske deployments for branchmønstre hvis det trengs en
teknisk sperre.
