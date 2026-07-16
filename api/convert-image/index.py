"""
api/convert-image/index.py
Convert JPEG/PNG image to PES embroidery file.

Supported stitch types:
  fill  – scanline fill with underlay (Brother PP1, max 100×100 mm)
  cross – cross stitch on 2.5 mm grid
"""

import json
import base64
import io
import math
import tempfile
import os
import traceback
from http.server import BaseHTTPRequestHandler


# --------------------------------------------------------------------------- #
# Brother thread colour palette (56 colours)                                   #
# --------------------------------------------------------------------------- #

_BROTHER = [
    (0,   0,   0,   "Black",             "001"),
    (28,  20,  13,  "Dark Brown",        "002"),
    (110, 55,  20,  "Brown",             "003"),
    (200, 120, 40,  "Nutmeg",            "004"),
    (215, 170, 30,  "Dark Gold",         "005"),
    (255, 210, 0,   "Gold",              "006"),
    (255, 255, 0,   "Yellow",            "007"),
    (255, 245, 170, "Pale Yellow",       "008"),
    (255, 245, 220, "Cream",             "009"),
    (250, 215, 145, "Skin",              "010"),
    (245, 175, 100, "Peach",             "011"),
    (235, 115, 70,  "Coral",             "012"),
    (220, 60,  35,  "Red Orange",        "013"),
    (200, 30,  25,  "Red",               "014"),
    (160, 0,   0,   "Dark Red",          "015"),
    (110, 0,   0,   "Wine",              "016"),
    (75,  0,   30,  "Dark Wine",         "017"),
    (140, 30,  75,  "Dark Violet",       "018"),
    (175, 60,  115, "Purple",            "019"),
    (215, 115, 175, "Magenta",           "020"),
    (245, 175, 210, "Light Magenta",     "021"),
    (255, 200, 225, "Pink",              "022"),
    (240, 145, 165, "Medium Pink",       "023"),
    (215, 90,  115, "Dark Pink",         "024"),
    (170, 45,  75,  "Salmon",            "025"),
    (80,  30,  90,  "Dark Purple",       "026"),
    (40,  0,   80,  "Very Dark Purple",  "027"),
    (20,  0,   100, "Navy",              "028"),
    (0,   0,   150, "Dark Blue",         "029"),
    (0,   50,  210, "Blue",              "030"),
    (0,   105, 225, "Bright Blue",       "031"),
    (55,  150, 220, "Sky Blue",          "032"),
    (100, 185, 240, "Light Blue",        "033"),
    (185, 225, 245, "Pale Blue",         "034"),
    (0,   130, 130, "Teal",              "035"),
    (0,   100, 100, "Dark Teal",         "036"),
    (0,   155, 125, "Dark Turquoise",    "037"),
    (0,   205, 165, "Turquoise",         "038"),
    (0,   135, 80,  "Green",             "039"),
    (0,   100, 50,  "Dark Green",        "040"),
    (0,   60,  20,  "Forest Green",      "041"),
    (50,  135, 50,  "Medium Green",      "042"),
    (100, 175, 80,  "Light Green",       "043"),
    (185, 225, 100, "Yellow Green",      "044"),
    (230, 240, 155, "Lime",              "045"),
    (200, 200, 60,  "Olive",             "046"),
    (155, 155, 50,  "Dark Olive",        "047"),
    (155, 120, 80,  "Khaki",             "048"),
    (200, 175, 125, "Sand",              "049"),
    (235, 215, 165, "Light Sand",        "050"),
    (245, 235, 200, "Ivory",             "051"),
    (255, 255, 255, "White",             "052"),
    (200, 205, 210, "Silver",            "053"),
    (150, 155, 160, "Gray",              "054"),
    (100, 105, 110, "Dark Gray",         "055"),
    (50,  55,  60,  "Charcoal",          "056"),
]


def _nearest_brother(r: int, g: int, b: int):
    best = _BROTHER[0]
    best_d = (r - best[0]) ** 2 + (g - best[1]) ** 2 + (b - best[2]) ** 2
    for e in _BROTHER[1:]:
        d = (r - e[0]) ** 2 + (g - e[1]) ** 2 + (b - e[2]) ** 2
        if d < best_d:
            best_d, best = d, e
    return best


def _rgb_to_lab(r: int, g: int, b: int):
    """Convert sRGB (0-255) to CIELab (D65)."""
    def lin(c):
        c /= 255.0
        return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92
    rl, gl, bl = lin(r), lin(g), lin(b)
    X = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047
    Y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000
    Z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883
    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    L = 116 * f(Y) - 16
    a = 500 * (f(X) - f(Y))
    b_ = 200 * (f(Y) - f(Z))
    return L, a, b_


