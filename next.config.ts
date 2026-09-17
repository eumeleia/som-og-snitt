import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp laster sitt native bibliotek via en optional dependency Next sin egen
  // filsporing ikke fanger opp i produksjon — funksjonen kræsjer i kjøretid med
  // "libvips-cpp.so.8.18.6: cannot open shared object file", bygget sier ingenting.
  // outputFileTracingIncludes er RUTESPESIFIKK — hver rute som importerer sharp (direkte
  // eller via lib/heic.ts) må stå med sin egen nøkkel her, ellers krasjer DEN ruta likt.
  outputFileTracingIncludes: {
    '/api/les-kvittering': [
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
    ],
    '/api/lagre-produktbilde': [
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
    ],
  },
};

export default nextConfig;
