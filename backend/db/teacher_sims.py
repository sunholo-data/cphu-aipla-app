"""Teacher-published sims (in-app-sim-authoring M6).

A teacher publishes one checked version of a draft from the Sim workshop. The
published sim then sits in the catalogue beside the built-in ones
(``artefacts.loader`` merges them) and is attached, framed and tutored exactly
like them. Two levels:

- ``classes``: the teacher's own recorded approval; only that teacher can attach
  it (ADR-013 as amended 2026-10-13: the teacher is the reviewer of record for
  their own classes).
- ``library``: a researcher's recorded sign-off on top; every teacher can attach it.

Each publish freezes a version: ``teacher_sim_versions/{id}__v{n}`` holds the exact
HTML students get, with the bridge stamped, and the approval that let it out. The
draft can go on changing without touching what a class runs. Withdrawing a sim
removes it from the catalogue; activities that used it lose the sim, never the
activity.

Collections: ``teacher_sims/{id}`` (the current published state and its catalogue
metadata) and ``teacher_sim_versions/{id}__v{n}`` (frozen versions).
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import Any, Literal

from db.firestore import get_document, query_documents, set_document, transact_document
from db.models.artefact import ArtefactMeta

logger = logging.getLogger(__name__)

SIMS = "teacher_sims"
VERSIONS = "teacher_sim_versions"
Scope = Literal["classes", "library"]

# Published sims change rarely and are read on every tutor turn that hosts one,
# so they are cached briefly per instance. A publish clears this instance's cache;
# other instances catch up within the TTL.
_TTL_S = 30.0
_cache: dict[str, Any] = {"at": 0.0, "rows": None}


class PublishRefused(Exception):
    """A publish the rules do not allow; the message is shown to the teacher."""


def invalidate() -> None:
    _cache["at"], _cache["rows"] = 0.0, None


def _live_rows() -> list[dict[str, Any]]:
    """Every live published sim, cached for ``_TTL_S``. Raises when Firestore does not answer."""
    now = time.monotonic()
    if _cache["rows"] is not None and now - _cache["at"] < _TTL_S:
        return _cache["rows"]
    rows = query_documents(SIMS, filters=[("status", "==", "live")], limit=500)
    _cache["rows"], _cache["at"] = rows, now
    return rows


def meta_of(row: dict[str, Any]) -> ArtefactMeta | None:
    """The catalogue entry for one published sim, or None if its stored metadata no longer validates."""
    try:
        meta = ArtefactMeta.model_validate(row.get("meta") or {})
    except Exception:
        logger.warning("teacher sim %s: stored metadata does not validate", row.get("__id"), exc_info=True)
        return None
    return meta.model_copy(
        update={"source": "teacher", "owner_uid": row.get("ownerUid"), "scope": row.get("scope") or "classes"}
    )


def live_metas() -> list[ArtefactMeta]:
    """Every live published sim as catalogue entries. Raises when Firestore does not answer."""
    return [m for m in (meta_of(r) for r in _live_rows()) if m is not None]


def get_sim(sim_id: str) -> dict[str, Any] | None:
    doc = get_document(SIMS, sim_id)
    return {"__id": sim_id, **doc} if doc else None


def get_version_html(sim_id: str, version: int) -> str | None:
    """The frozen page students get, for a LIVE sim's published version; None otherwise."""
    sim = get_sim(sim_id)
    if not sim or sim.get("status") != "live" or int(version) > int(sim.get("version") or 0):
        return None
    doc = get_document(VERSIONS, f"{sim_id}__v{int(version)}")
    return (doc or {}).get("html")


def list_for_owner(owner_uid: str) -> list[dict[str, Any]]:
    return query_documents(SIMS, filters=[("ownerUid", "==", owner_uid)], limit=200)


def list_library_requests() -> list[dict[str, Any]]:
    """Live class-level sims whose teacher asked for the shared library."""
    rows = query_documents(SIMS, filters=[("libraryRequested", "==", True)], limit=200)
    return [r for r in rows if r.get("status") == "live" and r.get("scope") == "classes"]


