-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
--
-- Finner filer i en Storage-bøtte som ingen rad i basen nevner. Sammenligningen
-- gjøres mot HELE radens tekst i hver tabell, ikke mot utvalgte kolonner: en
-- tidligere versjon som slo opp i pdfs/images/stoffer meldte 150 inventory-bilder
-- som foreldreløse, fordi den aldri så i inventory-tabellen. Et feltbasert søk
-- kan alltid gå glipp av et felt; et radbasert kan ikke.
--
-- broderi_motiv er utelatt med vilje: den peker bare på embroidery-files, og
-- miniatyr_svg ville dratt titalls MB inn i sammenligningen uten å bidra.
--
-- Funksjonen LESER bare. Sletting skjer via Storage-API-et i /api/opprydding,
-- fordi «delete from storage.objects» fjerner bokføringen og lar filen ligge.

create or replace function foreldrelose_filer(bkt text)
returns table (navn text, bytes bigint)
language plpgsql
as $$
declare
  alt text;
begin
  select string_agg(t, ' ') into alt from (
    select x::text as t from app_config x
    union all select x::text from boksmia_approved_words x
    union all select x::text from boksmia_books x
    union all select x::text from boksmia_chapters x
    union all select x::text from boksmia_corrections x
    union all select x::text from boksmia_jobs x
    union all select x::text from boksmia_learned_terms x
    union all select x::text from boksmia_push_subscriptions x
    union all select x::text from boksmia_series x
    union all select x::text from boksmia_spell_candidates x
    union all select x::text from broderi_komposisjon x
    union all select x::text from embroidery x
    union all select x::text from embroidery_bundles x
    union all select x::text from inventory x
    union all select x::text from projects x
    union all select x::text from recipes x
    union all select x::text from scan_jobs x
    union all select x::text from scan_pages x
    union all select x::text from scan_repairs x
    union all select x::text from techniques x
  ) s;

  return query
    select o.name::text,
           coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
    where o.bucket_id = bkt
      and position(o.name in coalesce(alt, '')) = 0
    order by coalesce((o.metadata->>'size')::bigint, 0) desc;
end $$;

grant execute on function foreldrelose_filer(text) to service_role;
