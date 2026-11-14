-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- «Fest til meny»: ett festet strikkeprosjekt og ett festet syprosjekt, vist som snarvei
-- øverst i sidemenyen. kind er primærnøkkel, så å feste et nytt prosjekt av samme type
-- erstatter det gamle (upsert på kind).
--
-- project_id peker til strikk_project (kind 'strikk') eller projects (kind 'sy'). Det er
-- ingen fremmednøkkel, fordi kolonnen peker til to tabeller; menyen viser ikke en pin
-- til et prosjekt som er slettet.
--
-- Samme mønster som Strikk-tabellene: anon/authenticated får bare SELECT, skriving går via
-- service_role i /api/menu-pin.

create table if not exists menu_pin (
  kind        text primary key check (kind in ('strikk', 'sy')),
  project_id  uuid not null,
  pinned_at   timestamptz not null default now()
);

alter table menu_pin enable row level security;
create policy "Allow all" on menu_pin for all using (true) with check (true);

grant select, insert, update, delete on menu_pin to service_role;
grant select on menu_pin to anon, authenticated;
