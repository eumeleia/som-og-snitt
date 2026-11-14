# Oppsett av oppskrifter: selve oppskriften i to spalter på A4

Fast instruks. Gjelder hver oppskrift Maria ber Claude Code lage eller finjustere, enten det er
strikk eller sying.

## Sideoppbygging

1. **Side 1:** forside med navn og bilde (og intro), som i originalen.
2. **Side 2 (og 3 om det trengs):** info om garn, størrelser, mål og pinner (tabellen i full
   bredde), merknaden under tabellen, og generell tekst og teknikker før selve oppskriften.
   Én spalte. Dette får stå i fred.
3. **Ny side:** selve oppskriften (for eksempel fra «Bol», «Pannebånd» eller «Pattern») i to
   spalter. Venstre spalte leses først, så høyre.
4. **Etter oppskriften:** forkortelser, tutorials, diagrammer, bakside, Merknader og vedlegg i
   én spalte, som i originalen.

Bare selve oppskriften står i to spalter, ikke alt.

## Regelen for spaltene

- Overskrifter i oppskriften står i spalten og holdes sammen med det som følger.
- Tabeller, diagrammer og bilder beholdes hele. Får de ikke plass i én spalte i sin naturlige
  størrelse, går de over hele bredden. De skaleres aldri ned for å passe en spalte.
- Står en overskrift rett før noe som går over hele bredden, følger overskriften med.
- Teksten er lik kilden, ord for ord. Bare oppsettet endres.

## Slik bygges den

Kildene ligger i `oppskrifter/_work/` (gitignorert, bare på Marias Mac):
`<oppskrift>/data.py` per oppskrift og felles `_work/scripts/build_pdf.py` med fonter og tegnekode.

```bash
python3 scripts/recipes/two_column.py oppskrifter/_work/<oppskrift>/data.py
```

Resultatet havner i `oppskrifter/To spalter/` med samme filnavn som originalen i
`oppskrifter/00 Ferdige filer/`. `two_column.py` bruker `build_pdf.py` og `data.py` uendret.

- **Finjustere en oppskrift:** rett i `data.py`, bygg énspaltet med `build_pdf.py` som før, og
  bygg den tospaltede med kommandoen over.
- **Ny oppskrift:** skriv `data.py` med samme skjema som de andre (se `build_pdf.py`), og bygg
  begge versjonene. Uten `data.py` finnes det ingen kilde å bygge fra.
- **Hvor selve oppskriften starter:** fra første blokk i `body`, med mindre `data.py` har
  `"columns_from": "<overskrift>"` (for eksempel `"Pattern"` når det står teknikker først).
  To spalter slutter ved første sideskift (`pagebreak`) etter start, eller ved
  `"columns_to": "<overskrift>"`. For Charlotte Jacket Mini og Butterscotch Sweater Adult står
  startpunktet i `COLUMNS_FROM` i skriptet, så kildene ikke endres.
- **Mangler `oppskrifter/_work`:** si fra til Maria i stedet for å bygge på noe annet.

## Sjekk før den regnes som ferdig

1. **Tekst:** samme ord som originalen. Sammenlign ordene fra begge PDF-ene, med bunnteksten
   trukket fra, for eksempel med pdfplumber. Et langt ord, som en lenke, kan deles over to linjer
   i en smal spalte. Det teller som samme ord når bitene satt sammen gir originalordet.
2. **Tabeller og diagrammer:** ingenting går utenfor margen, og hver side ses gjennom som bilde.
3. **Originalene:** `00 Ferdige filer/` og `_work/` er uendret. Sammenlign sha256 før og etter.
4. **Git:** ingen PDF-er committes (`oppskrifter/` er gitignorert).
