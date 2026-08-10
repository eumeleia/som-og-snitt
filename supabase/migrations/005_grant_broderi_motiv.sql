-- Migration 004 opprettet RLS-policy "Allow all" på broderi_motiv, men RLS er ikke
-- nok alene — Postgres krever et eksplisitt GRANT på tabellen for PostgREST-rollene
-- før policyen får virke. Bekreftet i produksjon: anon fikk "permission denied for
-- table broderi_motiv" (42501) ved lesing, selv med RLS-policyen på plass.
-- (embroidery-tabellen har tilsynelatende fått dette gjennom Supabase sin
-- Table Editor-UI, som legger på GRANT automatisk — det gjør ikke en ren SQL-migrasjon.)

grant select, insert, update, delete on broderi_motiv to anon, authenticated, service_role;
