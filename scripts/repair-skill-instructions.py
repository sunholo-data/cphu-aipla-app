"""One-off Firestore-doc repair for a skill whose ``instructions`` field
exceeds SkillConfig._validate_instructions' 10K cap.

Symptom this fixes: `list_marketplace` / `get_skill` / any read of the
poisoned doc 500s with `pydantic_core.ValidationError: 1 validation
error for SkillConfig` (instructions length > 10000). The seed flow
also can't recover because its first step is `list_skills` which hits
the same validator.

This script bypasses the Pydantic layer by writing directly via the
Firestore python client (matching the seed's wire-shape but skipping
the read-modify-write that fails). Overwrites ONLY the ``instructions``
field on the specified skill doc with the body parsed from the
matching SKILL.md.

Usage:
    uv run python scripts/repair-skill-instructions.py \\
        --project aipla-dev-2026 \\
        --skill-id ec34861d-2b09-4032-9f6d-539c41dac5a8 \\
        --skill-name problem-set-hints

Auth: uses Application Default Credentials. Run from a shell where
``gcloud auth application-default login`` has been completed (or
where ADC is provided by a service account).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from google.cloud import firestore  # type: ignore[import-untyped]

REPO_ROOT = Path(__file__).resolve().parents[1]
TEMPLATES_ROOT = REPO_ROOT / "backend" / "skills" / "templates"


def parse_skill_body(skill_name: str) -> str:
    """Read the SKILL.md for ``skill_name`` and return the body text
    (everything after the closing frontmatter ``---``)."""
    path = TEMPLATES_ROOT / skill_name / "SKILL.md"
    if not path.exists():
        raise SystemExit(f"FATAL: template not found at {path}")
    raw = path.read_text(encoding="utf-8")
    parts = raw.split("---", 2)
    if len(parts) < 3:
        raise SystemExit(f"FATAL: {path} has no frontmatter delimiters")
    body = parts[2].strip()
    if len(body) > 10_000:
        raise SystemExit(
            f"FATAL: {path} body is {len(body)} chars — still over the 10K cap. "
            "Trim before running this repair."
        )
    return body


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--project", required=True, help="GCP project ID")
    ap.add_argument(
        "--skill-id", required=True, help="Firestore doc ID (e.g. ec34861d-...)"
    )
    ap.add_argument(
        "--skill-name", required=True, help="Template directory name under backend/skills/templates/"
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the planned write but don't execute it.",
    )
    args = ap.parse_args()

    body = parse_skill_body(args.skill_name)
    print(
        f"[repair] skill_name={args.skill_name} skill_id={args.skill_id} "
        f"new_instructions_len={len(body)}"
    )
    if args.dry_run:
        print("[repair] dry-run: would write the above to "
              f"projects/{args.project}/databases/(default)/documents/skills/{args.skill_id}")
        return 0

    client = firestore.Client(project=args.project)
    doc_ref = client.collection("skills").document(args.skill_id)
    snap = doc_ref.get()
    if not snap.exists:
        print(f"FATAL: doc skills/{args.skill_id} does not exist in project {args.project}")
        return 1

    existing = snap.to_dict() or {}
    print(
        f"[repair] existing instructions len = {len(existing.get('instructions') or '')}"
    )
    print(f"[repair] writing trimmed instructions ({len(body)} chars)...")
    doc_ref.update({"instructions": body, "updatedAt": time.time()})
    print("[repair] write OK — re-fetching to confirm...")

    after = doc_ref.get().to_dict() or {}
    after_len = len(after.get("instructions") or "")
    print(f"[repair] post-write instructions len = {after_len}")
    if after_len > 10_000:
        print("FATAL: post-write length still > 10K — write didn't apply")
        return 1
    print("[repair] DONE — doc is now under the cap. Re-run scripts/seed-platform-skills.sh "
          "to apply any other template changes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
