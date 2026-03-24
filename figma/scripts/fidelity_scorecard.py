#!/usr/bin/env python3
"""Compute replay-fidelity metrics between a Figma baseline and a rendered candidate.

Outputs a JSON scorecard with:
- pixel diff ratio
- SSIM (grayscale)
- DeltaE00 p50 / p95 / max
- optional LPIPS when `lpips` is available and --lpips is passed
- diff heatmap image

The script prefers deterministic behavior over convenience:
- baseline and candidate are padded onto the same canvas instead of resized
- color metrics run on a deterministic spatial subsample when images are very large
- thresholds are preset by mode: page / region / hard-node
"""

from __future__ import annotations

import argparse
import gc
import json
from pathlib import Path
from typing import Any, Dict, Tuple

import numpy as np
from PIL import Image

try:
    from scipy.ndimage import uniform_filter
except Exception:  # pragma: no cover - fallback path
    uniform_filter = None

PRESETS: Dict[str, Dict[str, float]] = {
    "page": {
        "ssim_min": 0.98,
        "pixel_diff_ratio_max": 0.005,
        "delta_e_p95_max": 1.5,
        "delta_e_max_max": 3.0,
    },
    "region": {
        "ssim_min": 0.985,
        "pixel_diff_ratio_max": 0.002,
        "delta_e_p95_max": 1.0,
        "delta_e_max_max": 2.0,
    },
    "hard-node": {
        "ssim_min": 0.99,
        "pixel_diff_ratio_max": 0.001,
        "delta_e_p95_max": 0.8,
        "delta_e_max_max": 1.5,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compute replay-fidelity scorecard")
    parser.add_argument("--baseline", required=True, help="Path to the baseline image")
    parser.add_argument("--candidate", required=True, help="Path to the candidate image")
    parser.add_argument(
        "--mode",
        choices=sorted(PRESETS.keys()),
        default="page",
        help="Threshold preset to apply",
    )
    parser.add_argument(
        "--pixel-threshold",
        type=int,
        default=16,
        help="Per-channel threshold used to count a pixel as different (0-255)",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Output JSON report path (defaults next to candidate)",
    )
    parser.add_argument(
        "--heatmap",
        default=None,
        help="Output heatmap image path (defaults next to report)",
    )
    parser.add_argument(
        "--lpips",
        action="store_true",
        help="Attempt LPIPS if the optional lpips package is available",
    )
    parser.add_argument(
        "--max-color-samples",
        type=int,
        default=250000,
        help="Upper bound for color-difference samples used for DeltaE00",
    )
    parser.add_argument(
        "--fail-on-thresholds",
        action="store_true",
        help="Exit with code 1 when any threshold fails",
    )
    parser.add_argument(
        "--crop",
        default=None,
        help="Crop region as x,y,w,h (pixels) applied to both images before comparison",
    )
    parser.add_argument(
        "--early-exit",
        action="store_true",
        help="Skip expensive metrics (SSIM, DeltaE00) when pixel_diff already far exceeds threshold",
    )
    parser.add_argument(
        "--max-pixels",
        type=int,
        default=25_000_000,
        help="Safety limit: refuse to process images exceeding this pixel count (default 25M). Use --crop to reduce.",
    )
    return parser.parse_args()



def load_rgba(path: Path) -> np.ndarray:
    image = Image.open(path).convert("RGBA")
    return np.asarray(image, dtype=np.uint8)



def pad_to_same_canvas(a: np.ndarray, b: np.ndarray) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    ah, aw = a.shape[:2]
    bh, bw = b.shape[:2]
    h = max(ah, bh)
    w = max(aw, bw)
    out_a = np.zeros((h, w, 4), dtype=np.uint8)
    out_b = np.zeros((h, w, 4), dtype=np.uint8)
    out_a[:ah, :aw] = a
    out_b[:bh, :bw] = b
    meta = {
        "baseline_size": [int(aw), int(ah)],
        "candidate_size": [int(bw), int(bh)],
        "comparison_canvas": [int(w), int(h)],
        "size_mismatch": bool((aw, ah) != (bw, bh)),
    }
    return out_a, out_b, meta



def rgba_to_rgb_float(arr: np.ndarray) -> np.ndarray:
    rgb = arr[..., :3].astype(np.float32) / 255.0
    alpha = arr[..., 3:4].astype(np.float32) / 255.0
    return rgb * alpha + (1.0 - alpha)



def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)



def rgb_to_xyz(rgb: np.ndarray) -> np.ndarray:
    linear = srgb_to_linear(rgb)
    matrix = np.array(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ],
        dtype=np.float32,
    )
    flat = linear.reshape(-1, 3)
    xyz = flat @ matrix.T
    return xyz.reshape(rgb.shape)



