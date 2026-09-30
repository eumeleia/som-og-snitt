"""
Tests for the BX font-metric parser, against real Seraphine Satin files (StitchConcept).

Run from the project root:
    python api/parse-bx/test_parse_bx.py

Standard library only — no dependencies.
"""

import base64
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer

sys.path.insert(0, os.path.dirname(__file__))

from index import BxFeil, handler, parse_bx

TESTDATA = os.path.join(os.path.dirname(__file__), 'testdata')

# Measured from the real files (task spec, cross-checked against PES via pyembroidery).
FASIT_METRIKK = {
    "Seraphine_Satin_ 1_5''.bx": dict(ltrSpace=11.70, wSpace=15.60, kern=0, mHeight=390, defsz=390, minsz=195, maxsz=975),
    "Seraphine_Satin_2''.bx": dict(ltrSpace=15.48, wSpace=20.64, kern=0, mHeight=516, defsz=516, minsz=258, maxsz=1290),
    "Seraphine_Satin_5''.bx": dict(ltrSpace=38.34, wSpace=51.12, kern=0, mHeight=1278, defsz=1278, minsz=639, maxsz=3195),
}

# tegn: (bredde, hoyde, grunnlinjeY, underlengdeAndel), Seraphine 1.5"
FASIT_GLYFER_1_5 = {
    'a': (184, 126, -63.0, 0),
    'o': (128, 128, -64.0, 0),
    'p': (228, 318, -2.25, 0.4930),
    'g': (168, 208, -9.5, 0.4543),
    'y': (208, 234, -3.5, 0.4850),
    'A': (496, 390, -195.0, 0),
    ',': (66, 94, 14.0, 0.6489),
}

feil = []


def sjekk(betingelse, melding):
    if not betingelse:
        feil.append(melding)
        print(f'  FEIL: {melding}')


def naer(a, b, tol):
    return a is not None and abs(a - b) <= tol


def les(navn):
    with open(os.path.join(TESTDATA, navn), 'rb') as f:
        return f.read()


def test_font_metrikk():
    print('font-metrikk, tre størrelser')
    for navn, fasit in FASIT_METRIKK.items():
        r = parse_bx(les(navn))
        for felt, verdi in fasit.items():
            sjekk(naer(r[felt], verdi, 0.005), f'{navn} {felt}: {r[felt]} != {verdi}')
        m = r['mHeight']
        sjekk(naer(r['ltrSpace'], 0.03 * m, 0.01), f'{navn} ltrSpace != 0.03 × mHeight')
        sjekk(naer(r['wSpace'], 0.04 * m, 0.01), f'{navn} wSpace != 0.04 × mHeight')
        sjekk(naer(r['minsz'], 0.5 * m, 0.01), f'{navn} minsz != 0.5 × mHeight')
        sjekk(naer(r['maxsz'], 2.5 * m, 0.01), f'{navn} maxsz != 2.5 × mHeight')
        sjekk(r['intraRHS'] is not None, f'{navn} intraRHS mangler')
        sjekk(r['fontName'] and r['fontName'].startswith('Seraphine_Satin'), f'{navn} fontName: {r["fontName"]}')
        sjekk(r['advarsler'] == [], f'{navn} uventede advarsler: {r["advarsler"]}')


def test_glyfer_1_5():
    print('glyftabell, Seraphine 1.5"')
    r = parse_bx(les("Seraphine_Satin_ 1_5''.bx"))
    sjekk(len(r['glyphs']) == 72, f'antall glyfer {len(r["glyphs"])} != 72')
    per_tegn = {g['tegn']: g for g in r['glyphs']}
    sjekk(len(per_tegn) == 72, 'glyfer uten unikt tegn')
    for tegn, (bredde, hoyde, gy, andel) in FASIT_GLYFER_1_5.items():
        g = per_tegn.get(tegn)
        sjekk(g is not None, f'«{tegn}» mangler')
        if g is None:
            continue
        sjekk(naer(g['bredde'], bredde, 0.01), f'«{tegn}» bredde {g["bredde"]} != {bredde}')
        sjekk(naer(g['hoyde'], hoyde, 0.01), f'«{tegn}» hoyde {g["hoyde"]} != {hoyde}')
        sjekk(naer(g['grunnlinjeY'], gy, 0.01), f'«{tegn}» grunnlinjeY {g["grunnlinjeY"]} != {gy}')
        # p is 156.75/318 = 0.49292 exactly; the spec rounds it to 0.4930.
        sjekk(naer(g['underlengdeAndel'], andel, 0.001), f'«{tegn}» underlengdeAndel {g["underlengdeAndel"]} != {andel}')
    sjekk(per_tegn['A']['noekkel'] == 'AU', 'A skal ha nøkkelen AU')
    # bifMm = heightMm × (1 − andel): p at 31.8 mm → 16.12 mm
    sjekk(naer(31.8 * (1 - per_tegn['p']['underlengdeAndel']), 16.12, 0.01), 'bifMm for p != 16.12 mm')
    tilgjengelig = ''.join(r['availableChars'])
    for tegn in per_tegn:
        sjekk(tegn in tilgjengelig, f'«{tegn}» er glyf, men står ikke i AvailableChars')


