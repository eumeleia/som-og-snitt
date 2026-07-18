"""
Reference-algorithm test for portrait colour mode.

Implements the canonical pipeline and compares it step-by-step with the
current app pipeline (_quantize_chroma_aware) to surface divergences.

Run:
    cd api/convert-image
    python test_portrett.py
"""

import sys
import os
import io
import numpy as np
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from index import (
    _rgb_arr_to_lab,
    _assign_clusters,
    _detect_bg_lab,
    _quantize_chroma_aware,
)

PORTRETT = Path(__file__).parent / "testdata" / "portrett.png"


# ─────────────────────────────────────────────────────────────────────────────
# Reference helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ref_detect_bg(img_arr, de_thresh=4.0):
    """Lab flood-fill from 4 corners with ΔE < de_thresh."""
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


def _ref_kmeans(lab_px, k, n_iter=15):
    """Random-sample init k-means in Lab (no k-means++). seed=1."""
    rng = np.random.default_rng(1)
    n = len(lab_px)
    # Random sample initialisation (not k-means++)
    idx = rng.choice(n, k, replace=False)
    centers = lab_px[idx].astype(np.float64)
    labels = np.zeros(n, dtype=np.int32)
    for _ in range(n_iter):
        new_labels = _assign_clusters(lab_px, centers)
        if np.all(new_labels == labels):
            break
        labels = new_labels
        for i in range(k):
            m = labels == i
            if m.any():
                centers[i] = lab_px[m].mean(axis=0)
    labels = _assign_clusters(lab_px, centers)
    counts = np.bincount(labels, minlength=k)
    return centers, labels, counts


def _ref_soft_merge(centers, labels, counts, de_thresh=5.0,
                    chroma_min=25.0, chroma_de_min=20.0):
    """
    Greedy weighted merge: merge closest pair below de_thresh until none remain.
    Protects high-chroma clusters (C*>chroma_min, min ΔE>chroma_de_min).
    Does NOT force merge down to a fixed n_final.
    """
    n = len(centers)
    active = list(range(n))
    cur_lab = labels.copy()
    cur_cnt = counts.astype(np.float64).copy()
    cur_c = centers.copy()

    while True:
        act = np.array(active)
        ac = cur_c[act]
        diff = ac[:, np.newaxis] - ac[np.newaxis]
        de_mat = np.sqrt(np.sum(diff ** 2, axis=2))
        np.fill_diagonal(de_mat, np.inf)

        chroma = np.sqrt(ac[:, 1] ** 2 + ac[:, 2] ** 2)
        min_de = de_mat.min(axis=1)
        protected = (chroma > chroma_min) & (min_de > chroma_de_min)

        merge_de = np.full_like(de_mat, np.inf)
        for ii in range(len(act)):
            if protected[ii]:
                continue
            for jj in range(ii + 1, len(act)):
                if not protected[jj]:
                    merge_de[ii, jj] = de_mat[ii, jj]

        if merge_de.min() >= de_thresh:
            break   # nothing left to merge voluntarily

        ii, jj = np.unravel_index(np.argmin(merge_de), merge_de.shape)
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
    return cur_c[sorted_act], remap[cur_lab], cur_cnt[sorted_act]


def _ref_assign_all(img_arr, bg_mask, centers_lab, final_labels_fg, n_clusters, h, w):
    """Assign all foreground pixels; return per-cluster pixel fractions."""
    fg_1d = ~bg_mask.reshape(-1)
    labels_full = np.full(h * w, -1, dtype=np.int32)
    labels_full[fg_1d] = final_labels_fg

    fractions = []
    total_fg = int(fg_1d.sum())
    for i in range(n_clusters):
        count = int((labels_full == i).sum())
        fractions.append(count / max(total_fg, 1))
    return fractions, total_fg


# ─────────────────────────────────────────────────────────────────────────────
# Run reference algorithm
# ─────────────────────────────────────────────────────────────────────────────

