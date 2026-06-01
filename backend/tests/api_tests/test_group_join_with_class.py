"""Group → Class binding tests (1.A M5).

When a code is bound to a class (``anon_groups/<code>.classId`` is set),
the minted JWT carries ``group_tags={class.tag_namespace}`` so the
existing tagged-access evaluator picks up the binding.

Live revocation: a stale JWT minted before the class was soft-deleted
must be rejected on the next verify. Tested via the user_from_token
path with a JWT minted *before* revocation and consumed *after*.
"""

from __future__ import annotations

import jwt as _jwt
import pytest

from auth.group_id_auth import (
    AUTH_MODE,
    DEFAULT_TOKEN_LIFETIME_SECONDS,
    JWT_ALGORITHM,
    AnonymousGroupAuth,
    GroupRevoked,
    _signing_secret,
    create_group,
)
from db import classes as classes_db
from db import firestore as fs_module
from db.models.class_ import Class


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _make_class(owner_uid: str = "teacher-A") -> Class:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name="Class")
    classes_db.create_class(cls)
    return cls


def _mint_token_for_code(code: str) -> str:
    """Mint a join token directly — bypasses the rate-limited /join
    endpoint to keep the test focused on the verify-time class-binding
    check rather than join-time rate limiting."""
    import time

    now = time.time()
    claims = {
        "sub": f"anon-{code}-xyz",
        "group_id": code,
        "exp": now + DEFAULT_TOKEN_LIFETIME_SECONDS,
        "iat": now,
        "auth_mode": AUTH_MODE,
    }
    return _jwt.encode(claims, _signing_secret(), algorithm=JWT_ALGORITHM)


class TestBoundGroupCarriesClassNamespace:
    def test_jwt_carries_class_tag_when_bound(self) -> None:
        cls = _make_class()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        code = codes[0]

        token = _mint_token_for_code(code)
        user = AnonymousGroupAuth.user_from_token(token)
        assert user.group_tags == frozenset({cls.tag_namespace})
        assert user.auth_mode == "anonymous_group_id"
        assert user.group_id == code

    def test_unbound_group_keeps_empty_tags(self) -> None:
        """Regression: pre-v1 group codes (no class_id field) must keep
        the legacy frozenset() behaviour so the v0.1 demo flow keeps
        working."""
        record = create_group(
            title="Legacy",
            skill_ids=["skill-x"],
            creator_uid="platform",
        )
        token = _mint_token_for_code(record.group_id)
        user = AnonymousGroupAuth.user_from_token(token)
        assert user.group_tags == frozenset()


class TestRevokedClassRejectsJwt:
    def test_revoked_class_rejects_freshly_minted_jwt(self) -> None:
        cls = _make_class()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        code = codes[0]
        classes_db.revoke_class(cls.class_id)

        token = _mint_token_for_code(code)
        with pytest.raises(GroupRevoked):
            AnonymousGroupAuth.user_from_token(token)

    def test_revoked_class_rejects_stale_jwt(self) -> None:
        """Stale JWT minted BEFORE the class was revoked must also be
        rejected on a fresh verify. This is the live-revocation
        guarantee — we don't trust the JWT, we re-check the class flag
        at every verify."""
        cls = _make_class()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        code = codes[0]
        token = _mint_token_for_code(code)
        # First verify: still valid.
        user = AnonymousGroupAuth.user_from_token(token)
        assert user.group_tags == frozenset({cls.tag_namespace})

        # Now revoke the class. The stale token must fail on next verify.
        classes_db.revoke_class(cls.class_id)
        with pytest.raises(GroupRevoked):
            AnonymousGroupAuth.user_from_token(token)


