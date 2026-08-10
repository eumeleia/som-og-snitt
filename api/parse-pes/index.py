import json
import base64
import tempfile
import os
import traceback
from http.server import BaseHTTPRequestHandler


def parse_pes(pes_bytes: bytes) -> dict:
    """
    Parses a PES file into stitch blocks grouped by colour change, for the
    broderi-arrangement tool. All coordinates are returned in pyembroidery's
    native unit (1/10 mm) — the caller divides by 10 for millimetres. Never
    scale these values; that changes stitch density and ruins satin columns.
    """
    import pyembroidery

    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        f.write(pes_bytes)
        tmp_pes = f.name

    try:
        pattern = pyembroidery.read(tmp_pes)
        if pattern is None:
            raise ValueError("pyembroidery could not parse PES file")

        blokker = []
        total_stitches = 0

        for stitches, thread in pattern.get_as_stitchblock():
            if not stitches:
                continue
            points = [[s[0], s[1]] for s in stitches]
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            blokker.append({
                'farge_hex': thread.hex_color(),
                'tradnavn': thread.description,
                'sting': points,
                'antall_sting': len(points),
                'bbox': {
                    'min_x': min(xs), 'min_y': min(ys),
                    'max_x': max(xs), 'max_y': max(ys),
                },
            })
            total_stitches += len(points)

        bbox = None
        try:
            ext = pattern.extents()
            if ext and len(ext) >= 4:
                bbox = {
                    'min_x': ext[0], 'min_y': ext[1],
                    'max_x': ext[2], 'max_y': ext[3],
                }
        except Exception:
            pass
        if bbox is None and blokker:
            bbox = {
                'min_x': min(b['bbox']['min_x'] for b in blokker),
                'min_y': min(b['bbox']['min_y'] for b in blokker),
                'max_x': max(b['bbox']['max_x'] for b in blokker),
                'max_y': max(b['bbox']['max_y'] for b in blokker),
            }

        return {
            'enhet': '1/10mm',
            'bbox': bbox,
            'total_sting': total_stitches,
            'blokker': blokker,
        }
    finally:
        try:
            os.unlink(tmp_pes)
        except Exception:
            pass


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
            pes_b64 = body.get('pes_data', '')
            if not pes_b64:
                self._json(400, {'error': 'Missing pes_data field'})
                return

            pes_bytes = base64.b64decode(pes_b64)
            result = parse_pes(pes_bytes)
            self._json(200, result)

        except Exception as e:
            tb = traceback.format_exc()
            print(f"[parse-pes] Error: {e}\n{tb}")
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
