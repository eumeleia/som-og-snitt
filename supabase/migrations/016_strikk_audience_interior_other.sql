-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Målgruppe får to nye verdier i tillegg til woman, man, unisex og child:
--   interior: pledd, puter, kurver, kluter og annet til hjemmet
--   other:    det som ikke passer noe sted
-- Bare sjekken byttes; ingen rad endres. Kan kjøres flere ganger.

alter table strikk_oppskrift drop constraint if exists strikk_oppskrift_audience_check;
alter table strikk_oppskrift add constraint strikk_oppskrift_audience_check
  check (audience in ('woman', 'man', 'unisex', 'child', 'interior', 'other'));
