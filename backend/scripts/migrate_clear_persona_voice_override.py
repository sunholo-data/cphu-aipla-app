"""One-time migration: clear stale per-class voice overrides on classes that
already name a persona.

Background: a persona is a complete identity bundle (avatar + name + voice +
teaching style). The voice chain used to put the legacy "Custom voice (advanced)"
per-class override ABOVE the persona, so a class that set a custom voice before
personas existed kept speaking in that override even after a persona was chosen —
the bug where switching persona changed the avatar but not the spoken voice.

The code fix makes the persona authoritative and clears the override the moment a
persona is picked (``db.classes.update_class_persona``). This script repairs the
existing data: any class that has BOTH a ``persona`` and a ``voice`` override has
its override cleared so the persona's voice takes effect immediately.

Classes with NO persona keep their override — that's the legitimate escape hatch
for classes that have not picked an identity, so they are left untouched.

Idempotent: re-running finds nothing to do once cleared.

Run from ``backend/`` with the TARGET project's ADC (see the make target):
    GOOGLE_CLOUD_PROJECT=aipla-dev-2026 \\
    uv run python scripts/migrate_clear_persona_voice_override.py [--dry-run]
"""

from __future__ import annotations

import argparse
import sys

from db.firestore import get_client, update_document

_COLLECTION = "classes"


def _utcnow_iso() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).isoformat()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List the classes that would be changed without writing.",
    )
    args = parser.parse_args(argv)

    client = get_client()
    cleared = 0
    skipped_no_persona = 0
    skipped_no_override = 0

    for doc in client.collection(_COLLECTION).stream():
        data = doc.to_dict() or {}
        persona = data.get("persona")
        voice = data.get("voice")
        name = data.get("name")

        if not persona:
            skipped_no_override += 1 if voice is None else 0
            skipped_no_persona += 1 if voice is not None else 0
            continue
        if voice is None:
            skipped_no_override += 1
            continue

        # Class has BOTH a persona and a stale override -> clear the override.
        print(f"[migrate] class={doc.id!r} name={name!r} persona={persona!r} clearing voice={voice!r}")
        if not args.dry_run:
            update_document(_COLLECTION, doc.id, {"voice": None, "updatedAt": _utcnow_iso()})
        cleared += 1

    verb = "would clear" if args.dry_run else "cleared"
    print(
        f"[migrate] {verb} {cleared} override(s); "
        f"left {skipped_no_persona} no-persona override(s) as escape hatch; "
        f"{skipped_no_override} class(es) had no override."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
