# Fontmåling 2026-08-13 — Steg A: kalibrering av grunnlinje mot ekte tegn

Engangsskript kjørt mot ekte stingdata for 20 tegn i SC Seraphine_Satin (2″) og 19 tegn i
BX FLORAL ALPHABET PINK (2″), hentet fra `broderi_motiv`-cachen (alle 39 rader lå allerede
cachet — ingen kall til `/api/broderi-motiv/parse` var nødvendig). Skriptene er slettet
etter kjøring, i tråd med planen.

**Konklusjon i én setning:** ingen enkelt (profil, terskel) fra {bredde, masse} × {0.2, 0.3,
0.4} gir riktig svar for alle tegn i begge fonter — og det er ikke en bug i målingen. Begge
fontene bryter forutsetningen «underlengde = smal hale under bred kropp» på hver sin måte,
verifisert visuelt under. Se anbefaling og åpne spørsmål til deg nederst.

---

## 0. Retning på +y — bekreftet, ikke antatt

Seraphine «j» (som har prikk adskilt fra kroppen — en god test) tegnet opp RÅTT, uten
noen y-flip: prikken havnet øverst (nær fil-y=0), halen/løkken nederst (nær fil-y=max).
Det er riktig vei for en «j». **+y er nedover, y=0 er toppen av fila.** Bekreftet på ett
tegn, stoler på det for resten.

## 1. Oppsett — tegn → embroideryId/sizeId

Seraphine: én rad (`b281888e…`) inneholder ALLE tommestørrelser i `sizes[]`; identitet og
tomme utledes per størrelse via `utledTomme(pesFilename)` — samme funksjon som
`tomme.ts` bruker i appen. Filtrert på tomme==«2». Alle 20 tegn (inkl. komma) fantes.

BX Floral: én rad per tegn. Versaler og tall har eksakt `sizeLabel: "2\""`. **Men
småbokstaver har INGEN eksakt 2″-etikett** — de er merket med spenn (`"1.5-2\""`,
`"2-2.5\""` osv.), noe `utledTommeFraSizeLabel` i `tomme.ts` allerede (riktig) avviser,
siden det ikke er en ren tommeangivelse. Dette er en ekte, eksisterende datakvirk i denne
bunten, ikke noe jeg har innført. Jeg valgte spennet **`"1.5-2\""`** (øvre grense = 2″) som
nærmeste representant for «2 tommer» — se høydene under, de stemmer godt overens med
versalhøyden (x-høyde ≈ 75 % av versalhøyde, rimelig for denne fonten). BX Floral har
ikke noe komma-tegn i biblioteket.

## 2. Full måletabell

Bredde = `max_x − min_x` per bånd (0,5 mm), masse = antall stingpunkter per bånd, begge
normalisert mot egen maks. Terskel-sveip {0,2 · 0,3 · 0,4}, vandring nedenfra.

