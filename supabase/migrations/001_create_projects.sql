create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  data jsonb not null
);

alter table projects enable row level security;

create policy "Allow all" on projects
  for all using (true) with check (true);
