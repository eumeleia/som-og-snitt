-- Lagrer flere plasserte motiver på samme 100×100 mm-lerret (arrangeringsverktøyet,
-- steg 3). Samme id/created_at/data-mønster som resten av appen.
--
-- Skrivinger går KUN via service_role (server-ruter under /api/broderi-komposisjon) —
-- anon/authenticated får bare SELECT. RLS-policyen alene er ikke nok til å styre dette
-- presist siden den er "Allow all"; GRANT er det som faktisk sperrer skriving for
-- anon/authenticated. Se migrasjon 005 for bakgrunnen: RLS uten GRANT gir
-- "permission denied" (42501) i produksjon uansett policy.

create table if not exists broderi_komposisjon (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  data       jsonb not null
);

alter table broderi_komposisjon enable row level security;

create policy "Allow all" on broderi_komposisjon
  for all using (true) with check (true);

grant select, insert, update, delete on broderi_komposisjon to service_role;
grant select on broderi_komposisjon to anon, authenticated;
