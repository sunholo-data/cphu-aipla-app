"""Copy tutor→framework assignments from one environment to another (1.1.140 M2).

Design: docs/design/aipla/v1.1.0-feedback/meeting-2026-09-29-followups.md §M2

WHY THIS EXISTS

    ``tutor_framework_assignments`` is where a researcher signs off "this tutor
    teaches with that framework" (``db.tutor_assignments``). It is made by hand,
    in the running app, per environment — and Firestore is per-project. On
    2026-09-30 prod had 11 rows and test and dev had none, so every tutor on
    test taught with NO framework: a preview on test was not a preview of prod.

    Prod is the source of truth (that is where researchers work). This script
    copies its rows onward so test and dev teach what prod teaches.

WHAT IT WRITES

    Each written row keeps the tutor id and ``frameworkId`` verbatim — including
    ``frameworkId: None``, which is an explicit "no framework" and is NOT the
    same as no row (see ``db.tutor_assignments.get_assignment``). Provenance is
    restamped, because the sync is what wrote it:

        updatedBy            "sync:<from>"
        updatedAt            now (UTC, ISO)
        syncedFrom           "<from>"
        syncedFromUpdatedBy  the source row's ``updatedBy`` (the researcher)
        syncedFromUpdatedAt  the source row's ``updatedAt``

SAFETY

    * Dry run by default; ``--go`` writes exactly the printed plan.
    * Rows only in the target are left alone unless ``--prune``.
    * ``--to prod`` is refused unless ``--force``: prod is the source.
    * Each env gets its own explicit ``firestore.Client(project=...)`` — the
      process-global ``db.firestore`` singleton is bound to ONE project and
      would silently read and write the same database twice.
    * A read failure raises and exits non-zero; it never becomes "0 rows".

USAGE
    make sync-tutor-assignments FROM=prod TO=test          # dry run
    make sync-tutor-assignments FROM=prod TO=test GO=1     # write
    cd backend && uv run python scripts/sync_tutor_assignments.py --from prod --to dev [--prune] [--go]
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

COLLECTION = "tutor_framework_assignments"

ENV_PROJECTS = {
    "dev": "aipla-dev-2026",
    "test": "aipla-test-2026",
    "prod": "aipla-prod-2026",
}

_MISSING = object()


@dataclass(frozen=True)
class Op:
    """One planned change to the target collection."""

    action: str  # "add" | "change" | "remove"
    tutor_id: str
    source_framework: Any = None  # framework id or None (explicit none)
    target_framework: Any = None


def _fmt(framework: Any) -> str:
    return "(none)" if framework is None else str(framework)


def read_rows(client: Any) -> dict[str, dict[str, Any]]:
    """Every assignment row, keyed by tutor id. Raises on any read failure."""
    out: dict[str, dict[str, Any]] = {}
    for snap in client.collection(COLLECTION).stream():
        out[str(snap.id)] = snap.to_dict() or {}
    return out


def plan_sync(
    source: dict[str, dict[str, Any]],
    target: dict[str, dict[str, Any]],
    *,
    prune: bool = False,
) -> list[Op]:
    """What it takes to make ``target`` assign what ``source`` assigns.

    Compares ``frameworkId`` only — provenance fields differ by design after a
    sync, and a row whose framework already matches needs no write. A row whose
    ``frameworkId`` is None is a real row and is planned like any other.
    """
    ops: list[Op] = []
    for tutor_id in sorted(source):
        src_fw = source[tutor_id].get("frameworkId")
        if tutor_id not in target:
            ops.append(Op("add", tutor_id, src_fw, _MISSING))
            continue
        tgt_fw = target[tutor_id].get("frameworkId")
        if tgt_fw != src_fw:
            ops.append(Op("change", tutor_id, src_fw, tgt_fw))
    if prune:
        for tutor_id in sorted(set(target) - set(source)):
            ops.append(Op("remove", tutor_id, _MISSING, target[tutor_id].get("frameworkId")))
    return ops


def target_only(source: dict[str, Any], target: dict[str, Any]) -> list[str]:
    return sorted(set(target) - set(source))


def synced_row(tutor_id: str, source_row: dict[str, Any], from_env: str, now: str) -> dict[str, Any]:
    return {
        "tutorId": tutor_id,
        "frameworkId": source_row.get("frameworkId"),
        "updatedBy": f"sync:{from_env}",
        "updatedAt": now,
        "syncedFrom": from_env,
        "syncedFromUpdatedBy": source_row.get("updatedBy"),
        "syncedFromUpdatedAt": source_row.get("updatedAt"),
    }


def apply_plan(
    client: Any,
    ops: list[Op],
    source: dict[str, dict[str, Any]],
    *,
    from_env: str,
    now: str | None = None,
) -> int:
    """Write exactly ``ops`` to ``client``. Returns the number of writes."""
    stamp = now or datetime.now(UTC).isoformat()
    col = client.collection(COLLECTION)
    n = 0
    for op in ops:
        doc = col.document(op.tutor_id)
        if op.action == "remove":
            doc.delete()
        else:
            doc.set(synced_row(op.tutor_id, source[op.tutor_id], from_env, stamp), merge=False)
        n += 1
    return n


def render_plan(ops: list[Op], source: dict[str, Any], target: dict[str, Any], *, prune: bool) -> list[str]:
    lines = [f"source rows: {len(source)}   target rows: {len(target)}"]
    if not ops:
        lines.append("plan: nothing to do — target already assigns what source assigns.")
    else:
        lines.append(f"plan: {len(ops)} change(s)")
        for op in ops:
            if op.action == "add":
                lines.append(f"  + add     {op.tutor_id:<32} -> {_fmt(op.source_framework)}")
            elif op.action == "change":
                lines.append(
                    f"  ~ change  {op.tutor_id:<32} {_fmt(op.target_framework)} -> {_fmt(op.source_framework)}"
                )
            else:
                lines.append(f"  - remove  {op.tutor_id:<32} (was {_fmt(op.target_framework)})")
    if not prune:
        extra = target_only(source, target)
        if extra:
            lines.append(f"kept (target-only, pass --prune to remove): {', '.join(extra)}")
    return lines


def make_client(env: str) -> Any:
    from google.cloud import firestore  # deferred: tests never need ADC

    return firestore.Client(project=ENV_PROJECTS[env])


def main(argv: list[str] | None = None, *, client_factory: Any = make_client) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("--from", dest="from_env", required=True, choices=sorted(ENV_PROJECTS))
    p.add_argument("--to", dest="to_env", required=True, choices=sorted(ENV_PROJECTS))
    p.add_argument("--prune", action="store_true", help="also remove target-only rows")
    p.add_argument("--go", action="store_true", help="write the plan (default: dry run)")
    p.add_argument("--force", action="store_true", help="allow --to prod (prod is the source of truth)")
    args = p.parse_args(argv)

    if args.from_env == args.to_env:
        print(f"refusing: FROM and TO are both {args.from_env}", file=sys.stderr)
        return 2
    if args.to_env == "prod" and not args.force:
        print(
            "refusing: TO=prod. Prod is the source of truth for tutor assignments —"
            " researchers make them there. Pass FORCE=1 (--force) if you really mean it.",
            file=sys.stderr,
        )
        return 2

    print(
        f"[sync-tutor-assignments] {args.from_env} ({ENV_PROJECTS[args.from_env]}) -> "
        f"{args.to_env} ({ENV_PROJECTS[args.to_env]})  mode={'GO' if args.go else 'dry-run'}"
    )
    try:
        src_client = client_factory(args.from_env)
        dst_client = client_factory(args.to_env)
        source = read_rows(src_client)
        target = read_rows(dst_client)
    except Exception as exc:
        print(f"CANNOT READ: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    ops = plan_sync(source, target, prune=args.prune)
    for line in render_plan(ops, source, target, prune=args.prune):
        print(line)

    if not ops:
        return 0
    if not args.go:
        print("dry run — nothing written. Re-run with GO=1 (--go) to apply.")
        return 0

    n = apply_plan(dst_client, ops, source, from_env=args.from_env)
    print(f"wrote {n} change(s) to {args.to_env}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
