# Oppslag av garn til garnkatalogen

Slå opp hvert garn i denne mappa og skriv svaret som `svar.json` i garnets mappe. Bruk bare
egne verktøy for nettsøk og nettlesing. Claude-API-et og `ANTHROPIC_API_KEY` brukes ikke.
Ingenting skrives til databasen, det gjør `yarns.mjs save` etterpå.

For hvert garn står `meta.json`: produsent og navn, skrivemåtene garnet har i oppskriftene,
det oppskriftene selv oppgir om garnet (`pattern_data`), og hvilke oppskrifter det brukes i.

## Rekkefølge

1. **Oppskriftene først.** Står løpelengde, vekt eller fiber i `pattern_data` og er tallene
   samstemte, bruk dem og før kilden som `oppskrift: <tittel>` i `field_sources`.
2. **Produsenten.** Slå opp resten hos produsenten (offisiell side for garnet). Den gir som
   regel fiber, vekt og løpelengde per nøste, strikkefasthet og pinne. `source_kind` er
   `manufacturer`, `source_url` lenken til garnsiden.
3. **Utgått garn.** Finnes garnet ikke lenger hos produsenten, sett `discontinued: true` og
   bruk en annen pålitelig kilde: en garnbutikk (`retailer`), Ravelry eller et arkiv
   (`other`). Si i `source_note` hvorfor.
4. **Produsenten er ikke alltid sikker.** Står `brand` tomt, finn produsenten. Har garnet en
   skrivemåte uten produsent i `aliases`, er produsenten utledet fra oppskriften: sjekk at
   garnet finnes hos den produsenten, og rett `brand` hvis ikke. Finner du ikke garnet i
   det hele tatt, la feltene stå tomme og før dem i `uncertain`.
5. **Ett oppslag per garn.** Garnet slås opp én gang her; slå ikke opp de andre garnene i
   runden for å sammenligne.

## Feltene

- `brand`, `name`: produsentens egen skrivemåte (f.eks. «Sandnes Garn», «Peer Gynt»). Rett
  opp skrivefeil fra oppskriftene; den gamle skrivemåten tas vare på som alias.
- `fibers`: hver fiber med prosent, med norske navn der det er naturlig (ull, merinoull,
  alpakka, mohair, silke, bomull, lin, viskose, polyamid, nylon, akryl, polyester, elastan).
- `skein_weight_g`, `meterage_m`: per nøste.
- `gauge_stitches_min/max`: anbefalt strikkefasthet i masker per 10 cm i glattstrikk. Én
  verdi: samme tall i begge. `needle_mm_min/max`: anbefalt pinne i mm på samme måte.
- `drops_group`: A–F bare for DROPS-garn (Garnstudio), ellers "".
- `field_sources`: én rad per felt du fylte, med lenke eller `oppskrift: <tittel>`.
- `uncertain`: hvert felt du ikke fant eller er usikker på, med kort grunn på norsk
  («Ikke oppgitt hos produsenten», «To ulike tall på siden»). Ikke fyll et felt ut fra
  kunnskap om lignende garn; la det stå 0 eller "" og før det her.

Sjekk hvert svar før du er ferdig, og rett til den svarer `ok`:

```
node --no-warnings --env-file=.env.local scripts/strikk/yarns.mjs check strikk/garn/runde-N/<id>/svar.json
```
