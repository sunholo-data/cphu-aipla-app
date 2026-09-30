"""Personas authored in the app (TUTOR-2 M3).

``Persona.source`` has been ``Literal["yaml"]`` since 1.1.12, with its own
docstring recording that Firestore-custom personas were "a v1.2 follow-up". This
is that follow-up, and it is what "give a tutor a face and a voice" needs: the
six shipped personas are files in git with avatars under
``frontend/public/personas``, and a teacher cannot write either.

One Firestore doc per persona at ``custom_personas/{id}``, layered over the YAML
catalogue exactly as ``db/authored_frameworks`` layers over the framework YAML
and ``db/tutors`` over the base tutors. Third instance of one pattern, not a
fourth mechanism.

## What a custom persona may carry, and what it may not

Everything ``Persona`` already defines — name, title, avatar, language,
interaction style, voice, voice prompt, bio — plus ``author_uid`` and
``visibility``.

⚠️ **The avatar is CHOSEN, not uploaded.** M, 2026-09-28: *"we use our own
avatars for now and we will upload more so there is more choice."* An avatar
that a teacher uploads is an image a 16-year-old sees, attached to a class for a
term — the first user-generated student-facing content in AIPLA, needing a
moderation policy nobody had written. Choosing from a set the project ships
needs none, so ``save_custom_persona`` refuses an avatar outside the manifest.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, query_documents, set_document
from db.models.persona import Persona

log = logging.getLogger(__name__)

COLLECTION = "custom_personas"

#: Namespaced so a custom id can never shadow one of the six YAML personas, and
#: so reading an id tells you which store answers for it.
ID_PREFIX = "persona-"

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_ROW_ONLY = ("updatedBy", "updatedAt", "__id")


def make_persona_id(name: str) -> str:
    slug = _SLUG_RE.sub("-", name.strip().lower()).strip("-")[:40] or "persona"
    return f"{ID_PREFIX}{slug}"


def is_custom_id(persona_id: str | None) -> bool:
    return bool(persona_id) and str(persona_id).startswith(ID_PREFIX)


def _row_to_persona(row: dict[str, Any] | None) -> Persona | None:
    """Validate one row, or None. A malformed row is logged and skipped rather
    than fatal: this sits on the agent path, and a bad persona must not take a
    lesson down (Axiom 5) — it degrades to the default identity."""
    if not row:
        return None
    try:
        data = {k: v for k, v in row.items() if k not in _ROW_ONLY}
        data["source"] = "firestore"
        return Persona.model_validate(data)
    except Exception as exc:
        log.warning("custom_personas: row %s is malformed, skipping: %s", row.get("id"), exc)
        return None


def get_custom_persona(persona_id: str | None) -> Persona | None:
    if not is_custom_id(persona_id):
        return None
    return _row_to_persona(get_document(COLLECTION, str(persona_id)))


def list_custom_personas(for_uid: str | None = None, *, see_all: bool = False) -> list[Persona]:
    """Custom personas this caller may see.

    ``for_uid`` omitted returns everything, because the agent path and the
    loader are not a person — a student's lesson resolving its class's persona
    has no uid, and filtering there would change the face mid-term.
    """
    rows = query_documents(COLLECTION) or []
    out = [p for p in (_row_to_persona(r) for r in rows) if p]
    if for_uid is not None:
        out = [p for p in out if p.visible_to(for_uid, see_all=see_all)]
    return sorted(out, key=lambda p: p.name.lower())


def save_custom_persona(persona: Persona, *, author_uid: str, allowed_avatars: set[str]) -> Persona:
    """Create or replace a custom persona.

    ``author_uid`` comes from the VERIFIED token, never the body — the rule the
    framework and tutor stores already follow, for the same reason: who authored
    the face a class is taught by is not a client-supplied field.

    ⚠️ ``allowed_avatars`` is the manifest of images the project ships. An
    avatar outside it is refused rather than stored, which is what keeps "the
    avatar is chosen, not uploaded" true at the STORE rather than only in the
    UI — a UI-only rule is one fetch away from being bypassed.
    """
    if persona.avatar and persona.avatar not in allowed_avatars:
        raise ValueError(f"unknown avatar: {persona.avatar}")

    existing = get_custom_persona(persona.id)
    row = persona.model_dump(by_alias=True, mode="json")
    row["source"] = "firestore"
    row["authorUid"] = existing.author_uid if existing else author_uid
    # A new persona is private explicitly; an edit keeps what the author chose.
    # Sharing is its own act — an edit that could change who sees a thing is an
    # edit that shares it by accident.
    row["visibility"] = (existing.visibility if existing else None) or "private"
    row["updatedBy"] = author_uid
    row["updatedAt"] = datetime.now(UTC).isoformat()
    set_document(COLLECTION, persona.id, row)
    log.info("custom_personas: saved %s by %s", persona.id, author_uid)
    return _row_to_persona(row) or persona


def set_persona_visibility(persona_id: str, visibility: str) -> Persona | None:
    existing = get_custom_persona(persona_id)
    if existing is None:
        return None
    row = existing.model_dump(by_alias=True, mode="json")
    row["source"] = "firestore"
    row["visibility"] = visibility
    row["updatedAt"] = datetime.now(UTC).isoformat()
    set_document(COLLECTION, persona_id, row)
    return _row_to_persona(row)


def delete_custom_persona(persona_id: str) -> None:
    if is_custom_id(persona_id):
        delete_document(COLLECTION, persona_id)


__all__ = [
    "COLLECTION",
    "ID_PREFIX",
    "delete_custom_persona",
    "get_custom_persona",
    "is_custom_id",
    "list_custom_personas",
    "make_persona_id",
    "save_custom_persona",
    "set_persona_visibility",
]
