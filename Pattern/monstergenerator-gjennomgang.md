# Mønstergeneratoren — gjennomgang mot Aldrich

Notat til deg som jobber videre på `som-og-snitt/Pattern/`. Alt under er
kontrollert mot *Metric Pattern Cutting for Children's Wear and Babywear*,
Winifred Aldrich, 4. utgave (2009). Sidetallene viser til den trykte boka.
PDF-utgaven som ligger i Pattern/ er reflytet fra EPUB og har omtrent dobbelt
så mange sider — bok s. 38 tilsvarer PDF-side 75–76, bok s. 48 tilsvarer
PDF-side 96–98.

---

## 1. Ferdig lengde finnes ikke i boka

Appen ba brukeren skrive inn «ferdig lengde i cm» selv om størrelse allerede
var valgt. Det er ikke en kodefeil i vanlig forstand — det er et hull Aldrich
selv etterlater.

**Funn:**

- `finished length` forekommer tolv steder i boka, alltid som noe brukeren
  mater inn i konstruksjonen. Aldri som en oppgitt verdi.
- For jerseyblokken til baby (s. 24) lister boka opp «Measurements required to
  draft the blocks»: chest, across back, neck size, shoulder, scye depth, back
  neck to waist, arm length, wrist. Åtte mål — nøyaktig de samme åtte som står
  i `baby-kropp` i `plagg.ts`. Likevel krever steg `0–2 finished length` et
  niende mål som ikke står på lista.
- Samme mønster for T-skjorteblokken (s. 48): sju mål i eksempellista, og så
  `1–2 finished length` uten forvarsel.
- I sizing-kapittelet skiller Aldrich eksplisitt mellom kroppsmål og
  plaggmål, og plasserer plagglengder i sistnevnte kategori — informasjon som
  hører hjemme i postordrekataloger og nettbutikker, ikke i måltabellene.
  Størrelsessystemet bygger på høyde som primærdimensjon, med bryst-, midje-
  og halsvidde som sekundærdimensjoner. Lengde inngår ikke.
- Det eneste konkrete tallet i hele boka er i den klassiske skjørtblokken for
  ungjenter: «skirt length required, e.g. 54cm» for 158 cm høyde. Et eksempel,
  og selv der står det «required».
- Graderingskapittelet (s. ca. 367 i PDF-en) gir graderingsregler i mm for
  hvert eneste punkt på blokkene — men ingen for fallet. Det er ikke en glipp:
  fallet ligger ikke fast, så det kan ikke graderes.

**Konsekvens for koden:** feltet skal forhåndsutfylles med en utledet verdi,
ikke stå tomt og blokkere. Formlene som er valgt (`nakkeTilMidje +
midjeTilHofte + 1.5` for babyoverdel osv.) er ikke fra Aldrich — de er
konstruerte defaults. `+1.5`-varianten treffer 32,1 cm for str. 80, som
stemmer med den SVG-en som allerede var generert (bunnlinja lå på y = 32,00).

**Ett forbehold:** blokkene forankrer lengden ulikt i bokas ordlyd.

| Blokk | Ordlyd |
|---|---|
| Baby jersey, s. 24 | `0–2 finished length` — fra nakken |
| Baby vevd/kimono | `0–1 back neck to waist` … `1–2 extend to finished length` |
| T-skjorte, s. 48 | `0–1 back neck to waist plus 3cm; square down` … `1–2 finished length` |
| Klassisk skjorte | `1–2 neck to waist` … `1–3 finished length` — fra origo |

`babyblokk.ts` er utvetydig (`P[2] = { y: m.ferdigLengde }` fra punkt 0).
T-skjorteblokken merker segmentet `1–2`, ikke `0–2`. Ut fra diagrammet og
formuleringen «extend to finished length» i søsterblokken leses det som
totallengde fra nakken også der — men ordlyden er tvetydig, og `tskjorte.ts`
må bruke samme referansepunkt som babyblokken, ellers betyr feltet to
forskjellige ting i samme skjema.

---

## 2. Størrelsesfiltrering manglet

