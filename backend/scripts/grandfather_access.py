"""Grandfather every EXISTING teacher onto the access register (ACCESS-1 M1).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

WHY THIS EXISTS — read before deploying M1 to any environment with real users.

    ACCESS-1 makes ``visitor`` the default for every Firebase identity. That is
    the correct posture for a public domain, and it is also a breaking change
    for everyone already using the product: on the deploy that ships M1, every
    existing teacher becomes a visitor and their classes stop being able to
    reach a live model.

    The risk ACCESS-1 addresses is NEW uninvited signups. It is not the people
    who are already teaching with this. So the safe rollout is to grandfather:
    anyone who already owns a class was, by definition, using the platform
    before the register existed, and should keep working.

    Run this ONCE per environment, in the same change window as the M1 deploy.

WHAT IT DOES
    Finds every distinct ``ownerUid`` across the ``classes`` collection,
    resolves each to a Firebase email, and writes a ``pilot`` grant noting that
    it was grandfathered and when. Idempotent: an owner already on the register
    is left exactly as-is, so re-running never overwrites a deliberate cap,
    expiry, or revocation.

USAGE
    cd backend && uv run python -m scripts.grandfather_access            # dry run
    cd backend && uv run python -m scripts.grandfather_access --apply
    ... --cap 50 --expires 2027-09-15T00:00:00Z

    Dry run by default, matching backend/scripts/setup_demo.py.
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import UTC, datetime

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("grandfather_access")

#: Default expiry stamped on a grandfathered grant. An access register that
#: outlives the engagement is a liability, so the failure mode of forgetting to
#: clean up is "access lapses".
#:
#: This tracks the ENGAGEMENT, not the original 4-month contract. The extension
#: awarded 2026-08 runs to at least April 2027, and the prod register was
#: re-stamped to 2027-09-15 on 2026-08-17 (end of the 2026/27 Danish school
#: year) — so that is the boundary. It was 2026-09-15 until 2026-08-27, which
#: would have lapsed every grandfathered pilot teacher mid-September.
DEFAULT_EXPIRES_AT = "2027-09-15T00:00:00+00:00"


def _owner_class_counts() -> dict[str, int]:
    """Every uid that owns at least one class -> how many they own.

    The count is what makes a row verifiable at a glance: one class named
    "Demo class" is probably a stray sign-in, five named after real cohorts is a
    teacher you must not turn into a visitor.
    """
    from db.firestore import query_documents

    counts: dict[str, int] = {}
    for doc in query_documents("classes", limit=5000):
        owner = doc.get("ownerUid")
        if owner:
            counts[str(owner)] = counts.get(str(owner), 0) + 1
    return counts


def _class_names_for(owner_uid: str) -> list[str]:
    """The class names this owner has, for the verification listing."""
    from db.firestore import query_documents

    docs = query_documents("classes", filters=[("ownerUid", "==", owner_uid)], limit=50)
    return [str(d.get("name") or "(unnamed)") for d in docs]


def _ensure_firebase() -> None:
    """Initialise firebase-admin once, from ADC.

    Needed because ``_email_for_uid`` calls ``fb_auth.get_user`` — the script
    runs outside the FastAPI app, which is where ``initialize_app()`` normally
    happens.
    """
    import firebase_admin

    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app()


def _email_for_uid(uid: str) -> str | None:
    """Resolve a Firebase uid to its email, or ``None`` if unresolvable.

    An owner with no Firebase account (a deleted user, or a synthetic uid like
    the demo teacher) cannot be put on an email-keyed register. Those are
    reported and skipped rather than guessed at.
    """
    from firebase_admin import auth as fb_auth

    try:
        return fb_auth.get_user(uid).email or None
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the grants (default: dry run)")
    parser.add_argument(
        "--uncapped",
        action="store_true",
        help="Grandfather with NO per-teacher limit. Explicit on purpose; prints a warning.",
    )
    parser.add_argument(
        "--cap",
        type=float,
        default=None,
        help=(
            "monthly cap in USD. Defaults to the register default, NOT uncapped — an uncapped "
            "teacher is bounded only by the SHARED project quota and can starve every other "
            "teacher on it. The enforcer warns at 80%% before it blocks, and raising a cap is "
            "one command, so start here and adjust once you have watched real usage."
        ),
    )
    parser.add_argument(
        "--expires",
        default=DEFAULT_EXPIRES_AT,
        help=f"ISO-8601 expiry for every grandfathered grant (default: {DEFAULT_EXPIRES_AT}); pass 'never' to omit",
    )
    args = parser.parse_args(argv)

    from config.gcp import require_gcp_project
    from db.teacher_access import DEFAULT_MONTHLY_CAP_USD, UNCAPPED, get_grant, grant_access

    project = require_gcp_project()
    _ensure_firebase()
    log.info("Project: %s", project)
    log.info("")

    # No uncapped default, anywhere (M, 2026-08-12). Uncapped is opt-in only.
    if args.uncapped:
        cap = UNCAPPED
    elif args.cap is not None:
        cap = args.cap
    else:
        cap = DEFAULT_MONTHLY_CAP_USD
    expires_at = None if args.expires == "never" else args.expires
    note = f"grandfathered at ACCESS-1 rollout {datetime.now(UTC).date().isoformat()}"

    class_counts = _owner_class_counts()
    owners = sorted(class_counts)
    log.info("Found %d distinct class owner(s).", len(owners))
    if not owners:
        log.info("Nothing to grandfather.")
        return 0

    would_grant: list[tuple[str, str]] = []
    already: list[str] = []
    unresolved: list[str] = []

    for uid in owners:
        email = _email_for_uid(uid)
        if not email:
            unresolved.append(uid)
            continue
        if get_grant(email) is not None:
            already.append(email)
            continue
        would_grant.append((uid, email))

    log.info("")
    log.info("%-38s %-7s %s", "EMAIL", "CLASSES", "CLASS NAMES")
    for uid, email in would_grant:
        names = _class_names_for(uid)
        log.info("%-38s %-7d %s", email, class_counts.get(uid, 0), ", ".join(names[:4]))
    log.info("")

    for uid, email in would_grant:
        if args.apply:
            grant_access(
                email,
                tier="pilot",
                monthly_cap_usd=cap,
                granted_by="grandfather_access",
                expires_at=expires_at,
                note=note,
            )
            log.info("  GRANTED  %-40s (uid=%s)", email, uid)
        else:
            log.info("  would grant  %-40s (uid=%s)", email, uid)

    for email in already:
        log.info("  skip (already on the register)  %s", email)
    for uid in unresolved:
        log.warning("  UNRESOLVED uid=%s — no Firebase email; NOT granted, check manually", uid)

    log.info("")
    log.info(
        "%s %d grant(s) at cap=%s; %d already registered; %d unresolved.",
        "Wrote" if args.apply else "Would write",
        len(would_grant),
        "UNCAPPED" if cap == UNCAPPED else f"${cap:.2f}/month",
        len(already),
        len(unresolved),
    )
    if cap == UNCAPPED and would_grant:
        log.warning("")
        log.warning(
            "These grants are UNCAPPED. They are bounded only by the SHARED project quota, "
            "so one runaway class can starve every other teacher. Set real caps as soon as "
            "you can: aiplatform users grant-access <email> --cap N"
        )
    elif would_grant:
        log.info("")
        log.info(
            "Capped at $%.2f/month each. The enforcer warns at 80%% before it blocks, and "
            "raising a cap is one command — so start here and adjust once you have watched "
            "real usage.",
            cap,
        )
    if not args.apply:
        log.info("Dry run — re-run with --apply to write.")
    if unresolved:
        log.warning("")
        log.warning(
            "%d owner(s) could not be resolved to an email. Their classes will "
            "keep working via the legacy fail-open in auth/spend_authority.py, "
            "but they are NOT capped. Resolve them before relying on caps.",
            len(unresolved),
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
