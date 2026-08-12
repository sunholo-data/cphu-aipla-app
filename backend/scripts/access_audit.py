"""Produce a sign-off sheet for the access register (ACCESS-1).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

`grandfather_access.py` decides what to WRITE. This decides what to ASK, and it
exists because the two questions are different: a list of uids nobody can check
is not something a colleague can sign off on.

For every account that owns a class in this environment it reports the things a
human actually needs to make the call:

  * how many classes, and what they are named — one auto-seeded "Demo class" is
    a drive-by; five named after real cohorts is a teacher you must not turn
    into a visitor;
  * whether they ever came BACK. Firebase records created / last-sign-in
    separately, and when the two are the same instant the account signed in once
    and never returned;
  * whether any student ever joined their code, which is the difference between
    "a teacher" and "someone who clicked through the onboarding";
  * their current researcher claim, so the researcher roster gets confirmed in
    the same pass rather than in a second one nobody schedules.

Read-only. Writes nothing, anywhere.

USAGE
    cd backend
    GOOGLE_CLOUD_PROJECT=aipla-dev-2026 uv run python -m scripts.access_audit
    ... --format markdown        # a table to paste into a sign-off request
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import UTC, datetime

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("access_audit")


def _ensure_firebase() -> None:
    import firebase_admin

    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app()


def _iso(ms: int | None) -> str:
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat(timespec="seconds") if ms else "-"


def _ago(last_sign_in: str, days: int | None) -> str:
    """Render last-sign-in for the table. A synthetic uid (the demo teacher) has
    no Firebase record at all, which is a meaningful answer, not a gap."""
    if last_sign_in == "-" or days is None:
        return "never (no Firebase account)"
    return f"{last_sign_in[:10]} ({days}d ago)"


def _days_since(ms: int | None) -> int | None:
    if not ms:
        return None
    return (datetime.now(UTC) - datetime.fromtimestamp(ms / 1000, UTC)).days


def collect() -> list[dict]:
    """One row per class-owning account in this project."""
    from firebase_admin import auth as fb_auth

    from db.firestore import query_documents

    classes = query_documents("classes", limit=5000)
    by_owner: dict[str, list[dict]] = {}
    for c in classes:
        owner = c.get("ownerUid")
        if owner:
            by_owner.setdefault(str(owner), []).append(c)

    # Which codes ever saw a real student join.
    joined_codes = {str(s.get("group_id")) for s in query_documents("group_sessions", limit=2000) if s.get("group_id")}

    rows: list[dict] = []
    for uid, owned in sorted(by_owner.items()):
        try:
            user = fb_auth.get_user(uid)
            email = user.email or ""
            claims = user.custom_claims or {}
            created_ms = user.user_metadata.creation_timestamp
            last_ms = user.user_metadata.last_sign_in_timestamp
        except Exception:
            email, claims, created_ms, last_ms = "", {}, None, None

        codes: list[str] = []
        for c in owned:
            for g in query_documents("anon_groups", filters=[("classId", "==", c.get("__id"))], limit=20):
                codes.append(str(g.get("__id")))

        names = [str(c.get("name") or "(unnamed)") for c in owned]
        # "Only the auto-seeded demo class, and never came back" is the shape of
        # someone who clicked through onboarding once.
        only_demo = all(n == "Demo class" for n in names)
        returned = bool(created_ms and last_ms and abs(last_ms - created_ms) > 60_000)
        used = any(code in joined_codes for code in codes)

        if used or not only_demo:
            verdict = "GRANT"
            why = "real classes" if not only_demo else "students joined their code"
        elif returned:
            verdict = "ASK"
            why = "demo class only, but signed in more than once"
        else:
            verdict = "SKIP"
            why = "signed in once, demo class only, nobody ever joined"

        rows.append(
            {
                "email": email or f"(no email: {uid})",
                "uid": uid,
                "classes": len(owned),
                "names": names,
                "created": _iso(created_ms),
                "last_sign_in": _iso(last_ms),
                "days_idle": _days_since(last_ms),
                "returned": returned,
                "students_joined": used,
                "researcher": claims.get("role") == "researcher",
                "access_tier": claims.get("accessTier", "(none)"),
                "verdict": verdict,
                "why": why,
            }
        )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--format", choices=["text", "markdown"], default="text")
    args = parser.parse_args(argv)

    from config.gcp import require_gcp_project

    project = require_gcp_project()
    _ensure_firebase()
    rows = collect()

    order = {"GRANT": 0, "ASK": 1, "SKIP": 2}
    rows.sort(key=lambda r: (order[r["verdict"]], -r["classes"], r["email"]))

    if args.format == "markdown":
        print(f"### {project}\n")
        print("| Verdict | Email | Classes | Class names | Last sign-in | Returned? | Students joined? | Researcher |")
        print("|---|---|---|---|---|---|---|---|")
        for r in rows:
            names = ", ".join(r["names"][:3]) + ("…" if len(r["names"]) > 3 else "")
            print(
                f"| **{r['verdict']}** | `{r['email']}` | {r['classes']} | {names} | "
                f"{_ago(r['last_sign_in'], r['days_idle'])} | "
                f"{'yes' if r['returned'] else 'NO'} | {'yes' if r['students_joined'] else 'no'} | "
                f"{'YES' if r['researcher'] else '-'} |"
            )
    else:
        print(f"=== {project} — {len(rows)} class-owning account(s) ===\n")
        for r in rows:
            print(f"{r['verdict']:6} {r['email']}")
            print(f"       classes={r['classes']} ({', '.join(r['names'][:4])})")
            print(f"       created={r['created']}  last_sign_in={r['last_sign_in']} ({r['days_idle']}d ago)")
            print(
                f"       returned={r['returned']}  students_joined={r['students_joined']}  "
                f"researcher={r['researcher']}  accessTier={r['access_tier']}"
            )
            print(f"       -> {r['why']}")
            print()

    counts = {v: sum(1 for r in rows if r["verdict"] == v) for v in ("GRANT", "ASK", "SKIP")}
    print(f"\nGRANT {counts['GRANT']}   ASK {counts['ASK']}   SKIP {counts['SKIP']}")
    researchers = [r["email"] for r in rows if r["researcher"]]
    print(f"Researcher claim held by {len(researchers)}: {', '.join(researchers) or '(none)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
