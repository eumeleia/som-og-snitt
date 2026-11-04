-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Uttrekk av oppskriftsdata i Strikk: felt på strikk_oppskrift, fem tabeller under den,
-- og to funksjoner som lagrer et uttrekk i én transaksjon.
--
-- Samme mønster som 012 og 013: anon/authenticated får bare SELECT, all skriving går
-- via service_role i /api/strikk/... GRANT er det som faktisk sperrer skriving.
--
-- Godkjent uttrekk er låst: strikk_save_extraction lar raden og alt under den være når
-- extraction_status = 'approved'. Det er sjekket under radlås, så et uttrekk som kjører
-- samtidig med en godkjenning kan ikke skrive over den.

alter table strikk_oppskrift
  add column if not exists extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'extracted', 'failed', 'approved')),
  add column if not exists extraction_error text,
  add column if not exists extracted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists extracted_title text,
  add column if not exists extracted_designer text,
  add column if not exists audience text check (audience in ('woman', 'man', 'unisex', 'child')),
  add column if not exists garment_type text,
  add column if not exists gauge_stitches_10cm numeric,
  add column if not exists gauge_rows_10cm numeric,
  add column if not exists gauge_note text,
  add column if not exists needles text[] not null default '{}',
  add column if not exists variants text[] not null default '{}',
  add column if not exists is_collection boolean not null default false,
  add column if not exists collection_titles text[] not null default '{}',
  -- Feltnavn på denne raden som er lest ut med usikkerhet, f.eks. {audience,gauge_rows_10cm}.
  add column if not exists uncertain_fields text[] not null default '{}',
  add column if not exists extraction_pages int[] not null default '{}',
  add column if not exists extraction_raw jsonb;

create table if not exists strikk_size (
  id           uuid primary key default gen_random_uuid(),
  oppskrift_id uuid not null references strikk_oppskrift(id) on delete cascade,
  position     int not null,
  label        text not null,
  uncertain    boolean not null default false
);

-- Én rad per garn. Rader med samme color_group strikkes sammen (f.eks. Sunday + Kid-Silk
-- i hovedfargen). Flere tråder av samme garn er én rad med strands > 1.
create table if not exists strikk_yarn_line (
  id               uuid primary key default gen_random_uuid(),
  oppskrift_id     uuid not null references strikk_oppskrift(id) on delete cascade,
  position         int not null,
  color_group      int not null,
  color_label      text,
  yarn_name        text not null,
  brand            text,
  meterage_m       numeric,
  skein_weight_g   numeric,
  fiber            text,
  strands          int not null default 1,
  uncertain_fields text[] not null default '{}'
);

-- Mengde per størrelse og fargegruppe, eller per garn når oppskriften oppgir det slik.
-- needs_choice: én mengde står for flere garn med ulik løpelengde; candidates holder
-- garnnavnene, og yarn_line_id settes når du har valgt.
create table if not exists strikk_yarn_amount (
  id           uuid primary key default gen_random_uuid(),
  oppskrift_id uuid not null references strikk_oppskrift(id) on delete cascade,
  size_id      uuid not null references strikk_size(id) on delete cascade,
  color_group  int not null,
  yarn_line_id uuid references strikk_yarn_line(id) on delete set null,
  amount       numeric,
  unit         text not null check (unit in ('g', 'skeins')),
  candidates   text[] not null default '{}',
  needs_choice boolean not null default false,
  uncertain    boolean not null default false
);

-- source = 'pattern': nevnt i oppskriften. 'app': foreslått av appen senere. Et nytt
-- uttrekk erstatter bare 'pattern'-radene.
create table if not exists strikk_yarn_alternative (
  id             uuid primary key default gen_random_uuid(),
  oppskrift_id   uuid not null references strikk_oppskrift(id) on delete cascade,
  yarn_line_id   uuid references strikk_yarn_line(id) on delete set null,
  color_group    int,
  yarn_name      text not null,
  brand          text,
  meterage_m     numeric,
  skein_weight_g numeric,
  fiber          text,
  source         text not null default 'pattern' check (source in ('pattern', 'app')),
  uncertain      boolean not null default false
);

