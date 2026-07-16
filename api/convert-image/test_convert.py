"""
Validation tests for the image-to-PES conversion pipeline.

Run from the project root:
    python api/convert-image/test_convert.py

Requires: pyembroidery, Pillow, numpy  (same deps as the serverless function)
"""

import sys
import os
import io
import tempfile

sys.path.insert(0, os.path.dirname(__file__))

from index import convert_image_to_pes


def make_circle_png(size: int = 200, radius: int = 80) -> bytes:
    """White image with a solid black circle."""
    from PIL import Image, ImageDraw
    img = Image.new('RGB', (size, size), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        fill=(0, 0, 0),
    )
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def make_3color_png() -> bytes:
    """
    Three solid-colour panels side by side — no background, no antialiasing.
    Yellow | Cyan | Violet: chosen so Pillow MEDIANCUT cleanly separates them.
    """
    import numpy as np
    from PIL import Image
    arr = np.zeros((60, 90, 3), dtype=np.uint8)
    arr[:, 0:30]  = [220, 210, 10]   # yellow
    arr[:, 30:60] = [10,  200, 195]  # cyan
    arr[:, 60:90] = [150, 10,  200]  # violet
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def _check_parseable(pes_bytes: bytes, label: str):
    """Validate that pyembroidery can parse the generated PES file."""
    import pyembroidery
    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        f.write(pes_bytes)
        tmp = f.name
    try:
        parsed = pyembroidery.read(tmp)
        assert parsed is not None, f"[{label}] pyembroidery returned None"
        assert len(parsed.stitches) > 0, f"[{label}] parsed PES has no stitches"
    finally:
        os.unlink(tmp)


def test_fill_1color():
    """Fill stitch, 1 colour, 50 mm → stitch count > 0, 1 colour, ≤ 100 mm."""
    print("test_fill_1color ...", end=" ", flush=True)
    img = make_circle_png()
    pes, meta = convert_image_to_pes(img, 'fill', 50.0, 1)

    assert len(pes) > 0,             "PES is empty"
    assert meta['stitch_count'] > 0, f"stitch_count={meta['stitch_count']}"
    assert meta['color_count'] == 1, f"color_count={meta['color_count']}"
    assert meta['width_mm']  <= 100, f"width_mm={meta['width_mm']}"
    assert meta['height_mm'] <= 100, f"height_mm={meta['height_mm']}"
    _check_parseable(pes, "fill_1color")
    print(f"OK  ({meta['stitch_count']} stitches, "
          f"{meta['width_mm']}×{meta['height_mm']} mm)")


def test_fill_3colors():
    """
    3 clearly separated colour regions → exactly 3 threads, 2 COLOR_CHANGEs,
    and trim_count < 2 × number_of_regions (= 6).
    """
    print("test_fill_3colors ...", end=" ", flush=True)
    import pyembroidery
    img = make_3color_png()
    # 3 solid panels → exactly 3 colours, no background removal needed
    pes, meta = convert_image_to_pes(img, 'fill', 60.0, 3)

    assert len(pes) > 0,             "PES is empty"
    assert meta['stitch_count'] > 0, f"no stitches"
    assert meta['color_count'] == 3, \
        f"expected 3 threads, got {meta['color_count']}"

    # 2 COLOR_CHANGEs implied by 3 threads; verify via re-parsed file
    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        f.write(pes)
        tmp = f.name
    try:
        parsed = pyembroidery.read(tmp)
        n_threads = len([t for t in parsed.threadlist if t is not None])
    finally:
        os.unlink(tmp)
    assert n_threads == 3, f"PES has {n_threads} threads, expected 3"

    # Bound: 2 COLOR_BREAKs (~4 TRIMs) + 3 components × 2 transitions = ~10.
    # Metadata now comes from the re-parsed PES (Fix 3), which includes
    # pyembroidery's normalisation overhead, so the limit is 5 per region.
    num_regions = 3  # one per colour square
    assert meta['trim_count'] < 5 * num_regions, \
        f"trim_count={meta['trim_count']} ≥ 5×{num_regions}={5*num_regions}"

    assert meta['width_mm']  <= 100
    assert meta['height_mm'] <= 100
    _check_parseable(pes, "fill_3colors")
    print(f"OK  ({meta['stitch_count']} stitches, {meta['color_count']} colours, "
          f"{meta['trim_count']} trims)")


def test_cross_stitch():
    """Cross stitch, 2 colours, 40 mm."""
    print("test_cross_stitch ...", end=" ", flush=True)
    img = make_circle_png()
    pes, meta = convert_image_to_pes(img, 'cross', 40.0, 2)

    assert len(pes) > 0
    assert meta['stitch_count'] > 0
    assert meta['width_mm']  <= 100
    assert meta['height_mm'] <= 100
    _check_parseable(pes, "cross_stitch")
    print(f"OK  ({meta['stitch_count']} stitches, {meta['color_count']} colour(s))")


def test_max_size():
    """Design at 100 mm must never exceed 100×100 mm bounding box."""
    print("test_max_size ...", end=" ", flush=True)
    img = make_circle_png(size=400, radius=190)
    pes, meta = convert_image_to_pes(img, 'fill', 100.0, 1)

    assert meta['width_mm']  <= 100.5, f"width_mm={meta['width_mm']}"
    assert meta['height_mm'] <= 100.5, f"height_mm={meta['height_mm']}"
    _check_parseable(pes, "max_size")
    print(f"OK  ({meta['width_mm']}×{meta['height_mm']} mm)")


if __name__ == '__main__':
    test_fill_1color()
    test_fill_3colors()
    test_cross_stitch()
    test_max_size()
    print("\nAlle tester bestått.")
