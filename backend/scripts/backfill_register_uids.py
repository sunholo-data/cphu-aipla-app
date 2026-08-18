"""Stamp the Firebase uid onto every access-register row that is missing one.

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

WHY THIS EXISTS

    The register is keyed by EMAIL — that is what lets someone be invited before
    they have ever signed in. Both spend gates, though, arrive holding a UID: a
    teacher's own turn carries ``teacher:{uid}``, and a student's resolves
    group -> class -> ownerUid. They join the two through the denormalised
    ``uid`` field on the row.

    That field was only ever written when a teacher's tier CHANGED at bootstrap.
    A teacher granted while already signed in has their claim pushed by the admin
    route, so their tier never drifts, so their uid was never recorded. On
    2026-08-18, 17 of 18 rows in prod had ``uid: null`` — and both gates read a
    missing row as "no cap", so the entire per-teacher ceiling was inert.

    ``db.teacher_access.grant_for_uid`` now self-heals on the read path, and both
    the admin grant and the bootstrap stamp eagerly. This script is the third
    leg: it fills the rows NOW rather than on each teacher's next turn, so a
    human reading ``users list-access`` sees the true state.

    Safe to re-run. It never overwrites a uid that is already set, and never
    changes tier, cap, expiry or revocation.

USAGE
    cd backend && uv run python -m scripts.backfill_register_uids            # dry run
    cd backend && uv run python -m scripts.backfill_register_uids --apply

    Dry run by default, matching scripts/grandfather_access.py.
"""

from __future__ import annotations

import argparse
import logging

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("backfill_register_uids")


def _init_firebase() -> None:
    """Needed because ``fb_auth.get_user_by_email`` requires an initialised app."""
    import firebase_admin

    try:
        firebase_admin.initialize_app()
    except ValueError:
        pass  # already initialised


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the stamps (default: dry run)")
    args = parser.parse_args(argv)

    from firebase_admin import auth as fb_auth

    from config.gcp import require_gcp_project
    from db.teacher_access import list_grants, stamp_uid

    project = require_gcp_project()
    _init_firebase()

    # include_revoked: a revoked row still needs its uid, because that is how the
    # gate LEARNS it is revoked. An unstamped revocation is invisible to the
    # student path, which is the failure mode with teeth.
    grants = list_grants(include_revoked=True)
    missing = [g for g in grants if not g.uid]

    log.info("project: %s", project)
    log.info("register: %d row(s), %d missing a uid", len(grants), len(missing))
    log.info("")

    stamped, never_signed_in, failed = 0, [], []
    for grant in missing:
        try:
            uid = fb_auth.get_user_by_email(grant.email).uid
        except fb_auth.UserNotFoundError:
            # Invited, never signed in. Correct and expected — there is no uid to
            # record yet, and the bootstrap will stamp it on their first app load.
            never_signed_in.append(grant.email)
            continue
        except Exception as exc:
            failed.append((grant.email, str(exc)))
            continue

        if args.apply:
            try:
                stamp_uid(grant.email, uid)
            except Exception as exc:
                failed.append((grant.email, str(exc)))
                continue
            log.info("  STAMPED      %-42s uid=%s", grant.email, uid)
        else:
            log.info("  would stamp  %-42s uid=%s", grant.email, uid)
        stamped += 1

    for email in never_signed_in:
        log.info("  skip (no Firebase account yet)  %s", email)
    for email, err in failed:
        log.warning("  FAILED  %-42s %s", email, err)

    log.info("")
    log.info(
        "%s %d uid(s); %d invited-but-never-signed-in; %d failed.",
        "Stamped" if args.apply else "Would stamp",
        stamped,
        len(never_signed_in),
        len(failed),
    )
    if not args.apply and stamped:
        log.info("Dry run — re-run with --apply to write.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