-- size_id null: samme for alle størrelser.
create table if not exists strikk_accessory (
  id           uuid primary key default gen_random_uuid(),
  oppskrift_id uuid not null references strikk_oppskrift(id) on delete cascade,
  size_id      uuid references strikk_size(id) on delete cascade,
  kind         text not null check (kind in ('buttons', 'zipper', 'elastic', 'other')),
  description  text,
  quantity     numeric,
  dimension    text,
  uncertain    boolean not null default false
);

create index if not exists strikk_size_oppskrift_idx on strikk_size (oppskrift_id);
create index if not exists strikk_yarn_line_oppskrift_idx on strikk_yarn_line (oppskrift_id);
create index if not exists strikk_yarn_amount_oppskrift_idx on strikk_yarn_amount (oppskrift_id);
create index if not exists strikk_yarn_alternative_oppskrift_idx on strikk_yarn_alternative (oppskrift_id);
create index if not exists strikk_accessory_oppskrift_idx on strikk_accessory (oppskrift_id);

do $$
declare t text;
begin
  foreach t in array array['strikk_size', 'strikk_yarn_line', 'strikk_yarn_amount',
                           'strikk_yarn_alternative', 'strikk_accessory'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'Allow all') then
      execute format('create policy "Allow all" on %I for all using (true) with check (true)', t);
    end if;
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

-- Lagrer et normalisert uttrekk (se src/app/strikk/_lib/extraction.ts for formen på
-- p_data). Indeksene i p_data (size, yarn_line) peker inn i listene i samme dokument.
--
-- p_approve = false: et nytt uttrekk. Status blir 'extracted'.
-- p_approve = true:  gjennomgått og rettet. Status blir 'approved', og title/designer
--                    på oppskriften settes fra p_data.
-- Returnerer 'saved', 'approved', 'locked' (allerede godkjent, ingenting endret) eller
-- 'missing'.
create or replace function strikk_save_extraction(p_id uuid, p_data jsonb, p_approve boolean default false)
returns text
language plpgsql
security invoker
as $$
declare
  v_status   text;
  v_sizes    uuid[] := '{}';
  v_lines    uuid[] := '{}';
  v_id       uuid;
  r          jsonb;
  v_size_ix  int;
  v_line_ix  int;
