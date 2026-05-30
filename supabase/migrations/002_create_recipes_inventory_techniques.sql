create table if not exists recipes (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  data       jsonb not null
);

alter table recipes enable row level security;

create policy "Allow all" on recipes
  for all using (true) with check (true);

-- ──────────────────────────────────────────────────────────────────────────────

create table if not exists inventory (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  data       jsonb not null
);

alter table inventory enable row level security;

create policy "Allow all" on inventory
  for all using (true) with check (true);

-- ──────────────────────────────────────────────────────────────────────────────

create table if not exists techniques (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  data       jsonb not null
);

alter table techniques enable row level security;

create policy "Allow all" on techniques
  for all using (true) with check (true);
