"""``python -m sim_gates <artefact_dir> [--yaml PATH] [--tiers A,B,C,D] [--hidden TERM …] [--json]``

Exit codes: 0 ok · 1 a gate failed (or was skipped/errored) · 2 could not run.
With no ``--yaml``, ``backend/artefacts/<id>.yaml`` is used when it exists and
tier C is requested.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import REPO_ROOT, TIERS, run


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m sim_gates")
    ap.add_argument("artefact_dir", type=Path)
    ap.add_argument("--yaml", type=Path)
    ap.add_argument("--tiers", default=",".join(TIERS))
    ap.add_argument("--hidden", nargs="*", default=None)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    index = args.artefact_dir / "index.html"
    if not index.is_file():
        print(f"no index.html in {args.artefact_dir}", file=sys.stderr)
        return 2
    tiers = tuple(t.strip().upper() for t in args.tiers.split(",") if t.strip())
    yaml_path = args.yaml
    if yaml_path is None and "C" in tiers:
        guess = REPO_ROOT / "backend" / "artefacts" / f"{args.artefact_dir.resolve().parent.name}.yaml"
        yaml_path = guess if guess.is_file() else None
    total = sum(p.stat().st_size for p in args.artefact_dir.rglob("*") if p.is_file())
    report = run(
        index.read_text(encoding="utf-8"),
        catalogue_yaml=yaml_path.read_text(encoding="utf-8") if yaml_path else None,
        hidden_terms=args.hidden,
        tiers=tiers,
        total_bytes=total,
    )
    if args.json:
        print(json.dumps(report.to_dict(), indent=1, ensure_ascii=False))
    else:
        print(f"Auditing: {args.artefact_dir.resolve()} (tiers {''.join(tiers)})\n")
        print(report.to_text())
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
