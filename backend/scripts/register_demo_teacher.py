"""Put the demo class's owner on the access register, so demo turns can run.

WHY THIS EXISTS (2026-09-11)

    ``make verify-chat-logs`` is the repo's end-to-end proof that a chat turn
    reaches BigQuery: join a group, drive a real turn, poll for the row. It
    could not pass on dev or test, and the reason was not the pipeline.

    ``aipla-demo-1`` binds to a class named "Demo class" whose ``ownerUid`` is
    the synthetic ``aipla-demo-teacher``. The student spend gate resolves
    group -> class -> ownerUid and asks whether that owner may spend
    (``auth.spend_authority``). The demo teacher is on no register, so every
    demo turn was refused ``student_owner_not_registered`` before an agent ran.
    No turn, no log, no row — and a failure that looks like a broken pipeline.

    It could not be fixed with ``users grant-access`` either: the register is
    keyed by EMAIL, and ``grant_for_uid`` resolves a uid to an email through
    Firebase. ``aipla-demo-teacher`` is not a Firebase user and has no email, so
    both routes miss. Hence ``grant_access(..., uid=...)``, which stamps the
    denormalised index directly.

WHAT IT DOES
    Resolves the demo code -> its class -> the owning uid, then writes one
    register row keyed by a reserved synthetic address, with that uid stamped.
    Idempotent: an existing row is left alone unless --force.

SAFETY
    * ``visitor`` is NOT enough — the gate refuses it. ``pilot`` with a SMALL
      cap is the point: the demo should be able to run a lesson and should not
      be able to run up a bill. Default $5.
    * The owner is resolved FROM the code, never passed in, so this cannot
      accidentally grant a real teacher.
    * Refuses any class not named exactly "Demo class" — the same name-based
      constraint ``bind_demo_code_to_class.py`` uses, and for the same reason:
      ``aipla-demo-1`` is a publicly known code.
    * Dry run unless --apply, matching the other scripts here.

USAGE
    cd backend && uv run python -m scripts.register_demo_teacher                 # dry run
    cd backend && uv run python -m scripts.register_demo_teacher --apply
    ... --code aipla-demo-1 --cap 5 --force
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("register_demo_teacher")

#: Reserved, unroutable by RFC 2606. The register needs a primary key and this
#: identity has no mailbox; .invalid says so rather than inventing a plausible
#: address someone might later try to contact.
DEMO_EMAIL = "demo-teacher@aipla.invalid"
DEMO_CLASS_NAME = "Demo class"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--code", default="aipla-demo-1", help="demo group code to resolve the owner from")
    ap.add_argument("--cap", type=float, default=5.0, help="monthly cap in USD (default 5)")
    ap.add_argument("--class-name", default=DEMO_CLASS_NAME, help="required class name (deliberately awkward to widen)")
    ap.add_argument("--force", action="store_true", help="re-write an existing row")
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    args = ap.parse_args()

    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or "(unset)"
    log.info("project: %s", project)

    from db.classes import get_class
    from db.firestore import get_document
    from db.teacher_access import get_grant, grant_access, grant_for_uid

    group = get_document("anon_groups", args.code)
    if not group:
        log.error("no such group code: %s", args.code)
        return 1
    class_id = group.get("classId")
    if not class_id:
        log.error("group %s is not bound to a class — run bind_demo_code_to_class.py first", args.code)
        return 1

    cls = get_class(class_id)
    name = getattr(cls, "name", None)
    if name != args.class_name:
        log.error("class %s is named %r, not %r — refusing", class_id, name, args.class_name)
        return 1
    owner_uid = getattr(cls, "owner_uid", None)
    if not owner_uid:
        log.error("class %s has no ownerUid; nothing to register", class_id)
        return 1

    log.info("code %s -> class %s (%r) -> owner uid %s", args.code, class_id, name, owner_uid)

    existing = grant_for_uid(owner_uid)
    if existing is not None and not args.force:
        log.info(
            "owner %s is ALREADY on the register (tier=%s, cap=%s) — nothing to do",
            owner_uid,
            existing.tier,
            existing.monthly_cap_usd,
        )
        return 0

    log.info("would grant: email=%s uid=%s tier=pilot cap=$%.2f", DEMO_EMAIL, owner_uid, args.cap)
    if not args.apply:
        log.info("dry run — pass --apply to write")
        return 0

    grant_access(
        DEMO_EMAIL,
        tier="pilot",
        monthly_cap_usd=args.cap,
        granted_by="register_demo_teacher",
        note=f"Demo class owner for {args.code}. Lets make verify-chat-logs and the smoke scripts run a real turn.",
        uid=owner_uid,
    )
    written = get_grant(DEMO_EMAIL)
    log.info(
        "granted: %s uid=%s tier=%s cap=%s",
        DEMO_EMAIL,
        getattr(written, "uid", None),
        getattr(written, "tier", None),
        getattr(written, "monthly_cap_usd", None),
    )
    if grant_for_uid(owner_uid) is None:
        log.error("WROTE THE ROW BUT grant_for_uid(%s) STILL MISSES — the gate will still refuse", owner_uid)
        return 1
    log.info("grant_for_uid(%s) now resolves — demo turns can spend", owner_uid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
