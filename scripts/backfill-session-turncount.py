"""One-off backfill for ChatSessionIndex.turnCount poisoned by the app:-prefix bug.

Symptom this fixes: the teacher reports overview showed a wildly inflated
``turnCount`` (e.g. 259) for sessions that had only a handful of real turns. Root
cause (fixed 2026-06-23 in backend/adk/callbacks/session.py): the per-turn counter
was stored under an ``app:``-prefixed ADK state key, which is application-global —
so every turn of every session incremented one shared odometer and that global
value got stamped onto individual session index rows. See upstream-feedback.md #37.

This script recomputes ``turnCount`` from the durable source of truth — the
BigQuery chat-turn log (``chat_logs.aipla_chat_turn``) — as the number of
student-authored turns per session. That matches the going-forward live counter
(one invocation per student message) and is consistent with the detail report's
``messageCount`` (student turns + tutor replies). For the affected
``windy-crystal-82`` session this resolves 259 -> 1 (one student prompt, one
tutor reply = 2 messages exchanged).

Scope / safety:
* DRY-RUN BY DEFAULT. Prints the planned ``old -> new`` diff and exits without
  writing. Pass ``--commit`` to actually write.
* Authoritative recompute only touches sessions that appear in BigQuery. Sessions
  with NO chat-turn rows are left unchanged unless ``--zero-missing`` is passed
  (explicit opt-in: sets their turnCount to 0). This avoids zeroing legitimate
  sessions whose turns predate the BQ chat-log pipeline (SEQUENCE 1.2).
* Idempotent: a second run after ``--commit`` reports zero changes.

Usage:
    # Preview every change (read-only):
    uv run python scripts/backfill-session-turncount.py --project aipla-dev-2026

    # Preview one session:
    uv run python scripts/backfill-session-turncount.py --project aipla-dev-2026 \\
        --session-id a325b6dc-f817-4b9f-bf6e-32c2e4cc5ba2

    # Apply the changes:
    uv run python scripts/backfill-session-turncount.py --project aipla-dev-2026 --commit

Auth: Application Default Credentials. Run from a shell where
``gcloud auth application-default login`` has been completed (or where ADC is
provided by a service account). Record any committed run in
scripts/backfill-session-turncount.NOTES.md (side-effect log).
"""

from __future__ import annotations

import argparse
import sys

from google.cloud import bigquery, firestore  # type: ignore[import-untyped]

CHAT_LOGS_DATASET = "chat_logs"
CHAT_TURN_TABLE = "aipla_chat_turn"
COLLECTION = "chat_sessions"


def student_turns_by_session(project: str, session_id: str | None) -> dict[str, int]:
    """Map session_id -> count of student-authored chat-turn rows in BigQuery.

    This is the authoritative per-session turn count: each student message is
    one agent invocation, which is what ``turnCount`` represents going forward.
    """
    bq = bigquery.Client(project=project)
    table = f"`{project}.{CHAT_LOGS_DATASET}.{CHAT_TURN_TABLE}`"
    where = "WHERE jsonPayload.session_id IS NOT NULL"
    params: list = []
    if session_id:
        where += " AND jsonPayload.session_id = @session_id"
        params.append(bigquery.ScalarQueryParameter("session_id", "STRING", session_id))
    sql = (
        "SELECT jsonPayload.session_id AS session_id, "
        "COUNTIF(jsonPayload.role = 'student') AS student_turns "
        f"FROM {table} {where} GROUP BY session_id"
    )
    job = bq.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params))
    return {row["session_id"]: int(row["student_turns"]) for row in job.result()}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="GCP project ID (e.g. aipla-dev-2026)")
    ap.add_argument("--session-id", help="Backfill only this session id (default: all sessions).")
    ap.add_argument("--commit", action="store_true", help="Write the changes. Without this flag the script is read-only (dry-run).")
    ap.add_argument(
        "--zero-missing",
        action="store_true",
        help="Also set turnCount=0 for sessions with NO BigQuery chat-turn rows. Off by default to avoid zeroing pre-pipeline sessions.",
    )
    args = ap.parse_args()

    mode = "COMMIT" if args.commit else "DRY-RUN (read-only)"
    print(f"[backfill] project={args.project} mode={mode} zero_missing={args.zero_missing}")

    bq_counts = student_turns_by_session(args.project, args.session_id)
    print(f"[backfill] BigQuery returned student-turn counts for {len(bq_counts)} session(s)")

    fs = firestore.Client(project=args.project)
    col = fs.collection(COLLECTION)
    docs = [col.document(args.session_id).get()] if args.session_id else col.stream()

    planned: list[tuple[str, int, int]] = []  # (session_id, old, new)
    skipped_no_bq = 0
    for snap in docs:
        if not getattr(snap, "exists", False):
            print(f"[backfill] WARN: chat_sessions/{args.session_id} does not exist")
            continue
        data = snap.to_dict() or {}
        old = int(data.get("turnCount") or 0)
        sid = snap.id
        if sid in bq_counts:
            new = bq_counts[sid]
        elif args.zero_missing:
            new = 0
        else:
            skipped_no_bq += 1
            continue
        if new != old:
            planned.append((sid, old, new))

    planned.sort(key=lambda r: r[1] - r[2], reverse=True)  # biggest corrections first
    print(f"[backfill] {len(planned)} session(s) need correction; {skipped_no_bq} skipped (no BQ rows, --zero-missing off)")
    for sid, old, new in planned:
        print(f"[backfill]   {sid}  turnCount {old} -> {new}")

    if not planned:
        print("[backfill] nothing to do.")
        return 0
    if not args.commit:
        print("[backfill] DRY-RUN — no writes performed. Re-run with --commit to apply.")
        return 0

    print(f"[backfill] writing {len(planned)} correction(s)...")
    written = 0
    for sid, _old, new in planned:
        col.document(sid).update({"turnCount": new})
        written += 1
    print(f"[backfill] DONE — wrote {written} correction(s). Record this run in "
          "scripts/backfill-session-turncount.NOTES.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
