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


def _nearest_brother_lab(r: int, g: int, b: int, wL: float = 1.0, wab: float = 1.0):
    """Find nearest Brother thread entry using weighted CIELab ΔE-76."""
    L1, a1, b1 = _rgb_to_lab(r, g, b)
    best, best_d = _BROTHER[0], float('inf')
    for e in _BROTHER:
        L2, a2, b2 = _rgb_to_lab(e[0], e[1], e[2])
        d = (wL * (L1 - L2)) ** 2 + (wab * (a1 - a2)) ** 2 + (wab * (b1 - b2)) ** 2
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
    For saturated colours (C* > 25) hue is weighted more than lightness so that
    e.g. coral cheeks don't match a desaturated khaki/sand thread.
    """
    import pyembroidery
    _, _a1, _b1 = _rgb_to_lab(r, g, b)
    _chroma = (_a1 ** 2 + _b1 ** 2) ** 0.5
    if _chroma > 25:
        _, _, _, name, _ = _nearest_brother_lab(r, g, b, wL=0.7, wab=1.3)
    else:
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


def _fill_angled(comp_m, angle_deg: float, orig_h: int, orig_w: int,
                 row_spacing: int, max_stitch: int):
    """
    Generate a fill path for comp_m at the given angle.
    Rotates the mask by -angle_deg, runs the standard horizontal fill,
    then rotates the resulting points back by +angle_deg.
    angle_deg == 0 uses the unrotated code path (bit-identical to the original).
    """
    import math
    import numpy as np
    from scipy.ndimage import rotate as _nd_rotate

    if angle_deg == 0:
        comp_m_filled = _fill_holes(comp_m)
        comp_filled = {}
        for fy in range(0, orig_h, row_spacing):
            fsegs = list(_runs(comp_m_filled[fy]))
            if fsegs:
                comp_filled[fy] = fsegs
        return _component_pts_smart(comp_filled if comp_filled else {}, max_stitch)

    rad = math.radians(angle_deg)
    cos_t = math.cos(rad)
    sin_t = math.sin(rad)

    rotated = _nd_rotate(comp_m.astype(np.uint8), -angle_deg,
                         reshape=True, order=0, cval=0).astype(bool)
    rot_h, rot_w = rotated.shape
    rot_filled = _fill_holes(rotated)
    rot_comp: dict = {}
    for fy in range(0, rot_h, row_spacing):
        fsegs = list(_runs(rot_filled[fy]))
        if fsegs:
            rot_comp[fy] = fsegs

    rot_path = _component_pts_smart(rot_comp if rot_comp else {}, max_stitch)
    if not rot_path:
        return []

    rot_cx = rot_w / 2.0
    rot_cy = rot_h / 2.0
    orig_cx = orig_w / 2.0
    orig_cy = orig_h / 2.0

    result = []
    prev_xy = None
    for rx, ry in rot_path:
        dxr = rx - rot_cx
        dyr = ry - rot_cy
        dx = dxr * cos_t - dyr * sin_t
        dy = dxr * sin_t + dyr * cos_t
        ox = max(0, min(orig_w - 1, int(round(orig_cx + dx))))
        oy = max(0, min(orig_h - 1, int(round(orig_cy + dy))))
        xy = (ox, oy)
        if xy != prev_xy:
            result.append(xy)
            prev_xy = xy
    return result


def _assign_fill_angles(masks, protected_indices=None):
    """
    Greedy graph-colouring over a region-adjacency graph to assign fill angles.
    Adjacent regions get different angles from {0, 45, 90, 135}.
    Largest region and protected (small-detail) colours get 0°.
    """
    import numpy as np
    ANGLES = [0, 45, 90, 135]
    n = len(masks)
    if n == 0:
        return []
    protected_indices = set(protected_indices or [])
    areas = [int(m.astype(bool).sum()) for m in masks]

    dilated = []
    for m in masks:
        mb = m.astype(bool)
        d = mb.copy()
        for _ in range(2):
            nxt = d.copy()
            nxt[1:] |= d[:-1]
            nxt[:-1] |= d[1:]
            nxt[:, 1:] |= d[:, :-1]
            nxt[:, :-1] |= d[:, 1:]
            d = nxt
        dilated.append(d)

    adj: list = [set() for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            if np.logical_and(dilated[i], masks[j].astype(bool)).any():
                adj[i].add(j)
                adj[j].add(i)

    order = sorted(range(n), key=lambda i: -areas[i])
    angle_map: dict = {}
    for idx in order:
        if idx in protected_indices:
            angle_map[idx] = 0
            continue
        used = {angle_map[nb] for nb in adj[idx] if nb in angle_map}
        angle_map[idx] = next((a for a in ANGLES if a not in used), 0)
    return [angle_map.get(i, 0) for i in range(n)]


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


def _filter_short_moves(pts, min_dist, max_stitch, trim_dist):
    """
    Remove intermediate stitch points closer than min_dist to the previous kept
    point, but only when skipping would NOT create a gap > max_stitch to the
    next original point (which would force an unwanted JUMP in _emit).
    Run boundaries (gap > trim_dist) and run endpoints are always kept.
    """
    if len(pts) <= 2:
        return pts
    result = [pts[0]]
    n = len(pts)
    for i in range(1, n):
        prev = result[-1]
        cur = pts[i]
        gap = math.hypot(cur[0] - prev[0], cur[1] - prev[1])
        if gap > trim_dist:
            result.append(cur)      # genuine run boundary
        elif gap >= min_dist:
            result.append(cur)      # stitch long enough
        else:
            # Too short. Skip only if the next original point stays within
            # max_stitch of prev (so _emit won't insert an unwanted JUMP/TRIM).
            if i == n - 1:
                result.append(cur)
            else:
                nxt = pts[i + 1]
                nxt_from_cur = math.hypot(nxt[0] - cur[0], nxt[1] - cur[1])
                if nxt_from_cur > trim_dist:
                    result.append(cur)   # cur ends its run, keep it
                elif math.hypot(nxt[0] - prev[0], nxt[1] - prev[1]) <= max_stitch:
                    pass                 # skip: next still within stitch reach
                else:
                    result.append(cur)   # keep: skipping would force a JUMP
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


def _preprocess_portrait_color(img_arr, smoothing):
    """
    Edge-preserving smoothing for portrait colour mode.
    smoothing: 0=low (1×3x3), 1=medium (2×5x5), 2=high (3×7x7 median passes).
    Returns preprocessed RGB uint8 array (same shape as input).
    """
    from PIL import Image
    from PIL import ImageFilter as _IF
    img = Image.fromarray(img_arr)
    if smoothing == 0:
        img = img.filter(_IF.MedianFilter(size=3))
    elif smoothing == 1:
        img = img.filter(_IF.MedianFilter(size=5))
        img = img.filter(_IF.MedianFilter(size=5))
    else:
        img = img.filter(_IF.MedianFilter(size=7))
        img = img.filter(_IF.MedianFilter(size=7))
        img = img.filter(_IF.MedianFilter(size=7))
    import numpy as np
    return np.array(img, dtype=np.uint8)


def _preprocess_stencil(img_arr, detail_level, line_thickness_mm):
    """
    Convert to binary stencil (black-on-white) for stencil/silhouette mode.

    detail_level: 0–100; maps to adaptive-threshold offset C = detail_level−50.
        C > 0 → less black (more detail); C < 0 → more black.
    line_thickness_mm: 1.2–2.5; morphological dilation radius to ensure
        all black features are at least this wide (in mm, where 1 px = 0.1 mm).

    Returns H×W bool mask (True = black / filled).
    """
    import numpy as np
    from scipy.ndimage import (median_filter as _mf, uniform_filter as _uf,
                               binary_dilation as _dil, label as _lbl)

    # Luminosity grayscale
    gray = (0.299 * img_arr[:, :, 0] +
            0.587 * img_arr[:, :, 1] +
            0.114 * img_arr[:, :, 2]).astype(np.float32)

    # Edge-preserving smoothing (two 5×5 median passes)
    gray = _mf(gray, size=5).astype(np.float32)
    gray = _mf(gray, size=5).astype(np.float32)

    # Adaptive threshold: pixel becomes black if gray < local_mean − C
    block = max(5, min(41, gray.shape[0] // 4 * 2 + 1))  # odd, ≥5
    local_mean = _uf(gray, size=block)
    C = float(detail_level) - 50.0
    binary = gray < (local_mean - C)

    # Morphological thickening to minimum width
    # radius = half minimum width in pixels (1 px = 0.1 mm)
    radius_px = max(1, int(round(line_thickness_mm * 5.0)))
    r = radius_px
    Y, X = np.ogrid[-r:r + 1, -r:r + 1]
    disk = (X ** 2 + Y ** 2) <= r ** 2
    binary = _dil(binary, structure=disk)

    # Remove white islands (holes) and black islands < 3 mm² (300 px)
    MIN_ISLAND = 300
    white = ~binary
    wl, nw = _lbl(white)
    for c in range(1, nw + 1):
        if (wl == c).sum() < MIN_ISLAND:
            binary[wl == c] = True
    bl, nb = _lbl(binary)
    for c in range(1, nb + 1):
        if (bl == c).sum() < MIN_ISLAND:
            binary[bl == c] = False

    return binary


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
    Flood-fill from all 4 corners (RGB tolerance 30) to detect background.
    Also handles:
    - fake-transparency checkerboard: seeds both alternating colours so the
      full checkerboard border is removed.
    - enclosed background holes (e.g. interior of letter 'o'/'e'/'a'): any
      connected region of close-to-background pixels (ΔE < 5 in Lab) that
      does not touch the image border is reclassified as background.
    Returns boolean mask (H×W): True = background pixel.
    """
    import numpy as np
    from collections import deque

    h, w = img_arr.shape[:2]
    bg_mask = np.zeros((h, w), dtype=bool)
    visited = np.zeros((h, w), dtype=bool)
    TOLERANCE_SQ = 30 * 30

    # ── Phase 0: detect checkerboard (fake transparency) ──────────────────────
    # Scan the top row for an alternating light/achromatic pattern with a
    # regular period.  If found, add the alternate colour as an extra seed so
    # both checkerboard colours get flood-filled.
    _seeds = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]
    _top = img_arr[0, :min(128, w)].astype(np.int32)
    _corner = _top[0]
    _corner_is_light = (float(np.mean(_corner)) > 150 and
                        int(_corner.max()) - int(_corner.min()) < 40)
    if _corner_is_light and len(_top) > 4:
        _xi0 = -1
        for _i in range(1, len(_top)):
            _d2 = int(np.sum((_top[_i] - _corner) ** 2))
            if TOLERANCE_SQ < _d2 < 15000:          # noticeably different but still light
                _c = _top[_i]
                if float(_c.mean()) > 150 and int(_c.max()) - int(_c.min()) < 40:
                    _xi0 = _i
                    break
        if _xi0 > 0:
            # Verify regular period: the colour at xi0+period must differ from xi0
            for _xi2 in range(_xi0 + 1, len(_top)):
                _d2b = int(np.sum((_top[_xi2] - _top[_xi0]) ** 2))
                if _d2b > TOLERANCE_SQ:
                    _period = _xi2 - _xi0
                    _xi3 = _xi2 + _period
                    if _xi3 < len(_top):
                        _d3 = int(np.sum((_top[_xi3] - _top[_xi2]) ** 2))
                        if _d3 > TOLERANCE_SQ:      # alternates again — confirmed
                            _seeds.append((0, _xi0))
                    break

    # ── Phase 1: flood-fill from seeds ────────────────────────────────────────
    for start_y, start_x in _seeds:
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

    # ── Phase 2: reclassify enclosed close-colour regions ─────────────────────
    # Find connected components of pixels that are (a) not yet background and
    # (b) within ΔE 5 of the detected background mean in Lab space.  Any such
    # component that does not touch the image border is an enclosed background
    # hole (like the interior of a letter) and is added to bg_mask.
    bg_pix = img_arr[bg_mask]
    if len(bg_pix) == 0:
        return bg_mask

    bg_lab_mean = _rgb_arr_to_lab(bg_pix).mean(axis=0)

    # Vectorised ΔE map: cheap because _rgb_arr_to_lab is numpy-vectorised
    all_lab = _rgb_arr_to_lab(img_arr.reshape(-1, 3)).reshape(h, w, 3)
    de_map = np.sqrt(np.sum((all_lab - bg_lab_mean) ** 2, axis=2))

    # close_mask: background-coloured pixels not yet classified as background
    close_mask = (de_map < 5.0) & ~bg_mask

    # BFS over close_mask pixels only; skip components touching the border
    _enclosed_px = 0
    comp_vis = ~close_mask          # non-close pixels treated as already visited
    for _sy, _sx in np.argwhere(close_mask):
        if comp_vis[_sy, _sx]:
            continue
        touches_border = False
        comp_ys: list = []
        comp_xs: list = []
        q = deque([(_sy, _sx)])
        comp_vis[_sy, _sx] = True
        while q:
            cy, cx = q.popleft()
            comp_ys.append(cy)
            comp_xs.append(cx)
            if cy == 0 or cy == h - 1 or cx == 0 or cx == w - 1:
                touches_border = True
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and not comp_vis[ny, nx]:
                    comp_vis[ny, nx] = True
                    q.append((ny, nx))
        if not touches_border:
            bg_mask[np.array(comp_ys), np.array(comp_xs)] = True
            _enclosed_px += len(comp_ys)

    return bg_mask, _enclosed_px


