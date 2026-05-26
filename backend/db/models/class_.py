"""Class — teacher-owned grouping of students + lessons.

The trailing underscore on the module name (and the alias on the class
name when imported) is because ``class`` is a Python reserved word.

The load-bearing invariant: ``tag_namespace`` MUST equal
``class:<owner_uid>:<class_id>``. The @field_validator is the single
security boundary — a teacher API call that tries to set an arbitrary
tag fails at Pydantic validation before reaching Firestore. Two
teachers can never produce the same tag because Firebase uids are
unique.

Soft-deleted (`revoked: true`) classes stop minting new groups and
their existing group JWTs are rejected at verification time, but the
doc + audit trail stays.

Design doc: docs/design/aipla/v1.0.0-pilot/teacher-permission-model.md
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _short_id() -> str:
    """Short opaque class id. ULID would be ideal; using 12-char hex for
    simplicity (no extra dep). 16 hex chars from uuid4 = ~64 bits of
    entropy — plenty for per-teacher class collisions to be impossible
    in practice."""
    return uuid.uuid4().hex[:12]


class Class(BaseModel):
    """Firestore document at ``classes/<class_id>``.

    All wire fields camelCase via ``populate_by_name=True``.
    """

    class_id: str = Field(alias="classId")
    owner_uid: str = Field(alias="ownerUid")
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    tag_namespace: str = Field(alias="tagNamespace")
    lessons: list[str] = Field(default_factory=list)
    group_codes: list[str] = Field(alias="groupCodes", default_factory=list)
    revoked: bool = False
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    revoked_at: datetime | None = Field(alias="revokedAt", default=None)

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("tag_namespace")
    @classmethod
    def _validate_tag_namespace(cls, v: str, info: ValidationInfo) -> str:
        owner_uid = info.data.get("owner_uid")
        class_id = info.data.get("class_id")
        expected = f"class:{owner_uid}:{class_id}"
        if v != expected:
            raise ValueError(
                f"tag_namespace must be {expected!r}, got {v!r} — namespace is "
                "constructed server-side and cannot be supplied directly"
            )
        return v

    @classmethod
    def create_for_teacher(
        cls,
        *,
        owner_uid: str,
        name: str,
        description: str | None = None,
    ) -> Class:
        """The only path that produces a valid ``Class`` instance.

        Constructs the ``tag_namespace`` invariant server-side from the
        teacher's Firebase uid + a fresh class id. Teachers cannot
        supply or modify the namespace.
        """
        class_id = _short_id()
        now = _utcnow()
        return cls(
            classId=class_id,
            ownerUid=owner_uid,
            name=name,
            description=description,
            tagNamespace=f"class:{owner_uid}:{class_id}",
            createdAt=now,
            updatedAt=now,
        )

    def revoke(self) -> None:
        """Soft-delete this class. Idempotent — calling twice keeps the
        original ``revoked_at`` timestamp so audit trails don't shift."""
        if self.revoked:
            return
        self.revoked = True
        self.revoked_at = _utcnow()

    @property
    def owner_id(self) -> str:
        """Satisfies the ``_HasAccess`` protocol used elsewhere."""
        return self.owner_uid


__all__ = ["Class"]
