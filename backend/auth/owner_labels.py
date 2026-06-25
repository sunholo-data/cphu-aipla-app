"""Resolve user uids to friendly display labels (display name or email) via the
Firebase Admin SDK, for the researcher cross-teacher views (1.1.5).

Best-effort by design: any failure — local mode (no real Firebase Auth), an
unknown uid, a Firebase error — leaves that uid unmapped, so the caller falls
back to the raw uid. A label lookup must never break a listing.
"""

from __future__ import annotations

import logging

from config.local_mode import is_local_mode

log = logging.getLogger(__name__)

# firebase_admin.auth.get_users accepts at most 100 identifiers per call.
_BATCH = 100


def resolve_owner_labels(uids: set[str]) -> dict[str, str]:
    """Map each uid to ``display_name or email``; omit any that can't resolve.

    Returns a PARTIAL dict — uids absent from the result should fall back to the
    raw uid at the call site. No-ops in local mode and swallows all errors.
    """
    clean = {u for u in uids if u}
    if not clean or is_local_mode():
        return {}
    try:
        from firebase_admin import auth as fb_auth
    except Exception:  # pragma: no cover - firebase_admin is always present in prod
        return {}

    labels: dict[str, str] = {}
    ids = sorted(clean)
    for start in range(0, len(ids), _BATCH):
        chunk = ids[start : start + _BATCH]
        try:
            result = fb_auth.get_users([fb_auth.UidIdentifier(u) for u in chunk])
        except Exception as exc:  # network / permissions / malformed uid
            log.warning("resolve_owner_labels: get_users failed for %d uids: %s", len(chunk), exc)
            continue
        for record in result.users:
            label = (record.display_name or record.email or "").strip()
            if label:
                labels[record.uid] = label
    return labels
