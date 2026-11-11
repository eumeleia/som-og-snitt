-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Tildeler garnlagerrader til et prosjekt (migrasjon 024 + 019). En rad med project_id satt
-- vises med en stjerne i Garnlageret mens prosjektet er «planlagt»; blir prosjektet
-- «pågående» eller «ferdig», vises raden bare i prosjektet, ikke i Garnlageret (se
-- /api/strikk/garnlager og /api/strikk/projects/[id]/complete).

alter table strikk_yarn_stash
  add column if not exists project_id uuid references strikk_project(id) on delete set null;
create index if not exists strikk_yarn_stash_project_idx on strikk_yarn_stash (project_id);
