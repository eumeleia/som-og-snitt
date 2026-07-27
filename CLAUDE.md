@AGENTS.md

## Mønstermodul

Kildefiler ligger i `src/lib/monster/`:
- `maal.ts` — 35 kroppsmål med norsk/engelsk term, instruksjon og bokstavreferanse til måldiagrammet
- `plagg.ts` — 33 blokker med målkrav, stofftype og `status`
- `stoerrelser.ts` — 41 standardstørrelser (baby 56–92, jenter 98–164, gutter 98–170, dame 6–24)
- `generator.ts` — geometri, sømmonn, SVG-rendering og nedlasting
- `bukseblokk.ts` — flat bukseblokk i ett stykke, barn 80–170 cm

Måldiagrammet (Aldrich) ligger i `public/monster/Body_measurement_method.png`.

**`status`-feltet på en blokk:**
- `verifisert` — kodet og kryssjekket mot bokas tekst og diagram. Kun disse er valgbare.
- `kodet` — kodet, men ikke sjekket.
- `katalogisert` — målkrav kjent, konstruksjon ikke skrevet.

**Regel:** Nye konstruksjoner skrives aldri uten verifisering mot Aldrichs bok. OCR-en i
bøkene er upålitelig — brøker som ½ og ¼ leses ofte feil. Gjett aldri på en formel.
