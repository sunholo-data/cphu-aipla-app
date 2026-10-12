"""Export researcher corrections as a calibration set for the fidelity judge (1.1.148).

Design: docs/design/aipla/v1.1.0-feedback/assessment-transparency-and-override.md
(open questions 3 + 4, decided by M on 2026-10-08: shared + calibration set).

WHAT IT DOES

    Reads ``rubric_reviews`` (and each reviewed ``rubric_runs`` doc, for the
    judge's model on reviews older than the snapshot that carries it) from ONE
    environment's Firestore, and writes a LOCAL JSONL file: one line per current
    review — session, construct, the judge's cited turns + quotes, the AI band,
    the researcher band, the researcher's reason, criteria version, prompt
    version, model. Prints agreement stats per framework and construct.

    The same rows the researcher route ``GET /api/research/calibration-set``
    serves, built by the same function (``analytics.calibration_set``).

SAFETY

    * READ-ONLY. There is no write path in this script — not a dry-run flag,
      no writes at all. The only file it creates is the local ``--out``.
    * Its own ``firestore.Client(project=...)``, never the process-global
      singleton, so ``--env`` names exactly the database read.
    * A read failure raises and exits non-zero; it never becomes "0 reviews".
    * The JSONL holds researcher reasons and judge quotes of student dialogue:
      it is research data. The default ``--out`` is ``backend/exports/``, which
      the root ``.gitignore`` excludes (anchored).

USAGE
    make calibration-set ENV=prod
    make calibration-set ENV=prod FRAMEWORK=toulmin OUT=/tmp/cal.jsonl
    cd backend && uv run python scripts/export_calibration_set.py --env prod [--framework id] [--out path]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ENV_PROJECTS = {
    "dev": "aipla-dev-2026",
    "test": "aipla-test-2026",
    "prod": "aipla-prod-2026",
}

REVIEWS = "rubric_reviews"
RUNS = "rubric_runs"


def readers(client: Any) -> tuple[Any, Any]:
    """(read_reviews, read_run) bound to one explicit Firestore client."""

    def read_reviews() -> list[dict[str, Any]]:
        return [d.to_dict() or {} for d in client.collection(REVIEWS).stream()]

    def read_run(run_id: str) -> dict[str, Any] | None:
        snap = client.collection(RUNS).document(run_id).get()
        return snap.to_dict() if snap.exists else None

    return read_reviews, read_run


def write_jsonl(rows: list[dict[str, Any]], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def _pct(cell: dict[str, Any]) -> str:
    return "—" if cell.get("agreement") is None else f"{cell['agreement'] * 100:.0f}%"


def format_stats(stats: dict[str, Any]) -> str:
    o = stats["overall"]
    lines = [
        f"reviews: {o['n']}  agree: {o['agree']}  agreement: {_pct(o)}  "
        f"researcher higher: {o['researcherHigher']}  lower: {o['researcherLower']}  "
        f"reviewers: {stats['reviewers']}  multi-rated constructs: {stats['multiRated']}",
    ]
    for fw, cell in stats["byFramework"].items():
        lines.append(f"  {fw}: n={cell['n']} agreement={_pct(cell)}")
        for key, c in stats["byConstruct"].get(fw, {}).items():
            lines.append(
                f"    {key}: n={c['n']} agreement={_pct(c)} higher={c['researcherHigher']} lower={c['researcherLower']}"
            )
    return "\n".join(lines)


def main(argv: list[str] | None = None, *, client: Any = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--env", required=True, choices=sorted(ENV_PROJECTS))
    ap.add_argument("--framework", default=None, help="only this framework id (e.g. toulmin)")
    ap.add_argument("--out", default=None, help="JSONL path (default exports/calibration-<env>.jsonl)")
    args = ap.parse_args(argv)

    from analytics.calibration_set import load_calibration_set

    if client is None:
        from google.cloud import firestore

        client = firestore.Client(project=ENV_PROJECTS[args.env])
    read_reviews, read_run = readers(client)
    result = load_calibration_set(args.framework, read_reviews=read_reviews, read_run=read_run)

    out = Path(args.out or f"exports/calibration-{args.env}.jsonl")
    write_jsonl(result["rows"], out)
    print(f"{args.env} ({ENV_PROJECTS[args.env]}): {len(result['rows'])} rows → {out}")
    print(format_stats(result["stats"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
