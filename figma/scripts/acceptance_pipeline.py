#!/usr/bin/env python3
"""Run an automated replay-acceptance loop.

The pipeline does four things:
1. Read a manifest of baseline/candidate pairs.
2. Compute deterministic fidelity scorecards for page / region / hard-node entries.
3. Generate an acceptance plan with route escalations and fix suggestions.
4. Optionally patch a render plan, invoke an external rerender command, and package the resulting bundle.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Sequence

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from fidelity_scorecard import generate_report  # type: ignore
from lib.acceptance_core import (
    apply_plan_to_render_plan,
    build_entry_plan,
    copy_artifact,
    load_manifest,
    now_iso,
    package_bundle,
    run_command_template,
    slugify,
    write_json,
    write_summary_markdown,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run automated replay acceptance")
    parser.add_argument("--manifest", required=True, help="Acceptance manifest JSON path")
    parser.add_argument(
        "--bundle-dir",
        default=None,
        help="Directory to write the acceptance bundle into (default: next to manifest)",
    )
    parser.add_argument("--render-plan", default=None, help="Optional render.plan.json to patch with escalations")
    parser.add_argument("--scene-ir", default=None, help="Optional scene.ir.json to copy into the bundle")
    parser.add_argument(
        "--zip-path",
        default=None,
        help="Optional zip file output path. If omitted, defaults to <bundle-dir>.zip",
    )
    parser.add_argument(
        "--attach",
        action="append",
        default=[],
        help="Extra file or directory to copy into bundle/attachments. Can be passed multiple times.",
    )
    parser.add_argument(
        "--pixel-threshold",
        type=int,
        default=16,
        help="Per-channel diff threshold for pixel diff ratio",
    )
    parser.add_argument(
        "--max-color-samples",
        type=int,
        default=250000,
        help="Upper bound for DeltaE00 sampling",
    )
    parser.add_argument("--lpips", action="store_true", help="Attempt optional LPIPS metric")
    parser.add_argument(
        "--apply-route-escalation",
        action="store_true",
        help="Patch render plan when the acceptance plan proposes route escalation",
    )
    parser.add_argument(
        "--rerender-cmd",
        default=None,
        help=(
            "Optional rerender command template. Available placeholders: "
            "{render_plan}, {entry_ids}, {bundle_dir}, {iteration}."
        ),
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=1,
        help="Maximum acceptance iterations when rerendering is enabled",
    )
    parser.add_argument(
        "--rerun-failed-only",
        action="store_true",
        help="On later iterations, only recompute failed entries from the previous plan",
    )
    parser.add_argument(
        "--no-zip",
        action="store_true",
        help="Do not create the final zip package",
    )
    return parser.parse_args()



def copy_entry_images(bundle_dir: Path, entry_plan: Dict[str, Any], report: Dict[str, Any]) -> None:
    baseline_src = Path(report["baseline"])
    candidate_src = Path(report["candidate"])
    entry_slug = slugify(entry_plan["id"])
    copy_artifact(baseline_src, bundle_dir / "baseline" / f"{entry_slug}{baseline_src.suffix.lower()}")
    copy_artifact(candidate_src, bundle_dir / "candidate" / f"{entry_slug}{candidate_src.suffix.lower()}")
    heatmap_src = Path(report["heatmap"])
    if heatmap_src.exists():
        copy_artifact(heatmap_src, bundle_dir / "heatmaps" / heatmap_src.name)



def aggregate_reports(entry_plans: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    entries = []
    passed = 0
    actionable = 0
    for entry in entry_plans:
        if entry.get("status") == "passed":
            passed += 1
        elif entry.get("actions"):
            actionable += 1
        entries.append(
            {
                "id": entry.get("id"),
                "mode": entry.get("mode"),
                "surface": entry.get("surface"),
                "route": entry.get("route"),
                "status": entry.get("status"),
                "failureKind": entry.get("failureKind"),
                "metrics": entry.get("metrics"),
                "thresholds": entry.get("thresholds"),
                "diffBounds": entry.get("diffBounds"),
                "actions": entry.get("actions"),
                "reportPath": entry.get("reportPath"),
                "heatmapPath": entry.get("heatmapPath"),
            }
        )
    return {
        "generatedAt": now_iso(),
        "totalEntries": len(entries),
        "passedEntries": passed,
        "failedEntries": len(entries) - passed,
        "actionableFailures": actionable,
        "entries": entries,
    }



def build_plan_doc(manifest: Dict[str, Any], iteration: int, entry_plans: Sequence[Dict[str, Any]], render_plan_patch: Dict[str, Any] | None, rerender_log: Dict[str, Any] | None) -> Dict[str, Any]:
    aggregate = aggregate_reports(entry_plans)
    return {
        "ok": True,
        "generatedAt": aggregate["generatedAt"],
        "iteration": iteration,
        "task": manifest.get("task") if isinstance(manifest.get("task"), dict) else None,
        "summary": {k: v for k, v in aggregate.items() if k != "entries"},
        "entries": list(entry_plans),
        "renderPlanPatch": render_plan_patch,
        "rerender": rerender_log,
    }



def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    manifest, resolved_entries = load_manifest(manifest_path)
    bundle_dir = (
        Path(args.bundle_dir).expanduser().resolve()
        if args.bundle_dir
        else manifest_path.parent.resolve() / f"acceptance-bundle-{manifest_path.stem}"
    )
    if bundle_dir.exists():
        shutil.rmtree(bundle_dir)
    bundle_dir.mkdir(parents=True, exist_ok=True)
    write_json(bundle_dir / "acceptance-manifest.json", manifest)

    render_plan_source = Path(args.render_plan).expanduser().resolve() if args.render_plan else None
    scene_ir_source = Path(args.scene_ir).expanduser().resolve() if args.scene_ir else None
    if render_plan_source and render_plan_source.exists():
        copy_artifact(render_plan_source, bundle_dir / "render.plan.input.json")
    if scene_ir_source and scene_ir_source.exists():
        copy_artifact(scene_ir_source, bundle_dir / "scene.ir.json")

    for attach in args.attach:
        src = Path(attach).expanduser().resolve()
        if not src.exists():
            continue
        dest = bundle_dir / "attachments" / src.name
        if src.is_dir():
            shutil.copytree(src, dest, dirs_exist_ok=True)
        else:
            copy_artifact(src, dest)

    all_entry_plans: List[Dict[str, Any]] = []
    last_failed_ids: List[str] = []
    current_render_plan = render_plan_source
    last_plan_doc: Dict[str, Any] | None = None

    max_iterations = max(1, int(args.max_iterations))
    for iteration in range(1, max_iterations + 1):
        target_entries = resolved_entries
        if iteration > 1 and args.rerun_failed_only and last_failed_ids:
            target_entries = [entry for entry in resolved_entries if entry.entry_id in set(last_failed_ids)]

        report_dir = bundle_dir / "reports" / f"iteration-{iteration:02d}"
        heatmap_dir = bundle_dir / "heatmaps" / f"iteration-{iteration:02d}"
        report_dir.mkdir(parents=True, exist_ok=True)
        heatmap_dir.mkdir(parents=True, exist_ok=True)

        iteration_entry_plans: List[Dict[str, Any]] = []
        for entry in target_entries:
            entry_slug = slugify(entry.entry_id)
            report_path = report_dir / f"{entry_slug}.fidelity.json"
            heatmap_path = heatmap_dir / f"{entry_slug}.heatmap.png"
            report = generate_report(
                baseline_path=entry.baseline,
                candidate_path=entry.candidate,
                mode=entry.mode,
                pixel_threshold=args.pixel_threshold,
                report_path=report_path,
                heatmap_path=heatmap_path,
                lpips=args.lpips,
                max_color_samples=args.max_color_samples,
            )
            entry_plan = build_entry_plan(entry, report)
            iteration_entry_plans.append(entry_plan)
            copy_entry_images(bundle_dir, entry_plan, report)

        if iteration == 1 or not args.rerun_failed_only:
            all_entry_plans = iteration_entry_plans
        else:
            update_map = {entry["id"]: entry for entry in iteration_entry_plans}
            merged = []
            for existing in all_entry_plans:
                merged.append(update_map.get(existing["id"], existing))
            all_entry_plans = merged

        render_plan_patch = None
        if args.apply_route_escalation and current_render_plan and current_render_plan.exists():
            out_render_plan = bundle_dir / "render-plans" / f"render.plan.iteration-{iteration:02d}.json"
            render_plan_patch = apply_plan_to_render_plan(current_render_plan, all_entry_plans, out_render_plan)
            current_render_plan = Path(render_plan_patch["output"])

        rerender_log = None
        failed_entry_ids = [entry["id"] for entry in all_entry_plans if entry.get("status") != "passed"]
        last_failed_ids = failed_entry_ids

        plan_doc = build_plan_doc(manifest, iteration, all_entry_plans, render_plan_patch, None)
        plan_path = bundle_dir / f"acceptance.plan.iteration-{iteration:02d}.json"
        write_json(plan_path, plan_doc)
        write_summary_markdown(bundle_dir / f"acceptance.summary.iteration-{iteration:02d}.md", {**plan_doc["summary"], "iterations": iteration}, all_entry_plans)
        last_plan_doc = plan_doc

        can_rerender = bool(args.rerender_cmd) and iteration < max_iterations and bool(failed_entry_ids)
        if can_rerender:
            try:
                completed = run_command_template(
                    args.rerender_cmd,
                    render_plan=current_render_plan if current_render_plan else Path(""),
                    entry_ids=failed_entry_ids,
                    bundle_dir=bundle_dir,
                    iteration=iteration,
                )
                rerender_log = {
                    "ok": True,
                    "commandTemplate": args.rerender_cmd,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                }
            except Exception as exc:
                rerender_log = {
                    "ok": False,
                    "commandTemplate": args.rerender_cmd,
                    "error": str(exc),
                }
                plan_doc = build_plan_doc(manifest, iteration, all_entry_plans, render_plan_patch, rerender_log)
                write_json(plan_path, plan_doc)
                last_plan_doc = plan_doc
                break
            plan_doc = build_plan_doc(manifest, iteration, all_entry_plans, render_plan_patch, rerender_log)
            write_json(plan_path, plan_doc)
            last_plan_doc = plan_doc
            log_path = bundle_dir / "rerender-logs" / f"iteration-{iteration:02d}.json"
            write_json(log_path, rerender_log)

        if not failed_entry_ids:
            break

    assert last_plan_doc is not None
    final_aggregate = aggregate_reports(all_entry_plans)
    final_summary = {
        **{k: v for k, v in final_aggregate.items() if k != "entries"},
        "iterations": int(last_plan_doc.get("iteration", 1)),
        "manifest": str(manifest_path),
        "renderPlan": str(current_render_plan) if current_render_plan else None,
    }
    write_json(bundle_dir / "acceptance.plan.json", last_plan_doc)
    write_json(bundle_dir / "diff-report.json", final_aggregate)
    write_json(bundle_dir / "diagnostics.json", final_summary)
    write_summary_markdown(bundle_dir / "acceptance.summary.md", final_summary, all_entry_plans)

    if current_render_plan and current_render_plan.exists():
        copy_artifact(current_render_plan, bundle_dir / "render.plan.final.json")

    if not args.no_zip:
        zip_path = Path(args.zip_path).expanduser().resolve() if args.zip_path else bundle_dir.with_suffix(".zip")
        package_bundle(bundle_dir, zip_path)
        final_summary["zipPath"] = str(zip_path)
        write_json(bundle_dir / "diagnostics.json", final_summary)

    print(json.dumps({"ok": True, **final_summary}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