# --------------------------------------------------------------------------- #
# Lab k-means quantisation                                                     #
# --------------------------------------------------------------------------- #

def _rgb_arr_to_lab(rgb):
    """Vectorized sRGB (N×3 uint8 or float) → CIELab (N×3 float64)."""
    import numpy as np
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    lin = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = lin @ M.T / [0.95047, 1.00000, 1.08883]
    f = np.where(xyz > 0.008856, xyz ** (1.0 / 3), 7.787 * xyz + 16.0 / 116)
    L = 116 * f[:, 1] - 16
    a = 500 * (f[:, 0] - f[:, 1])
    b = 200 * (f[:, 1] - f[:, 2])
    return np.stack([L, a, b], axis=1)


def _assign_clusters(lab_px, centers, batch=40000):
    """Assign N Lab pixels to nearest of k centers (memory-safe batching)."""
    import numpy as np
    n = len(lab_px)
    labels = np.empty(n, dtype=np.int32)
    for s in range(0, n, batch):
        e = min(s + batch, n)
        d = np.sum((lab_px[s:e, np.newaxis] - centers[np.newaxis]) ** 2, axis=2)
        labels[s:e] = np.argmin(d, axis=1)
    return labels


def _kmeans_lab(lab_px, k, n_iter=25, seed=42, max_train=30000):
    """K-means++ in Lab space. Returns (centers k×3, all_labels N, counts k)."""
    import numpy as np
    rng = np.random.default_rng(seed)
    n = len(lab_px)
    if n > max_train:
        train = lab_px[rng.choice(n, max_train, replace=False)]
    else:
        train = lab_px
    nt = len(train)
    # K-means++ init
    ctrs = [train[int(rng.integers(nt))].copy()]
    for _ in range(k - 1):
        d2 = np.min(
            np.sum((train[:, np.newaxis] - np.array(ctrs)[np.newaxis]) ** 2, axis=2),
            axis=1)
        probs = d2 / d2.sum()
        ctrs.append(train[int(rng.choice(nt, p=probs))].copy())
    centers = np.array(ctrs, dtype=np.float64)
    # Iterate
    labels = np.zeros(nt, dtype=np.int32)
    for it in range(n_iter):
        new_labels = _assign_clusters(train, centers)
        if it > 0 and np.all(new_labels == labels):
            break
        labels = new_labels
        for i in range(k):
            m = labels == i
            if m.any():
                centers[i] = train[m].mean(axis=0)
    all_labels = _assign_clusters(lab_px, centers)
    counts = np.bincount(all_labels, minlength=k)
    return centers, all_labels, counts


