-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Hjem viser de aktive prosjektene med det sist åpnede øverst. Når Maria åpner et
-- strikkeprosjekt (strikk_project) eller et syprosjekt (projects), lagres tiden her.
--
-- For projects er det en egen kolonne, ikke et felt inni data: syprosjektsiden skriver hele
-- data på nytt når den lagrer, og ville da kunne overskrive tiden.

alter table strikk_project add column if not exists last_opened_at timestamptz;
alter table projects add column if not exists last_opened_at timestamptz;