def xyz_to_lab(xyz: np.ndarray) -> np.ndarray:
    ref_white = np.array([0.95047, 1.0, 1.08883], dtype=np.float32)
    xyz_scaled = xyz / ref_white
    epsilon = 216.0 / 24389.0
    kappa = 24389.0 / 27.0

    def f(t: np.ndarray) -> np.ndarray:
        return np.where(t > epsilon, np.cbrt(t), (kappa * t + 16.0) / 116.0)

    fx = f(xyz_scaled[..., 0])
    fy = f(xyz_scaled[..., 1])
    fz = f(xyz_scaled[..., 2])

    l = 116.0 * fy - 16.0
    a = 500.0 * (fx - fy)
    b = 200.0 * (fy - fz)
    return np.stack([l, a, b], axis=-1)



def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    return xyz_to_lab(rgb_to_xyz(rgb))



def ciede2000(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    l1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    l2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]

    c1 = np.sqrt(a1 * a1 + b1 * b1)
    c2 = np.sqrt(a2 * a2 + b2 * b2)
    c_bar = (c1 + c2) / 2.0

    c_bar7 = c_bar**7
    g = 0.5 * (1.0 - np.sqrt(c_bar7 / (c_bar7 + 25.0**7 + 1e-12)))

    a1p = (1.0 + g) * a1
    a2p = (1.0 + g) * a2
    c1p = np.sqrt(a1p * a1p + b1 * b1)
    c2p = np.sqrt(a2p * a2p + b2 * b2)

    h1p = np.degrees(np.arctan2(b1, a1p)) % 360.0
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360.0

    dlp = l2 - l1
    dcp = c2p - c1p

    dh = h2p - h1p
    dh = np.where(c1p * c2p == 0.0, 0.0, dh)
    dh = np.where(dh > 180.0, dh - 360.0, dh)
    dh = np.where(dh < -180.0, dh + 360.0, dh)
    dhp = 2.0 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh) / 2.0)

    l_bar_p = (l1 + l2) / 2.0
    c_bar_p = (c1p + c2p) / 2.0

    h_sum = h1p + h2p
    h_bar_p = np.where(
        c1p * c2p == 0.0,
        h_sum,
        np.where(
            np.abs(h1p - h2p) > 180.0,
            np.where(h_sum < 360.0, (h_sum + 360.0) / 2.0, (h_sum - 360.0) / 2.0),
            h_sum / 2.0,
        ),
    )

    t = (
        1.0
        - 0.17 * np.cos(np.radians(h_bar_p - 30.0))
        + 0.24 * np.cos(np.radians(2.0 * h_bar_p))
        + 0.32 * np.cos(np.radians(3.0 * h_bar_p + 6.0))
        - 0.20 * np.cos(np.radians(4.0 * h_bar_p - 63.0))
    )

    delta_theta = 30.0 * np.exp(-(((h_bar_p - 275.0) / 25.0) ** 2))
    r_c = 2.0 * np.sqrt((c_bar_p**7) / (c_bar_p**7 + 25.0**7 + 1e-12))
    s_l = 1.0 + (0.015 * ((l_bar_p - 50.0) ** 2)) / np.sqrt(20.0 + ((l_bar_p - 50.0) ** 2))
    s_c = 1.0 + 0.045 * c_bar_p
    s_h = 1.0 + 0.015 * c_bar_p * t
    r_t = -np.sin(np.radians(2.0 * delta_theta)) * r_c

    d_e = np.sqrt(
        (dlp / s_l) ** 2
        + (dcp / s_c) ** 2
        + (dhp / s_h) ** 2
        + r_t * (dcp / s_c) * (dhp / s_h)
    )
    return d_e