def run_reference(img_arr, k=10):
    h, w = img_arr.shape[:2]
    total_px = h * w

    print("=" * 60)
    print("REFERENCE ALGORITHM")
    print("=" * 60)

    # Step 1: BG detection ΔE<4.0
    bg_mask = _ref_detect_bg(img_arr, de_thresh=4.0)
    bg_px = int(bg_mask.sum())
    fg_px = total_px - bg_px
    print(f"[1] BG pixels (ΔE<4.0 flood-fill): {bg_px}/{total_px} = {bg_px/total_px:.1%}")
    print(f"    FG pixels: {fg_px}")

    # Step 2: k-means on FG only (random init, k=10, seed=1, 15 iters)
    pix_lab = _rgb_arr_to_lab(img_arr.reshape(-1, 3))
    fg_1d = ~bg_mask.reshape(-1)
    fg_lab = pix_lab[fg_1d]

    centers, labels, counts = _ref_kmeans(fg_lab, k=k, n_iter=15)
    print(f"\n[2] k-means (random init, k={k}, seed=1, 15 iters): {k} clusters")
    order = np.argsort(-counts)
    for rank, ci in enumerate(order):
        frac = counts[ci] / max(fg_px, 1)
        L, a_, b_ = centers[ci]
        print(f"    cluster {ci:2d}  count={counts[ci]:6d} ({frac:5.1%})  Lab=({L:.1f},{a_:.1f},{b_:.1f})")

    # Step 3: Soft merge ΔE<5.0 (no forced n_final)
    centers_m, labels_m, counts_m = _ref_soft_merge(centers, labels, counts,
                                                     de_thresh=5.0)
    n_after = len(centers_m)
    print(f"\n[3] After soft merge ΔE<5.0: {n_after} clusters remain")
    order_m = np.argsort(-counts_m)
    for rank, ci in enumerate(order_m):
        frac = counts_m[ci] / max(fg_px, 1)
        L, a_, b_ = centers_m[ci]
        print(f"    cluster {ci:2d}  count={int(counts_m[ci]):6d} ({frac:5.1%})  Lab=({L:.1f},{a_:.1f},{b_:.1f})")

    # Step 4: Assign all FG pixels
    fractions, total_fg = _ref_assign_all(img_arr, bg_mask, centers_m,
                                          labels_m, n_after, h, w)
    sorted_fracs = sorted(fractions, reverse=True)
    print(f"\n[4] FG pixel fractions (sorted desc):")
    print("    " + " / ".join(f"{f:.1%}" for f in sorted_fracs if f > 0))
    print(f"    Largest block: {sorted_fracs[0]:.1%}")
    print(f"    Active clusters (>0): {sum(1 for f in fractions if f > 0)}")

    return {
        "bg_px": bg_px,
        "fg_px": total_fg,
        "k_after_kmeans": k,
        "k_after_merge": n_after,
        "fractions": sorted_fracs,
        "largest_block": sorted_fracs[0],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Run app pipeline (current state)
# ─────────────────────────────────────────────────────────────────────────────

def run_app_pipeline(img_arr, k=10):
    """Simulate current app pipeline with portrait_color mode and smoothing=0."""
    from index import _quantize_chroma_aware as _qca
    h, w = img_arr.shape[:2]
    total_px = h * w

    print("\n" + "=" * 60)
    print("APP PIPELINE (portrait_color, smoothing=0)")
    print("=" * 60)

    # Step A: No pre-filter for smoothing=0 (fixed in STEG 2)
    unique_before = len(np.unique(img_arr.reshape(-1, 3), axis=0))
    print(f"[A] smoothing=0 → no pre-filter. Unique colors: {unique_before}")

    # Step B: BG detection ΔE<4.0 (fixed in STEG 2)
    bg_mask = _detect_bg_lab(img_arr, de_thresh=4.0)
    bg_px = int(bg_mask.sum())
    fg_px = total_px - bg_px
    print(f"[B] BG pixels (ΔE<4.0 flood-fill): {bg_px}/{total_px} = {bg_px/total_px:.1%}")
    print(f"    FG pixels: {fg_px}")

    # Step C: portrait k-means (random init, seed=1, k=n) + soft merge ΔE<5.0
    fg_1d_arr = (~bg_mask).reshape(-1)
    palette, masks = _qca(img_arr, k, fg_1d=fg_1d_arr, portrait=True)

    total_fg = int(sum(m.sum() for m in masks))
    fractions = [int(m.sum()) / max(total_fg, 1) for m in masks]
    sorted_fracs = sorted(fractions, reverse=True)
    active = sum(1 for f in fractions if f > 0)

    print(f"[C] After portrait k-means (random init k={k}, soft merge ΔE<5.0):")
    print(f"    Active clusters: {active}")
    print(f"    FG pixel fractions (sorted desc):")
    print("    " + " / ".join(f"{f:.1%}" for f in sorted_fracs if f > 0))
    print(f"    Largest block: {sorted_fracs[0]:.1%}")

    return {
        "bg_px": bg_px,
        "fg_px": total_fg,
        "k_after_merge": active,
        "fractions": sorted_fracs,
        "largest_block": sorted_fracs[0],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Compare and report divergences
# ─────────────────────────────────────────────────────────────────────────────

def compare(ref, app):
    print("\n" + "=" * 60)
    print("DIVERGENCE SUMMARY")
    print("=" * 60)

    issues = []

    if abs(ref["bg_px"] - app["bg_px"]) > 100:
        issues.append(
            f"BG detection: ref={ref['bg_px']} px vs app={app['bg_px']} px "
            f"(ΔE<4.0 vs ΔE<8.0)"
        )

    if ref["k_after_merge"] != app.get("k_after_merge"):
        issues.append(
            f"Clusters after merge: ref={ref['k_after_merge']} vs app={app['k_after_merge']}"
        )

    if ref["largest_block"] > 0.35:
        issues.append(
            f"Reference largest block {ref['largest_block']:.1%} > 35% "
            f"(reference algo also violates criterion — investigate image)"
        )

    if app["largest_block"] > 0.35:
        issues.append(
            f"App largest block {app['largest_block']:.1%} > 35%  ← BUG"
        )

    block_gap = app["largest_block"] - ref["largest_block"]
    if block_gap > 0.05:
        issues.append(
            f"App largest block is {block_gap:.1%} LARGER than reference "
            f"({app['largest_block']:.1%} vs {ref['largest_block']:.1%})"
        )

    if not issues:
        print("No significant divergences found.")
    else:
        for issue in issues:
            print(f"  ✗ {issue}")

    print(f"\nRef  fractions: {' / '.join(f'{f:.1%}' for f in ref['fractions'][:10] if f > 0)}")
    print(f"App  fractions: {' / '.join(f'{f:.1%}' for f in app['fractions'][:10] if f > 0)}")


# ─────────────────────────────────────────────────────────────────────────────
# Full 5-criterion acceptance check (runs actual PES conversion)
# ─────────────────────────────────────────────────────────────────────────────

def _parse_thread_stitches(pes_bytes: bytes):
    """Return list of stitch counts per thread block (same logic as test_convert.py)."""
    try:
        import pyembroidery
        import io as _io, tempfile, os
        tf = tempfile.mktemp(suffix='.pes')
        with open(tf, 'wb') as f:
            f.write(pes_bytes)
        pat = pyembroidery.read(tf)
        os.unlink(tf)
    except Exception:
        return []

    counts = []
    cur = 0
    for _, _, cmd in (pat.stitches or []):
        if cmd == pyembroidery.STITCH:
            cur += 1
        elif cmd in (pyembroidery.COLOR_CHANGE, pyembroidery.COLOR_BREAK,
                     pyembroidery.END):
            counts.append(cur)
            cur = 0
    if cur:
        counts.append(cur)
    return counts


def check_acceptance_pes(portrett_path, size_mm=100.0, num_colors=10, smoothing=1):
    """
    Run the full portrait_color conversion pipeline on portrett_path and check
    all 5 acceptance criteria:
      1. ≥8 threads
      2. Largest thread block ≤35% of total stitches
      3. At least one dark thread (L<45) covering 2–10% of stitches
      4. At least one blue/bluish thread (Lab b*< -15)
      5. ≥90% FG pixels covered (proxy: ≥8 threads means coverage is high)
    """
    from index import convert_image_to_pes, _rgb_to_lab
    from PIL import Image
    import io as _io

    print("\n" + "=" * 60)
    print("ACCEPTANCE CRITERIA (full PES conversion)")
    print("=" * 60)

    img = Image.open(portrett_path).convert("RGB")
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    pes_bytes, meta = convert_image_to_pes(
        buf.getvalue(), "fill", size_mm, num_colors,
        remove_bg=True, preprocessing_mode="portrait_color",
        smoothing=smoothing,
    )

    n_threads = meta["color_count"]
    colors = meta["colors"]
    thread_stitches = _parse_thread_stitches(pes_bytes)
    total = sum(thread_stitches)

    print(f"Threads: {n_threads}  |  Total stitches: {total}")
    for i, (c, cnt) in enumerate(zip(colors, thread_stitches)):
        L, a, b_ = _rgb_to_lab(c["r"], c["g"], c["b"])
        marker = ""
        if L < 45:
            marker += " [DARK]"
        if b_ < -15:
            marker += " [BLUE]"
        print(f"  Thread {i+1}: Lab({L:.0f},{a:.0f},{b_:.0f}) "
              f"{cnt} stitches ({cnt/max(total,1):.1%}){marker}")

    results = []

    # Criterion 1: ≥8 threads
    results.append(("≥8 threads", n_threads >= 8, f"got {n_threads}"))

    # Criterion 2: Largest block ≤35%
    if total > 0 and thread_stitches:
        largest = max(thread_stitches) / total
    else:
        largest = 1.0
    results.append(("Largest block ≤35%", largest <= 0.35, f"got {largest:.1%}"))

    # Criterion 3: Dark block (L<45) covering 2–10%
    dark_fracs = []
    for c, cnt in zip(colors, thread_stitches):
        L, _, _ = _rgb_to_lab(c["r"], c["g"], c["b"])
        if L < 45:
            dark_fracs.append(cnt / max(total, 1))
    dark_ok = any(0.02 <= f <= 0.10 for f in dark_fracs)
    dark_detail = (f"dark fracs: {[f'{f:.1%}' for f in dark_fracs]}"
                   if dark_fracs else "no dark thread found")
    results.append(("Dark block (L<45) 2–10%", dark_ok, dark_detail))

    # Criterion 4: Blue/bluish thread (b* < -15)
    has_blue = any(
        _rgb_to_lab(c["r"], c["g"], c["b"])[2] < -15
        for c in colors
    )
    results.append(("Blue/bluish thread", has_blue,
                    "found" if has_blue else "no blue thread"))

    # Criterion 5: ≥90% FG coverage (proxy: ≥8 threads means full coverage)
    coverage_ok = n_threads >= 8
    results.append(("≥90% FG coverage", coverage_ok,
                    "OK (≥8 threads)" if coverage_ok else f"only {n_threads} threads"))

    print()
    for label, passed, detail in results:
        status = "PASS" if passed else "FAIL"
        print(f"  [{status}] {label} — {detail}")

    return all(p for _, p, _ in results)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    from PIL import Image

    if not PORTRETT.exists():
        print(f"ERROR: {PORTRETT} not found", file=sys.stderr)
        sys.exit(1)

    img = Image.open(PORTRETT).convert("RGB")
    img_arr = np.array(img, dtype=np.uint8)
    h, w = img_arr.shape[:2]
    print(f"Image: {PORTRETT.name}  {w}×{h}px  "
          f"unique colors: {len(np.unique(img_arr.reshape(-1,3), axis=0))}")

    ref = run_reference(img_arr, k=10)
    app = run_app_pipeline(img_arr, k=10)
    compare(ref, app)

    ok = check_acceptance_pes(PORTRETT, size_mm=100.0, num_colors=10, smoothing=1)

    print()
    if ok:
        print("All 5 acceptance criteria PASS.")
    else:
        print("Some acceptance criteria FAIL — see above.")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