def _merge_clusters(centers, labels, counts, n_final,
                    de_vol=12.0, chroma_min=25.0, chroma_de_min=20.0):
    """
    Greedy merge k→n_final. Protects high-chroma clusters (C*>chroma_min
    that are far from all others: min ΔE > chroma_de_min) from voluntary merges.
    """
    import numpy as np
    n = len(centers)
    active = list(range(n))
    cur_lab = labels.copy()
    cur_cnt = counts.astype(np.float64).copy()
    cur_c   = centers.copy()

    while len(active) > n_final:
        act = np.array(active)
        ac = cur_c[act]
        diff = ac[:, np.newaxis] - ac[np.newaxis]
        de_mat = np.sqrt(np.sum(diff ** 2, axis=2))
        np.fill_diagonal(de_mat, np.inf)

        chroma   = np.sqrt(ac[:, 1] ** 2 + ac[:, 2] ** 2)
        min_de   = de_mat.min(axis=1)
        protected = (chroma > chroma_min) & (min_de > chroma_de_min)

        # Upper-triangle merge matrix — block protected clusters and ΔE ≥ threshold
        merge_de = np.full_like(de_mat, np.inf)
        for ii in range(len(act)):
            if protected[ii]:
                continue
            for jj in range(ii + 1, len(act)):
                if not protected[jj]:
                    merge_de[ii, jj] = de_mat[ii, jj]
        merge_de[merge_de >= de_vol] = np.inf

        if merge_de.min() < np.inf:
            ii, jj = np.unravel_index(np.argmin(merge_de), merge_de.shape)
        else:
            de_upper = de_mat.copy()
            for ii in range(len(act)):
                de_upper[ii, :ii + 1] = np.inf
            ii, jj = np.unravel_index(np.argmin(de_upper), de_upper.shape)

        i, j = int(act[ii]), int(act[jj])
        ci, cj = cur_cnt[i], cur_cnt[j]
        total = ci + cj
        if total > 0:
            cur_c[i] = (cur_c[i] * ci + cur_c[j] * cj) / total
        cur_cnt[i] = total
        cur_lab[cur_lab == j] = i
        active.remove(j)

    sorted_act = sorted(active)
    remap = np.full(n, -1, dtype=np.int32)
    for new, old in enumerate(sorted_act):
        remap[old] = new
    return cur_c[sorted_act], remap[cur_lab]


