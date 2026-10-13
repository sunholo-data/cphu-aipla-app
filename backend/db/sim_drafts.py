"""Sim drafts a teacher builds with the ``sim-author`` skill (in-app-sim-authoring M4).

One draft per authoring conversation, owned by the teacher who started it, and
one VERSION per checked submission: every time the skill calls ``verify_sim``,
the two files, the verdict and two screenshots are kept, so the teacher can
look back, compare and download any version. Nothing here publishes: a draft
is visible to its owner only, and publishing (to the teacher's classes, or the
shared library) is a later milestone behind an ADR-013 decision.

    sim_drafts/{draft_id}                    owner, title, latest version + level
    sim_draft_versions/{draft_id}__v{n}      html, yaml, level, reasons, screenshots (base64 PNG)

A version doc stays under Firestore's 1 MB limit: the page is capped at 256 KB
before it is checked, and two screenshots are ~100 KB of base64.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from db.firestore import get_document, query_documents, set_document, transact_document

DRAFTS = "sim_drafts"
VERSIONS = "sim_draft_versions"
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _check_id(draft_id: str) -> None:
    if not _SAFE_ID.match(draft_id or ""):
        raise ValueError("invalid draft id")


def _title_of(yaml_text: str | None) -> str:
    m = re.search(r"^displayName:\s*['\"]?(.+?)['\"]?\s*$", yaml_text or "", re.M)
    return m.group(1)[:120] if m else "Untitled sim"


def add_version(
    *,
    draft_id: str,
    owner_uid: str,
    index_html: str,
    catalogue_yaml: str | None,
    level: int,
    reasons: list[str],
    screenshots: dict[str, str],
    artefact_id: str | None,
    hidden_terms: list[str] | None = None,
) -> int:
    """Record one checked submission; returns its version number (1-based)."""
    _check_id(draft_id)
    now = datetime.now(UTC).isoformat()

    def bump(current: dict[str, Any] | None) -> tuple[dict[str, Any], int]:
        if current and current.get("ownerUid") != owner_uid:
            raise PermissionError("draft belongs to someone else")
        n = int((current or {}).get("latestVersion") or 0) + 1
        fields = {
            "latestVersion": n,
            "latestLevel": level,
            "title": _title_of(catalogue_yaml),
            "artefactId": artefact_id,
            "updatedAt": now,
        }
        if not current:
            fields |= {"createdAt": now, "ownerUid": owner_uid}
        return fields, n

    n = transact_document(DRAFTS, draft_id, bump)
    set_document(
        VERSIONS,
        f"{draft_id}__v{n}",
        {
            "draftId": draft_id,
            "ownerUid": owner_uid,
            "version": n,
            "html": index_html,
            "yaml": catalogue_yaml or "",
            "level": level,
            "reasons": reasons[:10],
            "screenshots": screenshots,
            # What the student must work out, as checked: publishing re-runs the
            # leak gate on exactly this version with exactly these terms.
            "hiddenTerms": list(hidden_terms or [])[:20],
            "createdAt": now,
        },
    )
    return n


def add_usage(
    *, draft_id: str, owner_uid: str, tokens_in: int, tokens_out: int, tokens_thinking: int, cost_usd: float
) -> None:
    """Add one model call's usage to the draft's running total (a rough guide for
    the teacher). Creates the draft record on its first call, before any version
    exists, so the cost of a build is visible while it is being written."""
    _check_id(draft_id)
    now = datetime.now(UTC).isoformat()

    def bump(current: dict[str, Any] | None) -> tuple[dict[str, Any] | None, None]:
        if current and current.get("ownerUid") != owner_uid:
            return None, None  # never write into someone else's draft
        usage = dict((current or {}).get("usage") or {})
        usage["tokensIn"] = int(usage.get("tokensIn") or 0) + int(tokens_in)
        usage["tokensOut"] = int(usage.get("tokensOut") or 0) + int(tokens_out)
        usage["tokensThinking"] = int(usage.get("tokensThinking") or 0) + int(tokens_thinking)
        usage["costUsd"] = round(float(usage.get("costUsd") or 0.0) + float(cost_usd), 6)
        usage["calls"] = int(usage.get("calls") or 0) + 1
        fields: dict[str, Any] = {"usage": usage, "updatedAt": now}
        if not current:
            fields |= {"createdAt": now, "ownerUid": owner_uid, "latestVersion": 0, "latestLevel": None, "title": None}
        return fields, None

    transact_document(DRAFTS, draft_id, bump)


def get_draft(draft_id: str, owner_uid: str) -> dict[str, Any] | None:
    """The draft, if it exists AND belongs to ``owner_uid`` (else None: never reveal someone else's)."""
    _check_id(draft_id)
    doc = get_document(DRAFTS, draft_id)
    return doc if doc and doc.get("ownerUid") == owner_uid else None


def get_version(draft_id: str, version: int, owner_uid: str) -> dict[str, Any] | None:
    _check_id(draft_id)
    doc = get_document(VERSIONS, f"{draft_id}__v{int(version)}")
    return doc if doc and doc.get("ownerUid") == owner_uid else None


def list_drafts(owner_uid: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = query_documents(DRAFTS, filters=[("ownerUid", "==", owner_uid)], limit=limit)
    return sorted(rows, key=lambda r: r.get("updatedAt", ""), reverse=True)