def compute_pixel_diff_ratio(a: np.ndarray, b: np.ndarray, threshold: int) -> Tuple[float, np.ndarray, np.ndarray]:
    diff = np.abs(a.astype(np.int16) - b.astype(np.int16)).astype(np.uint8)
    different = np.any(diff > threshold, axis=-1)
    ratio = float(different.mean())
    return ratio, diff, different



def compute_ssim(a_rgb: np.ndarray, b_rgb: np.ndarray) -> float:
    a = srgb_to_linear(a_rgb)
    b = srgb_to_linear(b_rgb)
    a_gray = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    b_gray = 0.2126 * b[..., 0] + 0.7152 * b[..., 1] + 0.0722 * b[..., 2]

    if uniform_filter is None:
        ux = float(a_gray.mean())
        uy = float(b_gray.mean())
        vx = float(a_gray.var())
        vy = float(b_gray.var())
        vxy = float(((a_gray - ux) * (b_gray - uy)).mean())
        c1 = 0.01**2
        c2 = 0.03**2
        num = (2 * ux * uy + c1) * (2 * vxy + c2)
        den = (ux * ux + uy * uy + c1) * (vx + vy + c2)
        return float(num / den)

    size = 11
    ux = uniform_filter(a_gray, size=size)
    uy = uniform_filter(b_gray, size=size)
    uxx = uniform_filter(a_gray * a_gray, size=size)
    uyy = uniform_filter(b_gray * b_gray, size=size)
    uxy = uniform_filter(a_gray * b_gray, size=size)

    vx = uxx - ux * ux
    vy = uyy - uy * uy
    vxy = uxy - ux * uy

    c1 = 0.01**2
    c2 = 0.03**2
    numerator = (2 * ux * uy + c1) * (2 * vxy + c2)
    denominator = (ux * ux + uy * uy + c1) * (vx + vy + c2)
    ssim_map = numerator / np.maximum(denominator, 1e-12)
    return float(np.clip(ssim_map.mean(), -1.0, 1.0))



def deterministic_stride(total: int, max_samples: int) -> int:
    if total <= max_samples:
        return 1
    stride = int(np.ceil(np.sqrt(total / max_samples)))
    return max(1, stride)



def compute_delta_e_metrics(a_rgb: np.ndarray, b_rgb: np.ndarray, max_samples: int) -> Dict[str, float]:
    h, w = a_rgb.shape[:2]
    stride = deterministic_stride(h * w, max_samples)
    a_sub = a_rgb[::stride, ::stride]
    b_sub = b_rgb[::stride, ::stride]
    lab_a = rgb_to_lab(a_sub)
    lab_b = rgb_to_lab(b_sub)
    delta = ciede2000(lab_a, lab_b).reshape(-1)
    return {
        "sample_stride": int(stride),
        "sample_count": int(delta.size),
        "p50": float(np.percentile(delta, 50)),
        "p95": float(np.percentile(delta, 95)),
        "max": float(delta.max(initial=0.0)),
        "mean": float(delta.mean()),
    }



def compute_diff_bounds(different: np.ndarray) -> Dict[str, int] | None:
    ys, xs = np.where(different)
    if len(xs) == 0 or len(ys) == 0:
        return None
    x0 = int(xs.min())
    x1 = int(xs.max())
    y0 = int(ys.min())
    y1 = int(ys.max())
    return {
        "x": x0,
        "y": y0,
        "width": int(x1 - x0 + 1),
        "height": int(y1 - y0 + 1),
    }



def save_heatmap(diff: np.ndarray, path: Path) -> None:
    rgb = diff[..., :3].max(axis=-1)
    rgba = np.zeros((*rgb.shape, 4), dtype=np.uint8)
    rgba[..., 0] = 255
    rgba[..., 3] = np.clip(rgb * 3, 0, 255).astype(np.uint8)
    image = Image.fromarray(rgba, mode="RGBA")
    image.save(path)