def _quantize_chroma_aware(img_arr, n_colors, fg_1d=None, de_vol=12.0):
    """
    Chroma-aware Lab k-means (over-cluster 3×, then greedy merge).
    fg_1d: (H*W,) bool — only these pixels participate in quantisation.
    de_vol: ΔE merge threshold; use 5.0 for portrait colour mode.
    Returns (palette [(r,g,b)…], masks [H×W bool …]) sorted brightest-first.
    """
    import numpy as np
    h, w = img_arr.shape[:2]
    pixels = img_arr.reshape(-1, 3)
    pix_lab = _rgb_arr_to_lab(pixels)

    if fg_1d is None:
        fg_1d = np.ones(h * w, dtype=bool)

    fg_lab = pix_lab[fg_1d]
    if len(fg_lab) == 0:
        return [(128, 128, 128)] * n_colors, [np.zeros((h, w), dtype=bool)] * n_colors

    k_over = max(24, 3 * n_colors)
    centers, labels, counts = _kmeans_lab(fg_lab, k_over)
    _, labels = _merge_clusters(centers, labels, counts, n_colors, de_vol=de_vol)

    labels_full = np.full(h * w, -1, dtype=np.int32)
    labels_full[fg_1d] = labels

    palette, masks = [], []
    for i in range(n_colors):
        m1d = labels_full == i
        if m1d.any():
            mean_rgb = pixels[m1d].mean(axis=0)
            palette.append(tuple(int(round(float(v))) for v in mean_rgb))
        else:
            palette.append((128, 128, 128))
        masks.append(m1d.reshape(h, w))

    lum = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in palette]
    order = sorted(range(n_colors), key=lambda i: -lum[i])
    return [palette[o] for o in order], [masks[o] for o in order]


