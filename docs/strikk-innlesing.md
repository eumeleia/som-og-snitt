# Lese inn strikkeoppskrifter

Fast instruks for Claude Code når Maria ber om å «lese inn nye strikkeoppskrifter».
Uttrekket gjøres lokalt av Claude Code. Claude-API-et og `ANTHROPIC_API_KEY` brukes ikke,
verken i appen eller her.

Maria laster opp PDF-en i appen og fyller selv inn navn og hvem oppskriften er ment for.
Alt som ikke er godkjent, er merket «Venter på Claude Code» i appen. Når hun ber om det,
leser Claude Code oppskriftene inn, kontrollerer dem mot PDF-en og godkjenner dem (steg 1–7).
Maria går ikke gjennom oppskriftene selv; bare det som er reelt uklart i selve PDF-en, blir
stående til henne med grunnen.

## Hva som leses inn

Oppskrifter i `strikk_oppskrift` med status `pending` («Ikke lest») eller `failed`
(«Feilet»). Godkjente (`approved`) og allerede leste (`extracted`, «Til gjennomgang»)
røres ikke. Skriptene velger aldri dem, og `strikk_save_extraction` nekter å endre
godkjente.

PDF-en leses fra `strikk/Strikkeoppskrifter ryddet/`. En oppskrift som er lastet opp i appen,
ligger bare i Disk; `prepare.mjs` henter den da dit selv, med det kortvarige Disk-tokenet appen
deler ut (`/api/strikk/token`). Navn og målgruppe Maria har fylt inn, gjelder: lagringen
beholder målgruppen hennes, og tittelen endres ikke av innlesingen.

## Forutsetninger

- `.env.local` med `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` og
  `SUPABASE_SERVICE_ROLE_KEY`.
- Migrering 016 er kjørt (målgruppene `interior` og `other`).
- Migrering 017 er kjørt (garnkatalogen `strikk_yarn` og koblingene fra garnlinjene).
- Migrering 018 er kjørt (restegarnmerket `mentions_leftover` på oppskriftene).

## Fremgang

1. **Fullfør en avbrutt runde.** Finnes det mapper under `strikk/innlesing/runde-*` med
   `svar.json` uten `lagret.json`, lagre dem først (steg 4).
2. **Klargjør neste runde på 20:**
   ```
   node --no-warnings --env-file=.env.local scripts/strikk/prepare.mjs
   ```
   Skriptet lager `strikk/innlesing/runde-N/` med `INSTRUKS.md` (lesereglene, alle
   rettelsene fra `strikk_extraction_correction` og skjemaet) og én mappe per oppskrift med
   `meta.json`, `tekst.txt` (alle sider) og `side-N.png` for sider uten tekstlag.
3. **Les oppskriftene.** Del runden på underagenter, for eksempel fire med fem oppskrifter
   hver. Hver agent leser `INSTRUKS.md` og, for hver oppskrift, `meta.json`, `tekst.txt` og
   bildene, og skriver `svar.json` i oppskriftens mappe. Svaret følger skjemaet nøyaktig.
   Rettelsene er rettesnor: samme type situasjon leses på samme måte. Verdier hentes bare
   fra PDF-en. Det som er usikkert, føres i `uncertain` med en kort grunn på norsk.
4. **Sjekk og lagre:**
   ```
   node --no-warnings --env-file=.env.local scripts/strikk/save.mjs strikk/innlesing/runde-N --dry-run
   node --no-warnings --env-file=.env.local scripts/strikk/save.mjs strikk/innlesing/runde-N
   ```
   Svar som ikke følger skjemaet, lagres ikke. Rett dem og kjør på nytt. Lagrede oppskrifter
   får status «Til gjennomgang».

   `save.mjs` setter også **restegarnmerket**: finnes ordene restegarn, restgarn,
   garnrester, rester, leftover, left-over eller scrap yarn i `tekst.txt`, får oppskriften
   `mentions_leftover = true` og ordene rundt som `leftover_note`; ellers `false`. En PDF uten
   tekstlag får ikke noe merke (`null`). Oppskrifter som mangler merket, sjekkes med
   ```
   node --no-warnings --env-file=.env.local scripts/strikk/leftover.mjs
   ```
   som leser de lokale PDF-ene (`--all` sjekker alle på nytt). At en oppskrift har minst tre
   farger som hver trenger under to nøster, regner appen ut selv fra mengdene.
5. **Gjenta** steg 2–4 til `prepare.mjs` sier at det ikke er noe igjen.
5b. **Kontroller og godkjenn oppskriftene.** Alle kommandoene kjøres som
   `node --no-warnings --env-file=.env.local scripts/strikk/check.mjs <kommando>`.
   1. `prepare` legger hver oppskrift «Til gjennomgang» i `strikk/innlesing/kontroll/<id>/`
      (`data.json`, `meta.json`) med `INSTRUKS.md` fra `scripts/strikk/recipe-check.md`,
      lesereglene og alle Marias rettelser.
   2. **Kontroller** med underagenter, for eksempel fire med fem oppskrifter hver, gruppert
      etter designer. Hver sjekker hvert felt mot alle sidene i PDF-en og skriver
      `kontroll.json`, og kjører `check` på den til den svarer `ok`.
   3. Les rapportene. Et felt som fortsatt er usikkert fordi en side mangler eller tallene
      spriker, betyr `approve: false`; rett det i `kontroll.json` om en agent har godkjent
      likevel. Kontroller selv noen tilfeldige oppskrifter mot sidene.
   4. `save --dry-run`, så `save`. Godkjente får merkene fjernet; resten lagres med merkene og
      står «Til gjennomgang» til Maria. Rettelsestabellen skrives aldri herfra: den er
      Marias egne rettelser, som neste innlesing lærer av.
