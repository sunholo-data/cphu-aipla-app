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


class ClassVoiceSettings(BaseModel):
    """Per-class voice override (1.1.11 sprint VOICE-PROVIDER).

    Set by the teacher in the class-detail page. Resolved in the
    voice-config chain BEFORE skill defaults but AFTER student
    localStorage preference (so an individual student can still pick
    English even if the teacher set Danish for the whole class).

    All three fields optional — leaving a field unset means "fall
    through to the next level" (skill default, then env, then "browser").
    """

    language: str | None = Field(default=None, max_length=16)
    """BCP-47 short tag (`"da"`, `"en"`). When set, ReadAloudButton uses
    this language instead of the skill's ttsLang."""

    voice: str | None = Field(default=None, max_length=64)
    """Cloud TTS voice name (e.g. `"da-DK-Wavenet-A"`). When set,
    /api/voice/config returns this in the `tts.voice` field."""

    provider: str | None = Field(default=None, max_length=32)
    """Registry provider key (`"gcp_wavenet"`, `"gcp_chirp3hd"`, etc.).
    Encodes the tier the teacher picked; the voice field above must
    match this tier (the picker enforces this client-side)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


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
    voice: ClassVoiceSettings | None = Field(default=None)
    """1.1.11 — teacher's per-class voice override. None means the class
    inherits skill defaults / env. See ClassVoiceSettings."""
    voice_input_enabled: bool = Field(default=True, alias="voiceInputEnabled")
    """VOICE-IN-REC — student voice input (talk-to-type / push-to-talk); gates
    the composer mic. Default-ON (2026-06-11, M) — benign: transcript-only, raw
    audio never persisted. Teachers can still toggle a class off."""
    recording_enabled: bool = Field(default=False, alias="recordingEnabled")
    """VOICE-IN-REC — lesson audio recording (RETAINED research record). Default
    OFF — it stays a deliberate per-class toggle (2026-06-11, M): enabling is the
    teacher's attestation that signed paper consent forms are held for the class
    (GDPR). Recording must never turn on without that explicit gesture."""
    recording_consent_attested_at: datetime | None = Field(alias="recordingConsentAttestedAt", default=None)
    """When the teacher last enabled recording (= attested the forms). Audit trail."""
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


__all__ = ["Class", "ClassVoiceSettings"]
