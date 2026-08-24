import json
import base64
import tempfile
import os
import traceback
from http.server import BaseHTTPRequestHandler

RAMME_MM = 100.0


def sett_rammeflagg(pes_bytes: bytes) -> bytes:
    """
    Nullstiller de to rammefeltene i PES v1-headeren.

    pyembroidery hardkoder begge (PesWriter.write_pes_header_v1):

        write_int_16le(f, 0x01)  # scale to fit
        write_int_16le(f, 0x01)  # 0 = 100x100, 130x180 hoop

    Altså: hver eneste fil biblioteket skriver sier «skaler til rammen» og
    «ramme = 130x180», uansett hvor stort motivet faktisk er. Skitch PP1 har
    100x100 mm, og et motiv skal ALDRI skaleres til rammen — målene i
    CEmbOne/PEC er allerede motivets egne (målt: 63,5 x 65,0 mm for en
    komposisjon som fyller under to tredjedeler av rammen).

    Patches ETTER skriving, på de fire bytene, i stedet for å vedlikeholde en
    egen kopi av PES-skriveren. Verifisert: resten av fila er byte for byte
    identisk, og pyembroidery leser tilbake nøyaktig samme sting, tråder og
    extents — selvsjekken under påvirkes derfor ikke.

    Bare PES v1 har disse feltene på faste offset. v6 har egne rammefelt lenger
    ute i headeren, så signaturen sjekkes før noe røres.
    """
    if not pes_bytes.startswith(b'#PES0001') or len(pes_bytes) < 16:
        return pes_bytes
    b = bytearray(pes_bytes)
    b[12:14] = (0).to_bytes(2, 'little')   # scale to fit = av
    b[14:16] = (0).to_bytes(2, 'little')   # ramme = 100x100
    return bytes(b)


def _snap_til_palett(farge_hex):
    """
    PesWriter snapper HVER trådfarge til nærmeste farge i Brothers 64-fargers PEC-palett
    ved skriving (bekreftet i PesWriter.py: current_thread.find_nearest_color_index(chart),
    chart = EmbThreadPec.get_thread_set() — samme palett som broderPalett.ts i frontend er
    hentet fra). Snapper her FØR vi bygger mønsteret, slik at forrige_farge-sammenligningen
    (fargeskift vs. trim) og selvsjekkens fasit begge opererer på den fargen som faktisk
    ender opp i fila — ikke den rå verdien som kom inn.
    """
    from pyembroidery.EmbThreadPec import get_thread_set
    from pyembroidery.EmbThread import EmbThread

    thread = EmbThread()
    thread.set_hex_color(farge_hex)
    chart = get_thread_set()
    idx = thread.find_nearest_color_index(chart)
    return chart[idx].hex_color()


def _les_faktiske_kjoringer(pattern):
    """
    Leser fargekjøringene i et innlest mønster direkte fra de rå stingkommandoene, IKKE via
    get_as_stitchblock() alene — den skiller ikke STOP fra TRIM/fargeskift, så to like-fargede
    blokker separert av en pause ville blitt slått sammen igjen her, i strid med
    tellOmtredninger() sin regel om at en pause alltid bryter kjeden. Dette er selvsjekkens
    fasit, så den må bruke akkurat samme regel som resten av appen.
    """
    from pyembroidery import STITCH, STOP, COLOR_CHANGE, COMMAND_MASK

    kjoringer = []
    thread_index = 0
    thread = pattern.get_thread_or_filler(0)
    current_stitches = 0
    # "Pending" fram til en faktisk blokk registreres — ikke en verdi som nullstilles av
    # hvilken som helst kommando. pyembroidery kan la et TRIM/JUMP med null bevegelse (typisk
    # rett etter en STOP på samme sted) forsvinne fra stingdataene ved skriving; hadde denne
    # flagget blitt satt til False av HVER ikke-sting-kommando (uansett om noe ble registrert),
    # ville en slik overflødig kommando slette pause-merket før neste ekte blokk leses. Bekreftet
    # empirisk: samme farge før/etter en pause ble feilaktig slått sammen med denne bugen.
    pause_pendende = False

    def avslutt_blokk():
        nonlocal current_stitches, pause_pendende
        if current_stitches == 0:
            return
        farge_hex = thread.hex_color()
        if kjoringer and not pause_pendende and kjoringer[-1]['farge_hex'] == farge_hex:
            kjoringer[-1]['antall_deler'] += 1
            kjoringer[-1]['antall_sting'] += current_stitches
        else:
            kjoringer.append({'farge_hex': farge_hex, 'antall_deler': 1, 'antall_sting': current_stitches})
        current_stitches = 0
        pause_pendende = False

    for stitch in pattern.stitches:
        flags = stitch[2] & COMMAND_MASK
        if flags == STITCH:
            current_stitches += 1
        else:
            avslutt_blokk()
            if flags == STOP:
                pause_pendende = True
            if flags == COLOR_CHANGE:
                thread_index += 1
                thread = pattern.get_thread_or_filler(thread_index)
    avslutt_blokk()
    return kjoringer