| Tegn | Font | Høyde (mm) | bredde·0.2 | bredde·0.3 | bredde·0.4 | masse·0.2 | masse·0.3 | masse·0.4 | Fasit |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| H | Ser | 51.6 | 1.0 | 3.0 | 3.5 | 0.0 | 21.5 | 22.0 | ≤0.5 |
| O | Ser | 51.6 | 0.5 | 1.5 | 2.5 | 0.0 | 0.0 | 0.0 | ≤0.5 |
| A | Ser | 51.6 | 1.0 | 2.5 | 5.0 | 0.0 | 2.0 | 2.0 | ≤0.5 |
| o | Ser | 16.7 | 0.0 | 0.5 | 0.5 | 0.0 | 0.0 | 0.0 | ≤0.5 |
| c | Ser | 16.4 | 0.0 | 0.0 | 0.5 | 0.0 | 0.0 | 0.0 | ≤0.5 |
| e | Ser | 15.8 | 0.0 | 0.0 | 0.5 | 0.0 | 0.0 | 0.0 | ≤0.5 |
| x | Ser | 17.8 | 2.0 | 2.0 | 2.0 | 0.0 | 2.0 | 2.0 | ≤0.5 |
| z | Ser | 35.3 | 0.0 | 0.5 | 1.0 | 0.0 | 0.0 | 0.0 | ≤0.5 |
| l | Ser | 31.9 | 0.0 | 0.5 | 1.0 | 0.0 | 0.0 | 0.0 | ≤0.5 |
| 1 | Ser | 51.1 | 1.0 | **19.5** | **19.5** | 0.0 | 0.0 | 0.0 | ≤0.5 |
| i | Ser | 24.3 | 0.0 | 0.5 | 0.5 | 0.0 | 0.0 | 0.0 | ≤0.5 |
| g | Ser | 27.3 | 0.0 | 0.5 | 1.0 | 0.0 | 0.0 | 1.5 | >1.0 |
| p | Ser | 42.3 | **20.5** | **20.5** | **20.5** | 0.0 | 2.0 | **21.0** | >1.0 |
| y | Ser | 30.9 | 0.0 | 0.5 | 1.0 | 0.0 | 0.0 | 1.0 | >1.0 |
| q | Ser | 34.7 | 1.0 | 2.5 | 6.5 | 0.0 | 2.0 | 2.0 | >1.0 |
| j | Ser | 37.7 | 0.0 | 0.5 | 0.5 | 0.0 | 0.0 | 0.0 | >1.0 |
| f | Ser | 50.5 | 0.0 | 0.5 | 1.0 | 0.0 | 2.0 | 2.0 | — |
| Q | Ser | 51.6 | 0.5 | 1.5 | 3.5 | 0.0 | 0.0 | 0.0 | — |
| J | Ser | 51.7 | 0.5 | 1.5 | 2.5 | 0.0 | 0.0 | 0.0 | — |
| , | Ser | 12.1 | 0.0 | 0.5 | 0.5 | 0.0 | 0.0 | 0.0 | — |
| H | BX | 51.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.5 | 1.0 | ≤0.5 |
| O | BX | 50.8 | 1.0 | 1.5 | 2.5 | 1.0 | 1.0 | 1.5 | ≤0.5 |
| A | BX | 51.0 | 0.0 | 0.0 | 0.0 | 0.5 | 0.5 | 0.5 | ≤0.5 |
| o | BX | 38.2 | 0.0 | *)  | *)  | 0.5 | *)  | *)  | ≤0.5 |
| c | BX | 38.4 | 0.0 | 0.5 | 2.0 | 0.5 | 2.0 | 2.5 | ≤0.5 |
| e | BX | 38.4 | 0.0 | 0.5 | 2.0 | 1.5 | 2.5 | 2.5 | ≤0.5 |
| x | BX | 38.4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | ≤0.5 |
| z | BX | 38.2 | 0.5 | 0.5 | 0.5 | 1.0 | 1.0 | 1.5 | ≤0.5 |
| l | BX | 51.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.5 | ≤0.5 |
| 1 | BX | 51.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.5 | ≤0.5 |
| i | BX | 51.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.5 | ≤0.5 |
| g | BX | 51.1 | 0.5 | 0.5 | 1.0 | 0.5 | 1.0 | 1.0 | >1.0 |
| p | BX | 51.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.5 | 1.0 | >1.0 |
| y | BX | 50.9 | 1.0 | **1.5** | **6.0** | 1.0 | 1.5 | 3.5 | >1.0 |
| q | BX | 51.0 | 0.0 | 0.0 | 0.0 | 0.0 | 1.0 | 1.0 | >1.0 |
| j | BX | 51.0 | 0.0 | 0.5 | 0.5 | 0.5 | 1.0 | 1.0 | >1.0 |
| f | BX | 51.1 | 0.5 | 0.5 | 0.5 | 0.5 | 1.0 | 1.0 | — |
| Q | BX | 51.0 | 0.5 | 1.0 | 1.5 | 1.0 | 1.0 | 1.5 | — |
| J | BX | 50.9 | 0.0 | 0.0 | 0.5 | 0.0 | 0.5 | 0.5 | — |

\*) o (BX): 1.0 / 1.5 mm ved hhv. 0.3 og 0.4 — feiler også der.

**Fet** = de klareste, mest problematiske avvikene (omtalt under).

### Oppsummering, bestått/feilet per (profil, terskel):

| Profil | Terskel | Antall feil av 34 fasit-tegn |
|---|---|---:|
| bredde | 0.2 | 14 |
| bredde | 0.3 | 14 |
| bredde | 0.4 | 18 |
| masse | 0.2 | 13 |
| masse | 0.3 | 15 |
| masse | 0.4 | 15 |

