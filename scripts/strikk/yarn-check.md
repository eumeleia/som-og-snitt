# Kontroll av garn i garnkatalogen

Hvert garn i denne mappa er slått opp én gang. Nå skal det kontrolleres før det godkjennes.
Maria går ikke gjennom garnene selv, så denne kontrollen er den som gjelder. Bruk bare egne
verktøy for nettsøk og nettlesing. Claude-API-et og `ANTHROPIC_API_KEY` brukes ikke, og
ingenting skrives til databasen (det gjør `yarns.mjs verify-save`).

`garn.json` har dagens data i `current` (samme format som svaret), skrivemåtene i
oppskriftene (`aliases`), hva oppskriftene selv oppgir (`pattern_data`) og hvor garnet brukes.

## Slik kontrollerer du ett garn

1. **Produsentens side først.** Finn produsentens egen side for garnet, også når
   `source_url` peker til en butikk eller Ravelry. Sammenlign hvert felt: fiber med prosent,
   vekt og løpelengde per nøste, strikkefasthet, pinne og DROPS-gruppe.
2. **Stemmer feltet**, behold det, og før produsentens lenke i `field_sources`.
3. **Er feltet feil**, rett det, før kilden i `field_sources` og endringen i `changes`.
4. **Finnes ikke produsentens side**, bruk en norsk eller skandinavisk garnbutikk, så Ravelry.
   Bruktannonser er ikke kilder. Står tallet bare i én slik kilde, la det stå, men før feltet
   i `uncertain`.
5. **Utgått** settes til `true` bare når en kilde sier det rett ut: produsentens liste over
   utgåtte garn, eller ordene utgått, discontinued, udgået eller utgått kvalitet. At garnet
   mangler på en side, er ikke nok. Da er `discontinued` false, og feltet står i `uncertain`
   med grunnen. Dette er viktig: utgåtte garn foreslås aldri som alternativ.
6. **Opplysninger fra Maria** («opplyst av Maria» i `source_note`) gjelder foran nettkilder.
   Ikke endre dem.
7. **Ikke omgå sperrer** (403, 429, bot-sjekk, annen user-agent). Gå videre til neste kilde.

Strikkefasthet oppgitt per 4 tommer er det samme som per 10 cm i praksis. Fyll aldri inn noe
ut fra kunnskap om lignende garn.

## Svaret

Skriv `kontroll.json` i garnets mappe:

```json
{
  "answer": { "...": "fullt svar etter skjemaet under, med rettelsene" },
  "changes": [{ "field": "meterage_m", "from": "175", "to": "170", "source": "https://..." }],
  "note": "Kort på norsk: hva som er sjekket og mot hva, f.eks. «Alle felt bekreftet hos produsenten.»"
}
```

Kunne ingenting bekreftes, behold `current` som `answer`, sett alle ubekreftede felt i
`uncertain`, og skriv «Kunne ikke bekreftes» i `note`.

Sjekk hvert svar før du er ferdig, og rett til den svarer `ok`:

```
node --no-warnings --env-file=.env.local scripts/strikk/yarns.mjs check strikk/garn/kontroll/<id>/kontroll.json
```