6. **Garnkatalogen.** Nye garn fra oppskriftene skal inn i katalogen på samme måte som
   resten. Katalogen er skjult: den har ingen side i appen, men ligger i databasen
   (`strikk_yarn`) og i arket Garn i Strikkeoversikt.xlsx. Maria går ikke gjennom garnene;
   Claude Code kontrollerer og godkjenner dem selv (punkt 9). Alle kommandoene kjøres som
   `node --no-warnings --env-file=.env.local scripts/strikk/yarns.mjs <kommando>`.
   1. `link` kobler alle garnlinjer og garnalternativer (også i godkjente oppskrifter) til
      garn som allerede er i katalogen. Bare de tre koblingsfeltene endres.
   2. `collect` skriver skrivemåtene som ikke finnes i katalogen ennå til
      `strikk/garn/kandidater.json`, med oppskriftene de står i, designer, de andre garnene i
      oppskriften og det oppskriften selv oppgir om garnet.
   3. **Grupper** kandidatene i `strikk/garn/grupper.json`: én rad per garn,
      `{brand, name, aliases: [{brand, name, certain, reason}]}`, med produsentens egen
      skrivemåte som `brand`/`name` og alle skrivemåtene fra oppskriftene som `aliases`
      («Peer Gynt» og «Sandnes Garn Peer Gynt» er samme garn). En skrivemåte uten
      produsent som er plassert ut fra designer eller de andre garnene i oppskriften, får
      `certain: false` og en grunn. Generiske «garn» («restegarn», «DK-garn», «tynt
      mohairgarn») får en rad `{generic: true, aliases: [...]}` og kommer ikke i katalogen.
      Se over grupperingen før neste steg.
   4. `create strikk/garn/grupper.json` legger garnene inn som utkast («Ikke slått opp»).
      Er garnet der fra før, legges bare skrivemåtene til.
   5. `prepare` lager neste runde på 20 i `strikk/garn/runde-N/`, med `INSTRUKS.md` (fra
      `scripts/strikk/yarn-lookup.md`, med skjemaet) og én mappe per garn med `meta.json`.
      Garn som ligger i en runde som ikke er lagret, velges ikke igjen, så flere runder
      kan klargjøres og slås opp samtidig.
   6. **Slå opp** med underagenter, for eksempel fire med fem garn hver. De bruker egne
      verktøy for nettsøk og nettlesing, oppskriftenes tall først, så produsenten, og for
      utgåtte garn en annen pålitelig kilde. Hver skriver `svar.json` i garnets mappe.
   7. `save strikk/garn/runde-N --dry-run`, så `save strikk/garn/runde-N`. Godkjente garn
      endres aldri. Lagrede garn får status «Til godkjenning».
   8. Gjenta 5–7 til `prepare` sier at det ikke er noe igjen, og kjør `link`.
   9. **Kontroller og godkjenn.** `verify-prepare` legger hvert garn som ikke er godkjent i
      `strikk/garn/kontroll/<id>/garn.json`, med `INSTRUKS.md` fra
      `scripts/strikk/yarn-check.md`. Underagenter kontrollerer hvert garn mot produsentens
      side og skriver `kontroll.json`; del garnene etter produsent, så samme nettsted ikke får
      spørsmål fra flere agenter samtidig. `verify-save --dry-run`, så `verify-save`,
      lagrer rettelsene og setter garnet til «Godkjent». Til slutt `link` og `status`, som
      viser antall garn og hvor mange linjer som er koblet, usikkert koblet, generiske og
      ikke koblet.

   **Utgåtte garn.** `discontinued` settes bare når en kilde sier rett ut at garnet er
   utgått. Et utgått garn foreslås aldri som alternativ. Er det originalgarnet i en
   oppskrift, beholder det koblingen og merkes «(utgått)» i regnearket, og alternativene
   viser oppskriftens egne alternativer som ikke er utgått, eller, om ingen er igjen, inntil
   tre garn fra katalogen med samme hovedfiber og tykkelse (`substitutes` i
   `src/app/strikk/_lib/yarns.ts`). Alternativer som ikke er koblet til katalogen, har ukjent
   status og vises som før.
7. **Avslutt** med antall lagret per runde, hvor mange som ble godkjent og hvilke som står
   igjen til Maria med grunnen, nye garn i katalogen, tallene fra `yarns.mjs status`, og
   listen i `strikk/innlesing/mangler-alle.json` over oppskrifter som ikke kunne hentes.

Blir arbeidet stoppet, starter neste økt på steg 1. Det som er lagret, er «Til gjennomgang»
og velges ikke igjen. For garn: mapper i `strikk/garn/runde-*` med `svar.json` uten
`lagret.json` lagres først, og garn som er slått opp, velges ikke igjen. I
`strikk/garn/kontroll/` lagres mapper med `kontroll.json` uten `godkjent.json` først, og i
`strikk/innlesing/kontroll/` mapper med `kontroll.json` uten `lagret.json`.

`strikk/innlesing/` og `strikk/garn/` er i `.gitignore` og skal ikke committes.
