-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Rettelser i uttrekket i Strikk (bygger på 014):
--   * garnmengde som spenn (amount = fra, amount_max = til) og amount_calc, verdien appen
--     regner med: den høyeste
--   * en kort begrunnelse for hvert usikre felt
--   * siden i PDF-en der garnmengden står
--   * rettelser gjort ved godkjenning, brukt som eksempler i neste uttrekk
--   * godkjente oppskrifter kan rettes fra Gjennomgang; et uttrekk endrer dem fortsatt ikke
--
-- Kun nye kolonner og en ny tabell; ingen eksisterende rad endres.

alter table strikk_oppskrift
  add column if not exists amounts_page int,
  -- {feltnavn: begrunnelse} for feltene i uncertain_fields
  add column if not exists uncertain_reasons jsonb not null default '{}';

alter table strikk_yarn_line
  add column if not exists uncertain_reasons jsonb not null default '{}';

alter table strikk_size add column if not exists uncertain_reason text;
alter table strikk_yarn_alternative add column if not exists uncertain_reason text;
alter table strikk_accessory add column if not exists uncertain_reason text;

alter table strikk_yarn_amount
  add column if not exists amount_max numeric,
  add column if not exists uncertain_reason text;
alter table strikk_yarn_amount
  add column if not exists amount_calc numeric generated always as (coalesce(amount_max, amount)) stored;

create table if not exists strikk_extraction_correction (
  id           uuid primary key default gen_random_uuid(),
  oppskrift_id uuid references strikk_oppskrift(id) on delete cascade,
  recipe_title text not null,
  -- Lesbar sti, f.eks. «Garnmengde 6-7 år / Sunday».
  field        text not null,
  extracted    text,
  corrected    text,
  created_at   timestamptz not null default now()
);
create index if not exists strikk_extraction_correction_created_idx on strikk_extraction_correction (created_at desc);

alter table strikk_extraction_correction enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'strikk_extraction_correction' and policyname = 'Allow all') then
    create policy "Allow all" on strikk_extraction_correction for all using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on strikk_extraction_correction to service_role;
grant select on strikk_extraction_correction to anon, authenticated;

-- Ny signatur (p_edit_approved). Den gamle må bort, ellers blir et kall med tre navngitte
-- argumenter tvetydig mellom de to.
drop function if exists strikk_save_extraction(uuid, jsonb, boolean);

-- p_approve = false: et nytt uttrekk. Status blir 'extracted'. Låst for godkjente.
-- p_approve = true:  gjennomgått og rettet. Status blir 'approved'.
-- p_edit_approved:   sammen med p_approve, retter en oppskrift som allerede er godkjent.
-- Returnerer 'saved', 'approved', 'locked' eller 'missing'.
create or replace function strikk_save_extraction(
  p_id uuid, p_data jsonb, p_approve boolean default false, p_edit_approved boolean default false
)
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
  if v_status = 'approved' and not (p_approve and p_edit_approved) then return 'locked'; end if;

  delete from strikk_accessory where oppskrift_id = p_id;
  delete from strikk_yarn_amount where oppskrift_id = p_id;
  delete from strikk_yarn_alternative where oppskrift_id = p_id and source = 'pattern';
  delete from strikk_yarn_line where oppskrift_id = p_id;
  delete from strikk_size where oppskrift_id = p_id;

  for r in select * from jsonb_array_elements(coalesce(p_data->'sizes', '[]')) loop
    insert into strikk_size (oppskrift_id, position, label, uncertain, uncertain_reason)
    values (p_id, coalesce(array_length(v_sizes, 1), 0), r->>'label',
            coalesce((r->>'uncertain')::boolean, false), r->>'uncertain_reason')
    returning id into v_id;
    v_sizes := v_sizes || v_id;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data->'yarn_lines', '[]')) loop
    insert into strikk_yarn_line (oppskrift_id, position, color_group, color_label, yarn_name, brand,
                                  meterage_m, skein_weight_g, fiber, strands, uncertain_fields, uncertain_reasons)
    values (p_id, coalesce(array_length(v_lines, 1), 0), (r->>'color_group')::int, r->>'color_label',
            r->>'yarn_name', r->>'brand', (r->>'meterage_m')::numeric, (r->>'skein_weight_g')::numeric,
            r->>'fiber', coalesce((r->>'strands')::int, 1),
            coalesce(array(select jsonb_array_elements_text(r->'uncertain_fields')), '{}'),
            coalesce(r->'uncertain_reasons', '{}'))
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
    insert into strikk_yarn_amount (oppskrift_id, size_id, color_group, yarn_line_id, amount, amount_max, unit,
                                    candidates, needs_choice, uncertain, uncertain_reason)
    values (p_id, v_sizes[v_size_ix + 1], (r->>'color_group')::int,
            case when v_line_ix is null then null else v_lines[v_line_ix + 1] end,
            (r->>'amount')::numeric, (r->>'amount_max')::numeric, r->>'unit',
            coalesce(array(select jsonb_array_elements_text(r->'candidates')), '{}'),
            coalesce((r->>'needs_choice')::boolean, false), coalesce((r->>'uncertain')::boolean, false),
            r->>'uncertain_reason');
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data->'alternatives', '[]')) loop
    v_line_ix := (r->>'yarn_line')::int;
    insert into strikk_yarn_alternative (oppskrift_id, yarn_line_id, color_group, yarn_name, brand,
                                         meterage_m, skein_weight_g, fiber, source, uncertain, uncertain_reason)
    values (p_id, case when v_line_ix is null then null else v_lines[v_line_ix + 1] end,
            (r->>'color_group')::int, r->>'yarn_name', r->>'brand', (r->>'meterage_m')::numeric,
            (r->>'skein_weight_g')::numeric, r->>'fiber', 'pattern', coalesce((r->>'uncertain')::boolean, false),
            r->>'uncertain_reason');
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_data->'accessories', '[]')) loop
    v_size_ix := (r->>'size')::int;
    insert into strikk_accessory (oppskrift_id, size_id, kind, description, quantity, dimension, uncertain, uncertain_reason)
    values (p_id, case when v_size_ix is null then null else v_sizes[v_size_ix + 1] end,
            r->>'kind', r->>'description', (r->>'quantity')::numeric, r->>'dimension',
            coalesce((r->>'uncertain')::boolean, false), r->>'uncertain_reason');
  end loop;

  update strikk_oppskrift set
    extracted_title     = case when p_approve then extracted_title else p_data->>'title' end,
    extracted_designer  = case when p_approve then extracted_designer else p_data->>'designer' end,
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
    uncertain_reasons   = coalesce(p_data->'uncertain_reasons', '{}'),
    amounts_page        = (p_data->>'amounts_page')::int,
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

revoke all on function strikk_save_extraction(uuid, jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function strikk_save_extraction(uuid, jsonb, boolean, boolean) to service_role;
