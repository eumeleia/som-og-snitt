-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Strikk › Oppskrifter: Marias egne mapper og ønskelista.
--
-- Mappene per plaggtype og målgruppe og mappa Favoritter lagres ikke: de regnes ut fra
-- strikk_oppskrift. Her ligger bare mappene Maria lager selv, for eksempel én per person hun
-- strikker til. En oppskrift kan ligge i flere mapper (én rad per par).
--
-- Ønskelista tar både oppskrifter fra biblioteket (oppskrift_id) og oppskrifter hun ikke har
-- ennå (title, designer, url, ca. pris, notat og eget bilde). Bildet ligger i den offentlige
-- bøtta strikk-wishes, komprimert i nettleseren til under 200 kB.
--
-- Samme mønster som 019–030: anon/authenticated leser, all skriving går via service_role
-- (/api/strikk/folders og /api/strikk/wishes).

create table if not exists strikk_folder (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);
create unique index if not exists strikk_folder_name_idx on strikk_folder (lower(trim(name)));

create table if not exists strikk_folder_recipe (
  folder_id     uuid not null references strikk_folder(id) on delete cascade,
  oppskrift_id  uuid not null references strikk_oppskrift(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (folder_id, oppskrift_id)
);
create index if not exists strikk_folder_recipe_recipe_idx on strikk_folder_recipe (oppskrift_id);

create table if not exists strikk_wish (
  id            uuid primary key default gen_random_uuid(),
  oppskrift_id  uuid references strikk_oppskrift(id) on delete cascade,
  title         text,
  designer      text,
  url           text,
  price_nok     numeric check (price_nok >= 0),
  note          text,
  image_path    text,
  -- When the picture was last replaced; added to its URL so a new picture is not cached.
  image_at      timestamptz,
  created_at    timestamptz not null default now(),
  check (oppskrift_id is not null or length(trim(coalesce(title, ''))) > 0)
);
-- A recipe from the library is on the list at most once.
create unique index if not exists strikk_wish_recipe_idx on strikk_wish (oppskrift_id) where oppskrift_id is not null;

alter table strikk_folder enable row level security;
alter table strikk_folder_recipe enable row level security;
alter table strikk_wish enable row level security;
create policy "Allow all" on strikk_folder for all using (true) with check (true);
create policy "Allow all" on strikk_folder_recipe for all using (true) with check (true);
create policy "Allow all" on strikk_wish for all using (true) with check (true);

grant select, insert, update, delete on strikk_folder to service_role;
grant select, insert, update, delete on strikk_folder_recipe to service_role;
grant select, insert, update, delete on strikk_wish to service_role;
grant select on strikk_folder to anon, authenticated;
grant select on strikk_folder_recipe to anon, authenticated;
grant select on strikk_wish to anon, authenticated;

-- Offentlig bøtte for bildene på ønskelista: lesing med offentlig URL, skriving bare med service_role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('strikk-wishes', 'strikk-wishes', true, 204800, array['image/jpeg'])
on conflict (id) do nothing;
