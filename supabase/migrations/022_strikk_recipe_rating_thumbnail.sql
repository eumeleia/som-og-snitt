-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Strikk › Oppskrifter: stjerner (1–5) og favoritt, et lite bilde av første side, og hvor
-- Maria var sist i oppskriften (side og andel ned i siden, 0–1).
--
-- Samme mønster som 012–021: anon/authenticated leser, all skriving går via service_role
-- (API-rutene under /api/strikk/oppskrifter/[id]).

alter table strikk_oppskrift
  add column if not exists rating       smallint check (rating between 1 and 5),
  add column if not exists favorite     boolean not null default false,
  add column if not exists thumbnail_path text,
  -- When the picture was last replaced; added to its URL so a new picture is not cached.
  add column if not exists thumbnail_at timestamptz,
  add column if not exists last_page    integer check (last_page >= 1),
  add column if not exists last_offset  real check (last_offset >= 0 and last_offset <= 1);

-- Offentlig bøtte for bildene: lesing med offentlig URL, skriving bare med service_role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('strikk-thumbnails', 'strikk-thumbnails', true, 61440, array['image/jpeg'])
on conflict (id) do nothing;
