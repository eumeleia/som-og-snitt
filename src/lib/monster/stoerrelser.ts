/**
 * STANDARDMÅLTABELLER
 *
 * Kilde: Aldrich, barneboka, bokside 16 (babywear 56–92 cm).
 * Alle mål i cm. Nøkler følger MAAL[].id i maal.ts.
 *
 * Bokstavene i kommentarene (B, C, D …) er Aldrichs egne referanser
 * til måldiagrammet, så det er lett å slå opp hvor på kroppen målet tas.
 *
 * Kontroll: str. 64 er krysssjekket mot regneeksempelet i bokteksten
 * (bokside 24 og 28) — alle tolv verdiene stemmer.
 */

export interface StandardRad {
  nokkel: string
  type: 'barn' | 'voksen'
  kjonn?: 'jente' | 'gutt' | 'unisex' | 'dame'
  alder?: string
  vektKg?: string
  maal: Record<string, number>
  kilde: string
}

const K  = 'Aldrich barneboka s.16 (baby, unisex)'
const KJ = 'Aldrich barneboka s.17 (jenter 3–14 år)'
const KG = 'Aldrich barneboka s.18 (gutter 3–14 år)'
const KD = 'Aldrich dameboka, damestørrelser (BS EN 13402-3, høyde 160–172 cm)'