def publish(
    *,
    sim_id: str,
    owner_uid: str,
    approved_by: str,
    meta: dict[str, Any],
    html: str,
    yaml_text: str,
    draft_id: str,
    draft_version: int,
    gates: dict[str, Any],
) -> int:
    """Freeze a new published version; returns its number.

    Refuses an id another teacher already published: ids are global, because the
    activity stores only the id. Re-publishing keeps the sim's level (a library
    sim stays in the library: the reviewer signed off the SIM; a new version of a
    library sim goes back to ``classes`` until signed off again, so nothing
    unreviewed reaches other teachers).
    """
    now = datetime.now(UTC).isoformat()

    def bump(current: dict[str, Any] | None) -> tuple[dict[str, Any], int]:
        if current and current.get("ownerUid") != owner_uid:
            raise PublishRefused(f"Another teacher has already published a sim with the id {sim_id!r}.")
        n = int((current or {}).get("version") or 0) + 1
        fields: dict[str, Any] = {
            "ownerUid": owner_uid,
            "version": n,
            "status": "live",
            "scope": "classes",
            "meta": {**meta, "id": sim_id, "version": f"v{n}", "status": "live"},
            "draftId": draft_id,
            "draftVersion": draft_version,
            "approvedBy": approved_by,
            "approvedAt": now,
            "updatedAt": now,
            "libraryRequested": False,
            "librarySignoff": None,
        }
        if not current:
            fields["createdAt"] = now
        return fields, n

    n = transact_document(SIMS, sim_id, bump)
    set_document(
        VERSIONS,
        f"{sim_id}__v{n}",
        {
            "simId": sim_id,
            "version": n,
            "ownerUid": owner_uid,
            "html": html,
            "yaml": yaml_text,
            "draftId": draft_id,
            "draftVersion": draft_version,
            "approvedBy": approved_by,
            "approvedAt": now,
            "gates": gates,
            "createdAt": now,
        },
    )
    invalidate()
    return n


def _update(sim_id: str, fn) -> dict[str, Any]:
    def step(current: dict[str, Any] | None) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        if not current:
            raise LookupError(sim_id)
        fields = fn(current)
        return fields, {**current, **fields}

    out = transact_document(SIMS, sim_id, step)
    invalidate()
    return out


def request_library(sim_id: str, owner_uid: str, note: str) -> dict[str, Any]:
    def fn(cur: dict[str, Any]) -> dict[str, Any]:
        if cur.get("ownerUid") != owner_uid or cur.get("status") != "live":
            raise LookupError(sim_id)
        return {
            "libraryRequested": True,
            "libraryRequest": {"note": note[:1000], "at": datetime.now(UTC).isoformat(), "version": cur.get("version")},
        }

    return _update(sim_id, fn)


def decide_library(sim_id: str, reviewer: str, approve: bool, note: str) -> dict[str, Any]:
    """A researcher's recorded sign-off (or decline) of the version the teacher asked about."""

    def fn(cur: dict[str, Any]) -> dict[str, Any]:
        if cur.get("status") != "live" or not cur.get("libraryRequested"):
            raise LookupError(sim_id)
        decision = {
            "by": reviewer,
            "at": datetime.now(UTC).isoformat(),
            "note": note[:1000],
            "version": cur.get("version"),
        }
        if approve:
            return {"scope": "library", "libraryRequested": False, "librarySignoff": decision}
        return {"libraryRequested": False, "libraryDeclined": decision}

    return _update(sim_id, fn)


def withdraw(sim_id: str, actor: str, *, owner_uid: str | None) -> dict[str, Any]:
    """Take a sim out of the catalogue. ``owner_uid`` None means a researcher acting on anyone's sim."""

    def fn(cur: dict[str, Any]) -> dict[str, Any]:
        if owner_uid is not None and cur.get("ownerUid") != owner_uid:
            raise LookupError(sim_id)
        return {"status": "withdrawn", "withdrawnBy": actor, "withdrawnAt": datetime.now(UTC).isoformat()}

    return _update(sim_id, fn)
