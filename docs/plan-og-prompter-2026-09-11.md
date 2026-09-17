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
| 9 | Enhet utledes fra kategori når lagervaren mangler mengde/antall | `c68645c` |
| 10 | Produktbilder lagres permanent i Supabase Storage, med etterfylling | `3b71768` |
| 11 | Kategorien kan endres eller angres etter «legg inn fra kvitteringen» | `4c39ca6` |
| 12 | Angre import — rett etter, og for tidligere kvitteringer | `f07e7ec` |

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

Ingenting. Kvitteringsimporten er ferdig.

**Gjenstår å bekrefte selv:** klikkeflyten i angre-del 1 (importer, angre, importer på
nytt) og at kategorivelgeren kan byttes og angres. Begge er verifisert i logikken, ikke i
nettleseren.

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

**(Flyttet til prompt F — var aldri parkert av Maria.)** Angre import. Billig å bygge: `importerFlereVarer` får de innsatte radene tilbake, og
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

**Dubletter i lageret.** «Vevet jacquard med stretch og lurex sand» finnes som to rader
(den ene med død bilde-URL), og «Luksus bomullslerret» hadde samme mønster i
produktnummer-jobben. Verdt en opprydding en gang.

**`/api/lagre-produktbilde` har ingen autentisering** og bruker service role-nøkkelen til
å skrive til Storage. Den henter en URL du sender inn og legger bildet i bucketen. Samme
mønster som resten av API-rutene i appen, men denne skriver — så hvem som helst som finner
ruta kan fylle bucketen. Ikke akutt på en privat app, men verdt å vite.
