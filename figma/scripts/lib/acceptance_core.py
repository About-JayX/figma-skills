from __future__ import annotations

import copy
import json
import os
import shlex
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


ESCALATION_ORDER = [
    "DOM_NATIVE",
    "DOM_INFERRED",
    "DOM_GRID",
    "SVG_ISLAND",
    "CANVAS_ISLAND",
    "RASTER_LOCK",
]

HARD_SIGNAL_KEYS = {
    "hasMask",
    "hasBoolean",
    "hasPattern",
    "hasComplexStroke",
    "hasVariableWidthStroke",
    "hasTextPath",
    "hasProgressiveBlur",
    "hasGlass",
    "hasNoise",
    "hasTexture",
    "hasImageFilter",
    "hasVideoFilter",
    "hasDrawStroke",
    "hasBrush",
}


@dataclass
class EntryResolution:
    raw: Dict[str, Any]
    baseline: Path
    candidate: Path
    entry_id: str
    mode: str
    kind: str
    route: Optional[str]
    surface: Optional[str]
    node_id: Optional[str]
    manifest_dir: Path



def slugify(value: Any) -> str:
    text = str(value or "item")
    safe = []
    for ch in text:
        if ch.isalnum() or ch in {"-", "_", "."}:
            safe.append(ch)
        else:
            safe.append("-")
    slug = "".join(safe)
    while "--" in slug:
        slug = slug.replace("--", "-")
    slug = slug.strip("-._")
    return slug or "item"



def read_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)



def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)



def resolve_path(manifest_dir: Path, value: str, bundle_root: Optional[Path]) -> Path:
    candidate = Path(value).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    if bundle_root is not None:
        rooted = (bundle_root / candidate).resolve()
        if rooted.exists():
            return rooted
    return (manifest_dir / candidate).resolve()



def load_manifest(path: Path) -> Tuple[Dict[str, Any], List[EntryResolution]]:
    manifest = read_json(path)
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be a JSON object")
    entries_raw = manifest.get("entries")
    if not isinstance(entries_raw, list) or not entries_raw:
        raise ValueError("manifest.entries must be a non-empty array")

    manifest_dir = path.parent.resolve()
    bundle_root_value = manifest.get("bundleRoot")
    bundle_root = resolve_path(manifest_dir, bundle_root_value, None) if isinstance(bundle_root_value, str) else None

    resolutions: List[EntryResolution] = []
    for index, raw in enumerate(entries_raw):
        if not isinstance(raw, dict):
            raise ValueError(f"entries[{index}] is not an object")
        baseline_value = raw.get("baseline")
        candidate_value = raw.get("candidate")
        if not isinstance(baseline_value, str) or not isinstance(candidate_value, str):
            raise ValueError(f"entries[{index}] is missing baseline/candidate paths")
        entry_id = str(raw.get("id") or raw.get("regionId") or raw.get("nodeId") or f"entry-{index+1}")
        mode = str(raw.get("mode") or raw.get("kind") or "region")
        kind = str(raw.get("kind") or mode)
        baseline = resolve_path(manifest_dir, baseline_value, bundle_root)
        candidate = resolve_path(manifest_dir, candidate_value, bundle_root)
        resolutions.append(
            EntryResolution(
                raw=raw,
                baseline=baseline,
                candidate=candidate,
                entry_id=entry_id,
                mode=mode if mode in {"page", "region", "hard-node"} else "region",
                kind=kind,
                route=raw.get("route") or raw.get("rendererRoute") or raw.get("renderRoute"),
                surface=raw.get("surface"),
                node_id=raw.get("nodeId"),
                manifest_dir=manifest_dir,
            )
        )
    return manifest, resolutions



def compute_diff_bbox(different_mask) -> Optional[Dict[str, int]]:
    import numpy as np

    ys, xs = np.where(different_mask)
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



