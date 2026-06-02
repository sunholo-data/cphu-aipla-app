"""Tests for analytics.auth — the load-bearing security control for
both 1.L and 1.M.

The hard gate test (``test_enumeration_resistance``) is non-negotiable:
the error message for "class does not exist" and "class exists but is
owned by someone else" MUST be byte-identical. If this test fails,
the sprint plan says stop and redesign rather than paper over with
prompt instructions.
"""

from __future__ import annotations

import pytest

from analytics.auth import (
    PERMISSION_ERROR_MESSAGE,
    assert_caller_owns,
    resolve_caller_class_ids,
    resolve_caller_group_codes,
)
from db import classes as classes_db
from db import firestore as fs_module
from db.models.class_ import Class


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    from auth.group_id_auth import AnonymousGroupAuth

    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _seed_class(owner_uid: str, *, name: str = "Test Class", group_codes: list[str] | None = None) -> Class:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name=name)
    if group_codes:
        cls = cls.model_copy(update={"group_codes": group_codes})
    classes_db.create_class(cls)
    return cls


class TestEnumerationResistance:
    """The byte-identical-error property is the load-bearing safety
    control for the entire analytics layer. Tests in this class assert
    it cannot be weakened without explicit intent."""

    def test_enumeration_resistance(self) -> None:
        """Missing class and not-owned class raise byte-identical error."""
        teacher_a = "teacher-A"
        # cls_b is owned by teacher-B (the owner_uid passed to _seed_class);
        # teacher-A trying to access it should look identical to a missing class.
        cls_b = _seed_class("teacher-B")

        # Branch 1: class does not exist at all.
        with pytest.raises(PermissionError) as missing_exc:
            assert_caller_owns(teacher_a, "does-not-exist")

        # Branch 2: class exists, owned by someone else.
        with pytest.raises(PermissionError) as forbidden_exc:
            assert_caller_owns(teacher_a, cls_b.class_id)

        missing_msg = str(missing_exc.value)
        forbidden_msg = str(forbidden_exc.value)

        # The two paths MUST produce the same message bytes — that is
        # the security control. If you are reading this because this
        # test failed: do NOT silence the assertion. Find why the
        # branches diverged and unify them in auth.py.
        assert missing_msg == forbidden_msg
        assert missing_msg == PERMISSION_ERROR_MESSAGE
        assert missing_msg.encode("utf-8") == forbidden_msg.encode("utf-8")

    def test_owner_passes(self) -> None:
        """Sanity check: the test correctly detects the difference
        between forbidden and allowed. Without this, the byte-identity
        assertion above could be vacuously true if every call raised."""
        teacher = "teacher-1"
        cls = _seed_class("teacher-1")
        # No raise = pass.
        assert_caller_owns(teacher, cls.class_id)

    def test_owner_check_does_not_leak_via_class_existence_lookup(self) -> None:
        """Defensive: even if both classes exist, the non-owner gets
        the same message as if the class were missing."""
        teacher_a = "teacher-A"
        cls_a = _seed_class("teacher-A", name="Class A")
        cls_b = _seed_class("teacher-B", name="Class B")
        # teacher-A owns cls_a; passes.
        assert_caller_owns(teacher_a, cls_a.class_id)
        # teacher-A does NOT own cls_b; raises with the canonical message.
        with pytest.raises(PermissionError) as exc:
            assert_caller_owns(teacher_a, cls_b.class_id)
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE


class TestResolveCallerClassIds:
    def test_returns_empty_set_for_teacher_with_no_classes(self) -> None:
        teacher = "teacher-empty"
        assert resolve_caller_class_ids(teacher) == set()

    def test_returns_owned_class_ids(self) -> None:
        teacher = "teacher-multi"
        c1 = _seed_class("teacher-multi", name="Class 1")
        c2 = _seed_class("teacher-multi", name="Class 2")
        _seed_class("teacher-other", name="Other teacher's class")
        assert resolve_caller_class_ids(teacher) == {c1.class_id, c2.class_id}


class TestResolveCallerGroupCodes:
    def test_empty_when_no_classes(self) -> None:
        teacher = "teacher-empty"
        assert resolve_caller_group_codes(teacher) == set()

    def test_empty_when_classes_have_no_group_codes(self) -> None:
        teacher = "teacher-newish"
        _seed_class("teacher-newish")
        assert resolve_caller_group_codes(teacher) == set()

    def test_union_across_classes(self) -> None:
        teacher = "teacher-multi"
        _seed_class("teacher-multi", name="Class 1", group_codes=["a-b-1", "a-b-2"])
        _seed_class("teacher-multi", name="Class 2", group_codes=["c-d-3"])
        _seed_class("teacher-other", name="Other", group_codes=["x-y-99"])  # excluded
        codes = resolve_caller_group_codes(teacher)
        assert codes == {"a-b-1", "a-b-2", "c-d-3"}
        assert "x-y-99" not in codes
