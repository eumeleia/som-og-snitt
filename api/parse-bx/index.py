import json
import base64
import bz2
import re
import struct
import traceback
from http.server import BaseHTTPRequestHandler

# BX (Embrilliance font) has no published specification. Everything below is read from
# real StitchConcept files (Seraphine Satin, eight sizes) — see test_parse_bx.py. All
# measurements are in 1/10 mm, the same unit as PES and pyembroidery.

BLOKK_MAGI = b'IDMDTL'
BZIP2_BLOKK_MAGI = bytes.fromhex('314159265359')
METRIKK_SOEKEOMRAADE = 32 * 1024
FLOAT_FELT = ['ltrSpace', 'wSpace', 'intraRHS', 'mHeight', 'defsz', 'minsz', 'maxsz']
INT_FELT = ['kern', 'expFont']
# The baseline object is a horizontal line one unit tall in every glyph seen so far. A taller
# "outline" is not a baseline, and pairing it would give a wrong metric — drop instead.
MAKS_GRUNNLINJE_TYKKELSE = 2.0


class BxFeil(ValueError):
    pass


def _er_navn(data: bytes, o: int, n: int) -> bool:
    if n <= 1 or n > 256 or o + n > len(data):
        return False
    s = data[o:o + n]
    return s[-1] == 0 and all(32 <= b < 127 for b in s[:-1])


def _les_blokk(data: bytes, start: int):
    """Returns the records of the IDMDTL block at `start`, or None if it does not parse."""
    o = start + len(BLOKK_MAGI)
    try:
        (antall,) = struct.unpack_from('<I', data, o)
        o += 4
        if antall > 100000:
            return None
        poster = []
        for _ in range(antall):
            (n,) = struct.unpack_from('<I', data, o)
            if _er_navn(data, o + 4, n):
                navn = data[o + 4:o + 4 + n - 1].decode('ascii')
                o += 4 + n
                (lengde,) = struct.unpack_from('<I', data, o)
                o += 4
                noekkel = ('navn', navn)
            else:
                _type_kode, tag_id, lengde = struct.unpack_from('<IHI', data, o)
                o += 10
                noekkel = ('tag', tag_id)
            if o + lengde > len(data):
                return None
            poster.append((noekkel, data[o:o + lengde]))
            o += lengde
        return poster
    except struct.error:
        return None


def _alle_blokker(data: bytes):
    """Every parseable IDMDTL block in offset order, nested ones included."""
    blokker = []
    i = data.find(BLOKK_MAGI)
    while i >= 0:
        poster = _les_blokk(data, i)
        if poster is not None:
            blokker.append((i, poster))
        i = data.find(BLOKK_MAGI, i + 1)
    return blokker


def _tag_ordbok(blokker) -> dict:
    # Tag ids are not guaranteed stable across fonts — always resolve through this.
    kandidater = [
        poster for _, poster in blokker
        if len(poster) >= 50 and all(k[0] == 'navn' and len(v) == 2 for k, v in poster)
    ]
    if not kandidater:
        raise BxFeil('Fant ingen tag-ordbok i BX-fila')
    return {struct.unpack('<H', v)[0]: k[1] for k, v in kandidater[-1]}


def _navngi(poster, tags: dict) -> dict:
    felt = {}
    for (art, verdi), data in poster:
        navn = verdi if art == 'navn' else tags.get(verdi)
        if navn is not None and navn not in felt:
            felt[navn] = data
    return felt


def _streng(data: bytes) -> str:
    return data.split(b'\x00', 1)[0].decode('latin-1')


def _size(data: bytes):
    if data is None or len(data) < 24:
        return None
    return struct.unpack('<6f', data[:24])


def _tegn_fra_noekkel(noekkel: str):
    # desname: a–z as-is, AU–ZU for capitals, digits and punctuation as the character itself.
    m = re.fullmatch(r'([A-Z])U', noekkel)
    if m:
        return m.group(1)
    if len(noekkel) == 1:
        return noekkel
    return None


