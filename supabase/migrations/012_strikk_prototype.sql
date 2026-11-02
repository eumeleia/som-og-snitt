-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Kastbar prototype av strikkevisningen på /strikk/prototype: én rad per opplastet PDF,
-- med streker og tellere. Slettes sammen med prototypen.
--
-- Samme mønster som 006 og 011: anon/authenticated får bare SELECT, all skriving går via
-- service_role i /api/strikk-prototype. GRANT er det som faktisk sperrer skriving, siden
-- policyen er «Allow all» (se 005 og 006).
--
-- version brukes som optimistisk lås i op-ruta: to samtidige skrivinger kan ikke
-- overskrive hverandres streker, den som taper prøver på nytt mot ny versjon.

create table if not exists strikk_prototype (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz default now(),
  last_opened   timestamptz default now(),
  drive_file_id text not null,
  file_name     text not null,
  strokes       jsonb not null default '[]'::jsonb,
  counters      jsonb not null default '[]'::jsonb,
  version       integer not null default 0
);

alter table strikk_prototype enable row level security;

create policy "Allow all" on strikk_prototype
  for all using (true) with check (true);

grant select, insert, update, delete on strikk_prototype to service_role;
grant select on strikk_prototype to anon, authenticated;