def _consolidate_small_colors(masks, palette, min_px=3600, de_thresh=15.0):
    """
    Merge colors with fewer than min_px surviving pixels into the perceptually
    nearest other color (ΔE76 < de_thresh). Iterates until stable.
    """
    import numpy as np
    n = len(palette)
    pal_lab = _rgb_arr_to_lab(np.array(palette, dtype=np.uint8))
    counts = np.array([float(m.sum()) for m in masks])

    changed = True
    while changed:
        changed = False
        for i in range(n):
            if counts[i] == 0 or counts[i] >= min_px:
                continue
            best_de, best_j = np.inf, -1
            for j in range(n):
                if j == i or counts[j] == 0:
                    continue
                de = float(np.sqrt(np.sum((pal_lab[i] - pal_lab[j]) ** 2)))
                if de < de_thresh and de < best_de:
                    best_de, best_j = de, j
            if best_j >= 0:
                masks[best_j] = masks[best_j] | masks[i]
                masks[i] = np.zeros_like(masks[i], dtype=bool)
                ci, cj = counts[i], counts[best_j]
                tot = ci + cj
                merged_rgb = tuple(
                    int(round((palette[i][k] * ci + palette[best_j][k] * cj) / tot))
                    for k in range(3))
                palette[best_j] = merged_rgb
                pal_lab[best_j] = _rgb_arr_to_lab(
                    np.array([merged_rgb], dtype=np.uint8))[0]
                counts[best_j] = tot
                counts[i] = 0
                changed = True
                break
    return masks, palette


def _detect_bg_lab(img_arr, de_thresh=8.0):
    """
    Flood-fill from 4 corners in Lab space (ΔE < de_thresh).
    Returns H×W bool mask: True = background pixel.
    """
    import numpy as np
    from collections import deque
    h, w = img_arr.shape[:2]
    pix_lab = _rgb_arr_to_lab(img_arr.reshape(-1, 3)).reshape(h, w, 3)
    bg = np.zeros((h, w), dtype=bool)
    vis = np.zeros((h, w), dtype=bool)
    t2 = de_thresh ** 2
    for sy, sx in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        if vis[sy, sx]:
            continue
        seed = pix_lab[sy, sx].copy()
        q = deque([(sy, sx)])
        vis[sy, sx] = True
        while q:
            y, x = q.popleft()
            diff = pix_lab[y, x] - seed
            if float(np.sum(diff ** 2)) <= t2:
                bg[y, x] = True
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and not vis[ny, nx]:
                        vis[ny, nx] = True
                        q.append((ny, nx))
    return bg


# --------------------------------------------------------------------------- #
# Main conversion                                                               #
# --------------------------------------------------------------------------- #

