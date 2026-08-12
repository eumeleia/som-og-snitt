// Dummy-verdier BARE for at moduler som leser disse ved import-tid (f.eks.
// src/lib/drive-helpers.ts og src/lib/supabase.ts sine `createClient(url!, key!)` på
// toppnivå — supabase.ts sin eksporterte klient bygges ØYEBLIKKELIG ved import, ikke
// lazy) ikke kaster ved selve importen når testfiler laster dem (f.eks.
// minTraadpalett.ts, som importeres ikke-type-only i sekvens.test.ts for
// byggPecTilEkteMap). Ingen av testene som trigger dette kaller faktisk noe som gjør et
// ekte nettverkskall. `??=` rører aldri en allerede satt verdi, så en ekte .env.local (om
// vitest en gang kjøres med en lastet) beholder forrang.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
