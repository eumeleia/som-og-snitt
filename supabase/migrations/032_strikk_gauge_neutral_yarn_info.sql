-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Strikk › Garnlager › Alternativt garn: strikkefasthetskalkulatoren og Tilia med dobbel tråd.
--
-- 1. strikk_yarn.gauge_neutral: garn som etter katalogen ikke påvirker strikkefastheten
--    (følgetråder som Dale Garn Bling). Kalkulatoren tar dem med uten å regne dem inn.
-- 2. strikk_yarn_combo.source får verdien 'yarn_info': garnets egne opplysninger fra produsent
--    eller forhandler, for eksempel strikkefasthet med dobbel tråd.
-- 3. Data: Bling merkes, og «Filcolana Tilia, 2 tråder» legges inn som kombinasjon.
--
-- Kan kjøres flere ganger.

alter table strikk_yarn add column if not exists gauge_neutral boolean not null default false;

alter table strikk_yarn_combo drop constraint if exists strikk_yarn_combo_source_check;
alter table strikk_yarn_combo add constraint strikk_yarn_combo_source_check
  check (source in ('skaberglaede', 'drops', 'yarn_info'));

-- Linde Hobby: «Dale BLING easily integrates with other yarn qualities without affecting the
-- knitting tension.»
update strikk_yarn set gauge_neutral = true where brand = 'Dale Garn' and name = 'Bling';

-- Tilia med dobbel tråd: ca. 19–21 m = 10 cm på pinne 4–5 (opplyst av Maria; Saturnia Garn
-- oppgir «4,5 - 5 mm med dobbel tråd»). Midten lagres; spennet står i notatet.
do $$
declare
  tilia uuid;
  combo uuid;
begin
  select id into tilia from strikk_yarn where brand = 'Filcolana' and name = 'Tilia';
  if tilia is null then return; end if;
  if exists (
    select 1 from strikk_yarn_combo c join strikk_yarn_combo_member m on m.combo_id = c.id
    where c.source = 'yarn_info' and m.yarn_id = tilia and m.strands = 2
  ) then return; end if;
  insert into strikk_yarn_combo (source, source_url, stitch_pattern, gauge_stitches_10cm, needle_mm, note)
  values ('yarn_info', 'https://shop.saturniagarn.no/categories/tilia', 'glattstrikk', 20, 4.5,
          'Dobbel tråd: ca. 19–21 m = 10 cm, pinne 4–5 (opplyst av Maria; Saturnia Garn: 4,5–5 mm)')
  returning id into combo;
  insert into strikk_yarn_combo_member (combo_id, position, yarn_id, strands) values (combo, 0, tilia, 2);
end $$;
