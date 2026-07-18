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
    from PIL import Image, ImageFilter as _IF
    h, w = img_arr.shape[:2]
    total_px = h * w

    print("\n" + "=" * 60)
    print("APP PIPELINE (current)")
    print("=" * 60)

    # Step A: MedianFilter(3) applied in standard pipeline (portrait_color smoothing=0)
    img_mf = Image.fromarray(img_arr).filter(_IF.MedianFilter(size=3))
    img_mf_arr = np.array(img_mf, dtype=np.uint8)
    unique_before = len(np.unique(img_arr.reshape(-1, 3), axis=0))
    unique_after = len(np.unique(img_mf_arr.reshape(-1, 3), axis=0))
    print(f"[A] After MedianFilter(3): unique colors {unique_before} → {unique_after}")

    # Step B: BG detection ΔE<8.0 (_detect_bg_lab default)
    bg_mask = _detect_bg_lab(img_mf_arr, de_thresh=8.0)
    bg_px = int(bg_mask.sum())
    fg_px = total_px - bg_px
    print(f"[B] BG pixels (ΔE<8.0 flood-fill): {bg_px}/{total_px} = {bg_px/total_px:.1%}")
    print(f"    FG pixels: {fg_px}")

    # Step C: _quantize_chroma_aware (k_over=3*k=30, k-means++ init, merge ΔE=5.0 → forced n=k)
    pix_lab = _rgb_arr_to_lab(img_mf_arr.reshape(-1, 3))
    fg_1d_arr = (~bg_mask).reshape(-1)

    # Simulate what convert_image_to_pes does (with remove_bg=True → soft_bg_mask branch skipped)
    # It calls _quantize_chroma_aware(img_mf_arr, num_colors, fg_1d=fg_1d, de_vol=5.0)
    palette, masks = _quantize_chroma_aware(img_mf_arr, k, fg_1d=fg_1d_arr, de_vol=5.0)

    total_fg = int(sum(m.sum() for m in masks))
    fractions = [int(m.sum()) / max(total_fg, 1) for m in masks]
    sorted_fracs = sorted(fractions, reverse=True)
    active = sum(1 for f in fractions if f > 0)

    print(f"[C] After _quantize_chroma_aware (k_over=30, k-means++, merge ΔE=5.0 → n={k}):")
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
# Acceptance criteria check
# ─────────────────────────────────────────────────────────────────────────────

def check_acceptance(ref):
    """Check reference algorithm against the 5 acceptance criteria from the spec."""
    print("\n" + "=" * 60)
    print("ACCEPTANCE CRITERIA (reference algorithm)")
    print("=" * 60)

    fracs = ref["fractions"]
    active = sum(1 for f in fracs if f > 0)
    largest = fracs[0] if fracs else 1.0

    results = []
    results.append(("≥8 active threads", active >= 8, f"got {active}"))
    results.append(("Largest block ≤35%", largest <= 0.35, f"got {largest:.1%}"))

    # Coverage: all fg pixels assigned (fracs sum ≈ 1.0 since we use total_fg)
    total = sum(fracs)
    results.append(("≥90% FG coverage", total >= 0.90, f"got {total:.1%}"))

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
    ok = check_acceptance(ref)

    print()
    if ok:
        print("Reference algorithm passes all acceptance criteria.")
    else:
        print("Reference algorithm FAILS some criteria — see above.")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
