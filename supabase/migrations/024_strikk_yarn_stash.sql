-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Garnlageret i Strikk: hvor mye Maria faktisk har liggende av hvert garn og hver farge,
-- registrert fra bilder (se docs/garnlager-registrering.md). En rad er ett garn i én farge;
-- skein_count er hele nøster, leftover_g et anslått restnøste i tillegg.
--
-- Samme mønster som 012–023: anon/authenticated får bare SELECT, all skriving går via
-- service_role (scripts/strikk/stash.mjs og API-rutene under /api/strikk/garnlager).
--
-- yarn_id kan være null helt til garnet er lagt i katalogen (strikk_yarn); et nytt garn
-- funnet i bildene legges inn der som status 'draft' og kobles opp med det samme.
-- uncertain_fields/uncertain_reasons er samme mønster som strikk_yarn og strikk_oppskrift:
-- hvert felt appen ikke var sikker på, med en kort norsk grunn.

create table if not exists strikk_yarn_stash (
  id                 uuid primary key default gen_random_uuid(),
  yarn_id            uuid references strikk_yarn(id) on delete set null,
  color_number       text,
  color_name         text,
  skein_count        numeric not null default 0,
  leftover_g         numeric,
  thumbnail_path     text,
  -- Filnavnene bildet(ene) ble funnet på, til sporing — originalbildene lagres ikke i Supabase.
  source_images      text[] not null default '{}',
  note               text,
  uncertain_fields   text[] not null default '{}',
  uncertain_reasons  jsonb not null default '{}',
  status             text not null default 'til_gjennomgang' check (status in ('til_gjennomgang', 'godkjent')),
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists strikk_yarn_stash_yarn_idx on strikk_yarn_stash (yarn_id);
create index if not exists strikk_yarn_stash_status_idx on strikk_yarn_stash (status);

alter table strikk_yarn_stash enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'strikk_yarn_stash' and policyname = 'Allow all') then
    create policy "Allow all" on strikk_yarn_stash for all using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on strikk_yarn_stash to service_role;
grant select on strikk_yarn_stash to anon, authenticated;

-- Samme bøtte som oppskrift-miniatyrene (022), bare en egen filsti (garnlager/<id>.jpg).
-- 61440 byte-grensen er allerede trangere enn de 50 kB garnlager-miniatyrene skal holde seg under.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('strikk-thumbnails', 'strikk-thumbnails', true, 61440, array['image/jpeg'])
on conflict (id) do nothing;