def maybe_compute_lpips(enabled: bool, a_rgb: np.ndarray, b_rgb: np.ndarray) -> Dict[str, Any] | None:
    if not enabled:
        return None

    try:
        import torch
        import lpips  # type: ignore
    except Exception as exc:  # pragma: no cover - optional dependency path
        return {"available": False, "error": str(exc)}

    device = torch.device("cpu")
    model = lpips.LPIPS(net="alex").to(device)
    with torch.no_grad():
        ta = torch.from_numpy(a_rgb.transpose(2, 0, 1)).unsqueeze(0).float() * 2 - 1
        tb = torch.from_numpy(b_rgb.transpose(2, 0, 1)).unsqueeze(0).float() * 2 - 1
        score = model(ta.to(device), tb.to(device)).item()
    return {"available": True, "score": float(score)}



def evaluate_thresholds(mode: str, metrics: Dict[str, Any]) -> Dict[str, Any]:
    preset = PRESETS[mode]
    checks = {
        "ssim": {
            "actual": float(metrics["ssim"]),
            "operator": ">=",
            "target": float(preset["ssim_min"]),
            "passed": bool(metrics["ssim"] >= preset["ssim_min"]),
        },
        "pixel_diff_ratio": {
            "actual": float(metrics["pixel_diff_ratio"]),
            "operator": "<=",
            "target": float(preset["pixel_diff_ratio_max"]),
            "passed": bool(metrics["pixel_diff_ratio"] <= preset["pixel_diff_ratio_max"]),
        },
        "delta_e_p95": {
            "actual": float(metrics["delta_e00"]["p95"]),
            "operator": "<=",
            "target": float(preset["delta_e_p95_max"]),
            "passed": bool(metrics["delta_e00"]["p95"] <= preset["delta_e_p95_max"]),
        },
        "delta_e_max": {
            "actual": float(metrics["delta_e00"]["max"]),
            "operator": "<=",
            "target": float(preset["delta_e_max_max"]),
            "passed": bool(metrics["delta_e00"]["max"] <= preset["delta_e_max_max"]),
        },
    }
    passed = all(item["passed"] for item in checks.values())
    return {"mode": mode, "checks": checks, "passed": passed}



def _parse_crop(crop_str: str | None) -> tuple[int, int, int, int] | None:
    if not crop_str:
        return None
    parts = [int(v) for v in crop_str.split(",")]
    if len(parts) != 4:
        raise ValueError(f"--crop expects x,y,w,h but got {crop_str!r}")
    return (parts[0], parts[1], parts[2], parts[3])


