import json
import base64
import io
import tempfile
import os
import traceback
from http.server import BaseHTTPRequestHandler


def render_pes(pes_bytes: bytes):
    """
    Renders PES embroidery file to PNG using pyembroidery + Pillow.
    Returns (png_bytes, width_mm, height_mm) or raises on failure.
    """
    import pyembroidery
    from PIL import Image

    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        f.write(pes_bytes)
        tmp_pes = f.name

    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        tmp_png = f.name

    try:
        pattern = pyembroidery.read(tmp_pes)
        if pattern is None:
            raise ValueError("pyembroidery could not parse PES file")

        # Extract physical dimensions (units are 1/10 mm in pyembroidery)
        width_mm = None
        height_mm = None
        try:
            if hasattr(pattern, 'extents'):
                ext = pattern.extents()
                if ext and len(ext) >= 4:
                    w = abs(ext[2] - ext[0])
                    h = abs(ext[3] - ext[1])
                    if w > 0 and h > 0:
                        width_mm = round(w / 10.0, 1)
                        height_mm = round(h / 10.0, 1)
            elif hasattr(pattern, 'min_x'):
                w = abs(pattern.max_x - pattern.min_x)
                h = abs(pattern.max_y - pattern.min_y)
                if w > 0 and h > 0:
                    width_mm = round(w / 10.0, 1)
                    height_mm = round(h / 10.0, 1)
        except Exception:
            pass

        # Render at scale 5 for a crisp result
        pyembroidery.write(pattern, tmp_png, {'scale': 5, 'background_color': 0xFFFFFF})

        img = Image.open(tmp_png)

        # Composite on white background (handles RGBA transparency)
        if img.mode == 'RGBA':
            bg = Image.new('RGB', img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        elif img.mode == 'P':
            img = img.convert('RGBA')
            bg = Image.new('RGB', img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        else:
            img = img.convert('RGB')

        # Trim white margins by finding non-white bounding box
        try:
            from PIL import ImageOps
            gray = img.convert('L')
            inverted = ImageOps.invert(gray)
            bbox = inverted.getbbox()
            if bbox:
                bbox_w = bbox[2] - bbox[0]
                bbox_h = bbox[3] - bbox[1]
                margin = max(10, int(max(bbox_w, bbox_h) * 0.05))
                left = max(0, bbox[0] - margin)
                top = max(0, bbox[1] - margin)
                right = min(img.width, bbox[2] + margin)
                bottom = min(img.height, bbox[3] + margin)
                if right > left and bottom > top:
                    img = img.crop((left, top, right, bottom))
        except Exception:
            pass

        # Scale down if too large
        max_size = 800
        if max(img.width, img.height) > max_size:
            img.thumbnail((max_size, max_size), Image.LANCZOS)

        out = io.BytesIO()
        img.save(out, format='JPEG', quality=80, optimize=True)
        png_bytes = out.getvalue()

        return png_bytes, width_mm, height_mm

    finally:
        try:
            os.unlink(tmp_pes)
        except Exception:
            pass
        try:
            os.unlink(tmp_png)
        except Exception:
            pass


def get_pes_bounds(pes_bytes: bytes):
    """Parse PES and return physical dimensions only — no PNG rendering."""
    import pyembroidery

    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        f.write(pes_bytes)
        tmp_pes = f.name
    try:
        pattern = pyembroidery.read(tmp_pes)
        if pattern is None:
            return {}
        width_mm, height_mm = _extract_extents(pattern)
        if width_mm is not None:
            return {'width_mm': width_mm, 'height_mm': height_mm}
        return {}
    except Exception:
        return {}
    finally:
        try:
            os.unlink(tmp_pes)
        except Exception:
            pass


def _extract_extents(pattern):
    """Return (width_mm, height_mm) from a pyembroidery pattern, or (None, None)."""
    try:
        if hasattr(pattern, 'extents'):
            ext = pattern.extents()
            if ext and len(ext) >= 4:
                w = abs(ext[2] - ext[0])
                h = abs(ext[3] - ext[1])
                if w > 0 and h > 0:
                    return round(w / 10.0, 1), round(h / 10.0, 1)
        if hasattr(pattern, 'min_x') and hasattr(pattern, 'max_x'):
            w = abs(pattern.max_x - pattern.min_x)
            h = abs(pattern.max_y - pattern.min_y)
            if w > 0 and h > 0:
                return round(w / 10.0, 1), round(h / 10.0, 1)
    except Exception:
        pass
    return None, None


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

            # Lightweight bounds-only mode — skip PNG rendering
            if body.get('bounds_only'):
                result = get_pes_bounds(pes_bytes)
                self._json(200, result)
                return

            png_bytes, width_mm, height_mm = render_pes(pes_bytes)
            png_b64 = base64.b64encode(png_bytes).decode('utf-8')

            result = {'png_base64': png_b64, 'content_type': 'image/jpeg'}
            if width_mm is not None:
                result['width_mm'] = width_mm
                result['height_mm'] = height_mm

            self._json(200, result)

        except Exception as e:
            tb = traceback.format_exc()
            print(f"[render-pes] Error: {e}\n{tb}")
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