def _nearest_brother_lab(r: int, g: int, b: int):
    """Find nearest Brother thread entry using CIELab ΔE-76."""
    L1, a1, b1 = _rgb_to_lab(r, g, b)
    best, best_d = _BROTHER[0], float('inf')
    for e in _BROTHER:
        L2, a2, b2 = _rgb_to_lab(e[0], e[1], e[2])
        d = (L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2
        if d < best_d:
            best_d, best = d, e
    return best


def _make_thread(r: int, g: int, b: int):
    """
    Create an EmbThread for the quantised colour (r, g, b).
    Thread colour is set to the *quantised* RGB (not the mapped Brother RGB)
    so that each distinct quantised colour becomes a distinct PES thread entry.
    Setting catalog_number to the Brother value would cause pyembroidery to
    collapse consecutive threads that share a catalog entry.
    """
    import pyembroidery
    _, _, _, name, _ = _nearest_brother_lab(r, g, b)
    t = pyembroidery.EmbThread()
    t.color = (r << 16) | (g << 8) | b   # keep quantised value unique
    t.name = name                          # human-readable label only
    return t


def _extract_extents(pattern):
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


# --------------------------------------------------------------------------- #
# Scanline helpers                                                              #
# --------------------------------------------------------------------------- #

def _runs(line_1d):
    """Return list of (start, end) index pairs for consecutive True runs."""
    import numpy as np
    padded = np.concatenate(([False], line_1d.astype(bool), [False]))
    diffs = np.diff(padded.astype(np.int8))
    starts = np.where(diffs == 1)[0]
    ends = np.where(diffs == -1)[0] - 1
    return list(zip(starts.tolist(), ends.tolist()))


def _scanline_h(mask, row_spacing: int, max_stitch: int):
    """Horizontal scanline fill positions (x, y)."""
    h, _ = mask.shape
    pts = []
    row_num = 0
    for y in range(0, h, row_spacing):
        row_pts = []
        for s, e in _runs(mask[y]):
            x = s
            while x <= e:
                row_pts.append((x, y))
                x += max_stitch
            if row_pts and row_pts[-1][0] != e:
                row_pts.append((e, y))
        if row_num % 2 == 1:
            row_pts.reverse()
        pts.extend(row_pts)
        row_num += 1
    return pts


def _scanline_v(mask, col_spacing: int, max_stitch: int):
    """Vertical scanline fill positions (x, y) — used for underlay."""
    _, w = mask.shape
    pts = []
    col_num = 0
    for x in range(0, w, col_spacing):
        col_pts = []
        for s, e in _runs(mask[:, x]):
            y = s
            while y <= e:
                col_pts.append((x, y))
                y += max_stitch
            if col_pts and col_pts[-1][1] != e:
                col_pts.append((x, e))
        if col_num % 2 == 1:
            col_pts.reverse()
        pts.extend(col_pts)
        col_num += 1
    return pts


def _emit(pattern, positions, cx: int, cy: int, pe,
          sc: list, jc: list, tc: list, max_stitch: int = 30):
    """Emit stitches for a list of (px,py) positions into the pattern."""
    prev = None
    for px, py in positions:
        ax, ay = px - cx, py - cy          # centre at hoop origin
        if prev is None:
            pattern.add_stitch_absolute(pe.JUMP, ax, ay)
            jc[0] += 1
        else:
            dist = math.hypot(ax - prev[0], ay - prev[1])
            if dist > 120:                  # > 12 mm → trim
                pattern.add_stitch_absolute(pe.TRIM, prev[0], prev[1])
                tc[0] += 1
                pattern.add_stitch_absolute(pe.JUMP, ax, ay)
                jc[0] += 1
            elif dist > max_stitch:         # → jump
                pattern.add_stitch_absolute(pe.JUMP, ax, ay)
                jc[0] += 1
            else:
                pattern.add_stitch_absolute(pe.STITCH, ax, ay)
                sc[0] += 1
        prev = (ax, ay)


# --------------------------------------------------------------------------- #
# Connected-component fill helpers                                              #
# --------------------------------------------------------------------------- #

def _seg_components(mask, row_spacing: int):
    """
    Group horizontal scanline segments into connected components.
    Segments in adjacent sampled rows are connected when their x-ranges overlap
    or are within row_spacing pixels of each other (handles thin curved regions
    that shift by up to their own width between sampled rows).
    Returns list of {y: [(start, end), ...]} dicts, one per component.
    """
    from collections import defaultdict
    h, _ = mask.shape
    tol = row_spacing  # horizontal tolerance for connectivity
    row_segs: dict = {}
    for y in range(0, h, row_spacing):
        segs = _runs(mask[y])
        if segs:
            row_segs[y] = segs
    if not row_segs:
        return []

    par: dict = {}

    def find(k):
        while par.get(k, k) != k:
            par[k] = par.get(par.get(k, k), par.get(k, k))
            k = par.get(k, k)
        return k

    def union(a, b):
        a, b = find(a), find(b)
        if a != b:
            par[b] = a

    sorted_ys = sorted(row_segs)
    for i in range(1, len(sorted_ys)):
        y_cur, y_prv = sorted_ys[i], sorted_ys[i - 1]
        for si, (s1, e1) in enumerate(row_segs[y_cur]):
            for pj, (s2, e2) in enumerate(row_segs[y_prv]):
                if s1 <= e2 + tol and s2 <= e1 + tol:
                    union((y_cur, si), (y_prv, pj))

    groups: dict = defaultdict(list)
    for y, segs in row_segs.items():
        for si in range(len(segs)):
            groups[find((y, si))].append((y, si))

    result = []
    for members in groups.values():
        comp: dict = defaultdict(list)
        for y, si in members:
            comp[y].append(row_segs[y][si])
        result.append(dict(comp))
    return result


def _component_pts(comp, max_stitch: int):
    """Serpentine-ordered (x, y) point list for one connected component."""
    pts: list = []
    sorted_ys = sorted(comp)
    for row_idx, y in enumerate(sorted_ys):
        segs = sorted(comp[y])
        row_pts: list = []
        for s, e in segs:
            x = s
            while x <= e:
                row_pts.append((x, y))
                x += max_stitch
            if not row_pts or row_pts[-1][0] != e:
                row_pts.append((e, y))
        if row_idx % 2 == 1:
            row_pts.reverse()
        pts.extend(row_pts)
    return pts


def _component_area(comp):
    """Approximate pixel count (area) of a component."""
    return sum(e - s + 1 for segs in comp.values() for s, e in segs)


def _comp_mask_full(comp: dict, h: int, w: int, base_mask=None):
    """
    Reconstruct a full H×W binary mask for one connected component.
    Fills gaps between sampled rows by OR-ing adjacent sampled rows,
    then intersects with base_mask to exclude non-colour pixels.
    """
    import numpy as np
    m = np.zeros((h, w), dtype=bool)
    sorted_ys = sorted(comp)
    for y in sorted_ys:
        for s, e in comp[y]:
            m[y, s:e+1] = True
    for i in range(len(sorted_ys) - 1):
        y0, y1 = sorted_ys[i], sorted_ys[i + 1]
        row = m[y0] | m[y1]
        for yy in range(y0 + 1, y1):
            m[yy] = row
    if base_mask is not None:
        m &= base_mask
    return m


def _component_pts_smart(comp: dict, max_stitch: int):
    """
    Greedy nearest-neighbour segment ordering for a connected component.
    Consecutive segments within the same arm are ~row_spacing apart (stitches).
    Transitions between disconnected arms are as short as possible (1 TRIM each).
    """
    seg_data = []
    for y in sorted(comp):
        for s, e in sorted(comp[y]):
            fwd = []
            x = s
            while x <= e:
                fwd.append((x, y))
                x += max_stitch
            if not fwd or fwd[-1][0] != e:
                fwd.append((e, y))
            seg_data.append((fwd[0], fwd[-1], fwd))

    if not seg_data:
        return []

    n = len(seg_data)
    done = [False] * n
    path = []
    done[0] = True
    path.extend(seg_data[0][2])
    cur = seg_data[0][1]

    for _ in range(n - 1):
        best_i, best_d, best_rev = -1, float('inf'), False
        for i in range(n):
            if done[i]:
                continue
            head, tail, _ = seg_data[i]
            dh = abs(cur[0] - head[0]) + abs(cur[1] - head[1])
            dt = abs(cur[0] - tail[0]) + abs(cur[1] - tail[1])
            d = min(dh, dt)
            if d < best_d:
                best_d, best_i, best_rev = d, i, dt < dh
        if best_i == -1:
            break
        done[best_i] = True
        fwd = seg_data[best_i][2]
        pts = fwd[::-1] if best_rev else fwd
        path.extend(pts)
        cur = pts[-1]

    return path


def _sample_path(path: list, step: int):
    """Down-sample a pixel path to ~step-unit spacing."""
    if not path:
        return []
    out = [path[0]]
    acc = 0.0
    for i in range(1, len(path)):
        acc += math.hypot(path[i][0] - path[i - 1][0],
                          path[i][1] - path[i - 1][1])
        if acc >= step:
            out.append(path[i])
            acc = 0.0
    if out[-1] != path[-1]:
        out.append(path[-1])
    return out


def _fill_holes(mask):
    """
    Fill enclosed background holes in a binary mask.
    Floods from all 4 edges to find the 'outside'; any background pixel not
    reachable from the edge is an enclosed hole and gets set to True.
    """
    from collections import deque
    import numpy as np
    h, w = mask.shape
    outside = np.zeros((h, w), dtype=bool)
    queue = deque()
    for y in range(h):
        for x in (0, w - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if not mask[y, x] and not outside[y, x]:
                outside[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not mask[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                queue.append((ny, nx))
    return mask | ~outside


def _dilate_mask(mask, radius: int):
    """4-connected binary dilation by `radius` pixels."""
    import numpy as np
    result = mask.copy()
    for _ in range(radius):
        nxt = result.copy()
        nxt[1:]  |= result[:-1]
        nxt[:-1] |= result[1:]
        nxt[:, 1:]  |= result[:, :-1]
        nxt[:, :-1] |= result[:, 1:]
        result = nxt
    return result


def _cleanup_regions(masks, palette):
    """
    Remove connected components that are unsewable: too small, too narrow, or
    thin slivers. Removed pixels are reassigned to the nearest surviving color
    per pixel using scipy's distance transform.
    Returns (new_masks, removed_count).
    """
    import numpy as np
    from scipy.ndimage import label as _label
    from scipy.ndimage import distance_transform_edt as _dte
    from scipy.ndimage import binary_erosion as _erode

    MIN_AREA    = 150   # 1.5 mm²  (1 px = 0.1 mm → 1 mm² = 100 px)
    MIN_DT      = 5.0   # 0.5 mm half-width → component narrower than 1 mm
    SLIVER_AREA = 500   # 5 mm²: upper bound for sliver check
    COMPACT_THR = 0.15  # 4πA/P²

    h, w = masks[0].shape
    new_masks = [m.copy() for m in masks]
    removed_count = 0

    for i, m in enumerate(masks):
        if not m.any():
            continue
        labeled, n_comps = _label(m)
        if n_comps == 0:
            continue
        dt = _dte(m)  # one distance-transform per colour mask (efficient)
        for c in range(1, n_comps + 1):
            cm = labeled == c
            area = int(cm.sum())
            remove = False
            if area < MIN_AREA:
                remove = True
            elif float(dt[cm].max()) < MIN_DT:
                remove = True
            elif area < SLIVER_AREA:
                eroded = _erode(cm)
                perim = int((cm & ~eroded).sum())
                if perim > 0 and 4 * math.pi * area / perim ** 2 < COMPACT_THR:
                    remove = True
            if remove:
                new_masks[i][cm] = False
                removed_count += 1

    # Reassign removed foreground pixels to nearest surviving colour per pixel
    surv = np.zeros((h, w), dtype=bool)
    for m in new_masks:
        surv |= m
    orig_fg = np.zeros((h, w), dtype=bool)
    for m in masks:
        orig_fg |= m
    reassign_px = orig_fg & ~surv
    if reassign_px.any() and surv.any():
        surv_map = np.full((h, w), -1, dtype=np.int32)
        for ci, m in enumerate(new_masks):
            surv_map[m] = ci
        _, idx = _dte(~surv, return_indices=True)
        ry, rx = np.where(reassign_px)
        targets = surv_map[idx[0][ry, rx], idx[1][ry, rx]]
        valid = targets >= 0
        for ci in range(len(new_masks)):
            sel = valid & (targets == ci)
            if sel.any():
                new_masks[ci][ry[sel], rx[sel]] = True

    return new_masks, removed_count


def _satin_pts(comp: dict):
    """
    Satin stitch: edge-to-edge zigzag across the narrow form, alternating
    direction each row.  Works on the ROW-spaced component dict directly.
    """
    pts = []
    forward = True
    for y in sorted(comp):
        segs = sorted(comp[y])
        if forward:
            for s, e in segs:
                pts.append((s, y))
                pts.append((e, y))
        else:
            for s, e in reversed(segs):
                pts.append((e, y))
                pts.append((s, y))
        forward = not forward
    return pts


def _trace_contour(mask, step: int):
    """
    Trace the outer boundary of a binary mask with Moore-neighbour contour
    following and return points sampled at ~step px intervals.
    """
    import numpy as np
    h, w = mask.shape
    # boundary = foreground pixels with ≥1 background 4-neighbour
    inner = np.zeros_like(mask, dtype=bool)
    inner[1:-1, 1:-1] = (
        mask[1:-1, 1:-1] & mask[:-2, 1:-1] &
        mask[2:, 1:-1]   & mask[1:-1, :-2] & mask[1:-1, 2:]
    )
    bnd = mask & ~inner
    ys, xs = np.where(bnd)
    if len(xs) == 0:
        return []
    idx = int(np.argmin(ys * w + xs))
    sy, sx = int(ys[idx]), int(xs[idx])

    D8 = [(-1, 0), (-1, 1), (0, 1), (1, 1),
          (1, 0),  (1, -1), (0, -1), (-1, -1)]
    cur_y, cur_x = sy, sx
    prev_d = 6
    path = [(cur_x, cur_y)]
    seen = {(cur_y, cur_x)}

    for _ in range(w * h):
        back = (prev_d + 4) % 8
        moved = False
        for i in range(1, 9):
            di = (back + i) % 8
            dy, dx = D8[di]
            ny, nx = cur_y + dy, cur_x + dx
            if 0 <= ny < h and 0 <= nx < w and bnd[ny, nx]:
                if (ny, nx) == (sy, sx) and len(path) > 2:
                    path.append((nx, ny))
                    return _sample_path(path, step)
                if (ny, nx) not in seen:
                    cur_y, cur_x = ny, nx
                    prev_d = di
                    path.append((cur_x, cur_y))
                    seen.add((cur_y, cur_x))
                    moved = True
                    break
        if not moved:
            break
    return _sample_path(path, step)


# --------------------------------------------------------------------------- #
# Background removal                                                            #
# --------------------------------------------------------------------------- #

def _compute_bg_mask(img_arr):
    """
    Flood-fill from all 4 corners with tolerance 30 (squared = 900).
    Returns boolean mask (H×W): True = background pixel.
    """
    import numpy as np
    from collections import deque

    h, w = img_arr.shape[:2]
    bg_mask = np.zeros((h, w), dtype=bool)
    visited = np.zeros((h, w), dtype=bool)
    TOLERANCE_SQ = 30 * 30

    for start_y, start_x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        if visited[start_y, start_x]:
            continue
        seed = img_arr[start_y, start_x].astype(np.int32)
        queue = deque([(start_y, start_x)])
        visited[start_y, start_x] = True
        while queue:
            y, x = queue.popleft()
            diff = img_arr[y, x].astype(np.int32) - seed
            if int(diff[0] ** 2 + diff[1] ** 2 + diff[2] ** 2) <= TOLERANCE_SQ:
                bg_mask[y, x] = True
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((ny, nx))
    return bg_mask


# --------------------------------------------------------------------------- #
# Main conversion                                                               #
# --------------------------------------------------------------------------- #

def convert_image_to_pes(image_bytes: bytes,
                         stitch_type: str,
                         size_mm: float,
                         num_colors: int,
                         remove_bg: bool = False):
    """
    Convert raw image bytes to a PES file.
    Returns (pes_bytes, metadata_dict).
    """
    import numpy as np
    from PIL import Image
    import pyembroidery

    # ── 1. Load & resize to target size (1 px = 0.1 mm = 1 pyembroidery unit) ─
    raw_img = Image.open(io.BytesIO(image_bytes))
    has_alpha = raw_img.mode in ('RGBA', 'LA', 'PA')

    img = raw_img.convert('RGB')
    w0, h0 = img.size
    scale = (size_mm * 10) / max(w0, h0)
    new_w = max(10, int(round(w0 * scale)))
    new_h = max(10, int(round(h0 * scale)))
    img = img.resize((new_w, new_h), Image.LANCZOS)
    img_arr = np.array(img, dtype=np.uint8)

    cx, cy = new_w // 2, new_h // 2

    # ── 1b. Background mask ───────────────────────────────────────────────────
    bg_mask = None
    if remove_bg:
        if has_alpha:
            # Use NEAREST for alpha to avoid blur creating spurious semi-transparent pixels
            alpha_ch = raw_img.convert('RGBA').split()[3]
            alpha_ch = alpha_ch.resize((new_w, new_h), Image.NEAREST)
            bg_mask = np.array(alpha_ch, dtype=np.uint8) < 128
            if not bg_mask.any():
                # All pixels fully opaque (e.g. RGBA with white background) —
                # fall back to flood-fill from corners
                bg_mask = _compute_bg_mask(img_arr)
        else:
            bg_mask = _compute_bg_mask(img_arr)

    # Apply bg_mask BEFORE quantisation so background pixels don't bias colour clusters
    if bg_mask is not None:
        img_arr[bg_mask] = 255   # fill background with white (neutral for MEDIANCUT)
        img = Image.fromarray(img_arr)

    # ── 2. Colour quantisation ────────────────────────────────────────────────
    # Median-filter the image before quantisation to reassign antialiasing border
    # pixels to the dominant neighbouring colour, giving cleaner palette colours.
    from PIL import ImageFilter as _IF
    img_mf = img.filter(_IF.MedianFilter(size=3))
    img_mf_arr = np.array(img_mf, dtype=np.uint8)
    if bg_mask is not None:
        img_mf_arr[bg_mask] = 255
        img_mf = Image.fromarray(img_mf_arr)

    if num_colors == 1:
        gray = np.mean(img_arr.astype(float), axis=2)
        masks = [gray < 128]
        palette = [(0, 0, 0)]
    else:
        if bg_mask is not None and (~bg_mask).any():
            # Quantise foreground-only pixels with FASTOCTREE so that:
            # (a) background doesn't waste palette slots, and
            # (b) small but visually distinct colours (black, pink) that MEDIANCUT
            #     would absorb into dominant clusters are preserved.
            fg_px = img_mf_arr[~bg_mask]
            N_fg = len(fg_px)
            side = max(1, int(math.ceil(math.sqrt(N_fg))))
            canvas = np.empty((side * side, 3), dtype=np.uint8)
            canvas[:N_fg] = fg_px
            canvas[N_fg:] = np.tile(fg_px,
                                    (math.ceil(side * side / N_fg), 1))[:side * side - N_fg]
            q_ref = Image.fromarray(canvas.reshape(side, side, 3)).quantize(
                colors=num_colors, method=Image.Quantize.FASTOCTREE)
            q = img_mf.quantize(palette=q_ref, dither=0)
        else:
            # No background mask — MEDIANCUT gives clean results for solid-colour images
            q = img_mf.quantize(colors=num_colors, method=Image.Quantize.MEDIANCUT)
        raw = q.getpalette()
        palette_all = [(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2])
                       for i in range(num_colors)]
        idx_arr = np.array(q, dtype=np.uint8)
        lum = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in palette_all]
        order = sorted(range(num_colors), key=lambda i: -lum[i])
        palette = [palette_all[o] for o in order]
        masks = [(idx_arr == o) for o in order]

    # Apply background exclusion to all masks
    if bg_mask is not None:
        masks = [m & ~bg_mask for m in masks]

    # Region-based cleanup: remove unsewable connected components per colour mask.
    # Pixels from removed components are reassigned to the nearest surviving colour.
    masks, _removed_region_count = _cleanup_regions(masks, palette)

    # Expand each color region ~0.3 mm (3 px) into later-stitched regions only,
    # preventing fabric-pullback gaps at color boundaries.
    for i in range(len(masks) - 1):
        later = np.zeros_like(masks[i], dtype=bool)
        for j in range(i + 1, len(masks)):
            later |= masks[j]
        if later.any():
            masks[i] = masks[i] | (_dilate_mask(masks[i], 3) & later)

    # ── 3. Build pyembroidery pattern ─────────────────────────────────────────
    pattern = pyembroidery.EmbPattern()

    sc, jc, tc = [0], [0], [0]
    active_colors: list = []
    has_thin = False
    first = True

    if stitch_type == 'fill':
        ROW      = 4    # 0.4 mm fill row spacing
        MAX      = 30   # 3.0 mm max stitch length
        MIN_AREA = 300  # 3 mm² minimum (1 px = 0.1 mm → 3 mm² = 300 px)

        for (r, g, b), mask_raw in zip(palette, masks):
            mask = mask_raw.astype(bool)
            if not mask.any():
                continue

            # Detect thin features for warning (before component filtering)
            if not has_thin:
                for y in range(0, new_h, ROW * 2):
                    for s, e in _runs(mask[y]):
                        if e - s < 10:
                            has_thin = True
                            break
                    if has_thin:
                        break

            # Find connected components and drop noise (< 3 mm²)
            comps = _seg_components(mask, ROW)
            sig_comps = [c for c in comps if _component_area(c) >= MIN_AREA]
            if not sig_comps:
                continue

            if not first:
                pattern.add_stitch_absolute(pyembroidery.COLOR_BREAK, 0, 0)
            pattern.add_thread(_make_thread(r, g, b))
            active_colors.append({'r': r, 'g': g, 'b': b})
            first = False

            for ci, comp in enumerate(sig_comps):
                if ci > 0:
                    pattern.add_stitch_absolute(pyembroidery.TRIM, 0, 0)
                    tc[0] += 1

                avg_width = _component_area(comp) / max(1, len(comp))
                if avg_width < 30:
                    # Narrow feature (< ~3 mm): satin edge-to-edge zigzag
                    _emit(pattern, _satin_pts(comp),
                          cx, cy, pyembroidery, sc, jc, tc, max_stitch=120)
                    continue

                comp_m = _comp_mask_full(comp, new_h, new_w, mask)
                if not comp_m.any():
                    continue

                # Fill enclosed holes so the greedy path stays continuous
                # within each arm — eliminates within-component gap crossings.
                comp_m_filled = _fill_holes(comp_m)
                comp_filled = {}
                for fy in range(0, new_h, ROW):
                    fsegs = list(_runs(comp_m_filled[fy]))
                    if fsegs:
                        comp_filled[fy] = fsegs

                _emit(pattern,
                      _component_pts_smart(comp_filled if comp_filled else comp, MAX),
                      cx, cy, pyembroidery, sc, jc, tc)

    elif stitch_type == 'cross':
        CELL = 25
        HALF = CELL // 2

        for (r, g, b), mask_raw in zip(palette, masks):
            mask = mask_raw.astype(bool)
            if not mask.any():
                continue

            if not first:
                pattern.add_stitch_absolute(pyembroidery.COLOR_BREAK, 0, 0)
            pattern.add_thread(_make_thread(r, g, b))
            active_colors.append({'r': r, 'g': g, 'b': b})
            first = False

            rows = new_h // CELL
            cols = new_w // CELL
            cross_pts: list = []
            for ri in range(rows):
                row_pts: list = []
                for ci in range(cols):
                    y0, x0 = ri * CELL, ci * CELL
                    cell = mask[y0:y0 + CELL, x0:x0 + CELL]
                    if cell.size > 0 and cell.mean() > 0.5:
                        ccx, ccy = x0 + HALF, y0 + HALF
                        row_pts += [
                            (ccx - HALF, ccy - HALF),
                            (ccx + HALF, ccy + HALF),
                            (ccx - HALF, ccy + HALF),
                            (ccx + HALF, ccy - HALF),
                        ]
                if ri % 2 == 1:
                    row_pts.reverse()
                cross_pts.extend(row_pts)
            _emit(pattern, cross_pts, cx, cy, pyembroidery, sc, jc, tc)

    if not active_colors:
        raise ValueError(
            "Ingen tegning funnet — bildet ser ut til å være nesten hvitt. "
            "Prøv et bilde med tydeligere motiv."
        )

    pattern.add_stitch_absolute(pyembroidery.END, 0, 0)

    # ── 4. Write PES ──────────────────────────────────────────────────────────
    with tempfile.NamedTemporaryFile(suffix='.pes', delete=False) as f:
        tmp = f.name
    try:
        pyembroidery.write(pattern, tmp, {
            'hoop_width':  1000,
            'hoop_height': 1000,
        })
        with open(tmp, 'rb') as f:
            pes_bytes = f.read()
        # Re-parse the written file so metadata matches what external tools see
        _parsed = pyembroidery.read(tmp)
        ghost_color_count      = 0
        fragmented_color_count = 0
        if _parsed is not None and _parsed.stitches:
            sc[0] = sum(1 for s in _parsed.stitches if s[2] == pyembroidery.STITCH)
            tc[0] = sum(1 for s in _parsed.stitches if s[2] == pyembroidery.TRIM)
            jc[0] = sum(1 for s in _parsed.stitches if s[2] == pyembroidery.JUMP)
            _cur_sc      = 0   # stitches in current thread block
            _cur_run     = 0   # stitches in current unbroken run
            _thread_runs: list = []
            for _, _, _cmd in _parsed.stitches:
                if _cmd == pyembroidery.STITCH:
                    _cur_sc  += 1
                    _cur_run += 1
                elif _cmd in (pyembroidery.TRIM, pyembroidery.JUMP):
                    if _cur_run > 0:
                        _thread_runs.append(_cur_run)
                        _cur_run = 0
                elif _cmd in (pyembroidery.COLOR_CHANGE, pyembroidery.COLOR_BREAK,
                              pyembroidery.END):
                    if _cur_run > 0:
                        _thread_runs.append(_cur_run)
                        _cur_run = 0
                    if _cur_sc < 50:
                        ghost_color_count += 1
                    elif _thread_runs:
                        _med = sorted(_thread_runs)[len(_thread_runs) // 2]
                        if _med < 10:
                            fragmented_color_count += 1
                    _cur_sc      = 0
                    _thread_runs = []
        else:
            sc[0] = sum(1 for s in pattern.stitches if s[2] == pyembroidery.STITCH)
            tc[0] = sum(1 for s in pattern.stitches if s[2] == pyembroidery.TRIM)
            jc[0] = sum(1 for s in pattern.stitches if s[2] == pyembroidery.JUMP)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass

    # ── 5. Metadata & warnings ────────────────────────────────────────────────

    width_mm, height_mm = _extract_extents(pattern)
    width_mm  = width_mm  or round(new_w / 10.0, 1)
    height_mm = height_mm or round(new_h / 10.0, 1)
    est_sec   = int((sc[0] / 400) * 60) if sc[0] > 0 else 0

    warnings = []
    if width_mm > 100 or height_mm > 100:
        warnings.append(
            f"Broderifeltet er {width_mm:.1f}×{height_mm:.1f} mm — "
            f"overskreder maskinens 100×100 mm!"
        )
    if sc[0] > 25_000:
        warnings.append(
            f"{sc[0]:,} sting — lang sømtid (ca. {est_sec // 60} min)"
        )
    trim_threshold = 30 + 15 * len(active_colors)
    if tc[0] > trim_threshold:
        warnings.append(
            f"{tc[0]} trims — normalt under {trim_threshold} for "
            f"{len(active_colors)} farger; vurder enklere bilde"
        )
    if ghost_color_count > 0:
        warnings.append(
            f"{ghost_color_count} av fargene dekker svært lite (under 50 sting) — "
            "sannsynligvis kantstøy fra bildet. Prøv færre farger for et renere resultat."
        )
    if fragmented_color_count > 0:
        warnings.append(
            f"{fragmented_color_count} av fargene har svært korte løp (median under 10 sting) — "
            "trolig kantstøy. Prøv færre farger for et renere resultat."
        )
    if has_thin:
        warnings.append(
            "Noen regioner er smalere enn 1 mm — "
            "kan bli brutte eller forsvinne i sømmen"
        )

    return pes_bytes, {
        'stitch_count': sc[0],
        'color_count':  len(active_colors),
        'trim_count':   tc[0],
        'jump_count':   jc[0],
        'width_mm':     width_mm,
        'height_mm':    height_mm,
        'est_seconds':  est_sec,
        'colors':       active_colors,
        'warnings':     warnings,
    }


# --------------------------------------------------------------------------- #
# Vercel HTTP handler                                                           #
# --------------------------------------------------------------------------- #

class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            n = int(self.headers.get('Content-Length', 0))
            if n == 0:
                self._json(400, {'error': 'Tom forespørsel'})
                return
            body = json.loads(self.rfile.read(n))

            img_b64    = body.get('image_data', '')
            s_type     = body.get('stitch_type', 'fill')
            size_mm    = float(body.get('size_mm', 100))
            n_colors   = int(body.get('num_colors', 3))
            rem_bg     = bool(body.get('remove_bg', False))

            if not img_b64:
                self._json(400, {'error': 'Mangler image_data'})
                return
            if s_type not in ('fill', 'cross'):
                self._json(400, {'error': "stitch_type må være 'fill' eller 'cross'"})
                return
            if not (1 <= n_colors <= 10):
                self._json(400, {'error': 'num_colors må være 1–10'})
                return
            if not (5.0 <= size_mm <= 100.0):
                self._json(400, {'error': 'size_mm må være 5–100'})
                return

            img_bytes = base64.b64decode(img_b64)
            pes_bytes, meta = convert_image_to_pes(
                img_bytes, s_type, size_mm, n_colors, rem_bg
            )
            self._json(200, {
                'pes_data': base64.b64encode(pes_bytes).decode(),
                'metadata': meta,
            })

        except Exception as e:
            tb = traceback.format_exc()
            print(f'[convert-image] Error: {e}\n{tb}')
            self._json(500, {'error': str(e)})

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass
