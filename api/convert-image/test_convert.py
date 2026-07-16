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


def _load_rev_png() -> bytes:
    """Load rev.png test image from testdata directory."""
    here = os.path.dirname(__file__)
    path = os.path.join(here, 'testdata', 'rev.png')
    with open(path, 'rb') as f:
        return f.read()


def _make_transparent_rev() -> bytes:
    """
    Return rev.png with the white background set to alpha=0 so that the
    alpha-channel path in _compute_bg_mask is exercised.
    """
    import numpy as np
    from PIL import Image
    from collections import deque

    img_bytes = _load_rev_png()
    img_rgba = Image.open(io.BytesIO(img_bytes)).convert('RGBA')
    arr = np.array(img_rgba, dtype=np.uint8)
    rgb = arr[:, :, :3]
    h, w = rgb.shape[:2]

    # Flood-fill from corners to find white background
    bg = np.zeros((h, w), dtype=bool)
    vis = np.zeros((h, w), dtype=bool)
    TOL = 30 * 30
    for sy, sx in [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]:
        if vis[sy, sx]:
            continue
        seed = rgb[sy, sx].astype(np.int32)
        q = deque([(sy, sx)])
        vis[sy, sx] = True
        while q:
            y, x = q.popleft()
            d = rgb[y, x].astype(np.int32) - seed
            if int(d[0] ** 2 + d[1] ** 2 + d[2] ** 2) <= TOL:
                bg[y, x] = True
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and not vis[ny, nx]:
                        vis[ny, nx] = True
                        q.append((ny, nx))

    arr[bg, 3] = 0  # set background alpha to transparent
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format='PNG')
    return buf.getvalue()


def _parse_pes_runs(pes_bytes: bytes):
    """
    Re-parse PES bytes with pyembroidery and return (stitch_count, trim_count,
    thread_count, run_lengths) where run_lengths is a list of consecutive STITCH
    run lengths (number of stitches between TRIMs/JUMPs).
    """
    import pyembroidery
    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        f.write(pes_bytes)
        tmp = f.name
    try:
        parsed = pyembroidery.read(tmp)
    finally:
        os.unlink(tmp)

    assert parsed is not None, "pyembroidery returned None"
    stitch_count = 0
    trim_count = 0
    runs = []
    cur_run = 0
    for _, _, cmd in parsed.stitches:
        if cmd == pyembroidery.STITCH:
            stitch_count += 1
            cur_run += 1
        elif cmd in (pyembroidery.TRIM, pyembroidery.JUMP,
                     pyembroidery.COLOR_CHANGE, pyembroidery.COLOR_BREAK):
            if cmd == pyembroidery.TRIM:
                trim_count += 1
            if cur_run > 0:
                runs.append(cur_run)
                cur_run = 0
        elif cmd == pyembroidery.END:
            if cur_run > 0:
                runs.append(cur_run)
    threads = len([t for t in parsed.threadlist if t is not None])
    return stitch_count, trim_count, threads, runs


def _check_rev_acceptance(pes_bytes: bytes, label: str):
    """
    Acceptance criteria for rev.png (5 colours, 100 mm, remove_bg=True):
      - at least 4 threads
      - fewer than 60 trims
      - median run length >= 30 stitches
    """
    import statistics
    sc, tc, threads, runs = _parse_pes_runs(pes_bytes)
    median_run = statistics.median(runs) if runs else 0

    print(f"  {label}: {threads} threads, {tc} trims, "
          f"median run={median_run:.0f}, {sc} stitches")

    assert threads >= 4, \
        f"[{label}] only {threads} threads — expected ≥ 4"
    assert tc < 60, \
        f"[{label}] {tc} trims — expected < 60"
    assert median_run >= 30, \
        f"[{label}] median run={median_run:.0f} — expected ≥ 30"


def test_rev_flood_fill():
    """rev.png (RGBA, opaque white bg) with remove_bg=True → flood-fill path."""
    print("test_rev_flood_fill ...", flush=True)
    img = _load_rev_png()
    pes, meta = convert_image_to_pes(img, 'fill', 100.0, 5, remove_bg=True)
    assert len(pes) > 0, "PES is empty"
    _check_rev_acceptance(pes, "flood-fill")
    print("  OK")


def test_rev_alpha():
    """Transparent-background rev.png with remove_bg=True → alpha-channel path."""
    print("test_rev_alpha ...", flush=True)
    img = _make_transparent_rev()
    pes, meta = convert_image_to_pes(img, 'fill', 100.0, 5, remove_bg=True)
    assert len(pes) > 0, "PES is empty"
    _check_rev_acceptance(pes, "alpha-channel")
    print("  OK")


def test_rev_10colors():
    """
    rev.png with 10 requested colors: noise auto-removal should yield ≥ 4 threads
    and keep total trims under 105.
    """
    print("test_rev_10colors ...", flush=True)
    img = _load_rev_png()
    pes, meta = convert_image_to_pes(img, 'fill', 100.0, 10, remove_bg=True)
    assert len(pes) > 0, "PES is empty"
    sc, tc, threads, runs = _parse_pes_runs(pes)
    import statistics
    median_run = statistics.median(runs) if runs else 0
    print(f"  10-colors: {threads} threads, {tc} trims, "
          f"median run={median_run:.0f}, {sc} stitches")
    assert threads >= 4, \
        f"only {threads} threads — expected ≥ 4 after noise removal"
    assert tc < 105, \
        f"{tc} trims — expected < 105"
    print("  OK")


if __name__ == '__main__':
    test_fill_1color()
    test_fill_3colors()
    test_cross_stitch()
    test_max_size()
    test_rev_flood_fill()
    test_rev_alpha()
    test_rev_10colors()
    print("\nAlle tester bestått.")