export const STANDARD: StandardRad[] = [
  {
    nokkel: '56', type: 'barn', kjonn: 'unisex', alder: 'nyfødt', vektKg: '4–5', kilde: K,
    maal: {
      bryst: 41,            // B
      midje: 41,            // C
      hofte: 41,            // D
      ryggbredde: 16.8,     // E
      halsvidde: 22,        // F
      skulder: 4.4,         // G–H
      overarm: 14.4,        // I
      haandledd: 9.8,       // J
      ermegapDybde: 9,      // K–L
      nakkeTilMidje: 15.8,  // K–M
      midjeTilHofte: 7,     // M–N
      nakkehoeyde: 42.2,    // K–O
      midjeTilKne: 20.2,    // M–P
      skrittdybde: 10.2,    // Q–R
      innsideBen: 16,       // S–O
      ermelengde: 19.2,     // H–T
      hodeomkrets: 42.5,    // U
      vertikalOmkrets: 66,  // V
      ankel: 11,            // W
      fotlengde: 8.4,       // X–Y
    },
  },
  {
    nokkel: '64', type: 'barn', kjonn: 'unisex', alder: '3 mnd', vektKg: '6–7', kilde: K,
    maal: {
      bryst: 44, midje: 43, hofte: 44, ryggbredde: 18, halsvidde: 23,
      skulder: 5, overarm: 15.2, haandledd: 10.4, ermegapDybde: 9.8,
      nakkeTilMidje: 17.4, midjeTilHofte: 8, nakkehoeyde: 49.4,
      midjeTilKne: 22.8, skrittdybde: 11.5, innsideBen: 21, ermelengde: 22,
      hodeomkrets: 44.5, vertikalOmkrets: 73, ankel: 12, fotlengde: 9.6,
    },
  },
  {
    nokkel: '72', type: 'barn', kjonn: 'unisex', alder: '6 mnd', vektKg: '8', kilde: K,
    maal: {
      bryst: 47, midje: 45, hofte: 47, ryggbredde: 19.2, halsvidde: 24,
      skulder: 5.6, overarm: 16, haandledd: 11, ermegapDybde: 10.6,
      nakkeTilMidje: 19, midjeTilHofte: 9, nakkehoeyde: 56.6,
      midjeTilKne: 25.4, skrittdybde: 12.8, innsideBen: 26, ermelengde: 24.8,
      hodeomkrets: 46.5, vertikalOmkrets: 80, ankel: 13, fotlengde: 10.8,
    },
  },
  {
    nokkel: '80', type: 'barn', kjonn: 'unisex', alder: '12 mnd', vektKg: '9–10', kilde: K,
    maal: {
      bryst: 50, midje: 47, hofte: 50, ryggbredde: 20.4, halsvidde: 25,
      skulder: 6.2, overarm: 16.8, haandledd: 11.6, ermegapDybde: 11.4,
      nakkeTilMidje: 20.6, midjeTilHofte: 10, nakkehoeyde: 63.8,
      midjeTilKne: 28, skrittdybde: 14.1, innsideBen: 31, ermelengde: 27.6,
      hodeomkrets: 48.5, vertikalOmkrets: 87, ankel: 14, fotlengde: 12,
      // Plaggmål, gjelder fra str. 80
      mansjett: 9.4,        // todelt erm
      mansjettSkjorte: 14.5,
      buksevidde: 14.5,
      jeansvidde: 12.5,     // Skanningen viste «2.5»; rekken 12.5/13/13.5 er
                            // regelmessig og stemmer med barnetabellene, så 12.5.
    },
  },
  {
    nokkel: '86', type: 'barn', kjonn: 'unisex', alder: '18 mnd', vektKg: '11–12', kilde: K,
    maal: {
      bryst: 52, midje: 49, hofte: 52, ryggbredde: 21.2, halsvidde: 25.5,
      skulder: 6.6, overarm: 17.4, haandledd: 12, ermegapDybde: 12,
      nakkeTilMidje: 21.8, midjeTilHofte: 10.75, nakkehoeyde: 69.2,
      midjeTilKne: 30, skrittdybde: 14.9, innsideBen: 34.5, ermelengde: 29.8,
      hodeomkrets: 49.5, vertikalOmkrets: 92, ankel: 14.5, fotlengde: 13,
      mansjett: 9.7, mansjettSkjorte: 14.8, buksevidde: 15, jeansvidde: 13,
    },
  },
  {
    nokkel: '92', type: 'barn', kjonn: 'unisex', alder: '2 år', kilde: K,
    maal: {
      bryst: 54, midje: 51, hofte: 54, ryggbredde: 22, halsvidde: 26,
      skulder: 7, overarm: 18, haandledd: 12.4, ermegapDybde: 12.6,
      nakkeTilMidje: 23, midjeTilHofte: 11.5, nakkehoeyde: 74.6,
      midjeTilKne: 32, skrittdybde: 15.7, innsideBen: 38, ermelengde: 32,
      hodeomkrets: 50.5, vertikalOmkrets: 97, ankel: 15, fotlengde: 14,
      mansjett: 10, mansjettSkjorte: 15.1, buksevidde: 15.5, jeansvidde: 13.5,
    },
  },

  // ══════════ JENTER 3–14 år, 98–164 cm ══════════
  { nokkel: '98', type: 'barn', kjonn: 'jente', alder: '3 år', kilde: KJ,
    maal: { bryst: 55, midje: 52, hofte: 56, ryggbredde: 22.8, halsvidde: 26.6, skulder: 7.4, overarm: 18.5, haandledd: 12.8, ermegapDybde: 13.2, nakkeTilMidje: 24.2, midjeTilHofte: 12.3, nakkehoeyde: 80, midjeTilKne: 34, skrittdybde: 16.8, innsideBen: 41, ermelengde: 34, hodeomkrets: 51.2, ankel: 15.5, mansjett: 10.2, mansjettSkjorte: 15.4, buksevidde: 16, jeansvidde: 13.5 } },
  { nokkel: '104', type: 'barn', kjonn: 'jente', alder: '4 år', kilde: KJ,
    maal: { bryst: 57, midje: 54, hofte: 59, ryggbredde: 23.6, halsvidde: 27.2, skulder: 7.8, overarm: 19, haandledd: 13, ermegapDybde: 13.8, nakkeTilMidje: 25.4, midjeTilHofte: 12.9, nakkehoeyde: 85.4, midjeTilKne: 36, skrittdybde: 17.6, innsideBen: 44.5, ermelengde: 36.5, hodeomkrets: 51.8, ankel: 16, mansjett: 10.4, mansjettSkjorte: 15.8, buksevidde: 16.5, jeansvidde: 14 } },
  { nokkel: '110', type: 'barn', kjonn: 'jente', alder: '5 år', kilde: KJ,
    maal: { bryst: 59, midje: 56, hofte: 62, ryggbredde: 24.4, halsvidde: 27.8, skulder: 8.2, overarm: 19.5, haandledd: 13.2, ermegapDybde: 14.4, nakkeTilMidje: 26.6, midjeTilHofte: 13.5, nakkehoeyde: 90.8, midjeTilKne: 38, skrittdybde: 18.4, innsideBen: 48, ermelengde: 39, hodeomkrets: 52.4, ankel: 16.5, mansjett: 10.6, mansjettSkjorte: 16.2, buksevidde: 17, jeansvidde: 14.5 } },
  { nokkel: '116', type: 'barn', kjonn: 'jente', alder: '6 år', kilde: KJ,
    maal: { bryst: 61, midje: 58, hofte: 65, ryggbredde: 25.2, halsvidde: 28.4, skulder: 8.6, overarm: 20, haandledd: 13.4, ermegapDybde: 15, nakkeTilMidje: 27.8, midjeTilHofte: 14.1, nakkehoeyde: 96.2, midjeTilKne: 40, skrittdybde: 19.2, innsideBen: 51.5, ermelengde: 41.5, hodeomkrets: 53, ankel: 17, mansjett: 10.8, mansjettSkjorte: 16.6, buksevidde: 17.5, jeansvidde: 15 } },
  { nokkel: '122', type: 'barn', kjonn: 'jente', alder: '7 år', kilde: KJ,
    maal: { bryst: 63, midje: 60, hofte: 68, ryggbredde: 26, halsvidde: 29, skulder: 9, overarm: 20.5, haandledd: 13.6, ermegapDybde: 15.6, nakkeTilMidje: 29, midjeTilHofte: 14.7, nakkehoeyde: 101.6, midjeTilKne: 42, skrittdybde: 20, innsideBen: 55, ermelengde: 44, hodeomkrets: 53.6, ankel: 17.5, mansjett: 11, mansjettSkjorte: 17, buksevidde: 18, jeansvidde: 15.5 } },
  { nokkel: '128', type: 'barn', kjonn: 'jente', alder: '8 år', kilde: KJ,
    maal: { bryst: 66, midje: 61, hofte: 71, ryggbredde: 27.1, halsvidde: 30, skulder: 9.5, overarm: 21.3, haandledd: 13.9, ermegapDybde: 16.3, nakkeTilMidje: 30.4, midjeTilHofte: 15.4, nakkehoeyde: 107, midjeTilKne: 44.2, skrittdybde: 21, innsideBen: 58, ermelengde: 46, hodeomkrets: 54, ankel: 18, mansjett: 11.4, mansjettSkjorte: 17.5, buksevidde: 18.5, jeansvidde: 16 } },
  { nokkel: '134', type: 'barn', kjonn: 'jente', alder: '9 år', kilde: KJ,
    maal: { bryst: 69, midje: 62, hofte: 74, ryggbredde: 28.2, halsvidde: 31, skulder: 10, overarm: 22.1, haandledd: 14.2, ermegapDybde: 17, nakkeTilMidje: 31.8, midjeTilHofte: 16.1, nakkehoeyde: 112.4, midjeTilKne: 46.4, skrittdybde: 22, innsideBen: 61, ermelengde: 48, hodeomkrets: 54.4, ankel: 18.5, mansjett: 11.8, mansjettSkjorte: 18, buksevidde: 19, jeansvidde: 16.5 } },
  { nokkel: '140', type: 'barn', kjonn: 'jente', alder: '10 år', kilde: KJ,
    maal: { bryst: 72, midje: 63, hofte: 77, ryggbredde: 29.3, halsvidde: 32, skulder: 10.5, overarm: 22.9, haandledd: 14.5, ermegapDybde: 17.7, nakkeTilMidje: 33.2, midjeTilHofte: 16.8, nakkehoeyde: 117.8, midjeTilKne: 48.6, skrittdybde: 23, innsideBen: 64, ermelengde: 50, hodeomkrets: 54.8, ankel: 19, mansjett: 12.2, mansjettSkjorte: 18.5, buksevidde: 19.5, jeansvidde: 17 } },
  { nokkel: '146', type: 'barn', kjonn: 'jente', alder: '11 år', kilde: KJ,
    maal: { bryst: 75, midje: 64, hofte: 80, ryggbredde: 30.4, halsvidde: 33, skulder: 11, overarm: 23.7, haandledd: 14.8, ermegapDybde: 18.4, nakkeTilMidje: 34.6, midjeTilHofte: 17.5, nakkehoeyde: 123.2, midjeTilKne: 50.8, skrittdybde: 24, innsideBen: 67, ermelengde: 52, hodeomkrets: 55.2, ankel: 19.5, mansjett: 12.6, mansjettSkjorte: 19.5, buksevidde: 20, jeansvidde: 17.5 } },
  { nokkel: '152', type: 'barn', kjonn: 'jente', alder: '12 år', kilde: KJ,
    maal: { bryst: 78, midje: 65, hofte: 83, ryggbredde: 31.5, halsvidde: 34, skulder: 11.5, overarm: 24.5, haandledd: 15.1, ermegapDybde: 19.1, nakkeTilMidje: 36, midjeTilHofte: 18.2, nakkehoeyde: 128.6, midjeTilKne: 53, skrittdybde: 25, innsideBen: 70, ermelengde: 54, hodeomkrets: 55.6, ankel: 20, mansjett: 13, mansjettSkjorte: 20, buksevidde: 20.5, jeansvidde: 18 } },
  { nokkel: '158', type: 'barn', kjonn: 'jente', alder: '13 år', kilde: KJ,
    maal: { bryst: 81, midje: 66, hofte: 86, ryggbredde: 32.6, halsvidde: 35, skulder: 12, overarm: 25.3, haandledd: 15.4, ermegapDybde: 19.8, nakkeTilMidje: 37.4, midjeTilHofte: 18.9, nakkehoeyde: 134, midjeTilKne: 55.2, skrittdybde: 26, innsideBen: 73, ermelengde: 56, hodeomkrets: 56, ankel: 20.5, mansjett: 13.4, mansjettSkjorte: 20.5, buksevidde: 21, jeansvidde: 18.5 } },
  { nokkel: '164', type: 'barn', kjonn: 'jente', alder: '14 år', kilde: KJ,
    maal: { bryst: 84, midje: 67, hofte: 89, ryggbredde: 33.7, halsvidde: 36, skulder: 12.5, overarm: 26.1, haandledd: 15.7, ermegapDybde: 20.5, nakkeTilMidje: 38.8, midjeTilHofte: 19.6, nakkehoeyde: 139.4, midjeTilKne: 57.4, skrittdybde: 27, innsideBen: 76, ermelengde: 58, hodeomkrets: 56.4, ankel: 21, mansjett: 13.8, mansjettSkjorte: 21, buksevidde: 21.5, jeansvidde: 19 } },

  // ══════════ GUTTER 3–14 år, 98–170 cm ══════════
  // Merk: guttetabellen oppgir ikke ankelvidde. Jentetabellen gjør det.
  { nokkel: '98', type: 'barn', kjonn: 'gutt', alder: '3 år', kilde: KG,
    maal: { bryst: 55, midje: 52, hofte: 55, ryggbredde: 23.2, halsvidde: 26.7, skulder: 7.8, overarm: 18.5, haandledd: 13, ermegapDybde: 13.2, nakkeTilMidje: 24.2, midjeTilHofte: 12, nakkehoeyde: 80.4, skrittdybde: 17.2, innsideBen: 41, ermelengde: 34.5, hodeomkrets: 52, mansjett: 10.4, mansjettSkjorte: 15.4, buksevidde: 16, jeansvidde: 13.5 } },
  { nokkel: '104', type: 'barn', kjonn: 'gutt', alder: '4 år', kilde: KG,
    maal: { bryst: 57, midje: 54, hofte: 58, ryggbredde: 24, halsvidde: 27.3, skulder: 8.2, overarm: 19, haandledd: 13.2, ermegapDybde: 13.8, nakkeTilMidje: 25.4, midjeTilHofte: 12.6, nakkehoeyde: 85.8, skrittdybde: 18, innsideBen: 44.5, ermelengde: 37, hodeomkrets: 52.5, mansjett: 10.6, mansjettSkjorte: 15.8, buksevidde: 16.5, jeansvidde: 14 } },
  { nokkel: '110', type: 'barn', kjonn: 'gutt', alder: '5 år', kilde: KG,
    maal: { bryst: 59, midje: 56, hofte: 61, ryggbredde: 24.8, halsvidde: 27.9, skulder: 8.6, overarm: 19.5, haandledd: 13.4, ermegapDybde: 14.4, nakkeTilMidje: 26.6, midjeTilHofte: 13.2, nakkehoeyde: 91.2, skrittdybde: 18.8, innsideBen: 48, ermelengde: 39.5, hodeomkrets: 53, mansjett: 10.8, mansjettSkjorte: 16.2, buksevidde: 17, jeansvidde: 14.5 } },
  { nokkel: '116', type: 'barn', kjonn: 'gutt', alder: '6 år', kilde: KG,
    maal: { bryst: 61, midje: 58, hofte: 64, ryggbredde: 25.6, halsvidde: 28.5, skulder: 9, overarm: 20, haandledd: 13.6, ermegapDybde: 15, nakkeTilMidje: 27.8, midjeTilHofte: 13.8, nakkehoeyde: 96.6, skrittdybde: 19.6, innsideBen: 51.5, ermelengde: 42, hodeomkrets: 53.5, mansjett: 11, mansjettSkjorte: 16.6, buksevidde: 17.5, jeansvidde: 15 } },
  { nokkel: '122', type: 'barn', kjonn: 'gutt', alder: '7 år', kilde: KG,
    maal: { bryst: 64, midje: 60, hofte: 67, ryggbredde: 26.8, halsvidde: 29.5, skulder: 9.5, overarm: 20.8, haandledd: 14, ermegapDybde: 15.8, nakkeTilMidje: 29.2, midjeTilHofte: 14.4, nakkehoeyde: 102, skrittdybde: 20.4, innsideBen: 55, ermelengde: 44.5, hodeomkrets: 54, mansjett: 11.2, mansjettSkjorte: 17, buksevidde: 18, jeansvidde: 15.5 } },
  { nokkel: '128', type: 'barn', kjonn: 'gutt', alder: '8 år', kilde: KG,
    maal: { bryst: 67, midje: 62, hofte: 70, ryggbredde: 28, halsvidde: 30.5, skulder: 10, overarm: 21.6, haandledd: 14.4, ermegapDybde: 16.6, nakkeTilMidje: 30.6, midjeTilHofte: 15, nakkehoeyde: 107.4, skrittdybde: 21.2, innsideBen: 58, ermelengde: 47, hodeomkrets: 54.5, mansjett: 11.6, mansjettSkjorte: 17.5, buksevidde: 18.5, jeansvidde: 16 } },
  { nokkel: '134', type: 'barn', kjonn: 'gutt', alder: '9 år', kilde: KG,
    maal: { bryst: 70, midje: 64, hofte: 73, ryggbredde: 29.2, halsvidde: 31.5, skulder: 10.5, overarm: 22.4, haandledd: 14.8, ermegapDybde: 17.4, nakkeTilMidje: 32, midjeTilHofte: 15.6, nakkehoeyde: 112.8, skrittdybde: 22, innsideBen: 61, ermelengde: 49.5, hodeomkrets: 55, mansjett: 12, mansjettSkjorte: 18, buksevidde: 19, jeansvidde: 16.5 } },
  { nokkel: '140', type: 'barn', kjonn: 'gutt', alder: '10 år', kilde: KG,
    maal: { bryst: 73, midje: 66, hofte: 76, ryggbredde: 30.4, halsvidde: 32.5, skulder: 11, overarm: 23.2, haandledd: 15.2, ermegapDybde: 18.2, nakkeTilMidje: 33.4, midjeTilHofte: 16.2, nakkehoeyde: 118.2, skrittdybde: 22.8, innsideBen: 64, ermelengde: 52, hodeomkrets: 55.5, mansjett: 12.4, mansjettSkjorte: 18.5, buksevidde: 19.5, jeansvidde: 17 } },
  { nokkel: '146', type: 'barn', kjonn: 'gutt', alder: '11 år', kilde: KG,
    maal: { bryst: 76, midje: 68, hofte: 79, ryggbredde: 31.6, halsvidde: 33.5, skulder: 11.5, overarm: 24, haandledd: 15.6, ermegapDybde: 19, nakkeTilMidje: 34.8, midjeTilHofte: 16.8, nakkehoeyde: 123.6, skrittdybde: 23.6, innsideBen: 67, ermelengde: 54.5, hodeomkrets: 56, mansjett: 12.8, mansjettSkjorte: 19, buksevidde: 20, jeansvidde: 17.5 } },
  { nokkel: '152', type: 'barn', kjonn: 'gutt', alder: '12 år', kilde: KG,
    maal: { bryst: 79, midje: 70, hofte: 82, ryggbredde: 32.8, halsvidde: 34.5, skulder: 12, overarm: 24.8, haandledd: 16, ermegapDybde: 19.8, nakkeTilMidje: 36.2, midjeTilHofte: 17.4, nakkehoeyde: 129, skrittdybde: 24.4, innsideBen: 70, ermelengde: 57, hodeomkrets: 56.5, mansjett: 13.2, mansjettSkjorte: 19.5, buksevidde: 20.5, jeansvidde: 18 } },
  { nokkel: '158', type: 'barn', kjonn: 'gutt', alder: '13 år', kilde: KG,
    maal: { bryst: 82, midje: 72, hofte: 85, ryggbredde: 34, halsvidde: 35.5, skulder: 12.5, overarm: 25.6, haandledd: 16.5, ermegapDybde: 20.6, nakkeTilMidje: 37.6, midjeTilHofte: 18, nakkehoeyde: 134.4, skrittdybde: 25.2, innsideBen: 73, ermelengde: 59, hodeomkrets: 57, mansjett: 13.6, mansjettSkjorte: 20, buksevidde: 21, jeansvidde: 18.5 } },
  { nokkel: '164', type: 'barn', kjonn: 'gutt', alder: '13–14 år', kilde: KG,
    maal: { bryst: 86, midje: 74, hofte: 89, ryggbredde: 35.6, halsvidde: 36.5, skulder: 13.1, overarm: 26.6, haandledd: 17, ermegapDybde: 21.6, nakkeTilMidje: 39.4, midjeTilHofte: 18.8, nakkehoeyde: 139.8, skrittdybde: 26.2, innsideBen: 75.5, ermelengde: 61, hodeomkrets: 57.4, mansjett: 14, mansjettSkjorte: 20.5, buksevidde: 21.5, jeansvidde: 19 } },
  { nokkel: '170', type: 'barn', kjonn: 'gutt', alder: '14 år', kilde: KG,
    maal: { bryst: 90, midje: 76, hofte: 93, ryggbredde: 37.2, halsvidde: 37.5, skulder: 13.7, overarm: 27.6, haandledd: 17.5, ermegapDybde: 22.6, nakkeTilMidje: 41.2, midjeTilHofte: 19.6, nakkehoeyde: 145.2, skrittdybde: 27.2, innsideBen: 78, ermelengde: 63, hodeomkrets: 57.8, mansjett: 14.4, mansjettSkjorte: 21, buksevidde: 22, jeansvidde: 19.5 } },

  // ══════════ DAME, str. 6–24 ══════════
  // Gjelder kvinner 160–172 cm. Boka har egen justeringstabell for
  // kortere og høyere — den er ikke lagt inn ennå.
  { nokkel: '6', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 80, midje: 64, lavMidje: 74, hofte: 88, ryggbredde: 32.4, brystbredde: 30, skulder: 11.75, halsvidde: 35, innsnitt: 5.8, overarm: 26, haandledd: 15, ankel: 23, hoyAnkel: 20, nakkeTilMidje: 40.2, skulderTilMidjeForan: 40.2, ermegapDybde: 20.2, midjeTilKne: 57.5, midjeTilHofte: 20, midjeTilGulv: 102, skrittdybde: 26.6, ermelengde: 57.5, ermelengdeJersey: 53.5, mansjettSkjorte: 21, mansjett: 13.25, buksevidde: 21, jeansvidde: 18.5 } },
  { nokkel: '8', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 84, midje: 68, lavMidje: 78, hofte: 92, ryggbredde: 33.4, brystbredde: 31.2, skulder: 12, halsvidde: 36, innsnitt: 6.4, overarm: 27.2, haandledd: 15.5, ankel: 23.5, hoyAnkel: 20.5, nakkeTilMidje: 40.6, skulderTilMidjeForan: 40.6, ermegapDybde: 20.6, midjeTilKne: 58, midjeTilHofte: 20.3, midjeTilGulv: 103, skrittdybde: 27.3, ermelengde: 58, ermelengdeJersey: 54, mansjettSkjorte: 21, mansjett: 13.5, buksevidde: 21.5, jeansvidde: 18.5 } },
  { nokkel: '10', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 88, midje: 72, lavMidje: 82, hofte: 96, ryggbredde: 34.4, brystbredde: 32.4, skulder: 12.25, halsvidde: 37, innsnitt: 7, overarm: 28.4, haandledd: 16, ankel: 24, hoyAnkel: 21, nakkeTilMidje: 41, skulderTilMidjeForan: 41, ermegapDybde: 21, midjeTilKne: 58.5, midjeTilHofte: 20.6, midjeTilGulv: 104, skrittdybde: 28, ermelengde: 58.5, ermelengdeJersey: 54.5, mansjettSkjorte: 21.5, mansjett: 13.75, buksevidde: 22, jeansvidde: 19 } },
  { nokkel: '12', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 92, midje: 76, lavMidje: 86, hofte: 100, ryggbredde: 35.4, brystbredde: 33.6, skulder: 12.5, halsvidde: 38, innsnitt: 7.6, overarm: 29.6, haandledd: 16.5, ankel: 24.5, hoyAnkel: 21.5, nakkeTilMidje: 41.4, skulderTilMidjeForan: 41.4, ermegapDybde: 21.4, midjeTilKne: 59, midjeTilHofte: 20.9, midjeTilGulv: 105, skrittdybde: 28.7, ermelengde: 59, ermelengdeJersey: 55, mansjettSkjorte: 21.5, mansjett: 14, buksevidde: 22.5, jeansvidde: 19 } },
  { nokkel: '14', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 96, midje: 80, lavMidje: 90, hofte: 104, ryggbredde: 36.4, brystbredde: 34.8, skulder: 12.75, halsvidde: 39, innsnitt: 8.2, overarm: 30.8, haandledd: 17, ankel: 25, hoyAnkel: 22, nakkeTilMidje: 41.8, skulderTilMidjeForan: 42.3, ermegapDybde: 21.8, midjeTilKne: 59.5, midjeTilHofte: 21.2, midjeTilGulv: 106, skrittdybde: 29.4, ermelengde: 59.5, ermelengdeJersey: 55.5, mansjettSkjorte: 22, mansjett: 14.25, buksevidde: 23, jeansvidde: 19.5 } },
  { nokkel: '16', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 100, midje: 84, lavMidje: 94, hofte: 108, ryggbredde: 37.4, brystbredde: 36, skulder: 13, halsvidde: 40, innsnitt: 8.8, overarm: 32, haandledd: 17.5, ankel: 25.5, hoyAnkel: 22.5, nakkeTilMidje: 42.2, skulderTilMidjeForan: 43.2, ermegapDybde: 22.2, midjeTilKne: 60, midjeTilHofte: 21.5, midjeTilGulv: 107, skrittdybde: 30.1, ermelengde: 60, ermelengdeJersey: 56, mansjettSkjorte: 22.5, mansjett: 14.5, buksevidde: 23.5, jeansvidde: 19.5 } },
  { nokkel: '18', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 104, midje: 88, lavMidje: 98, hofte: 112, ryggbredde: 38.4, brystbredde: 37.2, skulder: 13.25, halsvidde: 41, innsnitt: 9.4, overarm: 33.2, haandledd: 18, ankel: 26, hoyAnkel: 23, nakkeTilMidje: 42.6, skulderTilMidjeForan: 44.1, ermegapDybde: 22.6, midjeTilKne: 60.5, midjeTilHofte: 21.8, midjeTilGulv: 108, skrittdybde: 30.8, ermelengde: 60.25, ermelengdeJersey: 56.25, mansjettSkjorte: 23, mansjett: 14.75, buksevidde: 24, jeansvidde: 20 } },
  { nokkel: '20', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 110, midje: 94, lavMidje: 104, hofte: 118, ryggbredde: 39.8, brystbredde: 39, skulder: 13.6, halsvidde: 42, innsnitt: 10, overarm: 35, haandledd: 18.7, ankel: 26.7, hoyAnkel: 23.7, nakkeTilMidje: 43, skulderTilMidjeForan: 45, ermegapDybde: 23.2, midjeTilKne: 61, midjeTilHofte: 22.1, midjeTilGulv: 109, skrittdybde: 31.8, ermelengde: 60.5, ermelengdeJersey: 56.5, mansjettSkjorte: 23.5, mansjett: 15, buksevidde: 24.5, jeansvidde: 20 } },
  { nokkel: '22', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 116, midje: 100, lavMidje: 110, hofte: 124, ryggbredde: 41.2, brystbredde: 40.8, skulder: 13.9, halsvidde: 43, innsnitt: 10.6, overarm: 36.8, haandledd: 19.4, ankel: 27.4, hoyAnkel: 24.4, nakkeTilMidje: 43.4, skulderTilMidjeForan: 45.9, ermegapDybde: 23.8, midjeTilKne: 61.5, midjeTilHofte: 22.4, midjeTilGulv: 110, skrittdybde: 32.8, ermelengde: 60.75, ermelengdeJersey: 56.75, mansjettSkjorte: 24, mansjett: 15.25, buksevidde: 25, jeansvidde: 21 } },
  { nokkel: '24', type: 'voksen', kjonn: 'dame', kilde: KD,
    maal: { bryst: 122, midje: 106, lavMidje: 116, hofte: 132, ryggbredde: 42.6, brystbredde: 42.6, skulder: 14.2, halsvidde: 44, innsnitt: 11.2, overarm: 38.6, haandledd: 20.1, ankel: 28.1, hoyAnkel: 25.1, nakkeTilMidje: 43.8, skulderTilMidjeForan: 46.8, ermegapDybde: 24.4, midjeTilKne: 62, midjeTilHofte: 22.7, midjeTilGulv: 111, skrittdybde: 33.8, ermelengde: 61, ermelengdeJersey: 57, mansjettSkjorte: 24.5, mansjett: 15.5, buksevidde: 25.5, jeansvidde: 21 } },
]