def convert_image_to_pes(image_bytes: bytes,
                         stitch_type: str,
                         size_mm: float,
                         num_colors: int,
                         remove_bg: bool = False,
                         fill_angles=None,
                         preprocessing_mode: str = 'standard',
                         smoothing: int = 1,
                         detail_level: int = 50,
                         line_thickness_mm: float = 1.5):
    """
    Convert raw image bytes to a PES file.
    preprocessing_mode: 'standard' | 'portrait_color' | 'portrait_stencil'
    smoothing: 0=low, 1=medium, 2=high (portrait_color only)
    detail_level: 0–100 adaptive-threshold offset (portrait_stencil only)
    line_thickness_mm: minimum sewable width 1.2–2.5 (portrait_stencil only)
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

    # ── 1c. Image preprocessing (portrait / stencil modes) ───────────────────
    _stencil_mask = None
    if preprocessing_mode == 'portrait_color':
        img_arr = _preprocess_portrait_color(img_arr, smoothing)
        img = Image.fromarray(img_arr)
    elif preprocessing_mode == 'portrait_stencil':
        num_colors = 1  # locked for stencil mode
        _stencil_mask = _preprocess_stencil(img_arr, detail_level, line_thickness_mm)

    # ── 1b. Background mask ───────────────────────────────────────────────────
    bg_mask = None
    _enclosed_bg_px = 0
    if remove_bg:
        if has_alpha:
            # Use NEAREST for alpha to avoid blur creating spurious semi-transparent pixels
            alpha_ch = raw_img.convert('RGBA').split()[3]
            alpha_ch = alpha_ch.resize((new_w, new_h), Image.NEAREST)
            bg_mask = np.array(alpha_ch, dtype=np.uint8) < 128
            if not bg_mask.any():
                # All pixels fully opaque (e.g. RGBA with white background) —
                # fall back to flood-fill from corners
                bg_mask, _enclosed_bg_px = _compute_bg_mask(img_arr)
        else:
            bg_mask, _enclosed_bg_px = _compute_bg_mask(img_arr)

    # Apply bg_mask BEFORE quantisation so background pixels don't bias colour clusters
    if bg_mask is not None:
        img_arr[bg_mask] = 255   # fill background with white (neutral for MEDIANCUT)
        img = Image.fromarray(img_arr)

    if _stencil_mask is not None:
        # Stencil mode: skip quantisation; mask already preprocessed by _preprocess_stencil
        if bg_mask is not None:
            _stencil_mask = _stencil_mask & ~bg_mask
        masks = [_stencil_mask]
        palette = [(0, 0, 0)]
        _soft_bg_pct = None
        _removed_region_count = 0
    else:
        # ── 2. Colour quantisation ────────────────────────────────────────────
        # Median-filter before quantisation to reassign antialiasing border pixels
        # to the dominant neighbouring colour, giving cleaner palette colours.
        from PIL import ImageFilter as _IF
        img_mf = img.filter(_IF.MedianFilter(size=3))
        img_mf_arr = np.array(img_mf, dtype=np.uint8)
        if bg_mask is not None:
            img_mf_arr[bg_mask] = 255
            img_mf = Image.fromarray(img_mf_arr)

        # Portrait colour mode uses tighter merge threshold to preserve subtle skin tones
        _de_vol = 5.0 if preprocessing_mode == 'portrait_color' else 12.0

        if num_colors == 1:
            gray = np.mean(img_mf_arr.astype(float), axis=2)
            masks = [gray < 128]
            palette = [(0, 0, 0)]
            _soft_bg_pct = None
        else:
            _soft_bg_mask = None
            if not remove_bg and num_colors > 1:
                _soft_bg_mask = _detect_bg_lab(img_mf_arr)
                _bg_frac = float(_soft_bg_mask.mean())
                if _bg_frac < 0.05 or _bg_frac > 0.92:
                    _soft_bg_mask = None  # trivially small or whole image
                if _soft_bg_mask is not None:
                    import numpy as _np
                    _bg_px_lab = _rgb_arr_to_lab(
                        img_mf_arr.reshape(-1, 3)[_soft_bg_mask.reshape(-1)])
                    _bg_chroma = float(_np.sqrt(
                        _bg_px_lab[:, 1] ** 2 + _bg_px_lab[:, 2] ** 2).mean())
                    if _bg_chroma > 20.0:
                        _soft_bg_mask = None  # background is too colourful to be background
            if _soft_bg_mask is not None:
                # Reserve 1 slot for background; quantise fg with remaining slots
                n_fg = max(1, num_colors - 1)
                fg_1d = (~_soft_bg_mask).reshape(-1)
                fg_pal, fg_masks = _quantize_chroma_aware(
                    img_mf_arr, n_fg, fg_1d=fg_1d, de_vol=_de_vol)
                bg_px = img_mf_arr.reshape(-1, 3)[_soft_bg_mask.reshape(-1)]
                bg_color = tuple(int(round(float(v))) for v in bg_px.mean(axis=0))
                # bg stitched first (behind foreground); skip dilation for slot 0
                palette = [bg_color] + fg_pal
                masks   = [_soft_bg_mask] + fg_masks
                _soft_bg_pct = float(_soft_bg_mask.mean())
            else:
                fg_1d = (~bg_mask).reshape(-1) if bg_mask is not None else None
                palette, masks = _quantize_chroma_aware(
                    img_mf_arr, num_colors, fg_1d=fg_1d, de_vol=_de_vol)
                _soft_bg_pct = None

        # Apply background exclusion to all masks
        if bg_mask is not None:
            masks = [m & ~bg_mask for m in masks]

        # Region-based cleanup: remove unsewable connected components per colour mask.
        # Pixels from removed components are reassigned to the nearest surviving colour.
        if _soft_bg_pct is not None:
            fg_cleaned, _removed_region_count = _cleanup_regions(masks[1:], palette[1:])
            masks = [masks[0]] + fg_cleaned
            fg_consol, fg_pal = _consolidate_small_colors(masks[1:], palette[1:])
            masks = [masks[0]] + fg_consol
            palette = [palette[0]] + fg_pal
        else:
            masks, _removed_region_count = _cleanup_regions(masks, palette)
            masks, palette = _consolidate_small_colors(masks, palette)

    # Expand each color region ~0.3 mm (3 px) into later-stitched regions only,
    # preventing fabric-pullback gaps at color boundaries.
    _dil_start = 1 if _soft_bg_pct is not None else 0
    for i in range(_dil_start, len(masks) - 1):
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

    _active_angles: list = []

    if stitch_type == 'fill':
        ROW      = 4    # 0.4 mm fill row spacing
        MAX      = 30   # 3.0 mm max stitch length
        MIN_AREA = 300  # 3 mm² minimum (1 px = 0.1 mm → 3 mm² = 300 px)

        # Pre-compute per-palette auto angles (used when fill_angles is None or
        # when a per-active-colour entry is None meaning "keep auto").
        _pal_lab = np.array([list(_rgb_to_lab(r, g, b)) for r, g, b in palette])
        _pal_chroma = np.sqrt(_pal_lab[:, 1] ** 2 + _pal_lab[:, 2] ** 2)
        _pal_diff = _pal_lab[:, np.newaxis] - _pal_lab[np.newaxis]
        _pal_de = np.sqrt(np.sum(_pal_diff ** 2, axis=2))
        np.fill_diagonal(_pal_de, np.inf)
        _pal_min_de = _pal_de.min(axis=1)
        _prot_idx = {i for i in range(len(palette))
                     if _pal_chroma[i] > 25.0 and _pal_min_de[i] > 20.0}
        _auto_pal_angles = _assign_fill_angles(masks, protected_indices=_prot_idx)

        _active_color_idx = 0

        for palette_idx, ((r, g, b), mask_raw) in enumerate(zip(palette, masks)):
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

            # Find connected components and drop noise (< 3 mm²).
            # Portrait colour mode: isolated colours (ΔE > 15 to all neighbours)
            # use a lower 1.5 mm² threshold to preserve eye highlights and similar
            # small details that would otherwise be wrongly discarded.
            comps = _seg_components(mask, ROW)
            if (preprocessing_mode == 'portrait_color'
                    and palette_idx < len(_pal_min_de)
                    and _pal_min_de[palette_idx] > 15.0):
                _min_area_this = 150  # 1.5 mm² for isolated detail colour
            else:
                _min_area_this = MIN_AREA
            sig_comps = [c for c in comps if _component_area(c) >= _min_area_this]
            if not sig_comps:
                continue

            # Angle for this active colour: per-active-colour override (may be null)
            # or auto-assigned from the graph colouring.
            _auto_angle = _auto_pal_angles[palette_idx] if palette_idx < len(_auto_pal_angles) else 0
            if (fill_angles is not None
                    and _active_color_idx < len(fill_angles)
                    and fill_angles[_active_color_idx] is not None):
                angle = int(fill_angles[_active_color_idx])
            else:
                angle = _auto_angle

            if not first:
                pattern.add_stitch_absolute(pyembroidery.COLOR_BREAK, 0, 0)
            pattern.add_thread(_make_thread(r, g, b))
            active_colors.append({'r': r, 'g': g, 'b': b})
            _active_angles.append(angle)
            _active_color_idx += 1
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

                raw_path = _fill_angled(comp_m, angle, new_h, new_w, ROW, MAX)
                _emit(pattern,
                      _filter_short_moves(raw_path, min_dist=7,
                                          max_stitch=MAX, trim_dist=120),
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

    # Determine which active_colors entries are chroma-protected (C*>25, isolated ΔE>20).
    # Used to distinguish intentional small-detail colours from edge-noise ghost threads.
    _protected_active: set = set()
    if len(active_colors) > 1:
        _ac_lab = np.array([list(_rgb_to_lab(c['r'], c['g'], c['b'])) for c in active_colors])
        _ac_chroma = np.sqrt(_ac_lab[:, 1] ** 2 + _ac_lab[:, 2] ** 2)
        _ac_diff = _ac_lab[:, np.newaxis] - _ac_lab[np.newaxis]
        _ac_de = np.sqrt(np.sum(_ac_diff ** 2, axis=2))
        np.fill_diagonal(_ac_de, np.inf)
        _ac_min_de = _ac_de.min(axis=1)
        for _i in range(len(active_colors)):
            if _ac_chroma[_i] > 25.0 and _ac_min_de[_i] > 20.0:
                _protected_active.add(_i)

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
        ghost_noise_count      = 0
        ghost_protected_count  = 0
        fragmented_color_count = 0
        if _parsed is not None and _parsed.stitches:
            sc[0] = sum(1 for s in _parsed.stitches if s[2] == pyembroidery.STITCH)
            tc[0] = sum(1 for s in _parsed.stitches if s[2] == pyembroidery.TRIM)
            jc[0] = sum(1 for s in _parsed.stitches if s[2] == pyembroidery.JUMP)
            _cur_sc      = 0   # stitches in current thread block
            _cur_run     = 0   # stitches in current unbroken run
            _thread_idx  = 0   # which active_colors entry we are in
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
                        if _thread_idx in _protected_active:
                            ghost_protected_count += 1
                        else:
                            ghost_noise_count += 1
                    elif _thread_runs:
                        _med = sorted(_thread_runs)[len(_thread_runs) // 2]
                        if _med < 10:
                            fragmented_color_count += 1
                    _cur_sc      = 0
                    _thread_runs = []
                    _thread_idx  += 1
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
    info: list = []
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
    if preprocessing_mode == 'portrait_color':
        # In portrait mode the "edge-noise" warnings are misleading: subtle close
        # tones are intentional. Suppress them and surface a single info message.
        if ghost_noise_count > 0 or fragmented_color_count > 0:
            info.append("Portrettmodus: nære fargetoner beholdes med vilje.")
        if ghost_protected_count > 0:
            info.append(
                f"{ghost_protected_count} liten detaljfarge(r) beholdt (øye, nese o.l.) — "
                "små motiver kan bli utydelige i søm."
            )
    else:
        if ghost_noise_count > 0:
            warnings.append(
                f"{ghost_noise_count} av fargene dekker svært lite (under 50 sting) — "
                "sannsynligvis kantstøy fra bildet. Prøv færre farger for et renere resultat."
            )
        if ghost_protected_count > 0:
            info.append(
                f"{ghost_protected_count} liten detaljfarge(r) beholdt (blad, nese o.l.) — "
                "små motiver kan bli utydelige i søm."
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
    if _soft_bg_pct is not None:
        warnings.append(
            f"Bakgrunn sys som én farge ({_soft_bg_pct * 100:.0f} % av bildet). "
            "Bruk «Fjern bakgrunn» for å stryke bakgrunnen helt."
        )
    # 1 px = 0.1 mm → 1 mm² = 100 px² → 20 mm² = 2000 px²
    if remove_bg and _enclosed_bg_px > 2000:
        warnings.append(
            "Store hvite/bakgrunnsfargede områder inne i motivet ble fjernet som bakgrunn — "
            "hvis de er del av designet (ansikter, tekst-kontur), gi dem en annen farge i bildet "
            "eller bruk transparent PNG."
        )
    if _removed_region_count > 0:
        warnings.append(
            f"{_removed_region_count} småregioner fjernet automatisk "
            "(kantstøy/usømbart) — dette kan gi færre tråder enn valgt antall farger"
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
        'info':         info,
        'auto_angles':  _active_angles,
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

            img_b64      = body.get('image_data', '')
            s_type       = body.get('stitch_type', 'fill')
            size_mm      = float(body.get('size_mm', 100))
            n_colors     = int(body.get('num_colors', 3))
            rem_bg       = bool(body.get('remove_bg', False))
            fill_angles  = body.get('fill_angles', None)  # list[int] | null
            prep_mode    = body.get('preprocessing_mode', 'standard')
            smoothing    = int(body.get('smoothing', 1))
            detail_lvl   = int(body.get('detail_level', 50))
            line_thick   = float(body.get('line_thickness_mm', 1.5))

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
            if prep_mode not in ('standard', 'portrait_color', 'portrait_stencil'):
                self._json(400, {'error': "preprocessing_mode ukjent"})
                return
            if not (0 <= smoothing <= 2):
                self._json(400, {'error': 'smoothing må være 0, 1 eller 2'})
                return
            if not (0 <= detail_lvl <= 100):
                self._json(400, {'error': 'detail_level må være 0–100'})
                return
            if not (1.0 <= line_thick <= 3.0):
                self._json(400, {'error': 'line_thickness_mm må være 1–3'})
                return

            img_bytes = base64.b64decode(img_b64)
            pes_bytes, meta = convert_image_to_pes(
                img_bytes, s_type, size_mm, n_colors, rem_bg,
                fill_angles=fill_angles,
                preprocessing_mode=prep_mode,
                smoothing=smoothing,
                detail_level=detail_lvl,
                line_thickness_mm=line_thick,
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
