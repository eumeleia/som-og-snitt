# Oppsett av oppskrifter: alltid to spalter på A4

Fast instruks. Gjelder hver oppskrift Maria ber Claude Code lage eller finjustere, enten det er
strikk eller sying.

## Regelen

- Ferdig PDF på A4 med to tekstspalter per side. Venstre spalte leses først, så høyre.
- Forsiden (tittel, bilder, intro) og oppskriftens tittel går over hele bredden. Øvrige
  overskrifter står i spalten og holdes sammen med det som følger.
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
- **Mangler `oppskrifter/_work`:** si fra til Maria i stedet for å bygge på noe annet.

## Sjekk før den regnes som ferdig

1. **Tekst:** samme ord som originalen. Sammenlign ordene fra begge PDF-ene, med bunnteksten
   trukket fra, for eksempel med pdfplumber. Et langt ord, som en lenke, kan deles over to linjer
   i en smal spalte. Det teller som samme ord når bitene satt sammen gir originalordet.
2. **Tabeller og diagrammer:** ingenting går utenfor margen, og hver side ses gjennom som bilde.
3. **Originalene:** `00 Ferdige filer/` og `_work/` er uendret. Sammenlign sha256 før og etter.
4. **Git:** ingen PDF-er committes (`oppskrifter/` er gitignorert).
