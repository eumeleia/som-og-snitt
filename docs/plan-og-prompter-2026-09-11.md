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
| 7 | Produktnummer, betalt pris og produktlenke synlig på varen | `b9c2869` |
| 8 | Lageroppslag før nettet, filtrerte kandidater, «legg inn fra kvitteringen» | `d8c56bb` |

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

Bare D står igjen.

**Gjenstår å bekrefte i nettleseren fra C (`d8c56bb`):** at rader med varer du har fra før
viser treff fra lageret og ikke gjør nettkall, at fremdriftstelleren går raskere, og at
«legg inn fra kvitteringen» faktisk lagrer en rad. Klientlogikken er typesjekket og
byggeklossene er testet, men klikkeflyten er ikke kjørt.

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
