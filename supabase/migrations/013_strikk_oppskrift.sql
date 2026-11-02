-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Strikkeoppskrifter under Strikk › Oppskrifter. Helt adskilt fra syoppskriftene
-- (recipes): egen tabell, egne ruter under /api/strikk. PDF-en ligger i Disk
-- (Søm og Snitt/Strikk); raden holder bare Disk-fil-ID og filnavn.
--
-- Bare feltene dette steget trenger. Felt for uttrekk fra PDF-en kommer i en senere
-- migrering.
--
-- Samme mønster som 006, 011 og 012: anon/authenticated får bare SELECT, all skriving
-- går via service_role i /api/strikk/oppskrifter. GRANT er det som faktisk sperrer
-- skriving, siden policyen er «Allow all» (se 005 og 006).

create table if not exists strikk_oppskrift (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  designer      text,
  drive_file_id text not null,
  file_name     text not null,
  -- 'upload' = lastet opp fra enheten. Flere kilder kan legges til senere.
  source        text not null default 'upload' check (source in ('upload')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table strikk_oppskrift enable row level security;

create policy "Allow all" on strikk_oppskrift
  for all using (true) with check (true);

grant select, insert, update, delete on strikk_oppskrift to service_role;
grant select on strikk_oppskrift to anon, authenticated;