def test_navnemismatch_i_kildenavn():
    print('pesname er fontens gamle navn, ikke PES-filnavnet')
    r = parse_bx(les("Seraphine_Satin_ 1_5''.bx"))
    a = next(g for g in r['glyphs'] if g['tegn'] == 'a')
    sjekk(a['kildenavn'] == 'SCVintageLove_REG_1_5inch_lower_a.EMB', f'kildenavn for a: {a["kildenavn"]}')
    sjekk('Seraphine' not in a['kildenavn'], 'kildenavn skulle ikke inneholde Seraphine')


def test_ugyldige_filer():
    print('ugyldige filer gir BxFeil, aldri noe annet')
    data = les("Seraphine_Satin_ 1_5''.bx")
    for beskrivelse, bytes_ in [
        ('tom', b''),
        ('ikke BX', b'#PES0001' + b'\x00' * 100),
        ('bare header', b'BX001'),
        ('avkuttet før metrikk', data[:600]),
        ('søppel etter header', b'BX001' + bytes(range(256)) * 40),
    ]:
        try:
            parse_bx(bytes_)
            sjekk(False, f'{beskrivelse}: ga resultat i stedet for feil')
        except BxFeil:
            pass
        except Exception as e:
            sjekk(False, f'{beskrivelse}: kastet {type(e).__name__} i stedet for BxFeil: {e}')

    # The tag dictionary sits after the glyph stream, so a file cut inside the stream loses it
    # and must fail outright rather than return metrics read through guessed tag ids.
    i = data.find(bytes.fromhex('314159265359'))
    try:
        parse_bx(data[:i + 200])
        sjekk(False, 'avkuttet i glyfstrømmen: ga resultat uten tag-ordbok')
    except BxFeil:
        pass

    # Stream damaged in the middle, dictionary intact: metrics come back, glyphs degrade with a warning.
    skadet = data[:i + 2000] + b'\x00' * 2000 + data[i + 4000:]
    try:
        r = parse_bx(skadet)
        sjekk(r['mHeight'] == 390, 'skadet glyfstrøm: metrikk skal fortsatt leses')
        sjekk(len(r['glyphs']) < 72 and r['advarsler'], 'skadet glyfstrøm: skal gi færre glyfer og advarsel')
    except Exception as e:
        sjekk(False, f'skadet glyfstrøm kastet {type(e).__name__}: {e}')


def test_handler():
    print('HTTP-handleren')
    server = HTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'

    def post(payload):
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    try:
        status, body = post({'bx_data': base64.b64encode(les("Seraphine_Satin_2''.bx")).decode()})
        sjekk(status == 200 and body['mHeight'] == 516 and len(body['glyphs']) == 72, f'gyldig BX: {status}')
        status, body = post({'bx_data': base64.b64encode(b'BX001nothing').decode()})
        sjekk(status == 422 and 'error' in body and 'glyphs' not in body, f'ugyldig BX: {status} {body}')
        status, body = post({})
        sjekk(status == 400, f'manglende felt: {status}')
    finally:
        server.shutdown()


if __name__ == '__main__':
    test_font_metrikk()
    test_glyfer_1_5()
    test_navnemismatch_i_kildenavn()
    test_ugyldige_filer()
    test_handler()
    if feil:
        print(f'\n{len(feil)} feil')
        sys.exit(1)
    print('\nAlle tester bestått')
