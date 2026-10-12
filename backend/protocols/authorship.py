"""Who made this row, as the VIEWER is allowed to see it (1.1.150 M1/M2).

One helper for the three authored lists — tutors, custom approaches, custom
personas — so the "is this mine?" rule exists once, server-side, like
``canEdit`` beside it.

**``isOwn`` is not ``canEdit``.** A researcher may edit every authored row, by
design (``may_edit``), and the UI used to read ``canEdit`` as "mine": on
2026-10-05 a pilot teacher's private approach "Didaktisk Tutor" sat under a
researcher's **"Dine" / "Yours"** heading with no author shown, and nobody in the
room could say where it came from. ``canEdit`` answers *may I change it*;
``isOwn`` answers *did I make it*. The UI groups on the second.

**The author's email is researcher-only.** M, 2026-10-05: *"we should be
labelling who is making the tutor for researchers."* Teachers are told
researchers see their name against their work; they are not told other teachers
do, so a teacher's response never carries an ``authorEmail`` key at all — not
an empty one.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable

from auth.firebase_auth import User
from auth.owner_labels import resolve_owner_emails


async def author_emails_for(viewer: User | None, author_uids: Iterable[str | None]) -> dict[str, str]:
    """``uid -> email`` for the authors in a list — empty unless ``viewer`` is a researcher.

    Off the event loop: the Firebase lookup is synchronous network I/O.
    """
    if viewer is None or not viewer.is_researcher:
        return {}
    uids = {u for u in author_uids if u}
    if not uids:
        return {}
    return await asyncio.to_thread(resolve_owner_emails, uids)


def authorship_fields(author_uid: str | None, viewer: User | None, emails: dict[str, str] | None = None) -> dict:
    """The per-row authorship the viewer may see: ``isOwn`` always, ``authorEmail`` for researchers."""
    out: dict = {"isOwn": bool(viewer is not None and author_uid and author_uid == viewer.uid)}
    if viewer is not None and viewer.is_researcher:
        out["authorEmail"] = (emails or {}).get(author_uid) if author_uid else None
    return out


__all__ = ["author_emails_for", "authorship_fields"]
