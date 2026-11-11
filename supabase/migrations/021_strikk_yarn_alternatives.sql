-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Garnalternativer i Strikk: garnkombinasjoner som gir en bestemt strikkefasthet (fra
-- Skaberglæde og DROPS, se scripts/strikk/combos.mjs), og Marias egne strikkeprøver. En
-- strikkeprøve har samme form som en kombinasjon (ett eller flere garn holdt sammen, med
-- strikkefasthet og pinne), bare med egen tabell siden den alltid er Marias egen og alltid
-- allerede koblet til katalogen.
--
-- Samme mønster som 012–020: anon/authenticated får bare SELECT, all skriving går via
-- service_role (scripts/strikk/combos.mjs for kombinasjoner, en API-rute for strikkeprøver).
--
-- strikk_yarn_combo_member.yarn_id kan være null mens en kombinasjon er under arbeid (garnet
-- er ikke koblet til katalogen ennå); raw_brand/raw_name er skrivemåten kilden selv bruker,
-- til koblingen er gjort.

create table if not exists strikk_yarn_combo (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null check (source in ('skaberglaede', 'drops')),
  source_url          text,
  stitch_pattern      text,
  gauge_stitches_10cm numeric,
  gauge_rows_10cm     numeric,
  needle_mm           numeric,
  note                text,
  created_at          timestamptz not null default now()
);

create table if not exists strikk_yarn_combo_member (
  id         uuid primary key default gen_random_uuid(),
  combo_id   uuid not null references strikk_yarn_combo(id) on delete cascade,
  position   integer not null default 0,
  yarn_id    uuid references strikk_yarn(id) on delete set null,
  raw_brand  text,
  raw_name   text,
  strands    integer not null default 1
);
create index if not exists strikk_yarn_combo_member_combo_idx on strikk_yarn_combo_member (combo_id);
create index if not exists strikk_yarn_combo_member_yarn_idx on strikk_yarn_combo_member (yarn_id);

create table if not exists strikk_swatch (
  id                  uuid primary key default gen_random_uuid(),
  gauge_stitches_10cm numeric,
  gauge_rows_10cm     numeric,
  needle_mm           numeric,
  notes               text,
  created_at          timestamptz not null default now()
);

create table if not exists strikk_swatch_yarn (
  id         uuid primary key default gen_random_uuid(),
  swatch_id  uuid not null references strikk_swatch(id) on delete cascade,
  position   integer not null default 0,
  yarn_id    uuid not null references strikk_yarn(id) on delete cascade,
  strands    integer not null default 1
);
create index if not exists strikk_swatch_yarn_swatch_idx on strikk_swatch_yarn (swatch_id);

alter table strikk_yarn_combo enable row level security;
alter table strikk_yarn_combo_member enable row level security;
alter table strikk_swatch enable row level security;
alter table strikk_swatch_yarn enable row level security;

create policy "Allow all" on strikk_yarn_combo for all using (true) with check (true);
create policy "Allow all" on strikk_yarn_combo_member for all using (true) with check (true);
create policy "Allow all" on strikk_swatch for all using (true) with check (true);
create policy "Allow all" on strikk_swatch_yarn for all using (true) with check (true);

grant select, insert, update, delete on strikk_yarn_combo to service_role;
grant select on strikk_yarn_combo to anon, authenticated;
grant select, insert, update, delete on strikk_yarn_combo_member to service_role;
grant select on strikk_yarn_combo_member to anon, authenticated;
grant select, insert, update, delete on strikk_swatch to service_role;
grant select on strikk_swatch to anon, authenticated;
grant select, insert, update, delete on strikk_swatch_yarn to service_role;
grant select on strikk_swatch_yarn to anon, authenticated;
