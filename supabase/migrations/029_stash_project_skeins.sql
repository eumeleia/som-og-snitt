-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Hvor mange nøster av en rad i garnlageret som er satt av til prosjektet i project_id.
-- Raden deles ikke: garnet ligger samlet i Lager, og ✱ viser «3 nøster er tilknyttet …».
-- null betyr hele raden, slik alle tildelinger var før denne kolonnen.

alter table strikk_yarn_stash add column if not exists project_skeins numeric;