`stroelse` i `plagg.ts` var en visningsstreng (`'98–170'`), så ingenting kunne
sammenlignes mot valgt størrelse. Brukeren kunne velge T-skjorte (98–170) med
str. 80.

Løst med numeriske `minStr`/`maksStr` ved siden av visningsstrengen.

**Viktig:** overlapp mellom baby- og barnesystemet er riktig og skal beholdes.
Ved str. 80 er `baby-kropp` (56–92), `barn-kropp` (80–170) og `barn-bukse-1`
(80–170) alle gyldige samtidig. Aldrich lar de to systemene møtes i overgangen
fra baby til småbarn. Filteret skal skjule det ugyldige, ikke tvinge fram ett
enkelt valg.

---

## 3. Plaggnavnene var direkte oversettelser

Aldrichs «block» betyr grunnmønster — utgangspunktet du tilpasser videre til
et faktisk plagg. «Blokk» på norsk betyr ingenting for en som syr.

Navnene er lagt om til plaggnavn i klartekst, med `undertittel:
'Grunnmønster'` som grå undertekst. Id-ene er uendret.

**Én felle å kjenne til:** «body block» skal *ikke* bli «Body». På norsk er en
body et bodyplagg med trykknapper i skrittet — et konkret babyplagg som
sannsynligvis skal inn i appen senere. Aldrichs «body block» betyr overkroppen,
altså livet fra nakke til fall. Riktig ord er **Overdel**.

`flat` og `klassisk` er Aldrichs skille mellom flatkonstruksjon (enkle former,
forstykke ≈ bakstykke) og formkonstruksjon (tilpasset kroppen, med innsnitt).
Det skillet er reelt og beholdes — men som gruppeoverskrifter i katalogen, ikke
i hvert enkelt navn.

### Navneregelen

Katalogen inneholder langt flere blokker enn appen kan generere. De fleste står
som `status: 'katalogisert'` og dukker ikke opp i nedtrekksmenyen ennå. Navnene
settes likevel for alle, slik at en blokk får riktig navn i det øyeblikket den
kodes. Følg disse fire punktene når nye blokker legges til:

1. Navnet er plagget på klarnorsk, slik en som syr ville sagt det
2. `undertittel: 'Grunnmønster'` bærer informasjonen om at det er et
   utgangspunkt, ikke et ferdig snitt
3. Ordene «blokk» og «body» forekommer aldri i et brukervendt navn
4. Konstruksjonsmetode (flat/klassisk) og målgruppe hører til i grupperingen,
   ikke i navnet — unntatt når to blokker ellers ville hett det samme, som
   «Skjørt» og «Skjørt, formsydd»

### Gjeldende navn

| id | navn |
|---|---|
| baby-kropp | Overdel, baby |
| baby-yttertoy | Jakke og yttertøy, baby |
| baby-bukse | Bukse, baby |
| baby-heldress | Heldress |
| barn-kropp | Overdel og skjorte |
| barn-kropp-ermelos | Ermeløs overdel |
| barn-tskjorte | T-skjorte |
| barn-bukse-1 | Bukse uten sidesøm |
| barn-bukse-2 | Bukse med sidesøm |
| barn-skjort | Skjørt |
| barn-jeans | Jeans |
| barn-pyjamas | Pyjamas |
| barn-hette | Hette |
| barn-klassisk-skjort | Skjørt, formsydd |
| barn-klassisk-bukse | Bukse, formsydd |
| barn-skjorte | Skjorte, formsydd |
| barn-yttertoy | Jakke og kåpe |
| barn-livdel | Livdel |
| barn-erm-1 | Erme, ettdelt |
| barn-erm-2 | Erme, todelt |
| ungjente-livdel | Livdel, ungjente |
| ungjente-jakke | Jakke og yttertøy, ungjente |
| ungjente-bukse | Bukse, ungjente |
| ungjente-skjort | Skjørt, ungjente |
| dame-skjort | Skjørt |
| dame-bukse | Bukse |
| dame-livdel-tett | Livdel, tettsittende |
| dame-livdel-romslig | Livdel, romslig |
| dame-jakke | Jakke, skreddersydd |
| dame-kaape | Kåpe |
| dame-erm-1 | Erme, ettdelt |
| dame-erm-2 | Erme, todelt |
| dame-bukse-romslig | Bukse, romslig |
| dame-skjorte | Skjorte |
| dame-tskjorte | T-skjorte og joggedress |
| dame-strikk | Genser til strikk |

