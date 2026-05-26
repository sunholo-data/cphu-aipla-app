"""Unit tests for the Class model (1.A teacher-permission-model).

The load-bearing security boundary is the ``tag_namespace`` invariant:
``class:<owner_uid>:<class_id>`` MUST be constructed server-side. A
teacher API call that tries to set an arbitrary tag fails at Pydantic
validation before reaching Firestore.

These tests freeze that contract.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from db.models.class_ import Class


def _utcnow() -> datetime:
    return datetime.now(UTC)


class TestClassCreateForTeacher:
    """``Class.create_for_teacher`` is the only path that produces a valid Class."""

    def test_constructs_namespace_server_side(self) -> None:
        cls = Class.create_for_teacher(owner_uid="teacher-1", name="Physik 9A vår 2026")
        assert cls.owner_uid == "teacher-1"
        assert cls.name == "Physik 9A vår 2026"
        assert cls.tag_namespace == f"class:teacher-1:{cls.class_id}"
        assert cls.revoked is False
        assert cls.revoked_at is None
        assert cls.lessons == []
        assert cls.group_codes == []
        assert cls.created_at is not None
        assert cls.updated_at is not None

    def test_two_teachers_produce_different_namespaces(self) -> None:
        a = Class.create_for_teacher(owner_uid="teacher-a", name="Class A")
        b = Class.create_for_teacher(owner_uid="teacher-b", name="Class B")
        assert a.tag_namespace != b.tag_namespace
        assert a.tag_namespace.startswith("class:teacher-a:")
        assert b.tag_namespace.startswith("class:teacher-b:")

    def test_two_classes_same_teacher_have_different_namespaces(self) -> None:
        a = Class.create_for_teacher(owner_uid="teacher-x", name="Class 1")
        b = Class.create_for_teacher(owner_uid="teacher-x", name="Class 2")
        assert a.class_id != b.class_id
        assert a.tag_namespace != b.tag_namespace

    def test_optional_description(self) -> None:
        cls = Class.create_for_teacher(owner_uid="teacher-1", name="Class", description="9th grade physics")
        assert cls.description == "9th grade physics"


class TestTagNamespaceInvariant:
    """The @field_validator is the single security boundary."""

    def test_rejects_manually_supplied_tag_namespace_mismatching_uid(self) -> None:
        with pytest.raises(ValidationError) as exc:
            Class(
                classId="C1",
                ownerUid="teacher-a",
                name="Class",
                tagNamespace="class:teacher-b:C1",  # impersonation attempt
                createdAt=_utcnow(),
                updatedAt=_utcnow(),
            )
        assert "tag_namespace" in str(exc.value) or "tagNamespace" in str(exc.value)

    def test_rejects_arbitrary_tag(self) -> None:
        with pytest.raises(ValidationError):
            Class(
                classId="C1",
                ownerUid="teacher-a",
                name="Class",
                tagNamespace="role:admin",
                createdAt=_utcnow(),
                updatedAt=_utcnow(),
            )

    def test_rejects_empty_tag_namespace(self) -> None:
        with pytest.raises(ValidationError):
            Class(
                classId="C1",
                ownerUid="teacher-a",
                name="Class",
                tagNamespace="",
                createdAt=_utcnow(),
                updatedAt=_utcnow(),
            )

    def test_accepts_correctly_shaped_namespace(self) -> None:
        cls = Class(
            classId="C1",
            ownerUid="teacher-a",
            name="Class",
            tagNamespace="class:teacher-a:C1",
            createdAt=_utcnow(),
            updatedAt=_utcnow(),
        )
        assert cls.tag_namespace == "class:teacher-a:C1"


class TestSoftDelete:
    """``revoke()`` flips the flag without dropping the doc."""

    def test_revoke_sets_flag_and_timestamp(self) -> None:
        cls = Class.create_for_teacher(owner_uid="teacher-1", name="C")
        assert cls.revoked is False
        assert cls.revoked_at is None
        cls.revoke()
        assert cls.revoked is True
        assert cls.revoked_at is not None

    def test_revoke_is_idempotent(self) -> None:
        cls = Class.create_for_teacher(owner_uid="teacher-1", name="C")
        cls.revoke()
        first_ts = cls.revoked_at
        cls.revoke()
        assert cls.revoked is True
        assert cls.revoked_at == first_ts  # idempotent — timestamp doesn't shift


class TestAliasRoundTrip:
    """All wire fields camelCase round-trip via populate_by_name=True."""

    def test_dump_uses_camel_case(self) -> None:
        cls = Class.create_for_teacher(owner_uid="t1", name="C")
        cls.lessons = ["skill-a"]
        cls.group_codes = ["adjective-noun-12"]
        dumped = cls.model_dump(by_alias=True, mode="json")
        assert "classId" in dumped
        assert "ownerUid" in dumped
        assert "tagNamespace" in dumped
        assert "groupCodes" in dumped
        assert "createdAt" in dumped
        assert "updatedAt" in dumped
        # Snake-case keys should NOT appear when by_alias=True.
        assert "class_id" not in dumped
        assert "owner_uid" not in dumped
        assert "tag_namespace" not in dumped

    def test_load_from_camel_case_payload(self) -> None:
        payload = {
            "classId": "C1",
            "ownerUid": "t1",
            "name": "C",
            "tagNamespace": "class:t1:C1",
            "createdAt": _utcnow().isoformat(),
            "updatedAt": _utcnow().isoformat(),
        }
        cls = Class.model_validate(payload)
        assert cls.class_id == "C1"
        assert cls.tag_namespace == "class:t1:C1"

    def test_load_from_snake_case_payload(self) -> None:
        payload = {
            "class_id": "C1",
            "owner_uid": "t1",
            "name": "C",
            "tag_namespace": "class:t1:C1",
            "created_at": _utcnow().isoformat(),
            "updated_at": _utcnow().isoformat(),
        }
        cls = Class.model_validate(payload)
        assert cls.class_id == "C1"


class TestOwnerProtocol:
    """``owner_id`` property satisfies the _HasAccess protocol used elsewhere."""

    def test_owner_id_returns_owner_uid(self) -> None:
        cls = Class.create_for_teacher(owner_uid="teacher-1", name="C")
        assert cls.owner_id == "teacher-1"
