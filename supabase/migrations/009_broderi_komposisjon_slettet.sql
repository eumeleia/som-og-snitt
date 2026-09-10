-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Legger til myk sletting (søppelkurv, 30 dager) på broderi_komposisjon.
--
-- Tidspunktet ligger UTENFOR data-jsonb-en, med vilje: lagreNaa i KomposisjonEditor.tsx
-- bygger lagringsobjektet fra bunnen ({ navn, motiver, sekvens, miniatyrSvg }) ved hver
-- autolagring. Et felt inni data som ikke er en del av den lista, ville blitt slettet av
-- neste autolagring — samme klasse feil som fontMetrikk-overskrivingen (se
-- docs/onsker-2026-09-08.md, punkt D/0). En egen kolonne kan editoren ikke røre, uansett
-- hva den skriver til data.
--
-- Eksisterende grants fra migration 006 dekker nye kolonner automatisk.
-- Ingen indeks — tabellen er liten, og kolonnen filtreres i klienten på et sett som
-- uansett hentes i sin helhet (select('*')).

alter table broderi_komposisjon
  add column if not exists slettet_tid timestamptz;
