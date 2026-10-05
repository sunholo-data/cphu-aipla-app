"""Restore the class binding of join codes that an old Revoke hard-deleted (1.1.146 M3).

Design: docs/design/aipla/v1.1.0-feedback/research-access-survives-code-deletion.md

WHY THIS EXISTS

    Until 1.1.146, a teacher's per-code **Revoke** removed the code from
    ``classes/<id>.groupCodes`` and hard-deleted ``anon_groups/<code>`` — the
    only record of the code → class binding. The conversations stayed in
    BigQuery, but every class-anchored review surface (class page, recent
    sessions, insights, progress, the owner's group timeline) lost the group.
    On prod, 2026-09-30, eight codes across three classes went this way and a
    researcher could no longer review those sessions.

    1.1.146 M1 makes Revoke a tombstone, so it cannot recur. This script repairs
    the codes revoked BEFORE that shipped, by writing the tombstone they should
    have got: ``anon_groups/<code>`` = ``{revoked, revokedAt, classId,
    repairedAt, repairSource}`` and the code appended to the class's
    ``groupCodes`` + ``revokedGroupCodes``. The code still does not work —
    a tombstone refuses joins and tokens — it only becomes reviewable again.

DISCOVERY — two witnesses, reported separately

    bq   BigQuery chat turns carrying a ``class_id`` whose ``group_id`` is on no
         class roster (``class_id`` is stamped only since 2026-09-11).
    log  Cloud Logging lines ``classes_route: revoked code=<c> class=<id> …``
         (within the log retention window). Independent of ``class_id``, so it
         also attributes a code whose turns all predate 2026-09-11.
    m0   On prod only: the M0 table read from those same log lines on
         2026-10-05 (``M0_PROD_EXPECTED``). The _Default log bucket keeps 30
         days, so after ~2026-10-30 the log witness for the 30 Sept revokes is
         gone; the recorded evidence keeps the repair runnable.

    A code found ONLY as unattributed turns (``class_id`` NULL, binding
    document gone, no log line) is LISTED, NEVER WRITTEN: attributing it to a
    class needs the log witness or M's decision.

SAFETY

    * Dry run by default — prints the table and every write it would make.
      ``--go`` writes.
    * ``--env prod`` without ``--class`` is refused unless ``--force``.
    * Refuses a code whose ``anon_groups`` document is bound to a DIFFERENT
      class (reported, never overwritten), and skips one that is still live.
    * Idempotent: a second run reports "already repaired" and writes nothing.
    * Never deletes anything. This is not erasure (1.1.80).

USAGE
    make repair-revoked-codes ENV=prod CLASS=0be138dda057          # dry run
    make repair-revoked-codes ENV=prod CLASS=0be138dda057 GO=1
    make repair-revoked-codes ENV=prod FORCE=1                     # every class
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("repair_revoked_group_codes")

ENV_PROJECTS = {
    "dev": "aipla-dev-2026",
    "test": "aipla-test-2026",
    "prod": "aipla-prod-2026",
}

#: The M0 evidence, read from prod on 2026-10-05 (the doc's "M0 results"
#: table). On prod the dry run is checked against it, so a discovery that
#: finds fewer or more codes than the evidence says out loud.
M0_PROD_EXPECTED: dict[str, str] = {
    "busy-garden-11": "0be138dda057",
    "tidy-boulder-05": "0be138dda057",
    "huge-seed-10": "0be138dda057",
    "late-guppy-49": "0be138dda057",
    "nimble-button-13": "399b198bbe21",
    "salty-brook-09": "399b198bbe21",
    "happy-leaf-26": "399b198bbe21",
    "leafy-thicket-13": "59ad12cd997b",
}

_REVOKE_LINE = re.compile(r"classes_route: revoked code=(?P<code>\S+) class=(?P<cls>\S+)")


# ─── Data ───────────────────────────────────────────────────────────────────


@dataclass
class Candidate:
    """One orphaned ``(class_id, code)`` and what witnessed it."""

    code: str
    class_id: str | None
    sources: set[str] = field(default_factory=set)  # {"bq", "log", "m0"}
    revoked_at: str | None = None  # from the log line, when there is one
    sessions: int = 0
    turns: int = 0
    unattributed_turns: int = 0
    first_ts: str | None = None


@dataclass
class Outcome:
    code: str
    class_id: str | None
    action: str  # "write" | "already" | "conflict" | "live" | "no-class" | "list-only"
    detail: str = ""


# ─── Discovery (pure) ───────────────────────────────────────────────────────


def discover(
    *,
    bq_pairs: Iterable[dict[str, Any]],
    log_revokes: Iterable[dict[str, Any]],
    unattributed: Iterable[dict[str, Any]],
    rosters: dict[str, set[str]],
    revoked_rosters: dict[str, set[str]],
    seed_pairs: Iterable[dict[str, Any]] = (),
    class_filter: str | None = None,
) -> tuple[list[Candidate], list[Candidate]]:
    """Merge the witnesses into ``(writable, list_only)``.

    ``bq_pairs``      rows ``{class_id, group_id, sessions, turns, first_ts}``
    ``log_revokes``   rows ``{code, class_id, ts}``
    ``unattributed``  rows ``{group_id, unattributed_turns, sessions, first_ts,
                      binding_missing}`` — turns with ``class_id`` NULL
    ``rosters``       ``{class_id: set(groupCodes)}`` for EVERY class
    ``revoked_rosters`` ``{class_id: set(revokedGroupCodes)}``
    ``seed_pairs``    rows ``{code, class_id}`` from recorded evidence (the M0
                      table, source ``m0``) — so the repair does not depend on
                      Cloud Logging's 30-day retention outliving the incident

    A code on some roster is not orphaned, UNLESS it was found by the log
    witness and its roster entry lacks the revoked mark (half-repaired) — then
    it is still a candidate, and ``apply`` finishes the job idempotently.
    """
    on_any_roster = {c for codes in rosters.values() for c in codes}
    by_code: dict[str, Candidate] = {}

    def _take(code: str, class_id: str | None) -> Candidate:
        cand = by_code.get(code)
        if cand is None:
            cand = by_code[code] = Candidate(code=code, class_id=class_id)
        elif cand.class_id is None and class_id:
            cand.class_id = class_id
        return cand

    def _already_tombstoned(code: str, class_id: str) -> bool:
        return code in revoked_rosters.get(class_id, set()) and code in rosters.get(class_id, set())

    for row in seed_pairs:
        if not _already_tombstoned(row["code"], row["class_id"]):
            _take(row["code"], row["class_id"]).sources.add("m0")

    for row in log_revokes:
        code, class_id = row["code"], row["class_id"]
        if _already_tombstoned(code, class_id):
            continue  # revoked AFTER 1.1.146 shipped, or already repaired
        cand = _take(code, class_id)
        cand.sources.add("log")
        ts = row.get("ts")
        if ts and (cand.revoked_at is None or ts > cand.revoked_at):
            cand.revoked_at = ts  # the LAST revoke is the one that stuck

    for row in bq_pairs:
        code, class_id = row["group_id"], row["class_id"]
        if not code or not class_id or code in on_any_roster:
            continue
        cand = _take(code, class_id)
        cand.sources.add("bq")
        cand.sessions = max(cand.sessions, int(row.get("sessions") or 0))
        cand.turns += int(row.get("turns") or 0)
        cand.first_ts = _min_ts(cand.first_ts, row.get("first_ts"))

    list_only: list[Candidate] = []
    for row in unattributed:
        code = row["group_id"]
        if not code:
            continue
        if code in by_code:
            cand = by_code[code]
            cand.unattributed_turns = int(row.get("unattributed_turns") or 0)
            cand.first_ts = _min_ts(cand.first_ts, row.get("first_ts"))
            continue
        if code in on_any_roster or not row.get("binding_missing"):
            continue  # a legacy unbound code still HAS its document; not ours
        list_only.append(
            Candidate(
                code=code,
                class_id=None,
                unattributed_turns=int(row.get("unattributed_turns") or 0),
                sessions=int(row.get("sessions") or 0),
                first_ts=row.get("first_ts"),
            )
        )

    writable = sorted(by_code.values(), key=lambda c: (c.class_id or "", c.code))
    if class_filter:
        writable = [c for c in writable if c.class_id == class_filter]
    return writable, sorted(list_only, key=lambda c: c.code)


def _min_ts(a: Any, b: Any) -> str | None:
    vals = [str(v) for v in (a, b) if v]
    return min(vals) if vals else None


# ─── Apply ──────────────────────────────────────────────────────────────────


def apply(candidates: Iterable[Candidate], *, go: bool, now: Callable[[], datetime] | None = None) -> list[Outcome]:
    """Plan (and with ``go``, write) the tombstone for each candidate."""
    from db.classes import get_class
    from db.firestore import get_document, set_document, update_document

    stamp = (now or (lambda: datetime.now(UTC)))().isoformat()
    outcomes: list[Outcome] = []
    for cand in candidates:
        if not cand.class_id:
            outcomes.append(Outcome(cand.code, None, "list-only", "no class witnessed"))
            continue
        cls = get_class(cand.class_id)
        if cls is None:
            outcomes.append(Outcome(cand.code, cand.class_id, "no-class", "class document not found"))
            continue
        anon = get_document("anon_groups", cand.code)
        bound = (anon or {}).get("classId")
        if bound and bound != cand.class_id:
            outcomes.append(
                Outcome(cand.code, cand.class_id, "conflict", f"anon_groups is bound to {bound}; not overwritten")
            )
            continue
        if anon is not None and not anon.get("revoked"):
            outcomes.append(Outcome(cand.code, cand.class_id, "live", "binding exists and is not revoked; skipped"))
            continue

        on_roster = cand.code in cls.group_codes
        marked = cand.code in cls.revoked_group_codes
        if anon is not None and bound == cand.class_id and on_roster and marked:
            outcomes.append(Outcome(cand.code, cand.class_id, "already", "tombstone and roster in place"))
            continue

        source = next(s for s in ("log", "bq", "m0") if s in cand.sources)
        revoked_at = (anon or {}).get("revokedAt") or cand.revoked_at
        tombstone: dict[str, Any] = {
            "revoked": True,
            "classId": cand.class_id,
            "repairedAt": stamp,
            "repairSource": source,
        }
        if revoked_at:
            tombstone["revokedAt"] = revoked_at
        roster_patch: dict[str, Any] = {
            "groupCodes": cls.group_codes if on_roster else [*cls.group_codes, cand.code],
            "revokedGroupCodes": cls.revoked_group_codes if marked else [*cls.revoked_group_codes, cand.code],
            "updatedAt": stamp,
        }
        if revoked_at and cand.code not in cls.revoked_group_codes_at:
            roster_patch["revokedGroupCodesAt"] = {**cls.revoked_group_codes_at, cand.code: revoked_at}
        detail = f"source={source} revokedAt={revoked_at or '-'}"
        if go:
            set_document("anon_groups", cand.code, tombstone, merge=True)
            update_document("classes", cand.class_id, roster_patch)
        outcomes.append(Outcome(cand.code, cand.class_id, "write", detail))
    return outcomes


# ─── Readers (prod-facing; not exercised by unit tests) ─────────────────────


def fetch_bq_pairs() -> list[dict[str, Any]]:
    from analytics.research_logs import _STUDENT_ONLY, _turns_cte
    from db.bigquery import run_query

    sql = f"""
      WITH turns AS ({_turns_cte()})
      SELECT class_id, group_id,
             COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS turns,
             CAST(MIN(ts) AS STRING) AS first_ts
      FROM turns
      WHERE class_id IS NOT NULL AND group_id IS NOT NULL AND {_STUDENT_ONLY}
      GROUP BY class_id, group_id
    """
    return [dict(r) for r in run_query(sql)]


def fetch_unattributed(known_rosters: set[str]) -> list[dict[str, Any]]:
    """Codes with turns whose ``class_id`` is NULL — and whether their binding
    document is gone (the signature of the old hard-delete)."""
    from analytics.research_logs import _STUDENT_ONLY, _turns_cte
    from db.bigquery import run_query
    from db.firestore import get_document

    sql = f"""
      WITH turns AS ({_turns_cte()})
      SELECT group_id, COUNTIF(class_id IS NULL) AS unattributed_turns,
             COUNT(DISTINCT session_id) AS sessions, CAST(MIN(ts) AS STRING) AS first_ts
      FROM turns
      WHERE group_id IS NOT NULL AND {_STUDENT_ONLY}
      GROUP BY group_id
      HAVING unattributed_turns > 0
    """
    rows = [dict(r) for r in run_query(sql)]
    for row in rows:
        code = row["group_id"]
        row["binding_missing"] = (
            code not in known_rosters and "/" not in code and get_document("anon_groups", code) is None
        )
    return rows


def fetch_log_revokes(project: str, freshness_days: int) -> list[dict[str, Any]]:
    from datetime import timedelta

    from google.cloud import logging as gcl

    since = (datetime.now(UTC) - timedelta(days=freshness_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    client = gcl.Client(project=project)
    flt = f'textPayload:"classes_route: revoked code=" AND timestamp>="{since}"'
    out: list[dict[str, Any]] = []
    for entry in client.list_entries(filter_=flt, order_by=gcl.ASCENDING, page_size=500):
        payload = entry.payload if isinstance(entry.payload, str) else str(entry.payload)
        m = _REVOKE_LINE.search(payload)
        if m:
            ts = entry.timestamp.isoformat() if entry.timestamp else None
            out.append({"code": m.group("code"), "class_id": m.group("cls"), "ts": ts})
    return out


def read_rosters() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    from db.classes import list_all_classes

    classes = list_all_classes(include_revoked=True)
    return (
        {c.class_id: set(c.group_codes) for c in classes},
        {c.class_id: set(c.revoked_group_codes) for c in classes},
    )


# ─── Report ─────────────────────────────────────────────────────────────────


def _print_table(writable: list[Candidate], list_only: list[Candidate], outcomes: list[Outcome], go: bool) -> None:
    by_code = {o.code: o for o in outcomes}
    log.info(
        "%-20s %-14s %-8s %8s %7s %6s  %-26s %s",
        "code",
        "class",
        "witness",
        "sessions",
        "turns",
        "pre911",
        "revoked_at",
        "action",
    )
    for c in writable:
        o = by_code.get(c.code)
        log.info(
            "%-20s %-14s %-8s %8d %7d %6d  %-26s %s",
            c.code,
            c.class_id or "-",
            "+".join(sorted(c.sources)) or "-",
            c.sessions,
            c.turns,
            c.unattributed_turns,
            c.revoked_at or "-",
            f"{o.action}: {o.detail}" if o else "-",
        )
    if list_only:
        log.info("")
        log.info("LISTED, NOT WRITTEN — turns with no class_id, binding gone, no log witness (needs M's decision):")
        for c in list_only:
            log.info(
                "  %-20s sessions=%d unattributed_turns=%d first=%s",
                c.code,
                c.sessions,
                c.unattributed_turns,
                c.first_ts or "-",
            )
    n_write = sum(o.action == "write" for o in outcomes)
    log.info("")
    log.info(
        "%s %d tombstone(s); %d already repaired; %d refused (conflict/live/no-class).",
        "WROTE" if go else "WOULD WRITE",
        n_write,
        sum(o.action == "already" for o in outcomes),
        sum(o.action in ("conflict", "live", "no-class") for o in outcomes),
    )
    if not go and n_write:
        log.info("Dry run — re-run with GO=1 to write.")


def check_against_m0(writable: list[Candidate], class_filter: str | None) -> list[str]:
    """Differences between what the LIVE witnesses (bq, log) found today and the
    prod M0 evidence. Informational: the M0 rows are repaired either way."""
    expected = {k: v for k, v in M0_PROD_EXPECTED.items() if class_filter in (None, v)}
    found = {c.code: c.class_id for c in writable if c.sources - {"m0"}}
    problems = [
        f"M0 code not re-witnessed by bq/log today (repaired from the M0 record): {code} (class {cls})"
        for code, cls in expected.items()
        if code not in found
    ]
    problems += [
        f"M0 code attributed to {found[code]}, evidence says {cls}"
        for code, cls in expected.items()
        if code in found and found[code] != cls
    ]
    problems += [
        f"discovered but not in M0 evidence: {code} (class {found[code]})" for code in found if code not in expected
    ]
    return problems


# ─── CLI ────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env", required=True, choices=sorted(ENV_PROJECTS))
    parser.add_argument("--class", dest="class_id", default=None, help="repair one class only")
    parser.add_argument("--go", action="store_true", help="write (default: dry run)")
    parser.add_argument("--force", action="store_true", help="allow --env prod without --class")
    parser.add_argument("--log-days", type=int, default=30, help="Cloud Logging look-back (default 30)")
    args = parser.parse_args(argv)

    if args.env == "prod" and not args.class_id and not args.force:
        log.error("refused: --env prod without --class repairs every class; pass --force (FORCE=1) to mean it.")
        return 2

    project = ENV_PROJECTS[args.env]
    # Bind every client (Firestore, BigQuery, Logging) to the chosen env BEFORE
    # any db module resolves a project. A stale GOOGLE_CLOUD_PROJECT in the shell
    # must not point a prod run at dev, or the reverse.
    os.environ["GOOGLE_CLOUD_PROJECT"] = project
    log.info(
        "env: %s  project: %s  class: %s  mode: %s",
        args.env,
        project,
        args.class_id or "ALL",
        "GO" if args.go else "dry run",
    )

    rosters, revoked_rosters = read_rosters()
    known = {c for codes in rosters.values() for c in codes}
    bq_pairs = fetch_bq_pairs()
    log_revokes = fetch_log_revokes(project, args.log_days)
    unattributed = fetch_unattributed(known)
    log.info(
        "witnesses: %d bq class-by-group pairs, %d revoke log lines, %d codes with unattributed turns",
        len(bq_pairs),
        len(log_revokes),
        len(unattributed),
    )
    log.info("")

    writable, list_only = discover(
        bq_pairs=bq_pairs,
        log_revokes=log_revokes,
        unattributed=unattributed,
        rosters=rosters,
        revoked_rosters=revoked_rosters,
        seed_pairs=[{"code": k, "class_id": v} for k, v in M0_PROD_EXPECTED.items()] if args.env == "prod" else [],
        class_filter=args.class_id,
    )
    outcomes = apply(writable, go=args.go)
    _print_table(writable, list_only, outcomes, args.go)

    if args.env == "prod":
        problems = check_against_m0(writable, args.class_id)
        log.info("")
        if problems:
            log.warning("Discovery differs from the M0 evidence (2026-10-05) — check before GO=1:")
            for p in problems:
                log.warning("  %s", p)
        else:
            log.info("Discovery matches the M0 evidence exactly.")

    return 1 if any(o.action == "conflict" for o in outcomes) else 0


if __name__ == "__main__":
    sys.exit(main())
