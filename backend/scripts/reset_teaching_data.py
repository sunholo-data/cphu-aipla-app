"""Reset dev TEACHING data to a clean slate — start fresh on the new activity model.

Deletes all teacher/student teaching data so dev begins from zero on the new
``activities`` data model (the old ``activity_configs`` model is dropped, not
migrated). Pairs with the teacher first-login demo seed: after this runs, the
next time a teacher signs in they get a fresh personal demo class + activities.

SAFETY
------
- **DEV ONLY.** Refuses to run unless the resolved GCP project is in
  ``_DEV_PROJECTS`` (or LOCAL_MODE, which is an ephemeral in-memory store).
  test/prod are off-limits — re-point + extend the allowlist deliberately.
- **Dry-run by default.** Prints per-collection counts. Pass ``--apply`` to
  actually delete.

DELETES (teaching data):
  classes, activities, activity_configs, anon_groups, group_sessions,
  chat_sessions, documents, and every users/{uid}/folders subcollection.

KEEPS (config + shared corpus + identity):
  skills, curriculum_content, curriculum_docs, tool_permissions, clients,
  the users/{uid} profile docs, and Firebase Auth teacher accounts (sign-in
  stays intact).

NOTE: ``chat_sessions`` is the Firestore session INDEX. The actual ADK
conversation state lives in the Vertex AI session service; those rows aren't
deleted here but become unreachable without their index and expire on their own.

Usage:
  uv run python -m scripts.reset_teaching_data            # dry run
  uv run python -m scripts.reset_teaching_data --apply    # delete
"""

from __future__ import annotations

import argparse

from config.gcp import resolve_gcp_project
from config.local_mode import is_local_mode
from db.firestore import delete_document, get_client, query_documents

# Top-level collections holding teaching data (wiped wholesale).
_TEACHING_COLLECTIONS = [
    "classes",
    "activities",
    "activity_configs",
    "anon_groups",
    "group_sessions",
    "chat_sessions",
    "documents",
]

# Projects this destructive script is allowed to touch. DEV ONLY.
_DEV_PROJECTS = {"aipla-dev-2026"}


def _guard_target() -> str:
    """Return the resolved target label, or raise if it's not an allowed dev
    target. LOCAL_MODE is always safe (ephemeral in-memory store)."""
    if is_local_mode():
        return "LOCAL_MODE (in-memory)"
    project = resolve_gcp_project() or "<unknown>"
    if project not in _DEV_PROJECTS:
        raise SystemExit(
            f"REFUSING: project {project!r} is not in the dev allowlist {sorted(_DEV_PROJECTS)}.\n"
            "This script only resets dev. test/prod are off-limits."
        )
    return project


def _wipe_collection(collection: str, *, apply: bool) -> int:
    """Delete every document in a top-level collection. Returns the count."""
    ids = [d["__id"] for d in query_documents(collection)]
    if apply:
        for doc_id in ids:
            delete_document(collection, doc_id)
    return len(ids)


def _wipe_user_folders(*, apply: bool) -> int:
    """Delete every users/{uid}/folders subcollection doc (keeps the user doc).
    Best-effort: a backend whose client can't enumerate subcollections (some
    in-memory test clients) yields 0 rather than failing the whole wipe."""
    client = get_client()
    total = 0
    try:
        users = list(client.collection("users").stream())
    except Exception:  # pragma: no cover - subcollection scan unsupported
        return 0
    for user in users:
        try:
            folders = list(user.reference.collection("folders").stream())
        except Exception:  # pragma: no cover
            continue
        total += len(folders)
        if apply:
            for folder in folders:
                folder.reference.delete()
    return total


def run(*, apply: bool) -> dict[str, int]:
    """Wipe (or count) the teaching collections. Returns per-collection counts."""
    _guard_target()
    counts: dict[str, int] = {}
    for collection in _TEACHING_COLLECTIONS:
        counts[collection] = _wipe_collection(collection, apply=apply)
    counts["users/*/folders"] = _wipe_user_folders(apply=apply)
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset dev teaching data to a clean slate.")
    parser.add_argument("--apply", action="store_true", help="Actually delete (otherwise dry-run).")
    args = parser.parse_args()

    target = _guard_target()
    print(f"{'APPLY — DELETING' if args.apply else 'DRY RUN'} against {target}\n")
    counts = run(apply=args.apply)
    for collection, n in counts.items():
        print(f"  {collection:<22} {n}")
    total = sum(counts.values())
    print(f"\n{'Deleted' if args.apply else 'Would delete'} {total} documents.")
    if not args.apply:
        print("Re-run with --apply to delete. (KEEPS skills, curriculum, tool_permissions, accounts.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
