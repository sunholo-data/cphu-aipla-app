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

    def test_revoke_group_code_writes_a_tombstone_and_keeps_the_binding(self) -> None:
        """1.1.146 — Revoke ends access, never evidence. The anon_groups doc is
        kept with ``revoked`` set AND ``classId`` intact (the only code → class
        binding), and the code stays on the roster every evidence surface reads.

        Until 1.1.146 this test was named ``…_marks_anon_group_revoked`` while
        asserting the code was REMOVED — and the function hard-deleted the doc,
        which is how a researcher lost a whole class's sessions on prod."""
        cls = _create()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=2)
        code, other = codes

        classes_db.revoke_group_code(cls.class_id, code, revoked_by="teacher-1")

        anon = fs_module.get_document("anon_groups", code)
        assert anon is not None, "the binding document must survive a revoke"
        assert anon["revoked"] is True
        assert anon["classId"] == cls.class_id
        assert anon["revokedBy"] == "teacher-1"
        assert anon["revokedAt"]

        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert code in reloaded.group_codes, "the historical roster keeps the code"
        assert reloaded.revoked_group_codes == [code]
        assert reloaded.active_group_codes == [other]
        assert reloaded.revoked_group_codes_at[code] == anon["revokedAt"]
        # Ownership still resolves through the tombstone.
        bound = classes_db.get_class_for_group(code)
        assert bound is not None and bound.class_id == cls.class_id

    def test_revoke_group_code_is_idempotent(self) -> None:
        cls = _create()
        code = classes_db.mint_group_codes_under_class(cls.class_id, count=1)[0]

        classes_db.revoke_group_code(cls.class_id, code)
        first = fs_module.get_document("anon_groups", code)["revokedAt"]
        classes_db.revoke_group_code(cls.class_id, code)

        assert fs_module.get_document("anon_groups", code)["revokedAt"] == first
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert reloaded.group_codes.count(code) == 1
        assert reloaded.revoked_group_codes == [code]

    def test_revoke_refuses_a_code_bound_to_another_class(self) -> None:
        """The old version deleted whatever anon_groups doc it was handed, so an
        owner could unbind ANOTHER class's code by naming it."""
        mine = _create(owner="teacher-1", name="Mine")
        theirs = _create(owner="teacher-2", name="Theirs")
        their_code = classes_db.mint_group_codes_under_class(theirs.class_id, count=1)[0]

        with pytest.raises(classes_db.GroupCodeNotInClass):
            classes_db.revoke_group_code(mine.class_id, their_code)

        anon = fs_module.get_document("anon_groups", their_code)
        assert anon is not None and not anon.get("revoked")
        assert anon["classId"] == theirs.class_id

    def test_a_revoked_code_string_is_never_minted_again(self, monkeypatch) -> None:
        """The uid is deterministic per code (ADR-001): a reissued string would
        hand a new cohort the old one's sessions."""
        import auth.group_id_auth as gid

        cls = _create()
        code = classes_db.mint_group_codes_under_class(cls.class_id, count=1)[0]
        classes_db.revoke_group_code(cls.class_id, code)
        # A different instance: nothing in memory, only the tombstone.
        gid.AnonymousGroupAuth.reset_for_tests()

        draws = iter([code, code, "fresh-otter-01"])
        monkeypatch.setattr(gid, "_generate_code", lambda: next(draws))
        minted = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        assert minted == ["fresh-otter-01"]


class TestLiveSkillIdsForClass:
    """The new-model skill resolution that gates a student's visible lessons:
    a class's skills = the skills of its assigned activities (not Class.lessons,
    which is empty for activity-driven classes after the clean-slate wipe)."""

    def test_resolves_skill_ids_from_assigned_activities_deduped(self) -> None:
        from db.activities import create_activity
        from db.models.activity import Activity

        cls = _create()
        a1 = create_activity(Activity(activityId="", ownerUid="teacher-1", skillId="concept-dialogue", title="A"))
        a2 = create_activity(Activity(activityId="", ownerUid="teacher-1", skillId="problem-set-hints", title="B"))
        a3 = create_activity(Activity(activityId="", ownerUid="teacher-1", skillId="concept-dialogue", title="C"))
        classes_db.add_activities(cls.class_id, [a1.activity_id, a2.activity_id, a3.activity_id])

        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        # Deduped + order-preserving: concept appears once, before problem-set.
        assert classes_db.live_skill_ids_for_class(reloaded) == ("concept-dialogue", "problem-set-hints")

    def test_falls_back_to_lessons_when_no_activities(self) -> None:
        cls = _create()
        classes_db.add_lessons(cls.class_id, ["legacy-skill-x"])
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert classes_db.live_skill_ids_for_class(reloaded) == ("legacy-skill-x",)

    def test_empty_when_no_activities_and_no_lessons(self) -> None:
        cls = _create()
        reloaded = classes_db.get_class(cls.class_id)
        assert reloaded is not None
        assert classes_db.live_skill_ids_for_class(reloaded) == ()
