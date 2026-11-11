-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Strikk › Prosjekter: hvor Maria var sist i oppskriften (side og andel ned i siden, 0–1),
-- en side hun har merket som «Gjeldende side», og et eget forsidebilde.
--
-- Samme mønster som 019–022: anon/authenticated leser, all skriving går via service_role
-- (API-rutene under /api/strikk/projects/[id]).

alter table strikk_project
  add column if not exists last_page    integer check (last_page >= 1),
  add column if not exists last_offset  real check (last_offset >= 0 and last_offset <= 1),
  add column if not exists current_page integer check (current_page >= 1),
  add column if not exists cover_path   text,
  -- When the picture was last replaced; added to its URL so a new picture is not cached.
  add column if not exists cover_at     timestamptz;

-- Offentlig bøtte for forsidebildene: lesing med offentlig URL, skriving bare med service_role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('strikk-covers', 'strikk-covers', true, 204800, array['image/jpeg'])
on conflict (id) do nothing;
