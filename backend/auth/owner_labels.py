"""Resolve user uids to friendly display labels (display name or email) via the
Firebase Admin SDK, for the researcher cross-teacher views (1.1.5).

Best-effort by design: any failure — local mode (no real Firebase Auth), an
unknown uid, a Firebase error — leaves that uid unmapped, so the caller falls
back to the raw uid. A label lookup must never break a listing.

⚠️ Synchronous network I/O. From an ``async def`` route, call through
``asyncio.to_thread`` — uvicorn runs one worker, and a blocked loop freezes
every student's stream on the instance (CLAUDE.md, "Blocking I/O inside an
``async def`` route").
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from config.local_mode import is_local_mode

log = logging.getLogger(__name__)

# firebase_admin.auth.get_users accepts at most 100 identifiers per call.
_BATCH = 100


def _resolve(uids: set[str], pick: Callable[[Any], str | None], *, what: str) -> dict[str, str]:
    """Batch-read Firebase users and map each uid through ``pick``; partial, never raises."""
    clean = {u for u in uids if u}
    if not clean or is_local_mode():
        return {}
    try:
        from firebase_admin import auth as fb_auth
    except Exception:  # pragma: no cover - firebase_admin is always present in prod
        return {}

    out: dict[str, str] = {}
    ids = sorted(clean)
    for start in range(0, len(ids), _BATCH):
        chunk = ids[start : start + _BATCH]
        try:
            result = fb_auth.get_users([fb_auth.UidIdentifier(u) for u in chunk])
        except Exception as exc:  # network / permissions / malformed uid
            log.warning("%s: get_users failed for %d uids: %s", what, len(chunk), exc)
            continue
        for record in result.users:
            value = (pick(record) or "").strip()
            if value:
                out[record.uid] = value
    return out


def resolve_owner_labels(uids: set[str]) -> dict[str, str]:
    """Map each uid to ``display_name or email``; omit any that can't resolve.

    Returns a PARTIAL dict — uids absent from the result should fall back to the
    raw uid at the call site. No-ops in local mode and swallows all errors.
    """
    return _resolve(uids, lambda r: r.display_name or r.email, what="resolve_owner_labels")


def resolve_owner_emails(uids: set[str]) -> dict[str, str]:
    """Map each uid to its account EMAIL; omit any without one (1.1.150).

    The author line a researcher sees on another person's tutor, approach or
    persona. Email, not display name: it is what identifies a pilot teacher
    unambiguously to the research team. Researchers only — the caller gates it;
    teachers are told researchers see their name against their work
    (``CustomApproachPanel.researchersCanSee``), not each other's.
    """
    return _resolve(uids, lambda r: r.email, what="resolve_owner_emails")
