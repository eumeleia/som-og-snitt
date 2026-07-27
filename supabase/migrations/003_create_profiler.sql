create table profiler (
  id         uuid primary key default gen_random_uuid(),
  navn       text not null,
  type       text not null check (type in ('barn','voksen')),
  kjonn      text check (kjonn in ('jente','gutt','dame')),
  hoyde_cm   numeric,
  maal       jsonb not null default '{}',
  opprettet  timestamptz default now(),
  oppdatert  timestamptz default now()
);

alter table profiler enable row level security;

create policy "Allow all" on profiler
  for all using (true) with check (true);