def bygg_forventet_fargekjoringer(segmenter):
    """
    Samme foldingsregel som tellOmtredninger() i sekvens.ts: konsekutive 'kjoring'-segmenter
    med samme farge_hex slås sammen — men en pause bryter ALLTID kjeden, selv ved samme
    farge, fordi det er nettopp det brukeren ba om (maskinen stopper uansett). Dette er
    fasiten selvsjekken skriver mot, ikke bare et antall fargeskift-kommandoer.
    """
    kjoringer = []
    forrige_farge = None
    for seg in segmenter:
        if seg.get('type') == 'pause':
            forrige_farge = None
            continue
        farge_hex = seg.get('farge_hex')
        blokker = seg.get('blokker') or []
        antall_sting = sum(len(b) for b in blokker)
        antall_deler = len(blokker)
        if not farge_hex or antall_sting == 0:
            continue
        farge_hex = _snap_til_palett(farge_hex)
        if kjoringer and forrige_farge == farge_hex:
            kjoringer[-1]['antall_sting'] += antall_sting
            kjoringer[-1]['antall_deler'] += antall_deler
        else:
            kjoringer.append({'farge_hex': farge_hex, 'antall_sting': antall_sting, 'antall_deler': antall_deler})
        forrige_farge = farge_hex
    return kjoringer


def bygg_monster(segmenter, pes_versjon):
    import pyembroidery
    from pyembroidery import EmbPattern, EmbThread, STITCH

    pattern = EmbPattern()
    forrige_farge = None

    for seg in segmenter:
        if seg.get('type') == 'pause':
            # STOP-kommandoen alene er nok til at selvsjekkens gruppering (_les_faktiske_
            # kjoringer) regner dette som et brudd i kjeden, uansett farge — se der. IKKE
            # nullstill forrige_farge her: det ville fått koden nedenfor til å tro en ny
            # add_thread() ikke trengte en tilhørende color_change(), som forskyver
            # thread-indeksen for alt som kommer etter og gir HELT feil farger tilbake
            # ved gjenlesing. Bekreftet med en ekte fil: rødt ble lest tilbake som svart.
            pattern.stop()
            continue

        farge_hex = seg.get('farge_hex')
        blokker = seg.get('blokker') or []
        if not farge_hex or not blokker:
            continue
        farge_hex = _snap_til_palett(farge_hex)

        if farge_hex != forrige_farge:
            thread = EmbThread()
            thread.set_hex_color(farge_hex)
            pattern.add_thread(thread)
            if forrige_farge is not None:
                pattern.color_change()

        for i, blokk in enumerate(blokker):
            # Skille mellom stingblokker: enten en ny blokk INNI samme kjøring (i>0), eller
            # denne kjøringen er slått sammen med forrige (samme farge, første blokk her) —
            # begge er et fysisk skille i stoffet uten fargeskift, altså en trim, ikke mer.
            if i > 0 or farge_hex == forrige_farge:
                pattern.trim()
            for punkt in blokk:
                x = punkt[0]
                y = punkt[1]
                pattern.add_stitch_absolute(STITCH, x, y)

        forrige_farge = farge_hex

    pattern.end()

    # KRITISK: uten dette tror maskinen motivet ligger langt fra nullpunktet og avviser
    # det som for stort for rammen, selv når det i realiteten passer fint.
    pattern.move_center_to_origin()

    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        tmp_pes = f.name
    try:
        settings = {'version': float(pes_versjon)} if pes_versjon else None
        pattern.write(tmp_pes, settings=settings)
        with open(tmp_pes, 'rb') as f:
            pes_bytes = sett_rammeflagg(f.read())
    finally:
        try:
            os.unlink(tmp_pes)
        except Exception:
            pass

    return pes_bytes


