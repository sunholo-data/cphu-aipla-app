"""Firestore repository for the Class collection (1.A teacher-permission-model).

All I/O goes through ``db.firestore`` helpers — no raw SDK calls here.
Mirrors the pattern in ``db.chat_sessions``.

Two-write atomicity for group binding: ``mint_group_codes_under_class``
both appends to ``Class.groupCodes`` and writes the bound code's
``anon_groups/<code>`` doc with a ``classId`` field. The classId field
is the single source of truth that M5's verify-token path uses to look
up the class's tag namespace; the Class.groupCodes array is for the
teacher dashboard's "codes I've minted" view.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from db.firestore import (
    delete_document,
    get_document,
    query_documents,
    set_document,
    update_document,
)
from db.models.class_ import Class

logger = logging.getLogger(__name__)

_COLLECTION = "classes"
_ANON_GROUPS_COLLECTION = "anon_groups"


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _to_firestore(cls: Class) -> dict:
    """Convert a Class to a flat dict suitable for Firestore set()."""
    d = cls.model_dump(by_alias=True, exclude_none=False)
    for key in ("createdAt", "updatedAt", "revokedAt"):
        val = d.get(key)
        if isinstance(val, datetime):
            d[key] = val.isoformat()
    return d


def _from_firestore(data: dict, doc_id: str) -> Class:
    if "classId" not in data:
        data = {**data, "classId": doc_id}
    return Class.model_validate(data)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def create_class(cls: Class) -> None:
    """Persist a freshly-minted Class. Use ``Class.create_for_teacher``
    to construct the instance — the namespace invariant is enforced
    there and at Pydantic-validation time."""
    set_document(_COLLECTION, cls.class_id, _to_firestore(cls))
    logger.info(
        "classes_db: created class=%s owner=%s namespace=%s",
        cls.class_id,
        cls.owner_uid,
        cls.tag_namespace,
    )


def get_class(class_id: str) -> Class | None:
    data = get_document(_COLLECTION, class_id)
    if data is None:
        return None
    return _from_firestore(data, class_id)


def list_classes_for_owner(owner_uid: str, *, include_revoked: bool = False) -> list[Class]:
    """List classes by owner. Excludes revoked by default."""
    docs = query_documents(
        _COLLECTION,
        filters=[("ownerUid", "==", owner_uid)],
    )
    classes = [_from_firestore({k: v for k, v in d.items() if k != "__id"}, d["__id"]) for d in docs]
    if not include_revoked:
        classes = [c for c in classes if not c.revoked]
    return classes


def list_all_classes(*, include_revoked: bool = False) -> list[Class]:
    """List every class across all owners. Excludes revoked by default.

    The cross-owner scan that backs the researcher "Research view"
    (sprint 1.1.5). Callers MUST gate this on the researcher claim
    before invoking — this function performs no authorization; it is the
    bypass target, not the bypass check.
    """
    docs = query_documents(_COLLECTION)
    classes = [_from_firestore({k: v for k, v in d.items() if k != "__id"}, d["__id"]) for d in docs]
    if not include_revoked:
        classes = [c for c in classes if not c.revoked]
    return classes


def update_class(
    class_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    cohort: str | None = None,
) -> None:
    """Partial update — name + description + cohort. Tag namespace is
    immutable, lessons go through add_lessons/remove_lessons, group
    codes through mint_group_codes_under_class.

    ``cohort`` (1.1.9): a non-None value sets the cohort tag; the empty
    string clears it (→ "uncategorised" in the cost view)."""
    fields: dict = {"updatedAt": _utcnow().isoformat()}
    if name is not None:
        fields["name"] = name
    if description is not None:
        fields["description"] = description
    if cohort is not None:
        fields["cohort"] = cohort or None
    update_document(_COLLECTION, class_id, fields)


def update_class_voice_settings(
    class_id: str,
    *,
    language: str | None,
    voice: str | None,
    provider: str | None,
) -> None:
    """Set or clear the per-class voice override (1.1.11).

    Pass all three Nones to clear (`voice: null`). Pass at least one
    non-None value to set; the Firestore doc carries the embedded map
    so per-field None becomes "fall through" at resolution time.
    """
    if language is None and voice is None and provider is None:
        update_document(
            _COLLECTION,
            class_id,
            {"voice": None, "updatedAt": _utcnow().isoformat()},
        )
        return
    update_document(
        _COLLECTION,
        class_id,
        {
            "voice": {
                "language": language,
                "voice": voice,
                "provider": provider,
            },
            "updatedAt": _utcnow().isoformat(),
        },
    )


def get_class_for_group(group_id: str | None) -> Class | None:
    """Resolve the class a group belongs to (anon_groups -> classId). None on any
    miss — callers degrade gracefully."""
    if not group_id:
        return None
    try:
        anon = get_document("anon_groups", group_id)
        class_id = anon.get("classId") if anon else None
        return get_class(class_id) if class_id else None
    except Exception:
        return None


def update_class_persona(class_id: str, persona_id: str | None) -> None:
    """Set (or clear, with None) the per-class default persona.

    Picking an explicit persona ALSO clears any per-class voice override (the
    "Custom voice (advanced)" panel). A persona is a complete identity bundle
    (avatar + name + voice + teaching style), so a stale override must not keep
    speaking over the chosen persona's voice — the bug where switching persona
    changed the avatar but the spoken voice stayed the old override. Clearing the
    persona (``None``) leaves any override in place: the advanced panel is the
    escape hatch for classes that have NOT picked an identity.
    """
    patch: dict = {"persona": persona_id, "updatedAt": _utcnow().isoformat()}
    if persona_id:
        patch["voice"] = None
    update_document(_COLLECTION, class_id, patch)


def update_class_capabilities(
    class_id: str,
    *,
    voice_input_enabled: bool | None = None,
    recording_enabled: bool | None = None,
) -> None:
    """Set the per-class voice-in / lesson-recording capability toggles
    (VOICE-IN-REC). Only the passed (non-None) flags are written. Enabling
    recording stamps ``recordingConsentAttestedAt`` (the teacher's attestation
    that signed paper consent forms are held); disabling clears it."""
    patch: dict = {"updatedAt": _utcnow().isoformat()}
    if voice_input_enabled is not None:
        patch["voiceInputEnabled"] = voice_input_enabled
    if recording_enabled is not None:
        patch["recordingEnabled"] = recording_enabled
        patch["recordingConsentAttestedAt"] = _utcnow().isoformat() if recording_enabled else None
    update_document(_COLLECTION, class_id, patch)


def add_lessons(class_id: str, skill_ids: list[str]) -> None:
    """Idempotent: appends skill_ids to Class.lessons, no duplicates."""
    cls = get_class(class_id)
    if cls is None:
        raise ValueError(f"class {class_id} not found")
    new_lessons = list(cls.lessons)
    for sid in skill_ids:
        if sid not in new_lessons:
            new_lessons.append(sid)
    update_document(
        _COLLECTION,
        class_id,
        {"lessons": new_lessons, "updatedAt": _utcnow().isoformat()},
    )


def remove_lessons(class_id: str, skill_ids: list[str]) -> None:
    """Remove skill_ids from Class.lessons. Missing ids are no-ops."""
    cls = get_class(class_id)
    if cls is None:
        raise ValueError(f"class {class_id} not found")
    drop = set(skill_ids)
    new_lessons = [sid for sid in cls.lessons if sid not in drop]
    update_document(
        _COLLECTION,
        class_id,
        {"lessons": new_lessons, "updatedAt": _utcnow().isoformat()},
    )


def revoke_class(class_id: str) -> None:
    """Soft-delete. Idempotent — second call doesn't shift revoked_at."""
    cls = get_class(class_id)
    if cls is None:
        raise ValueError(f"class {class_id} not found")
    if cls.revoked:
        return
    now = _utcnow()
    update_document(
        _COLLECTION,
        class_id,
        {
            "revoked": True,
            "revokedAt": now.isoformat(),
            "updatedAt": now.isoformat(),
        },
    )
    logger.info("classes_db: revoked class=%s owner=%s", class_id, cls.owner_uid)


