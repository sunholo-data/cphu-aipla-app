#!/usr/bin/env python3
"""Fail if any step that ships something can run before BOTH CI gates pass.

Since 2026-09-25 cloudbuild.yaml builds its images in parallel with the CI
gates (a ~25 min deploy became ~max(gate, build) + deploy). That is only safe
while everything that leaves the build VM still waits on both gates:
image pushes (a pushed tag is what `make promote` copies to prod), the
Firestore rules deploy, the Cloud Run deploy, and every step after it.

A step may start before the gates only if it is on the ALLOWED_EARLY list —
local work whose output never leaves /workspace or the local docker daemon.
A new step with `waitFor: ['-']`, or one that waits only on a build, fails here
unless it is added to that list deliberately.

Usage: python3 scripts/check-cloudbuild-gates.py [cloudbuild.yaml]
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("PyYAML required: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

GATES = {"ci-gate-backend", "ci-gate-frontend"}
# Local-only work that may run beside the gates. Adding to this list is a
# decision: the step must not push, deploy, write to a project, or publish.
ALLOWED_EARLY = {"get-firebase-config", "build-frontend", "build-backend"}


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "cloudbuild.yaml")
    steps = yaml.safe_load(path.read_text())["steps"]

    names: list[str] = []
    deps: dict[str, list[str]] = {}
    prev: str | None = None
    for i, step in enumerate(steps):
        name = step.get("id") or f"<step {i}: {step.get('name', '?')}>"
        wait = step.get("waitFor")
        # Cloud Build: no waitFor = wait for every previous step; ['-'] = start now.
        deps[name] = list(names) if wait is None else [w for w in wait if w != "-"]
        names.append(name)
        prev = name
    del prev

    def gates_upstream(name: str, seen: frozenset[str] = frozenset()) -> set[str]:
        if name in GATES:
            return {name}
        found: set[str] = set()
        for dep in deps.get(name, []):
            if dep not in seen:
                found |= gates_upstream(dep, seen | {name})
        return found

    bad = [n for n in names if n not in GATES and n not in ALLOWED_EARLY and gates_upstream(n) != GATES]
    if bad:
        print(f"{path}: these steps can run before BOTH CI gates pass:", file=sys.stderr)
        for n in bad:
            print(f"  - {n} (waits on gates: {sorted(gates_upstream(n)) or 'none'})", file=sys.stderr)
        print(
            "Make it wait on the gates (directly or via a step that does), or, if it is "
            "genuinely local-only, add it to ALLOWED_EARLY in this script with a reason.",
            file=sys.stderr,
        )
        return 1
    print(f"OK: every shipping step in {path} waits on both CI gates ({len(names)} steps)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