Ingen kombinasjon er null. `masse`-profilen har i tillegg en katastrofal feilmodus (se
under) som gjør den uegnet uavhengig av terskel.

---

## 3. Hvorfor — visuell verifisering, ikke gjetning

Jeg tegnet opp rå stingdata for et utvalg tegn (samme metode som y-retning-sjekken) for å
forstå AVVIKENE, ikke bare telle dem.

**Seraphine er ikke en enkel skriftfont — det er en monogramstil med svinger som går under
grunnlinjen på VERSALENE.** `H` har en stor dekorativ løkke nederst til venstre som henger
tydelig under kryssstreken. `A` har tilsvarende en løkke nederst til venstre. `O` er en
skråstilt dobbel-oval der bunnen av skråstillingen naturlig blir spiss. `x` har krøllete
svingender i alle fire tuppene, også de to nederste. Dette er ikke støy — det er
bokstavenes faktiske design, og bredde-profilen fanger det korrekt: det ER mindre bredde
helt nederst på disse versalene, fordi det faktisk ER en svingtupp der, ikke fordi
algoritmen bommer.

**Seraphines EKTE underlengder («g», «q») bruker brede løkker, ikke tynne haler.** Det
motsatte av `f`/`Q`/`J`-risikoen planen advarte mot (krøll bredere enn kroppen) — her er
HELE underlengden en løkke nesten like bred som kroppen over. Det er derfor bredde-profilen
måler dem som nesten IKKE i det hele tatt (0,5 mm ved terskel 0,3, mot forventet >1 mm):
det er aldri noen tynn hale å oppdage, bredden endrer seg knapt fra kropp til løkke.

**«1» i Seraphine har en ekte, lang dekorativ svingtupp** — en tynn diagonal strek på
nesten 20 mm UNDER en liten løkke. Sjekket mot de andre sifrene (0–9, alle ~51 mm totalt,
altså ikke spesielt høye i seg selv) — «1» skiller seg ikke ut i totalhøyde, bare i hvor
mye av den høyden som er tynn hale. Dette er ikke en feilmåling; det er fontens faktiske
design, og reiser et reelt spørsmål: bør «1» behandles som om den HAR en underlengde (for
å holde løkken på linje med de andre sifrene), selv om et siffer «normalt» ikke har det?
Det er nettopp derfor planen kaller `f`/`Q`/`J` fontavhengige — «1» hører tydeligvis til
samme kategori i denne fonten, se anbefaling under.

**Seraphines «p» er en ekte, lang tynn diagonal hale** (til forskjell fra «g»/«q»s brede
løkker) — 20,5 mm dybde, stabilt på tvers av alle tre terskler. Se spørsmål 3 under.

**BX Floral er IKKE «rettere former» slik planen antok — det er en tett blomsterdekorert
font.** Hvert tegn er bygget av mange overlappende blomstermotiv langs hele
bokstavformen, også på steder som strukturelt ikke er del av kroppen (f.eks. helt nederst
på en «O»-krans, eller nederst på en «p»s stett). Dette skaper to motsatte feil:
- Falske positiver: en runding som «e»/«c»/«o» kan ha et hull mellom to blomsterklynger
  nederst, som midlertidig senker bredden/massen under terskelen før neste klynge tar over
  — leses som en (liten, uekte) underlengde.
- Falske negativer: en ekte underlengde som «p» er dekorert med blomster HELE veien ned,
  inkludert på selve stetten — bredden faller aldri nok til å krysse terskelen, og
  underlengden blir usynlig for målingen (0,0 mm målt, mot >1 mm forventet).

Ingen av disse to fontene er «lineære nok» til at én enkelt geometrisk terskel kan skille
strukturell grunnlinje fra dekorativ flourish. Det er ikke noe som kan tunes bort med et
annet tall i {0,2 · 0,3 · 0,4} — begge feilretningene finnes samtidig i BX Floral.

---

## 4. Svar på de tre spørsmålene dine

**a) Valgt profil og terskel, med tabell som viser at den holder for alle tegn i begge
fonter:** Den finnes ikke — se tabellen over. Ingen av de 6 kombinasjonene består. Det
nærmeste er **bredde-profil, terskel 0,3** (14 av 34 fasit-tegn feiler, ingen katastrofale
utslag). `masse`-profilen er verre totalt sett OG har en katastrofal feilmodus (Seraphine
H: 21,5–22,0 mm dybde på en bokstav uten underlengde — massen i to parallelle tynne
strøk med luft mellom er lavere enn massen i en tett kryssstrek eller et seriff-tungt
område lenger oppe, så vandringen når aldri opp gjennom «kroppen» før den er halvveis opp
i bokstaven). Anbefaler bredde-profil, ikke masse, uavhengig av terskelvalg.

