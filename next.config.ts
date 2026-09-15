import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp (brukt av lib/heic.ts, kun for /api/les-kvittering) laster sitt native bibliotek
  // via en optional dependency Next sin egen filsporing ikke fanger opp i produksjon —
  // funksjonen kræsjet i kjøretid med "libvips-cpp.so.8.18.6: cannot open shared object
  // file". Sporer begge linux-x64-pakkene inn manuelt. Ingen annen rute bruker sharp.
  outputFileTracingIncludes: {
    '/api/les-kvittering': [
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
    ],
  },
};

export default nextConfig;
