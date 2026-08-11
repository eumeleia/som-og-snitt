-- Motivvelgeren måtte lese data->bbox for alle rader i broderi_motiv for å vite hvilke
-- motiver som passer i 100×100 mm-rammen — men data inneholder også stingblokker og
-- fargekjøringer (alle stingkoordinatene, kan være over 10 000 punkter per rad), så det
-- hentet ned langt mer enn nødvendig og gikk i timeout. Bredde og høyde flyttes derfor ut i
-- egne kolonner, i samme enhet parseren skriver (1/10 mm — se api/parse-pes/index.py), slik
-- at velgeren kan filtrere/telle uten å røre data-kolonnen i det hele tatt.
--
-- data-jsonb-en forblir kilden for stingdata. Disse kolonnene er avledet av data->bbox og
-- kan bygges opp igjen fra den ved behov (se backfillen nedenfor).

alter table broderi_motiv
  add column if not exists bredde_tiendedel_mm integer,
  add column if not exists hoyde_tiendedel_mm integer;

update broderi_motiv
set
  bredde_tiendedel_mm = (data->'bbox'->>'max_x')::numeric::integer - (data->'bbox'->>'min_x')::numeric::integer,
  hoyde_tiendedel_mm  = (data->'bbox'->>'max_y')::numeric::integer - (data->'bbox'->>'min_y')::numeric::integer
where data->'bbox' is not null
  and bredde_tiendedel_mm is null;

create index if not exists broderi_motiv_bredde_idx on broderi_motiv (bredde_tiendedel_mm);
create index if not exists broderi_motiv_hoyde_idx on broderi_motiv (hoyde_tiendedel_mm);

-- Kjør dette skriptet i Supabase SQL editor — verifiseringstallet under kan ikke hentes
-- trygt herfra: en spørring mot data->bbox over hele tabellen er nøyaktig den samme
-- TOAST-dekomprimeringskostnaden per rad som er årsaken til treg lasting i utgangspunktet,
-- så å teste den fra utsiden ville risikert å reprodusere problemet i stedet for å bekrefte
-- fiksen. Etter migreringen er dette derimot en billig spørring (bare de nye int-kolonnene,
-- ingen jsonb) — kjør den og se selve tallet i outputen. Forventet: 0.
select count(*) as mangler_maal
from broderi_motiv
where bredde_tiendedel_mm is null or hoyde_tiendedel_mm is null;