**b) Hvilke tegn lot seg ikke måle:** Alle 39 lot seg måle (ingen tomme punktlister, ingen
enkelt-bånd-tegn). Det som IKKE lot seg gjøre, er å treffe fasiten for alle samtidig. 14
tegn ved bredde/0,3 avviker fra den antatte fasiten, alle med en identifisert, visuelt
bekreftet årsak (se punkt 3): Seraphine H, A, O, x, 1 (versal-svinger/svingtupper/tallets
egen hale — reelle trekk ved fonten, ikke feilmåling), Seraphine g, j, y (ekte
underlengder som bruker brede løkker og derfor måler grunnere enn 1 mm), BX Floral O, o,
g, p, q, j (blomsterdekor som enten later som underlengde der det ikke er noen, eller
skjuler en ekte underlengde under blomster hele veien ned).

**c) Henger Seraphines «p» virkelig ~26 mm under grunnlinjen ved 2″?** Målt dybde er
20,5 mm, stabilt uansett terskel (0,2/0,3/0,4 gir alle nøyaktig samme tall — et sterkt
tegn på at dette IKKE er en terskeleffekt, men en ekte, skarp overgang i formen). Visuell
kontroll bekrefter: «p» er en tynn diagonal strek som fortsetter godt under en liten løkke
øverst — se punkt 3. 20,5 mm er ikke identisk med v1s 26 mm, men samme størrelsesorden og
samme konklusjon: **ja, denne bokstaven har en ekte, uvanlig dyp hale**, det er ikke en
målefeil i verken v1 eller denne målingen. Avviket fra 26 til 20,5 mm skyldes trolig at v1
brukte en annen metode (gruppemedian, se punkt 1 i planens «Det v1-planen tar feil om») og
ikke denne bånd-baserte målingen.

---

## 5. Anbefaling — åpent spørsmål til deg før steg B

Planens eget kriterium («finnes det ÉN terskel og ÉN profil som gir riktig svar for ALLE»)
er ikke oppfylt, og planen sier selv at dette i så fall betyr at funksjonens FORM er feil
og må endres før den bygges inn. Jeg har IKKE endret formen på egen hånd — det er nettopp
beslutningen jeg legger fram her:

**Alternativ 1 — behold funksjonens form som spesifisert, bruk bredde/0,3 som standard.**
De 14 tegnene som avviker, går til manuell korreksjon i steg D (som uansett er bygget for
akkurat dette). Dette er den enkleste, mest forutsigbare veien, og feilene er små i
millimeter for de fleste (0,5–3 mm) bortsett fra Seraphine «1» (19,5 mm — bør trolig
korrigeres manuelt uansett terskel, siden ingen automatikk kan vite om et siffers
dekorative hale skal telle som underlengde).

**Alternativ 2 — utvid vernet (`maksAndel`) til også å fange «liten, men mistenkelig»
dybde**, ikke bare «dyp dybde». Løser ikke BX Florals falske negativer (p/q/j måler 0,0 mm
— vernet trigger aldri fordi det ikke er noen dybde å mistenke), og ville krevd en ny,
utestet regel jeg ikke har grunnlag for å foreslå tall til uten å gjette. Frarår dette nå.

Jeg anbefaler **alternativ 1**: ikke fordi målingen er perfekt, men fordi den beviselig er
riktig for det store flertallet av tegn (20 av 34), er FEIL av forståelige, dokumenterte
grunner for resten, og steg D — manuell korreksjon per tegn — er allerede planlagt for
nøyaktig denne situasjonen. Å prøve å konstruere en mer «robust» automatikk mot to fonter
som er så ulikt dekorert som disse, uten flere fonter å kalibrere mot, er å gjette en
løsning på et problem jeg ikke kan verifisere at løsningen faktisk løser.

Si fra hvordan du vil gå videre — alternativ 1, noe annet, eller om du vil se flere tegn
målt først — så går jeg videre til steg B når du har sagt ja.