Merk at `plagg.ts` i repoet og den versjonen som ble gjennomgått her har glidd
fra hverandre — blant annet er `barn-tskjorte` oppgitt som 80–170 i den ene og
98–170 i den andre. Sjekk hvilke id-er som faktisk finnes før du endrer noe.

---

## 4. Terminologi: dansk og tvetydigheter

**`ærmegab` er dansk.** «Ærme» er dansk for erme. På norsk heter hullet
**ermegap**. Rettet gjennomgående: `aermegabDybde` → `ermegapDybde`,
`aermegabOmkrets` → `ermegapOmkrets`, `aermegabLengde` → `ermegapLengde`,
og «Ærmegabdybde» → «Ermegapdybde» i grensesnittet.

**`skjortlengde` kolliderte med seg selv.** Den ble brukt om skjørt, men uten ø
er den ikke til å skille fra skjortelengde. Endret til `skjoertelengde`, slik
at `skjortelengde` står ledig til skjorte. Følger konvensjonen som allerede
fantes i `haandledd` og `stoerrelser` (ø→oe, å→aa).

Videre: `bodyRise` → `skrittdybde`, `hoyde` → `hoeyde`, `nakkehoyde` →
`nakkehoeyde`.

---

## 5. Skulderklaffen er ikke implementert

`VID_HALS = { utvid: 2, senk: 1 }` i `babyblokk.ts` utvider og senker halsen —
men konstruerer ingen klaff. Avkrysningsboksen het likevel «Vid hals med
skulderklaff», altså feilmerket. Teksten er endret til «Vid hals (bok s.38)»
inntil klaffen faktisk er kodet.

**Hva det er:** den kryssende klaffen over begge skuldre på en babybody, ofte
kalt *envelope neck* eller *lap shoulder*. Babyer har stort hode i forhold til
halsen, så klaffene lar halsåpningen sprette opp når plagget dras over hodet,
og legge seg flatt igjen etterpå. Nødvendig i vevd stoff, valgfritt i jersey
med god strekk.

Referansefoto: `Pattern/skulderklaff.jpg`, kopiert til
`public/pattern/skulderklaff.jpg` fordi Next.js bare serverer fra `public/`.

**Konstruksjonen (bok s. 38, kapittel 3, «9 Tee shirts»):**

1. Senk for- og bakhals ca. 1 cm, utvid ca. 2 cm, tegn nye halskurver
2. A = nytt halspunkt, B = skulderpunkt
3. Kvadrer ut fra A; kvadrer opp fra B til C
4. D = halve B–C. E markeres på ermegapet, ca. 2,5 cm fra B
5. D–F = D–E (F speiles om D). F–G = 0,5 cm
6. Tegn klaffen A–G og B–G. Både for- og bakstykke får klaffen

Boka begrunner det slik: de fleste T-skjorter til baby konstrueres for å gå
lett over hodet, og vid hals med ombrettede klaffer ved skulderen er en vanlig
halsløsning.

---

## 6. Mønster for referansebilder

Det er innført et valgfritt felt `illustrasjon?: string` på Blokk (og på
halsvalget), som peker på en fil under `public/pattern/`. Flere referansebilder
kan dermed kobles på senere uten ny kode. Klikk på teksten åpner bildet i samme
visning som «Vis måldiagram» bruker.

---

## Kort oppsummert

Koden gjenga Aldrich korrekt. Problemene lå tre andre steder: boka etterlater
et hull (ferdig lengde), oversettelsen var for direkte (blokknavn, dansk
terminologi), og én funksjon var merket som implementert uten å være det
(skulderklaffen). Ingenting av dette krevde at konstruksjonsformlene ble rørt.
