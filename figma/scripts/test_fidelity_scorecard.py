"""Unit tests for fidelity_scorecard acceleration paths (C1 two-stage DeltaE, C3 Lab cache).

Run: python3 skills/figma/scripts/test_fidelity_scorecard.py
"""
import numpy as np
import sys
import tempfile
from pathlib import Path

import fidelity_scorecard as fs


def _rand_rgb(h: int, w: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.random((h, w, 3), dtype=np.float32)


def test_two_stage_matches_exact_for_large_diffs():
    # Strong differences -> all pixels go through exact CIEDE2000.
    rng = np.random.default_rng(0)
    lab_a = rng.uniform(0, 100, (512, 3)).astype(np.float32)
    lab_b = lab_a + np.array([5.0, 5.0, 5.0], dtype=np.float32)
    exact = fs.ciede2000(lab_a, lab_b)
    fast = fs._two_stage_delta_e(lab_a, lab_b)
    # Differences of 5.0 in each channel -> DeltaE76 ~= 8.66 >> threshold.
    # Fast path must fall through to exact CIEDE2000 for every pixel.
    assert np.allclose(fast, exact, atol=1e-5), (fast[:3], exact[:3])
    print("  ok: two_stage matches exact for large diffs")


def test_two_stage_preserves_max_and_p95():
    # Mixed: 99% identical pixels, 1% with big diffs. The big ones dominate
    # max/p95 and must be exact.
    rng = np.random.default_rng(1)
    n = 10000
    lab_a = rng.uniform(0, 100, (n, 3)).astype(np.float32)
    lab_b = lab_a.copy()
    # Perturb ~1% by a large amount.
    idx = rng.choice(n, size=100, replace=False)
    lab_b[idx] += rng.uniform(3, 10, (100, 3)).astype(np.float32)

    exact = fs.ciede2000(lab_a, lab_b)
    fast = fs._two_stage_delta_e(lab_a, lab_b)

    assert abs(float(exact.max()) - float(fast.max())) < 1e-5
    # p95 should be in the mask region; must match.
    p95_exact = float(np.percentile(exact, 95))
    p95_fast = float(np.percentile(fast, 95))
    assert abs(p95_exact - p95_fast) < 1e-4, (p95_exact, p95_fast)
    print(f"  ok: max exact={exact.max():.4f} fast={fast.max():.4f}, p95 exact={p95_exact:.4f} fast={p95_fast:.4f}")


def test_two_stage_bounds_low_diff_pixels():
    # All pixels have very small diff -> all go through DeltaE76 fast path.
    rng = np.random.default_rng(2)
    lab_a = rng.uniform(0, 100, (2000, 3)).astype(np.float32)
    lab_b = lab_a + rng.uniform(-0.2, 0.2, (2000, 3)).astype(np.float32)
    exact = fs.ciede2000(lab_a, lab_b)
    fast = fs._two_stage_delta_e(lab_a, lab_b)

    # For pixels where fast path applies (de76 <= 0.5), DeltaE76 is an
    # upper bound in practice for CIEDE2000 on small diffs. The max
    # reported value by fast path is bounded by _DE76_FASTPATH_THRESHOLD.
    assert fast.max() <= fs._DE76_FASTPATH_THRESHOLD + 1e-6, fast.max()
    # Exact should also be small (but may differ slightly in absolute values).
    assert exact.max() < 2.0, exact.max()
    print(f"  ok: low-diff bounded fast.max={fast.max():.4f} <= {fs._DE76_FASTPATH_THRESHOLD}")


def test_lab_cache_roundtrip():
    from PIL import Image

    with tempfile.TemporaryDirectory() as tmp:
        baseline_path = Path(tmp) / "baseline.png"
        # Write a tiny PNG so file mtime is meaningful.
        rng = np.random.default_rng(3)
        rgba = (rng.random((16, 16, 4)) * 255).astype(np.uint8)
        Image.fromarray(rgba, mode="RGBA").save(baseline_path)

        baseline_rgb = fs.rgba_to_rgb_float(rgba)
        # First call: computes + caches.
        lab_first = fs._load_or_build_baseline_lab(baseline_path, baseline_rgb)
        cache_path = baseline_path.with_suffix(baseline_path.suffix + ".lab.npy")
        assert cache_path.exists()

        # Second call: loads via mmap, same values.
        lab_second = fs._load_or_build_baseline_lab(baseline_path, baseline_rgb)
        assert lab_first.shape == lab_second.shape
        assert np.array_equal(np.asarray(lab_first), np.asarray(lab_second))

        # Direct compute must match cached.
        lab_direct = fs.rgb_to_lab(baseline_rgb).astype(np.float32)
        assert np.allclose(np.asarray(lab_second), lab_direct, atol=1e-5)
        print("  ok: cache roundtrip bit-identical within float32")


def test_delta_e_with_cache_matches_without():
    rng = np.random.default_rng(4)
    a = rng.random((256, 256, 3), dtype=np.float32)
    b = a + rng.uniform(-0.05, 0.05, a.shape).astype(np.float32)
    b = np.clip(b, 0, 1)

    # Without cache
    no_cache = fs._compute_delta_e_from_samples(a, b, stride=1)
    # With pre-computed baseline Lab
    lab_a = fs.rgb_to_lab(a).astype(np.float32)
    with_cache = fs._compute_delta_e_from_samples(a, b, stride=1, baseline_lab_sub=lab_a)

    for k in ("p50", "p95", "max", "mean"):
        assert abs(no_cache[k] - with_cache[k]) < 1e-4, (k, no_cache[k], with_cache[k])
    print(f"  ok: cache vs no-cache identical: {no_cache}")


if __name__ == "__main__":
    print("test_fidelity_scorecard:")
    test_two_stage_matches_exact_for_large_diffs()
    test_two_stage_preserves_max_and_p95()
    test_two_stage_bounds_low_diff_pixels()
    test_lab_cache_roundtrip()
    test_delta_e_with_cache_matches_without()
    print("all pass")
