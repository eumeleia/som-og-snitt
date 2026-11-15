-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Strikk › Prosjekter: bilder Maria laster opp av et ferdig prosjekt. Bildet med lavest
-- position er forsidebildet. Filene ligger i den offentlige bøtta strikk-covers (023), under
-- <prosjekt-id>/<bilde-id>.jpg, komprimert i nettleseren til under 200 kB.
--
-- Samme mønster som 019–029: anon/authenticated leser, all skriving går via service_role
-- (/api/strikk/projects/[id]/photos).

create table if not exists strikk_project_photo (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references strikk_project(id) on delete cascade,
  path        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists strikk_project_photo_project_idx on strikk_project_photo (project_id, position);

alter table strikk_project_photo enable row level security;
create policy "Allow all" on strikk_project_photo for all using (true) with check (true);

grant select, insert, update, delete on strikk_project_photo to service_role;
grant select on strikk_project_photo to anon, authenticated;
