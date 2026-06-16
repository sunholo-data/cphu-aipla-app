"""Unit tests for db/classes.py — Firestore CRUD for the Class collection.

Uses the in-memory Firestore client; no GCP credentials. Reset between
tests via the existing ``_reset_client_for_testing`` helper.
"""

from __future__ import annotations

import pytest

from db import classes as classes_db
from db import firestore as fs_module
from db.models.class_ import Class


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    """Force the in-memory Firestore client + a signing secret for the
    group-id auth path that mint_group_codes_under_class calls into."""
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    # AnonymousGroupAuth keeps an in-memory state; reset it for hygiene.
    from auth.group_id_auth import AnonymousGroupAuth

    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _create(owner: str = "teacher-1", name: str = "Physik 9A") -> Class:
    cls = Class.create_for_teacher(owner_uid=owner, name=name)
    classes_db.create_class(cls)
    return cls


class TestCreateAndGet:
    def test_create_then_get_round_trip(self) -> None:
        cls = _create()
        loaded = classes_db.get_class(cls.class_id)
        assert loaded is not None
        assert loaded.class_id == cls.class_id
        assert loaded.owner_uid == cls.owner_uid
        assert loaded.tag_namespace == cls.tag_namespace
        assert loaded.revoked is False

    def test_get_missing_returns_none(self) -> None:
        assert classes_db.get_class("does-not-exist") is None


class TestListForOwner:
    def test_lists_only_owners_classes(self) -> None:
        _create(owner="teacher-a", name="A's class 1")
        _create(owner="teacher-a", name="A's class 2")
        _create(owner="teacher-b", name="B's class")

        a_classes = classes_db.list_classes_for_owner("teacher-a")
        b_classes = classes_db.list_classes_for_owner("teacher-b")

        assert len(a_classes) == 2
        assert len(b_classes) == 1
        assert all(c.owner_uid == "teacher-a" for c in a_classes)
        assert all(c.owner_uid == "teacher-b" for c in b_classes)

    def test_excludes_revoked_by_default(self) -> None:
        a = _create(owner="t1", name="active")
        b = _create(owner="t1", name="to-revoke")
        classes_db.revoke_class(b.class_id)

        active = classes_db.list_classes_for_owner("t1")
        assert {c.class_id for c in active} == {a.class_id}

    def test_include_revoked_flag(self) -> None:
        a = _create(owner="t1", name="active")
        b = _create(owner="t1", name="to-revoke")
        classes_db.revoke_class(b.class_id)

        all_classes = classes_db.list_classes_for_owner("t1", include_revoked=True)
        assert {c.class_id for c in all_classes} == {a.class_id, b.class_id}


class TestUpdateClass:
    def test_update_name(self) -> None:
        cls = _create(name="Old name")
        classes_db.update_class(cls.class_id, name="New name")
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert reloaded.name == "New name"

    def test_update_description(self) -> None:
        cls = _create()
        classes_db.update_class(cls.class_id, description="A new description")
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert reloaded.description == "A new description"


class TestPersonaClearsVoiceOverride:
    """Picking a persona is a complete identity choice (avatar + name + voice +
    style); it must clear any legacy per-class voice override so the override
    can't keep speaking over the persona's voice (the avatar-switched-but-voice-
    stayed bug). Clearing the persona (None) keeps the override as the escape
    hatch for classes that have not picked an identity."""

    def test_picking_persona_clears_voice_override(self) -> None:
        cls = _create()
        classes_db.update_class_voice_settings(
            cls.class_id, language="da", voice="da-DK-Chirp3-HD-Charon", provider="gcp_chirp3hd"
        )
        assert classes_db.get_class(cls.class_id).voice is not None  # type: ignore[union-attr]

        classes_db.update_class_persona(cls.class_id, "astrid")

        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert reloaded.persona == "astrid"
        assert reloaded.voice is None  # legacy override cleared

    def test_clearing_persona_preserves_voice_override(self) -> None:
        cls = _create()
        classes_db.update_class_voice_settings(
            cls.class_id, language="da", voice="da-DK-Wavenet-C", provider="gcp_wavenet"
        )

        classes_db.update_class_persona(cls.class_id, None)  # "default" — no identity chosen

        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert reloaded.persona is None
        assert reloaded.voice is not None  # escape hatch preserved


class TestLessons:
    def test_add_lessons_idempotent(self) -> None:
        cls = _create()
        classes_db.add_lessons(cls.class_id, ["skill-a", "skill-b"])
        classes_db.add_lessons(cls.class_id, ["skill-b", "skill-c"])  # b is dup
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert set(reloaded.lessons) == {"skill-a", "skill-b", "skill-c"}

    def test_remove_lessons(self) -> None:
        cls = _create()
        classes_db.add_lessons(cls.class_id, ["skill-a", "skill-b", "skill-c"])
        classes_db.remove_lessons(cls.class_id, ["skill-b"])
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert set(reloaded.lessons) == {"skill-a", "skill-c"}

    def test_remove_lessons_missing_is_noop(self) -> None:
        cls = _create()
        classes_db.add_lessons(cls.class_id, ["skill-a"])
        classes_db.remove_lessons(cls.class_id, ["skill-doesnt-exist"])
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert reloaded.lessons == ["skill-a"]


class TestSoftDelete:
    def test_revoke_class_flips_flag(self) -> None:
        cls = _create()
        classes_db.revoke_class(cls.class_id)
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert reloaded.revoked is True
        assert reloaded.revoked_at is not None

    def test_revoke_class_is_idempotent(self) -> None:
        cls = _create()
        classes_db.revoke_class(cls.class_id)
        first = classes_db.get_class(cls.class_id)
        assert first is not None
        ts_before = first.revoked_at

        classes_db.revoke_class(cls.class_id)
        second = classes_db.get_class(cls.class_id)
        assert second is not None
        assert second.revoked_at == ts_before  # unchanged

    def test_revoke_does_not_drop_doc(self) -> None:
        cls = _create()
        classes_db.revoke_class(cls.class_id)
        assert classes_db.get_class(cls.class_id) is not None  # still there


class TestGroupBinding:
    def test_mint_group_writes_both_sides(self) -> None:
        """``mint_group_codes_under_class`` appends to Class.groupCodes AND
        writes class_id into the anon_groups/<code> doc — the link is in
        both directions so M5's revocation check has a single source of
        truth (the anon_groups doc's class_id field)."""
        cls = _create()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=2)
        assert len(codes) == 2

        # Class.groupCodes now contains both codes.
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert set(reloaded.group_codes) == set(codes)

        # Each anon_groups/<code> doc has class_id set.
        for code in codes:
            anon_doc = fs_module.get_document("anon_groups", code)
            assert anon_doc is not None, f"anon_groups/{code} not persisted"
            assert anon_doc.get("classId") == cls.class_id

    def test_mint_group_under_revoked_class_raises(self) -> None:
        cls = _create()
        classes_db.revoke_class(cls.class_id)
        with pytest.raises(ValueError, match="revoked"):
            classes_db.mint_group_codes_under_class(cls.class_id, count=1)

    def test_revoke_group_code_marks_anon_group_revoked(self) -> None:
        cls = _create()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        code = codes[0]

        classes_db.revoke_group_code(cls.class_id, code)

        # The code is removed from Class.groupCodes.
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert code not in reloaded.group_codes
