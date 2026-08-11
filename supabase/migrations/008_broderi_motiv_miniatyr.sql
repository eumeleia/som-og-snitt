-- KJØR DETTE SKRIPTET I SUPABASE SQL EDITOR (ikke via migreringspipeline).
-- Det legger til kolonnen miniatyr_svg på broderi_motiv-tabellen.
-- Eksisterende grants fra migration 005 dekker nye kolonner automatisk.
-- Ingen indeks — kolonnen er aldri et filter- eller sorteringskriterium.

-- Rapport: motiver der "størrelsene" har ulikt format (kjøres separat i Supabase SQL editor)
--
-- WITH sizes_with_ratio AS (
--   SELECT
--     bm.embroidery_id,
--     e.data->>'navn' AS navn,
--     bm.bredde_tiendedel_mm::float / NULLIF(bm.hoyde_tiendedel_mm, 0) AS ratio
--   FROM broderi_motiv bm
--   JOIN embroidery e ON e.id = bm.embroidery_id
--   WHERE bm.bredde_tiendedel_mm IS NOT NULL AND bm.hoyde_tiendedel_mm > 0
-- ),
-- varianter AS (
--   SELECT embroidery_id, navn,
--     COUNT(*) AS antall_storr,
--     ROUND((MAX(ratio) - MIN(ratio)) / NULLIF(AVG(ratio), 0) * 100, 1) AS pst_variasjon
--   FROM sizes_with_ratio GROUP BY embroidery_id, navn
--   HAVING COUNT(*) > 1
--     AND (MAX(ratio) - MIN(ratio)) / NULLIF(AVG(ratio), 0) > 0.03
-- )
-- SELECT *, (SELECT COUNT(*) FROM varianter) AS antall_motiver_totalt FROM varianter ORDER BY pst_variasjon DESC;

alter table broderi_motiv
  add column if not exists miniatyr_svg text;
