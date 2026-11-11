-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- /strikk/prototype og /api/strikk-prototype er fjernet (se samme commit): markup og
-- tellere flyttet til Strikk › Prosjekter (strikk_project, migrasjon 019). Denne tabellen
-- trengs ikke lenger.

drop table if exists strikk_prototype;