/** Slå opp med 'jente-104', 'gutt-134', 'unisex-80'. */
export const standardById = Object.fromEntries(
  STANDARD.map(s => [`${s.kjonn ?? 'unisex'}-${s.nokkel}`, s]))

/** Slå opp én rad på høyde og kjønn. Faller tilbake på unisex under 98 cm. */
export function finn(nokkel: string, kjonn: 'jente' | 'gutt'): StandardRad | undefined {
  return standardById[`${kjonn}-${nokkel}`] ?? standardById[`unisex-${nokkel}`]
}

/**
 * Nærmeste standardstørrelse for en gitt høyde.
 * Under 98 cm finnes bare unisex babytabell; over 98 velges etter kjønn.
 */
export function naermesteStoerrelse(
  hoydeCm: number,
  kjonn: 'jente' | 'gutt' = 'jente',
): StandardRad | undefined {
  const aktuelle = STANDARD.filter(s =>
    s.type === 'barn' && (s.kjonn === 'unisex' || s.kjonn === kjonn))
  if (!aktuelle.length) return undefined
  return aktuelle.reduce((a, b) =>
    Math.abs(+b.nokkel - hoydeCm) < Math.abs(+a.nokkel - hoydeCm) ? b : a)
}

/** Alle størrelser tilgjengelig for et gitt kjønn, sortert på høyde. */
export function stoerrelserFor(kjonn: 'jente' | 'gutt' = 'jente'): StandardRad[] {
  return STANDARD
    .filter(s => s.type === 'barn' && (s.kjonn === 'unisex' || s.kjonn === kjonn))
    .sort((a, b) => +a.nokkel - +b.nokkel)
}

/** Damestørrelser, sortert på størrelseskode. */
export function damestoerrelser(): StandardRad[] {
  return STANDARD.filter(s => s.type === 'voksen').sort((a, b) => +a.nokkel - +b.nokkel)
}

/** Nærmeste damestørrelse ut fra bystemål. */
export function naermesteDame(bystemaal: number): StandardRad | undefined {
  const d = damestoerrelser()
  if (!d.length) return undefined
  return d.reduce((a, b) =>
    Math.abs(b.maal.bryst - bystemaal) < Math.abs(a.maal.bryst - bystemaal) ? b : a)
}
