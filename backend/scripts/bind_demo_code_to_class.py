"""Bind the shared demo student code to a Demo class, so `/lessons` isn't empty.

WHY THIS EXISTS (2026-08-14). `scripts/seed-demo-codes.sh` mints `aipla-demo-1`
through the admin `mint-demo-group` endpoint, which sets only ``skillIds`` — it
has no way to set ``classId``. But `GET /api/auth/group/my-activities`, which is
what `/lessons` actually renders, resolves activities from
``anon_groups/<code>.classId -> Class.activity_ids``. A skill-bound code
therefore joins fine and then shows an empty lesson list.

That is exactly what test and prod looked like: `aipla-demo-1` joined
successfully, `/lessons` was blank, and the Demo classes sitting there with nine
activities each were unreachable. Dev only worked because its code had been
bound to a class at some point. So the student journey could be rehearsed on
dev and nowhere else — with a teacher pilot starting.

SAFETY — read before widening this. ``aipla-demo-1`` is a PUBLICLY KNOWN code:
it is in CLAUDE.md, the deploy runbook and the smoke scripts. Binding it to a
class grants every anonymous holder of that code access to that class's
activities. On prod the class list includes real pilot classes with real
teachers' work. So the target is constrained by NAME, not by an id someone types
correctly under time pressure:

  * only a class named exactly "Demo class" is eligible (--class-name to widen,
    deliberately awkward);
  * the class must not be revoked;
  * the class must have activities (binding to an empty one fixes nothing);
  * ties break on most-activities then lowest id, so re-runs are stable;
  * dry-run unless --apply.

Usage:
    uv run python -m scripts.bind_demo_code_to_class                 # dry-run
    uv run python -m scripts.bind_demo_code_to_class --apply
    uv run python -m scripts.bind_demo_code_to_class --code aipla-demo-2 --apply
"""

from __future__ import annotations

import argparse
import sys

from db.classes import get_class
from db.firestore import get_document, query_documents, update_document

_ANON_GROUPS = "anon_groups"
_CLASSES = "classes"
DEFAULT_CODE = "aipla-demo-1"
DEFAULT_CLASS_NAME = "Demo class"


def _eligible_classes(class_name: str) -> list:
    """Every non-revoked class with that exact name AND at least one activity."""
    out = []
    for raw in query_documents(_CLASSES, limit=200):
        cid = raw.get("__id")
        if not cid:
            continue
        cls = get_class(cid)
        if cls is None or cls.revoked or cls.name != class_name:
            continue
        if not cls.activity_ids:
            continue
        out.append(cls)
    # Most activities wins; id breaks the tie so repeat runs pick the same class.
    out.sort(key=lambda c: (-len(c.activity_ids), c.class_id))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--code", default=DEFAULT_CODE, help="group code to bind")
    ap.add_argument(
        "--class-name",
        default=DEFAULT_CLASS_NAME,
        help="exact class name to bind to. Widening this points a public code at real work.",
    )
    ap.add_argument("--apply", action="store_true", help="write (default: dry-run)")
    args = ap.parse_args()

    prefix = "" if args.apply else "[DRY-RUN] "

    doc = get_document(_ANON_GROUPS, args.code)
    if doc is None:
        print(f"FATAL: code {args.code!r} does not exist. Run `make seed-demo-codes ENV=<env>` first.")
        return 2

    current = doc.get("classId")
    if current:
        cls = get_class(current)
        if cls and not cls.revoked and cls.activity_ids:
            print(
                f"{args.code!r} is already bound to {current!r} "
                f"({cls.name!r}, {len(cls.activity_ids)} activities) — nothing to do."
            )
            return 0
        # Bound to something revoked, missing, or empty: say so rather than
        # silently rebinding, then continue to pick a good target.
        print(f"WARN {args.code!r} is bound to {current!r}, which is missing/revoked/empty — rebinding.")

    candidates = _eligible_classes(args.class_name)
    if not candidates:
        print(
            f"FATAL: no non-revoked class named {args.class_name!r} with any activities.\n"
            f"       Seed one first: `make force-seed-demo ENV=<env> APPLY=1`."
        )
        return 1

    target = candidates[0]
    if len(candidates) > 1:
        print(f"note: {len(candidates)} eligible classes; picking the one with most activities.")
    print(
        f"{prefix}bind {args.code!r} -> class {target.class_id!r} "
        f"({target.name!r}, {len(target.activity_ids)} activities)"
    )

    if not args.apply:
        print("\nRe-run with --apply to write.")
        return 0

    update_document(_ANON_GROUPS, args.code, {"classId": target.class_id})
    # Mirror mint_group_codes_under_class's second write so the teacher's class
    # page lists the code it is actually handing out.
    if args.code not in target.group_codes:
        update_document(
            _CLASSES,
            target.class_id,
            {"groupCodes": [*target.group_codes, args.code]},
        )

    check = get_document(_ANON_GROUPS, args.code) or {}
    if check.get("classId") != target.class_id:
        print(f"FATAL: write did not stick — classId is {check.get('classId')!r}")
        return 1
    print(f"OK bound. {args.code!r}.classId = {check['classId']!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