def _font_metrikk(blokker, tags: dict) -> dict:
    for start, poster in blokker:
        if start > METRIKK_SOEKEOMRAADE:
            break
        felt = _navngi(poster, tags)
        if 'ltrSpace' not in felt or 'mHeight' not in felt:
            continue
        ut = {'fontName': _streng(felt['fontName']) if 'fontName' in felt else None}
        for navn in FLOAT_FELT:
            v = felt.get(navn)
            ut[navn] = round(struct.unpack('<f', v)[0], 4) if v is not None and len(v) == 4 else None
        for navn in INT_FELT:
            v = felt.get(navn)
            ut[navn] = struct.unpack('<i', v)[0] if v is not None and len(v) == 4 else None
        if not ut['mHeight'] or ut['mHeight'] <= 0:
            raise BxFeil('Font-metrikkposten har ingen gyldig mHeight')
        linjer = _streng(felt.get('AvailableChars', b'')).replace('\r\n', '\n').split('\n')
        # First line is the font name, the rest one line per character group.
        ut['availableChars'] = [l for l in linjer[1:] if l.strip()]
        return ut
    raise BxFeil(f'Fant ingen font-metrikkpost (ltrSpace + mHeight) i de første {METRIKK_SOEKEOMRAADE} bytene')


def _glyfer(data: bytes, tags: dict):
    """Glyph table from the bzip2 stream. Returns (glyphs, warnings); never raises on odd glyph
    structure — an object-based font with a different layout just yields fewer glyphs."""
    advarsler = []
    i = data.find(BZIP2_BLOKK_MAGI)
    if i < 0:
        return [], ['Fant ingen bzip2-strøm (glyfbibliotek) i BX-fila']
    try:
        # The stream is stored without its four header bytes.
        payload = bz2.BZ2Decompressor().decompress(b'BZh9' + data[i:])
    except (OSError, ValueError) as e:
        return [], [f'Glyfbiblioteket kunne ikke pakkes ut: {e}']

    glyfer = []
    sett = set()
    grunnlinje = None
    for _, poster in _alle_blokker(payload):
        felt = _navngi(poster, tags)
        s_typ = _streng(felt['sTyp']) if 'sTyp' in felt else None
        size = _size(felt.get('Size'))
        if s_typ == 'outline' and size is not None:
            grunnlinje = size
            continue
        if 'desname' not in felt or size is None:
            continue
        noekkel = _streng(felt['desname'])
        if noekkel == 'baseline':
            continue
        linje, grunnlinje = grunnlinje, None
        if linje is None:
            advarsler.append(f'«{noekkel}»: ingen grunnlinje foran glyfen')
            continue
        if linje[4] - linje[1] > MAKS_GRUNNLINJE_TYKKELSE:
            advarsler.append(f'«{noekkel}»: objektet foran glyfen er ikke en grunnlinje')
            continue
        minx, miny, _, maxx, maxy, _ = size
        bredde, hoyde = maxx - minx, maxy - miny
        if bredde <= 0 or hoyde <= 0:
            advarsler.append(f'«{noekkel}»: glyfen har ingen utstrekning')
            continue
        if noekkel in sett:
            advarsler.append(f'«{noekkel}»: finnes flere ganger, bare den første er brukt')
            continue
        sett.add(noekkel)
        grunnlinje_y = linje[1]
        glyfer.append({
            'tegn': _tegn_fra_noekkel(noekkel),
            'noekkel': noekkel,
            'bredde': round(bredde, 4),
            'hoyde': round(hoyde, 4),
            'grunnlinjeY': round(grunnlinje_y, 4),
            'underlengdeAndel': round((grunnlinje_y - miny) / hoyde, 6),
            # Kept for display only — the digitiser renamed the font, so this never matches
            # the PES file names in the pack. Never link on it.
            'kildenavn': _streng(felt['pesname']) if 'pesname' in felt else None,
        })
    return glyfer, advarsler


def parse_bx(data: bytes) -> dict:
    if not data.startswith(b'BX001'):
        raise BxFeil('Fila starter ikke med «BX001» — ikke en BX-fil')
    blokker = _alle_blokker(data)
    if not blokker:
        raise BxFeil('Fant ingen IDMDTL-blokker i BX-fila')
    tags = _tag_ordbok(blokker)
    ut = _font_metrikk(blokker, tags)
    glyfer, advarsler = _glyfer(data, tags)
    ut['enhet'] = '1/10mm'
    ut['glyphs'] = glyfer
    ut['advarsler'] = advarsler
    return ut


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
            body = json.loads(self.rfile.read(content_length))
            bx_b64 = body.get('bx_data', '')
            if not bx_b64:
                self._json(400, {'error': 'Missing bx_data field'})
                return
            self._json(200, parse_bx(base64.b64decode(bx_b64)))
        except BxFeil as e:
            self._json(422, {'error': str(e)})
        except Exception as e:
            print(f"[parse-bx] Error: {e}\n{traceback.format_exc()}")
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
        pass
