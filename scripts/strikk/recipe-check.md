# Kontroll av strikkeoppskrifter før godkjenning

Hver mappe her er én oppskrift som står «Til gjennomgang». Maria går ikke gjennom dem selv;
denne kontrollen er den som gjelder, og oppskriften godkjennes etterpå. Bruk bare egne
verktøy. Claude-API-et og `ANTHROPIC_API_KEY` brukes ikke, og ingenting skrives til databasen.

I mappa:
- `data.json`: oppskriften slik appen har den nå (samme format som gjennomgangssiden).
- `meta.json`: tittel, designer, `read_in` (mappa med `tekst.txt` = alle sider med
  «--- Side N ---», og `side-N.png` for sider uten tekstlag), og `catalogue`: garnet hver
  garnlinje er koblet til i den kontrollerte garnkatalogen.

## Slik kontrollerer du

Les **alle sidene** i oppskriften (tekst og sidebilder) og sjekk **hvert felt** i `data.json`,
ikke bare de som er merket usikre:

- `title`, `designer`, `audience`, `garment_type`, `is_collection`, `collection_titles`, `variants`
- `sizes`: alle størrelser, i oppskriftens rekkefølge og skrivemåte
- `yarn_lines`: ett garn per linje, fargegruppe (`color_group`), fargenavn, tråder
- `amounts`: mengde per størrelse (`size` = indeks i `sizes`) og fargegruppe; `yarn_line` =
  indeks i `yarn_lines` når mengden gjelder ett garn i en gruppe. Spenn som `amount` +
  `amount_max`. Enhet `g` eller `skeins`.
- `alternatives`: bare garn oppskriften selv nevner som alternativ (under «Garnforslag» o.l.)
- `gauge_stitches_10cm`, `gauge_rows_10cm`, `gauge_note`, `needles`
- `accessories`: knapper, glidelås osv. (`size` = indeks, eller null for alle)

Lesereglene og Marias rettelser under er rettesnor: samme type situasjon behandles på samme
måte. Verdier kommer bare fra oppskriften; gjett aldri. Garnkatalogen kan brukes til å avgjøre
produsent og skrivemåte for et garn, ikke mengder.

- **Tittel og målgruppe** som Maria har fylt inn ved opplasting, står. Endre ikke tittelen
  fordi PDF-en har en fellesoverskrift; tittelen styrer filnavnet i Disk.
- Rør ikke `yarn_id`, `yarn_link_uncertain` og `yarn_link_reason`; koblingene settes på nytt
  etterpå (`yarns.mjs link`).
- Endrer du rekkefølgen på `sizes` eller `yarn_lines`, må indeksene i `amounts`,
  `alternatives` og `accessories` følge med.

## Godkjenne eller ikke

- `approve: true` når alt er sjekket og stemmer med oppskriften. Merker som bare sier at
  oppskriften gir flere likestilte valg (garn, farger), hindrer ikke godkjenning.
- `approve: false` når oppskriften selv er i strid med seg selv, ikke kan leses, eller mangler
  en side som trengs (f.eks. «side 2 sier 50 g, side 4 sier 25 g», «fem mengder for seks
  størrelser», «side 65 mangler»). Merk feltet usikkert med grunnen, så det står igjen til
  Maria. Godkjenning sletter alle merker, så et felt som fortsatt er usikkert av slike
  grunner, betyr alltid `approve: false`.

## Svaret

Skriv `kontroll.json` i oppskriftens mappe:

```json
{
  "data": { "...": "hele data.json, med rettelsene" },
  "changes": [{ "field": "amounts[3].amount", "from": "250", "to": "300", "where": "Side 2, mengdetabellen, M" }],
  "approve": true,
  "note": "Kort på norsk: hva som er sjekket og hva som ble rettet."
}
```

Sjekk svaret før du går videre, og rett til den svarer `ok`:

```
node --no-warnings scripts/strikk/check.mjs check strikk/innlesing/kontroll/<id>/kontroll.json
```