begin
  select extraction_status into v_status from strikk_oppskrift where id = p_id for update;
  if not found then return 'missing'; end if;
  if v_status = 'approved' then return 'locked'; end if;

  delete from strikk_accessory where oppskrift_id = p_id;
  delete from strikk_yarn_amount where oppskrift_id = p_id;
  delete from strikk_yarn_alternative where oppskrift_id = p_id and source = 'pattern';
  delete from strikk_yarn_line where oppskrift_id = p_id;
  delete from strikk_size where oppskrift_id = p_id;

  for r in select * from jsonb_array_elements(coalesce(p_data->'sizes', '[]')) loop
    insert into strikk_size (oppskrift_id, position, label, uncertain)
    values (p_id, coalesce(array_length(v_sizes, 1), 0), r->>'label', coalesce((r->>'uncertain')::boolean, false))
    returning id into v_id;
    v_sizes := v_sizes || v_id;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data->'yarn_lines', '[]')) loop
    insert into strikk_yarn_line (oppskrift_id, position, color_group, color_label, yarn_name, brand,
                                  meterage_m, skein_weight_g, fiber, strands, uncertain_fields)
    values (p_id, coalesce(array_length(v_lines, 1), 0), (r->>'color_group')::int, r->>'color_label',
            r->>'yarn_name', r->>'brand', (r->>'meterage_m')::numeric, (r->>'skein_weight_g')::numeric,
            r->>'fiber', coalesce((r->>'strands')::int, 1),
            coalesce(array(select jsonb_array_elements_text(r->'uncertain_fields')), '{}'))
    returning id into v_id;
    v_lines := v_lines || v_id;
  end loop;

  -- jsonb indexes are 0-based, Postgres arrays 1-based.
  for r in select * from jsonb_array_elements(coalesce(p_data->'amounts', '[]')) loop
    v_size_ix := (r->>'size')::int;
    v_line_ix := (r->>'yarn_line')::int;
    if v_size_ix is null or v_sizes[v_size_ix + 1] is null then
      raise exception 'amount points at missing size %', r->>'size';
    end if;
    insert into strikk_yarn_amount (oppskrift_id, size_id, color_group, yarn_line_id, amount, unit,
                                    candidates, needs_choice, uncertain)
    values (p_id, v_sizes[v_size_ix + 1], (r->>'color_group')::int,
            case when v_line_ix is null then null else v_lines[v_line_ix + 1] end,
            (r->>'amount')::numeric, r->>'unit',
            coalesce(array(select jsonb_array_elements_text(r->'candidates')), '{}'),
            coalesce((r->>'needs_choice')::boolean, false), coalesce((r->>'uncertain')::boolean, false));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data->'alternatives', '[]')) loop
    v_line_ix := (r->>'yarn_line')::int;
    insert into strikk_yarn_alternative (oppskrift_id, yarn_line_id, color_group, yarn_name, brand,
                                         meterage_m, skein_weight_g, fiber, source, uncertain)
    values (p_id, case when v_line_ix is null then null else v_lines[v_line_ix + 1] end,
            (r->>'color_group')::int, r->>'yarn_name', r->>'brand', (r->>'meterage_m')::numeric,
            (r->>'skein_weight_g')::numeric, r->>'fiber', 'pattern', coalesce((r->>'uncertain')::boolean, false));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data->'accessories', '[]')) loop
    v_size_ix := (r->>'size')::int;
    insert into strikk_accessory (oppskrift_id, size_id, kind, description, quantity, dimension, uncertain)
    values (p_id, case when v_size_ix is null then null else v_sizes[v_size_ix + 1] end,
            r->>'kind', r->>'description', (r->>'quantity')::numeric, r->>'dimension',
            coalesce((r->>'uncertain')::boolean, false));
  end loop;

  update strikk_oppskrift set
    extracted_title     = p_data->>'title',
    extracted_designer  = p_data->>'designer',
    audience            = p_data->>'audience',
    garment_type        = p_data->>'garment_type',
    gauge_stitches_10cm = (p_data->>'gauge_stitches_10cm')::numeric,
    gauge_rows_10cm     = (p_data->>'gauge_rows_10cm')::numeric,
    gauge_note          = p_data->>'gauge_note',
    needles             = coalesce(array(select jsonb_array_elements_text(p_data->'needles')), '{}'),
    variants            = coalesce(array(select jsonb_array_elements_text(p_data->'variants')), '{}'),
    is_collection       = coalesce((p_data->>'is_collection')::boolean, false),
    collection_titles   = coalesce(array(select jsonb_array_elements_text(p_data->'collection_titles')), '{}'),
    uncertain_fields    = coalesce(array(select jsonb_array_elements_text(p_data->'uncertain_fields')), '{}'),
    extraction_pages    = case when p_approve then extraction_pages
                               else coalesce(array(select (jsonb_array_elements_text(p_data->'pages'))::int), '{}') end,
    extraction_raw      = case when p_approve then extraction_raw else p_data->'raw' end,
    extraction_status   = case when p_approve then 'approved' else 'extracted' end,
    extraction_error    = null,
    extracted_at        = case when p_approve then extracted_at else now() end,
    approved_at         = case when p_approve then now() else approved_at end,
    title               = case when p_approve and coalesce(p_data->>'title', '') <> '' then p_data->>'title' else title end,
    designer            = case when p_approve then nullif(p_data->>'designer', '') else designer end,
    updated_at          = now()
  where id = p_id;

  return case when p_approve then 'approved' else 'saved' end;
end;
$$;

revoke all on function strikk_save_extraction(uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function strikk_save_extraction(uuid, jsonb, boolean) to service_role;
