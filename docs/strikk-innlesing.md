# Lese inn strikkeoppskrifter

Fast instruks for Claude Code når Maria ber om å «lese inn nye strikkeoppskrifter».
Uttrekket gjøres lokalt av Claude Code. Claude-API-et og `ANTHROPIC_API_KEY` brukes ikke,
verken i appen eller her.

## Hva som leses inn

Oppskrifter i `strikk_oppskrift` med status `pending` («Ikke lest») eller `failed`
(«Feilet»). Godkjente (`approved`) og allerede leste (`extracted`, «Til gjennomgang»)
røres ikke. Skriptene velger aldri dem, og `strikk_save_extraction` nekter å endre
godkjente.

PDF-en hentes fra `strikk/Strikkeoppskrifter ryddet/`. Nye oppskrifter som er lastet opp i
appen, ligger bare i Disk. Be Maria legge PDF-en i den mappa først, ellers havner den på
listen over manglende PDF-er.

## Forutsetninger

- `.env.local` med `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` og
  `SUPABASE_SERVICE_ROLE_KEY`.
- Migrering 016 er kjørt (målgruppene `interior` og `other`).

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
5. **Gjenta** steg 2–4 til `prepare.mjs` sier at det ikke er noe igjen.
6. **Avslutt** med antall lagret per runde, og listen i `strikk/innlesing/mangler-alle.json`
   over oppskrifter uten lokal PDF.

Blir arbeidet stoppet, starter neste økt på steg 1. Det som er lagret, er «Til gjennomgang»
og velges ikke igjen.

`strikk/innlesing/` er i `.gitignore` og skal ikke committes.