class TestMissingBoundClass:
    def test_class_doc_deleted_underneath_token_rejects(self) -> None:
        """If the anon_groups doc still has classId pointing to a
        class that no longer exists, reject the token. Falling through
        to empty tags would silently downgrade a class-scoped student
        to public-only — that's a security regression. The anon_groups
        binding is the trigger; missing-target = reject."""
        cls = _make_class()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        code = codes[0]

        # Manually drop the class doc (simulate an operator hard-delete).
        from db.firestore import delete_document

        delete_document("classes", cls.class_id)

        token = _mint_token_for_code(code)
        with pytest.raises(GroupRevoked):
            AnonymousGroupAuth.user_from_token(token)

    def test_teacher_mock_auth_env_flips_is_teacher_for_anon_user(self, monkeypatch) -> None:
        """1.A follow-up demo bypass (2026-05-26): when
        AIPLA_TEACHER_MOCK_AUTH=1 is set on the service, anon-group
        users get is_teacher=True so the /teacher/* pages can reach
        the real /api/classes/* backend without Firebase OAuth.

        Also injects the synthetic role:teacher tag so AccessControl
        gates that scope to teachers (manage-class) work in the
        bypass path."""
        monkeypatch.setenv("AIPLA_TEACHER_MOCK_AUTH", "1")
        cls = _make_class()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        token = _mint_token_for_code(codes[0])

        user = AnonymousGroupAuth.user_from_token(token)
        assert user.is_teacher is True
        assert "role:teacher" in user.group_tags
        # Class binding still applies on top of the bypass.
        assert cls.tag_namespace in user.group_tags

    def test_teacher_mock_auth_default_off_keeps_is_teacher_false(self, monkeypatch) -> None:
        """Without AIPLA_TEACHER_MOCK_AUTH set, anon-group users are NOT
        teachers — the default v1 behavior. Regression guard so the
        bypass doesn't leak into test/prod by accident."""
        monkeypatch.delenv("AIPLA_TEACHER_MOCK_AUTH", raising=False)
        cls = _make_class()
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        token = _mint_token_for_code(codes[0])

        user = AnonymousGroupAuth.user_from_token(token)
        assert user.is_teacher is False
        assert "role:teacher" not in user.group_tags

    def test_anon_groups_doc_missing_falls_through_to_empty(self) -> None:
        """If the anon_groups doc itself is missing (Firestore write
        failed in cloud mode, or pre-2.11 in-memory-only record), the
        JWT's signature already proved legitimacy at the verify layer.
        Fall through to empty tags rather than reject — failing here
        would lock out every legitimate v0.1 demo code in a Firestore
        outage."""
        record = create_group(
            title="legacy",
            skill_ids=["s"],
            creator_uid="u",
        )
        # Simulate the doc missing.
        from db.firestore import delete_document

        delete_document("anon_groups", record.group_id)

        token = _mint_token_for_code(record.group_id)
        user = AnonymousGroupAuth.user_from_token(token)
        assert user.group_tags == frozenset()


class TestLiveSkillResolveAtJoin:
    """join_group() resolves skill_ids live from Class.lessons.

    Bug: mint_group_codes_under_class() snapshots lessons at mint time.
    If a teacher adds/removes lessons after minting, the stored
    GroupRecord.skill_ids is stale. join_group() must look up the class
    and return current lessons instead.
    """

    def test_join_live_resolves_updated_class_lessons(self) -> None:
        cls = Class.create_for_teacher(owner_uid="teacher-B", name="Hold 9A")
        classes_db.create_class(cls)
        classes_db.add_lessons(cls.class_id, ["skill-alpha"])
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        code = codes[0]

        # Teacher adds a second lesson after minting.
        classes_db.add_lessons(cls.class_id, ["skill-beta"])

        from auth.group_id_auth import join_group

        result = join_group(code, client_ip="10.0.0.1")
        assert set(result.skill_ids) == {"skill-alpha", "skill-beta"}

    def test_join_returns_class_name_and_id(self) -> None:
        cls = Class.create_for_teacher(owner_uid="teacher-C", name="IB Physics 1B")
        classes_db.create_class(cls)
        classes_db.add_lessons(cls.class_id, ["skill-x"])
        codes = classes_db.mint_group_codes_under_class(cls.class_id, count=1)
        code = codes[0]

        from auth.group_id_auth import join_group

        result = join_group(code, client_ip="10.0.0.2")
        assert result.class_name == "IB Physics 1B"
        assert result.class_id == cls.class_id

    def test_join_unbound_group_returns_stored_skill_ids_and_no_class(self) -> None:
        record = create_group(title="unbound", skill_ids=["stored-skill"], creator_uid="u")

        from auth.group_id_auth import join_group

        result = join_group(record.group_id, client_ip="10.0.0.3")
        assert result.skill_ids == ("stored-skill",)
        assert result.class_name is None
        assert result.class_id is None
