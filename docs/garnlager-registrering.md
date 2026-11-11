# Registrere garnlageret fra bilder

Fast instruks for Claude Code når Maria ber om å «registrere garnlageret» eller legger nye
bilder i `strikk/garnbilder/` og ber om at de leses inn. Uttrekket gjøres lokalt av Claude
Code — ved å se på bildene selv, ikke via noen bildegjenkjenningstjeneste. Claude-API-et og
`ANTHROPIC_API_KEY` brukes ikke, verken i appen eller her.

Maria tar bildene og legger dem i `strikk/garnbilder/`. Ett bilde kan vise mange garn.
Bilder tatt like etter hverandre (samme filnavn-rekkefølge) hører som regel til samme kasse
eller haug: først ett eller flere nærbilder av banderolen, så et oversiktsbilde der nøstene
ligger ved siden av hverandre og kan telles. Bruk nærbildene til å kjenne igjen garnet og
fargen i oversiktsbildet — ikke les mer ut av dem enn det. Maria går ikke gjennom bildene
selv; alt som faktisk er uklart i bildet, merkes usikkert med en kort grunn og blir stående
til henne i Garnlager.

## Forutsetninger

- `.env.local` med `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` og
  `SUPABASE_SERVICE_ROLE_KEY`.
- Migrering 024 er kjørt (`strikk_yarn_stash` og miniatyrbøtta).
- Garnkatalogen (`strikk_yarn`, migrering 017) er fylt — nye garn som ikke finnes der,
  legges inn som utkast i `save`-steget, se punkt 6 i `docs/strikk-innlesing.md`.

## Fremgang

1. **Konverter bildene** til små JPEG-kopier Claude Code kan se på:
   ```
   node --no-warnings --env-file=.env.local scripts/strikk/stash.mjs convert
   ```
   Skriver til `strikk/garnlager-arbeid/bilder/`. Hopper over bilder som alt er konvertert,
   så nye bilder senere bare legger til resten.
2. **Klargjør runder** på bilder som ikke er tatt med i en runde fra før:
   ```
   node --no-warnings --env-file=.env.local scripts/strikk/stash.mjs rounds --all
   ```
   Lager `strikk/garnlager-arbeid/runde-NN/` i filnavn-rekkefølge, med `INSTRUKS.md` (denne
   fila) og `manifest.json` (bildene i runden). Hver runde etter den første gjentar siste
   bilde fra forrige runde som sitt første bilde — det bildet skal IKKE telles på nytt, det
   er bare til å kjenne igjen om haugen fortsetter. Utelat `--all` for å lage én runde om
   gangen; `--size N` endrer antall nye bilder per runde (20 er standard).
3. **Se gjennom hver runde**, gjerne én underagent per runde. For hvert bilde i
   `manifest.json`, i rekkefølge:
   - Les banderolen: merke (`brand`) og garnnavn (`name`) — slå dem opp mot garnkatalogen
     (`strikk_yarn`, spør databasen, gjett aldri) og bruk produsentens egen skrivemåte.
     Finnes garnet ikke i katalogen, bruk skrivemåten fra banderolen; det legges inn som
     utkast når runden lagres.
   - Fargenummer (`color_number`) og fargenavn (`color_name`) — bare det som faktisk står
     på banderolen eller synes i bildet. Mangler det, la feltet stå tomt.
   - **Tell nøstene** i oversiktsbildet. Et nøste som opptrer i flere bilder i samme haug,
     telles bare én gang — bruk nærbildene og posisjonen til å se at det er de samme
     nøstene, ikke flere. Et nøste som er påbegynt, går i `leftover_g` (anslå gram) i stedet
     for i `skein_count`; har haugen både hele og ett påbegynt nøste av samme garn og farge,
     er det ett funn med begge feltene fylt ut.
   - Dukker samme garn og fargenummer opp igjen MYE senere i rekkefølgen (en annen kasse,
     ikke et bilde i samme haug), er det et NYTT funn — et ekstra antall av garnet, ikke en
     duplikatregistrering.
   - Skriv ett funn per garn og farge til runden sin `funn.json` (en liste), med feltene i
     skjemaet under. `images` er alle bildene (originalt filnavn, f.eks. `IMG_3850.HEIC`) som
     viser akkurat dette garnet i denne haugen. `thumbnail_image` er det bildet som viser
     garnet og fargen tydeligst — vanligvis oversiktsbildet.
   - Alt du er usikker på — garnet, fargen eller antallet — i `uncertain`, med en kort norsk
     grunn. Ikke gjett.
4. **Sjekk og lagre:**
   ```
   node --no-warnings --env-file=.env.local scripts/strikk/stash.mjs check strikk/garnlager-arbeid/runde-NN/funn.json
   node --no-warnings --env-file=.env.local scripts/strikk/stash.mjs save --dry-run
   node --no-warnings --env-file=.env.local scripts/strikk/stash.mjs save
   ```
   `save` uten mappe tar alle runder som ikke er lagret ennå. Den lager et miniatyrbilde
   (under 50 kB) av `thumbnail_image`, legger garn som ikke fantes i katalogen inn som
   utkast, og setter hver rad til «Til gjennomgang» i Garnlager.
5. **Avslutt** med `status`-tallene og hvor mange nye garn som ble lagt i katalogen som
   utkast (de har ikke fiber, løpelengde osv. ennå — se `docs/strikk-innlesing.md` punkt 6
   for oppslag, om Maria ber om det).

## Skjema for funn.json

Se `FINDING_SCHEMA` i `src/app/strikk/_lib/stash.ts`; `stash.mjs rounds` skriver det inn i
hver runde sin `INSTRUKS.md` automatisk.

Blir arbeidet stoppet, starter neste økt på steg 2: runde-mapper med `funn.json` men uten
`lagret.json` lagres først (steg 4), og bilder som alt er tatt med i en runde, velges ikke
igjen uansett om runden er lagret.

`strikk/garnbilder/` og `strikk/garnlager-arbeid/` er i `.gitignore` og skal ikke committes.

## Gjennomgang i appen

Garn «Til gjennomgang» ligger øverst i Strikk › Garnlager, med miniatyrbildet og usikre felt
markert. Maria kan rette, slå sammen to rader som er samme garn og farge, slette og godkjenne
derfra. Bare godkjent garn telles med i «Hva vil du strikke?».
