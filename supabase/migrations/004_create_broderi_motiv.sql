-- Parsed sting/farge-data for ett bestemt PES-motiv+størrelse, brukt av
-- broderi-arrangeringsverktøyet. Motivet selv (PES-fil, forhåndsvisning,
-- kategori osv.) eies fortsatt av `embroidery`-tabellen — denne tabellen
-- er bare en cache av det pyembroidery finner ved parsing, så vi ikke
-- må kjøre Python-funksjonen på nytt hver gang siden åpnes.

create table if not exists broderi_motiv (
  id            uuid primary key default gen_random_uuid(),
  embroidery_id uuid not null references embroidery(id) on delete cascade,
  size_id       text not null,
  navn          text not null,
  fil_sti       text not null,
  data          jsonb not null,
  created_at    timestamptz default now(),
  unique (embroidery_id, size_id)
);

alter table broderi_motiv enable row level security;

create policy "Allow all" on broderi_motiv
  for all using (true) with check (true);
