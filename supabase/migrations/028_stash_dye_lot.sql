-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Parti (innfarging) på en rad i garnlageret. Maria kan nå legge til garn selv i Lager
-- (POST /api/strikk/garnlager), med farge, fargenummer, parti og nøster eller gram.
-- Til denne er kjørt, lagres partiet i notatet i stedet, og Lager viser det derfra.

alter table strikk_yarn_stash add column if not exists dye_lot text;