def summarize_signal_flags(signals: Dict[str, Any]) -> Dict[str, bool]:
    out: Dict[str, bool] = {}
    for key, value in signals.items():
        if isinstance(value, bool):
            out[key] = value
    return out



def has_any_hard_signal(entry: EntryResolution) -> bool:
    signals = entry.raw.get("signals")
    if not isinstance(signals, dict):
        return False
    return any(bool(signals.get(key)) for key in HARD_SIGNAL_KEYS)



def preferred_route(entry: EntryResolution, report: Dict[str, Any]) -> Optional[str]:
    current = str(entry.route or "") or None
    signals = entry.raw.get("signals") if isinstance(entry.raw.get("signals"), dict) else {}
    size_mismatch = bool(report.get("canvas", {}).get("size_mismatch"))

    if has_any_hard_signal(entry):
        if current in {None, "", "DOM_NATIVE", "DOM_INFERRED", "DOM_GRID"}:
            return "SVG_ISLAND"
        if current == "SVG_ISLAND":
            return "CANVAS_ISLAND"
        if current == "CANVAS_ISLAND":
            return "RASTER_LOCK"
        return None

    if bool(signals.get("hasGrid")) and current in {None, "", "DOM_NATIVE", "DOM_INFERRED"}:
        return "DOM_GRID"

    if bool(signals.get("hasInferredAutoLayout")) and current in {None, "", "DOM_NATIVE"}:
        return "DOM_INFERRED"

    if size_mismatch and current in {None, "", "DOM_NATIVE"}:
        return "DOM_INFERRED"

    if current in ESCALATION_ORDER:
        idx = ESCALATION_ORDER.index(current)
        if idx + 1 < len(ESCALATION_ORDER):
            return ESCALATION_ORDER[idx + 1]
    return None



def classify_failure(entry: EntryResolution, report: Dict[str, Any]) -> str:
    checks = report.get("thresholds", {}).get("checks", {})
    ssim_ok = bool(checks.get("ssim", {}).get("passed", False))
    pixel_ok = bool(checks.get("pixel_diff_ratio", {}).get("passed", False))
    delta_ok = bool(checks.get("delta_e_p95", {}).get("passed", False))
    size_mismatch = bool(report.get("canvas", {}).get("size_mismatch"))

    if size_mismatch:
        return "size-mismatch"
    if ssim_ok and not delta_ok:
        return "color-drift"
    if delta_ok and not ssim_ok:
        return "layout-or-shape-drift"
    if pixel_ok and (not ssim_ok or not delta_ok):
        return "minor-perceptual-drift"
    return "mixed-drift"



