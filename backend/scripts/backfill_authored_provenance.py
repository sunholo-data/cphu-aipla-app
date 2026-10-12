"""Backfill ``createdBy`` / ``createdVia`` / ``createdAt`` on authored rows (1.1.150 M2).

Design: docs/design/aipla/v1.1.0-feedback/teaching-approach-provenance-and-sources.md

WHY THIS EXISTS

    On 2026-10-05 a researcher found "Didaktisk Tutor" in their own list and
    nobody could say where it came from. From 1.1.150 every NEW tutor, custom
    approach and custom persona is stamped on create. This fills the rows that
    already existed, from what is CERTAIN and nothing else:

        createdAt   <- Firestore's own document ``create_time`` (always present)
        createdBy   <- ``authorUid`` (the store has always recorded it)
        createdVia  <- ``seed`` when ``authorUid == platform-seed``; otherwise
                       left unset, which the UI shows as "not recorded".
                       Never guessed: a human row could have come from the UI
                       or the co-pilot, and the row does not say which.

    Safe to re-run. It writes only fields that are missing or null, with a merge
    update, and never overwrites a value — in particular never a non-null
    ``createdVia``.

⚠️ DEPLOY ORDER. ``Tutor``, ``TeachingFramework`` and ``Persona`` are
``extra="forbid"`` and the stores SKIP a row that fails validation. A revision
whose models predate these fields would silently drop every backfilled row from
every list — and from tutor resolution on the agent path. Run this on an env
ONLY once the release whose models carry ``createdBy``/``createdVia`` is serving
all of that env's traffic (``make deploy-status``).

USAGE
    make backfill-authored-provenance ENV=dev            # dry run
    make backfill-authored-provenance ENV=dev GO=1       # write

    dev, then test; prod is run by M only.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from typing import Any

#: ``db.models.authorship.SEED_AUTHOR``, spelled out because this runs as a
#: plain script from ``backend/`` (``scripts/`` is sys.path[0], not ``backend``).
#: A test asserts the two agree.
SEED_AUTHOR = "platform-seed"

ENV_PROJECTS = {
    "dev": "aipla-dev-2026",
    "test": "aipla-test-2026",
    "prod": "aipla-prod-2026",
}

#: The three stores a person can author a teaching record into.
COLLECTIONS = ("tutors", "authored_frameworks", "custom_personas")


def _iso(ts: Any) -> str | None:
    """Firestore's ``create_time`` as the ISO string the stores write."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts.isoformat()
    to_dt = getattr(ts, "ToDatetime", None)  # protobuf Timestamp
    if callable(to_dt):
        return to_dt().isoformat()
    return str(ts)


def plan_row(data: dict[str, Any], create_time: Any) -> dict[str, Any]:
    """The fields to write on ONE row — only missing or null ones, only certain values."""
    updates: dict[str, Any] = {}
    if not data.get("createdAt"):
        created = _iso(create_time)
        if created:
            updates["createdAt"] = created
    author = data.get("authorUid")
    if not data.get("createdBy") and author:
        updates["createdBy"] = author
    # Never overwrite a recorded channel; never guess one.
    if data.get("createdVia") is None and author == SEED_AUTHOR:
        updates["createdVia"] = "seed"
    return updates


def plan(client: Any) -> list[tuple[str, str, dict[str, Any]]]:
    """``(collection, doc_id, updates)`` for every row that needs anything."""
    out: list[tuple[str, str, dict[str, Any]]] = []
    for coll in COLLECTIONS:
        for snap in client.collection(coll).stream():
            updates = plan_row(snap.to_dict() or {}, getattr(snap, "create_time", None))
            if updates:
                out.append((coll, snap.id, updates))
    return out


def apply(client: Any, ops: list[tuple[str, str, dict[str, Any]]]) -> int:
    for coll, doc_id, updates in ops:
        # merge=True: touch only the named fields, never the rest of the row.
        client.collection(coll).document(doc_id).set(updates, merge=True)
    return len(ops)


def make_client(env: str) -> Any:
    from google.cloud import firestore

    return firestore.Client(project=ENV_PROJECTS[env])


def main(argv: list[str] | None = None, *, client_factory: Any = make_client) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--env", required=True, choices=sorted(ENV_PROJECTS))
    p.add_argument("--go", action="store_true", help="write (default: dry run)")
    args = p.parse_args(argv)

    print(
        f"[backfill-authored-provenance] env={args.env} ({ENV_PROJECTS[args.env]}) "
        f"mode={'GO' if args.go else 'dry-run'}"
    )
    client = client_factory(args.env)
    ops = plan(client)
    for coll, doc_id, updates in ops:
        fields = ", ".join(f"{k}={v}" for k, v in sorted(updates.items()))
        print(f"  {'WRITE' if args.go else 'would write'}  {coll}/{doc_id}: {fields}")
    if not ops:
        print("  nothing to backfill — every row already carries what can be known.")
        return 0
    if args.go:
        print(f"Wrote {apply(client, ops)} row(s).")
    else:
        print(f"{len(ops)} row(s) would change. Dry run — re-run with GO=1 to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
