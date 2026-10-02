-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- «Min palett» i fargevelgeren i broderi-arrangøren: en håndplukket kortliste på maks 8
-- farger som gjelder på tvers av alle komposisjoner og følger med mellom enheter.
--
-- Egen tabell, IKKE et felt i data-jsonb-en på broderi_komposisjon: paletten hører ikke
-- til én komposisjon, og lagreNaa i KomposisjonEditor.tsx bygger data fra bunnen ved hver
-- autolagring — alt som ikke står i det objektet, ville forsvunnet.
--
-- Skrivinger går KUN via service_role (server-ruta /api/broderi-fargepalett) — anon/
-- authenticated får bare SELECT, så klienten kan lese direkte. GRANT er med fordi RLS-
-- policyen alene ikke er nok: uten GRANT gir PostgREST «permission denied» (42501) i
-- produksjon uansett policy, se migrasjon 005. Og siden policyen er «Allow all», er det
-- GRANT som faktisk sperrer skriving for anon/authenticated, se migrasjon 006.
--
-- Ingen indeks, ingen sorteringskolonne. Tabellen holder maks 8 rader (grensen håndheves i
-- API-ruta, ikke her) og hentes alltid i sin helhet; rekkefølgen er created_at.

create table if not exists broderi_fargepalett (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  data       jsonb not null
);

alter table broderi_fargepalett enable row level security;

create policy "Allow all" on broderi_fargepalett
  for all using (true) with check (true);

grant select, insert, update, delete on broderi_fargepalett to service_role;
grant select on broderi_fargepalett to anon, authenticated;