# ---------------------------------------------------------------------------
# Group-code binding
# ---------------------------------------------------------------------------


def mint_group_codes_under_class(class_id: str, *, count: int = 1) -> list[str]:
    """Mint ``count`` group codes that are bound to this class.

    Two-write atomicity:
      1. Each code's ``anon_groups/<code>`` doc is written with
         ``classId`` (so M5's verify path can pull the tag namespace).
      2. The codes are appended to ``Class.groupCodes`` (so the teacher
         dashboard can show "codes I've minted").

    The actual mint goes through ``auth.group_id_auth.create_group`` so
    the JWT-signing + rate-limit + audit path stays unified.
    """
    cls = get_class(class_id)
    if cls is None:
        raise ValueError(f"class {class_id} not found")
    if cls.revoked:
        raise ValueError(f"class {class_id} is revoked; cannot mint codes")

    # Lazy import — avoid circular: auth.group_id_auth imports from db.
    from auth.group_id_auth import create_group

    minted: list[str] = []
    for _ in range(count):
        record = create_group(
            title=f"{cls.name} ({cls.class_id})",
            skill_ids=list(cls.lessons),
            creator_uid=cls.owner_uid,
        )
        # Bind the code to this class — written to anon_groups doc.
        update_document(
            _ANON_GROUPS_COLLECTION,
            record.group_id,
            {"classId": class_id},
        )
        minted.append(record.group_id)

    new_codes = list(cls.group_codes) + minted
    update_document(
        _COLLECTION,
        class_id,
        {"groupCodes": new_codes, "updatedAt": _utcnow().isoformat()},
    )

    logger.info(
        "classes_db: minted %d codes under class=%s owner=%s",
        count,
        class_id,
        cls.owner_uid,
    )
    return minted


def revoke_group_code(class_id: str, code: str) -> None:
    """Remove a single code from a class's bindings.

    The anon_groups/<code> doc itself is dropped — the next attempt to
    use the JWT will fail at verification.
    """
    cls = get_class(class_id)
    if cls is None:
        raise ValueError(f"class {class_id} not found")

    if code in cls.group_codes:
        new_codes = [c for c in cls.group_codes if c != code]
        update_document(
            _COLLECTION,
            class_id,
            {"groupCodes": new_codes, "updatedAt": _utcnow().isoformat()},
        )

    # Drop the anon_groups doc directly — the next verify-token attempt
    # will fail because the doc is gone. Going through
    # auth.group_id_auth.delete_group would need the requesting_uid +
    # the in-process _state lookup, both of which are noise here: this
    # function is called from a Firebase-teacher-authenticated route
    # that already gated ownership at the layer above.
    delete_document(_ANON_GROUPS_COLLECTION, code)

    logger.info("classes_db: revoked group code=%s from class=%s", code, class_id)


__all__ = [
    "add_lessons",
    "create_class",
    "get_class",
    "list_all_classes",
    "list_classes_for_owner",
    "mint_group_codes_under_class",
    "remove_lessons",
    "revoke_class",
    "revoke_group_code",
    "update_class",
]