def build_actions(entry: EntryResolution, report: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions: List[Dict[str, Any]] = []
    checks = report.get("thresholds", {}).get("checks", {})
    metrics = report.get("metrics", {})
    failure_kind = classify_failure(entry, report)
    signals = entry.raw.get("signals") if isinstance(entry.raw.get("signals"), dict) else {}
    next_route = preferred_route(entry, report)

    if report.get("thresholds", {}).get("passed"):
        return actions

    if next_route and next_route != entry.route:
        actions.append(
            {
                "type": "ESCALATE_ROUTE",
                "from": entry.route,
                "to": next_route,
                "reason": failure_kind,
            }
        )

    if bool(report.get("canvas", {}).get("size_mismatch")):
        actions.append(
            {
                "type": "ENFORCE_ABSOLUTE_BOUNDS",
                "settings": {
                    "useAbsoluteBounds": True,
                    "absoluteRenderBounds": True,
                },
                "reason": "Baseline and candidate sizes do not match; investigate cropping and real render bounds first",
            }
        )

    if not bool(checks.get("delta_e_p95", {}).get("passed", False)):
        actions.append(
            {
                "type": "SYNC_COLOR_AND_EFFECTS",
                "reason": "Color or effect drift exceeds the threshold; align tokens, opacity, effects, and colorProfile first",
                "metrics": {
                    "delta_e_p95": metrics.get("delta_e00", {}).get("p95"),
                    "delta_e_max": metrics.get("delta_e00", {}).get("max"),
                },
            }
        )

    if not bool(checks.get("ssim", {}).get("passed", False)) or failure_kind == "size-mismatch":
        if bool(signals.get("hasText")):
            actions.append(
                {
                    "type": "FIX_TEXT_METRICS",
                "reason": "Geometry or structure drift exceeds the threshold; inspect text wrap, baseline, font loading, OpenType, and paragraph metrics",
                }
            )
        else:
            actions.append(
                {
                    "type": "FIX_LAYOUT_METRICS",
                "reason": "Geometry or structure drift exceeds the threshold; inspect sizing, gap, padding, grid/span, and anchor behavior",
                }
            )

    if has_any_hard_signal(entry):
        actions.append(
            {
                "type": "FORCE_PRECISE_VECTOR_EXPORT",
                "settings": {
                    "svgOutlineText": True,
                    "svgSimplifyStroke": False,
                    "useAbsoluteBounds": True,
                },
                "reason": "The hard node contains mask / complex stroke / graphic signals, so visual consistency should take priority",
            }
        )

    if (entry.route or next_route) == "RASTER_LOCK":
        actions.append(
            {
                "type": "MANUAL_REVIEW",
                "reason": "The node has already reached the highest fallback route and still fails the threshold; manual review or a different implementation strategy is required",
            }
        )

    return actions



def build_entry_plan(entry: EntryResolution, report: Dict[str, Any]) -> Dict[str, Any]:
    actions = build_actions(entry, report)
    return {
        "id": entry.entry_id,
        "nodeId": entry.node_id,
        "surface": entry.surface,
        "mode": entry.mode,
        "kind": entry.kind,
        "route": entry.route,
        "signals": summarize_signal_flags(entry.raw.get("signals") if isinstance(entry.raw.get("signals"), dict) else {}),
        "status": "passed" if report.get("thresholds", {}).get("passed") else ("manual-review" if any(a["type"] == "MANUAL_REVIEW" for a in actions) else "failed"),
        "failureKind": None if report.get("thresholds", {}).get("passed") else classify_failure(entry, report),
        "actions": actions,
        "reportPath": report.get("report"),
        "heatmapPath": report.get("heatmap"),
        "metrics": report.get("metrics"),
        "thresholds": report.get("thresholds"),
        "canvas": report.get("canvas"),
        "diffBounds": report.get("diffBounds"),
    }



def find_matching_id(obj: Dict[str, Any], entry_id: str, node_id: Optional[str]) -> bool:
    values = {
        str(obj.get("id")) if obj.get("id") is not None else None,
        str(obj.get("regionId")) if obj.get("regionId") is not None else None,
        str(obj.get("nodeId")) if obj.get("nodeId") is not None else None,
        str(obj.get("key")) if obj.get("key") is not None else None,
    }
    if entry_id in values:
        return True
    if node_id and node_id in values:
        return True
    return False



def apply_plan_to_render_plan(render_plan_path: Path, entry_plans: List[Dict[str, Any]], out_path: Path) -> Dict[str, Any]:
    render_plan = read_json(render_plan_path)
    patched = copy.deepcopy(render_plan)
    applied: List[Dict[str, Any]] = []

    hints: Dict[str, Any] = {}
    escalation_map: Dict[Tuple[str, Optional[str]], str] = {}
    for entry_plan in entry_plans:
        for action in entry_plan.get("actions", []):
            if action.get("type") == "ESCALATE_ROUTE" and action.get("to"):
                escalation_map[(entry_plan["id"], entry_plan.get("nodeId"))] = str(action["to"])
        hints[entry_plan["id"]] = {
            "failureKind": entry_plan.get("failureKind"),
            "actions": entry_plan.get("actions", []),
            "thresholds": entry_plan.get("thresholds", {}),
            "metrics": entry_plan.get("metrics", {}),
        }

    def recurse(node: Any) -> None:
        if isinstance(node, dict):
            for (entry_id, node_id), new_route in escalation_map.items():
                if find_matching_id(node, entry_id, node_id):
                    existing_route = node.get("route") or node.get("rendererRoute") or node.get("renderRoute")
                    if "route" in node or existing_route is not None:
                        node["route"] = new_route
                    else:
                        node["route"] = new_route
                    node.setdefault("verification", {})
                    node["verification"]["lastAcceptancePlan"] = hints.get(entry_id)
                    applied.append(
                        {
                            "id": entry_id,
                            "nodeId": node_id,
                            "from": existing_route,
                            "to": new_route,
                        }
                    )
            for value in node.values():
                recurse(value)
        elif isinstance(node, list):
            for item in node:
                recurse(item)

    recurse(patched)
    if isinstance(patched, dict):
        patched.setdefault("verification", {})
        patched["verification"].update(
            {
                "generatedAt": now_iso(),
                "appliedEscalations": applied,
                "entryHints": hints,
            }
        )
        patched.setdefault("routeEscalations", [])
        if isinstance(patched["routeEscalations"], list):
            patched["routeEscalations"].extend(applied)

    write_json(out_path, patched)
    return {
        "source": str(render_plan_path),
        "output": str(out_path),
        "appliedEscalations": applied,
    }



def copy_artifact(src: Path, dest: Path) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return str(dest)



def package_bundle(bundle_dir: Path, zip_path: Path) -> Path:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(bundle_dir.rglob("*")):
            if file_path.is_file():
                zf.write(file_path, file_path.relative_to(bundle_dir))
    return zip_path



def write_summary_markdown(path: Path, summary: Dict[str, Any], entry_plans: List[Dict[str, Any]]) -> None:
    lines: List[str] = []
    lines.append("# Acceptance Summary")
    lines.append("")
    lines.append(f"- generatedAt: {summary.get('generatedAt')}")
    lines.append(f"- totalEntries: {summary.get('totalEntries')}")
    lines.append(f"- passedEntries: {summary.get('passedEntries')}")
    lines.append(f"- failedEntries: {summary.get('failedEntries')}")
    lines.append(f"- actionableFailures: {summary.get('actionableFailures')}")
    lines.append(f"- iterations: {summary.get('iterations')}")
    lines.append("")
    lines.append("## Entries")
    lines.append("")
    for entry in entry_plans:
        lines.append(f"### {entry['id']}")
        lines.append(f"- status: {entry.get('status')}")
        lines.append(f"- mode: {entry.get('mode')}")
        lines.append(f"- route: {entry.get('route')}")
        lines.append(f"- failureKind: {entry.get('failureKind') or 'none'}")
        metrics = entry.get("metrics", {}) or {}
        delta = metrics.get("delta_e00", {}) if isinstance(metrics, dict) else {}
        lines.append(f"- pixel diff ratio: {metrics.get('pixel_diff_ratio')}")
        lines.append(f"- SSIM: {metrics.get('ssim')}")
        lines.append(f"- DeltaE00 p95: {delta.get('p95')}")
        lines.append(f"- DeltaE00 max: {delta.get('max')}")
        actions = entry.get("actions", [])
        if actions:
            lines.append("- actions:")
            for action in actions:
                lines.append(f"  - {action.get('type')}: {action.get('reason', '')}")
        else:
            lines.append("- actions: none")
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")



def run_command_template(command_template: str, *, render_plan: Path, entry_ids: Iterable[str], bundle_dir: Path, iteration: int) -> subprocess.CompletedProcess[str]:
    joined_ids = ",".join(entry_ids)
    command = command_template.format(
        render_plan=shlex.quote(str(render_plan)),
        entry_ids=shlex.quote(joined_ids),
        bundle_dir=shlex.quote(str(bundle_dir)),
        iteration=iteration,
    )
    return subprocess.run(command, shell=True, check=True, text=True, capture_output=True)