def selvsjekk(pes_bytes, segmenter):
    """
    Leser den skrevne fila tilbake og sammenligner mot det som ble bestilt. Returnerer
    (ok, resultat) der resultat enten er selvsjekk-oppsummeringen (ok=True) eller en liste
    med avvik (ok=False) — billig å gjøre og fanger det meste.
    """
    import pyembroidery

    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        f.write(pes_bytes)
        tmp_pes = f.name
    try:
        pattern = pyembroidery.read(tmp_pes)
    finally:
        try:
            os.unlink(tmp_pes)
        except Exception:
            pass

    if pattern is None:
        return False, ['Klarte ikke lese tilbake den skrevne PES-filen']

    faktiske_kjoringer = _les_faktiske_kjoringer(pattern)
    forventede_kjoringer = bygg_forventet_fargekjoringer(segmenter)

    avvik = []

    if len(faktiske_kjoringer) != len(forventede_kjoringer):
        avvik.append(
            f'Antall fargekjøringer stemmer ikke: forventet {len(forventede_kjoringer)}, fikk {len(faktiske_kjoringer)}'
        )
    else:
        for i, (forventet, faktisk) in enumerate(zip(forventede_kjoringer, faktiske_kjoringer)):
            if forventet['farge_hex'] != faktisk['farge_hex']:
                avvik.append(
                    f'Kjøring {i + 1}: forventet farge {forventet["farge_hex"]}, fikk {faktisk["farge_hex"]}'
                )
            if forventet['antall_sting'] != faktisk['antall_sting']:
                avvik.append(
                    f'Kjøring {i + 1} ({forventet["farge_hex"]}): forventet {forventet["antall_sting"]} sting, fikk {faktisk["antall_sting"]}'
                )
            if forventet['antall_deler'] != faktisk['antall_deler']:
                avvik.append(
                    f'Kjøring {i + 1} ({forventet["farge_hex"]}): forventet {forventet["antall_deler"]} klipp-deler, fikk {faktisk["antall_deler"]}'
                )

    forventet_total = sum(k['antall_sting'] for k in forventede_kjoringer)
    faktisk_total = sum(k['antall_sting'] for k in faktiske_kjoringer)
    if forventet_total != faktisk_total:
        avvik.append(f'Totalt stingantall stemmer ikke: forventet {forventet_total}, fikk {faktisk_total}')

    ext = pattern.extents()
    bredde_mm = round(abs(ext[2] - ext[0]) / 10.0, 1) if ext else 0.0
    hoyde_mm = round(abs(ext[3] - ext[1]) / 10.0, 1) if ext else 0.0
    if bredde_mm > RAMME_MM or hoyde_mm > RAMME_MM:
        avvik.append(
            f'Bbox er {bredde_mm} × {hoyde_mm} mm etter sentrering — over {RAMME_MM:.0f}×{RAMME_MM:.0f} mm-rammen'
        )

    if avvik:
        return False, avvik

    return True, {
        'antall_fargekjoringer': len(faktiske_kjoringer),
        'farger': [
            {'farge_hex': k['farge_hex'], 'antall_deler': k['antall_deler'], 'antall_sting': k['antall_sting']}
            for k in faktiske_kjoringer
        ],
        'total_sting': faktisk_total,
        'bredde_mm': bredde_mm,
        'hoyde_mm': hoyde_mm,
    }


class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self._json(400, {'error': 'Empty request body'})
                return

            raw_body = self.rfile.read(content_length)
            body = json.loads(raw_body)
            segmenter = body.get('segmenter')
            if not segmenter or not isinstance(segmenter, list):
                self._json(400, {'error': 'Missing or invalid segmenter field'})
                return
            pes_versjon = body.get('pes_versjon', 1)

            pes_bytes = bygg_monster(segmenter, pes_versjon)
            ok, resultat = selvsjekk(pes_bytes, segmenter)

            if not ok:
                self._json(422, {'error': 'Selvsjekk feilet — filen ble IKKE returnert', 'avvik': resultat})
                return

            self._json(200, {
                'pes_base64': base64.b64encode(pes_bytes).decode('utf-8'),
                'selvsjekk': resultat,
            })

        except Exception as e:
            tb = traceback.format_exc()
            print(f"[export-pes] Error: {e}\n{tb}")
            self._json(500, {'error': str(e)})

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, status: int, data: dict):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # suppress default access log noise