def generate_report(
    *,
    baseline_path: Path,
    candidate_path: Path,
    mode: str = "page",
    pixel_threshold: int = 16,
    report_path: Path | None = None,
    heatmap_path: Path | None = None,
    lpips: bool = False,
    max_color_samples: int = 250000,
    crop: str | None = None,
    early_exit: bool = False,
    max_pixels: int = 25_000_000,
) -> Dict[str, Any]:
    baseline_path = baseline_path.expanduser().resolve()
    candidate_path = candidate_path.expanduser().resolve()
    if report_path is None:
        report_path = candidate_path.with_name(candidate_path.stem + ".fidelity.json")
    if heatmap_path is None:
        heatmap_path = report_path.with_suffix(".heatmap.png")

    crop_rect = _parse_crop(crop)

    raw_baseline = load_rgba(baseline_path)
    raw_candidate = load_rgba(candidate_path)

    # After crop (if any), check pixel budget before heavy computation
    effective_b = raw_baseline
    effective_c = raw_candidate
    if crop_rect:
        x, y, w, h = crop_rect
        effective_b = raw_baseline[y:y+h, x:x+w]
        effective_c = raw_candidate[y:y+h, x:x+w]
    max_h = max(effective_b.shape[0], effective_c.shape[0])
    max_w = max(effective_b.shape[1], effective_c.shape[1])
    canvas_pixels = max_h * max_w
    if max_pixels and canvas_pixels > max_pixels:
        raise ValueError(
            f"Canvas {max_w}x{max_h} = {canvas_pixels:,} pixels exceeds --max-pixels {max_pixels:,}. "
            f"Use --crop to reduce the comparison region."
        )

    if crop_rect:
        x, y, w, h = crop_rect
        raw_baseline = raw_baseline[y:y+h, x:x+w].copy()
        raw_candidate = raw_candidate[y:y+h, x:x+w].copy()

    baseline, candidate, canvas_meta = pad_to_same_canvas(raw_baseline, raw_candidate)
    del raw_baseline, raw_candidate
    gc.collect()

    if crop_rect:
        canvas_meta["crop"] = {"x": crop_rect[0], "y": crop_rect[1], "w": crop_rect[2], "h": crop_rect[3]}

    # pixel diff uses uint8 directly - no float32 needed
    pixel_diff_ratio, diff, different = compute_pixel_diff_ratio(baseline, candidate, pixel_threshold)

    preset = PRESETS[mode]
    skipped_expensive = early_exit and pixel_diff_ratio > preset["pixel_diff_ratio_max"] * 5

    if skipped_expensive:
        ssim = 0.0
        delta_e00: Dict[str, Any] = {"skipped": True, "reason": "pixel_diff_ratio far exceeds threshold"}
        lpips_result = None
    else:
        # convert to float32 only when needed, then free uint8 padded arrays
        baseline_rgb = rgba_to_rgb_float(baseline)
        candidate_rgb = rgba_to_rgb_float(candidate)
        del baseline, candidate
        gc.collect()

        ssim = compute_ssim(baseline_rgb, candidate_rgb)
        delta_e00 = compute_delta_e_metrics(baseline_rgb, candidate_rgb, max_color_samples)
        lpips_result = maybe_compute_lpips(lpips, baseline_rgb, candidate_rgb)
        del baseline_rgb, candidate_rgb
        gc.collect()

    metrics: Dict[str, Any] = {
        "pixel_threshold": int(pixel_threshold),
        "pixel_diff_ratio": float(pixel_diff_ratio),
        "ssim": float(ssim),
        "delta_e00": delta_e00,
    }
    if lpips_result is not None:
        metrics["lpips"] = lpips_result

    thresholds = evaluate_thresholds(mode, metrics) if not skipped_expensive else {
        "mode": mode,
        "checks": {
            "pixel_diff_ratio": {
                "actual": float(pixel_diff_ratio),
                "operator": "<=",
                "target": float(preset["pixel_diff_ratio_max"]),
                "passed": False,
            },
        },
        "passed": False,
        "early_exit": True,
    }
    heatmap_path.parent.mkdir(parents=True, exist_ok=True)
    save_heatmap(diff, heatmap_path)

    report: Dict[str, Any] = {
        "ok": True,
        "baseline": str(baseline_path),
        "candidate": str(candidate_path),
        "report": str(report_path),
        "heatmap": str(heatmap_path),
        "canvas": canvas_meta,
        "metrics": metrics,
        "thresholds": thresholds,
        "diffBounds": compute_diff_bounds(different),
        "notes": [
            "Baseline and candidate are padded to a shared canvas instead of resized.",
            "DeltaE00 uses deterministic spatial subsampling when the image is very large.",
            "Text wrap, baseline alignment, and route correctness still require task-level checks outside this script.",
        ],
    }

    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    return report



def main() -> int:
    args = parse_args()
    report = generate_report(
        baseline_path=Path(args.baseline),
        candidate_path=Path(args.candidate),
        mode=args.mode,
        pixel_threshold=args.pixel_threshold,
        report_path=Path(args.report).expanduser().resolve() if args.report else None,
        heatmap_path=Path(args.heatmap).expanduser().resolve() if args.heatmap else None,
        lpips=args.lpips,
        max_color_samples=args.max_color_samples,
        crop=args.crop,
        early_exit=args.early_exit,
        max_pixels=args.max_pixels,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.fail_on_thresholds and not report["thresholds"]["passed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
