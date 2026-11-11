-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Strikk › Prosjekter: ett strikkeprosjekt per rad, startet fra en oppskrift i
-- strikk_oppskrift eller som et tomt prosjekt. Markeringer og tellere hører til
-- prosjektet (ikke oppskriften), slik at samme oppskrift kan strikkes flere ganger.
--
-- Samme mønster som 012–018: anon/authenticated får bare SELECT, all skriving går via
-- service_role i /api/strikk/projects. version er optimistisk lås for streker/tellere,
-- samme som i strikk_prototype (012).
--
-- strikk_project_yarn.position følger indeksen til oppskriftens strikk_yarn_line (sortert
-- på position) når oppskrift_id er satt, slik at garnvalget for linje N i prosjektet
-- hører til yarn_line N i oppskriften. yarn_id peker inn i garnkatalogen (017), slik at
-- garnet senere kan kobles til et garnlager uten å endre denne tabellen.

create table if not exists strikk_project (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default '',
  oppskrift_id  uuid references strikk_oppskrift(id) on delete set null,
  size_index    integer,
  size_label    text,
  needles       text,
  status        text not null default 'planned' check (status in ('planned', 'in_progress', 'done')),
  start_date    date,
  end_date      date,
  notes         text,
  sort_order    integer not null default 0,
  strokes       jsonb not null default '[]'::jsonb,
  counters      jsonb not null default '[]'::jsonb,
  version       integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists strikk_project_yarn (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references strikk_project(id) on delete cascade,
  position    integer not null default 0,
  yarn_id     uuid references strikk_yarn(id) on delete set null,
  color_label text,
  created_at  timestamptz not null default now()
);
create index if not exists strikk_project_yarn_project_idx on strikk_project_yarn (project_id);

alter table strikk_project enable row level security;
alter table strikk_project_yarn enable row level security;

create policy "Allow all" on strikk_project for all using (true) with check (true);
create policy "Allow all" on strikk_project_yarn for all using (true) with check (true);

grant select, insert, update, delete on strikk_project to service_role;
grant select on strikk_project to anon, authenticated;
grant select, insert, update, delete on strikk_project_yarn to service_role;
grant select on strikk_project_yarn to anon, authenticated;
