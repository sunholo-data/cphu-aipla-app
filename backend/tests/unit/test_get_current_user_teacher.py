"""Unit tests for the teacher Firebase auth path (1.A M3).

The ``User`` model gains an ``is_teacher`` boolean. In v1, all Firebase-
authenticated users ARE teachers (students use anonymous-group; dev uses
LOCAL_MODE stub which is also flagged as teacher). v2 may add non-teacher
Firebase users (e.g. UCPH SSO students) — at which point this flag stops
being a synonym for ``auth_mode == "firebase"`` and the test names will
need updating.

The flag is the gate for ``/api/classes/*`` route handlers — they
require ``user.is_teacher`` to write to the classes collection.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from auth.firebase_auth import User, _user_from_decoded_token


class TestUserModel:
    def test_user_default_is_teacher_false(self) -> None:
        """Backward-compat: existing call sites construct User directly
        with auth_mode='firebase' but no is_teacher kwarg. They should
        keep getting is_teacher=False so existing assertions (which
        don't mention is_teacher) don't shift."""
        u = User(uid="u1")
        assert u.is_teacher is False

    def test_user_can_be_constructed_as_teacher(self) -> None:
        u = User(uid="u1", auth_mode="firebase", is_teacher=True)
        assert u.is_teacher is True
        assert u.auth_mode == "firebase"


class TestFirebasePathMarksTeacher:
    def test_user_from_decoded_token_sets_is_teacher_true(self) -> None:
        """Firebase verifier marks the user as a teacher because in v1
        only teachers carry a Firebase identity."""
        decoded = {"uid": "firebase-uid-123", "email": "alice@example.com"}
        u = _user_from_decoded_token(decoded)
        assert u.uid == "firebase-uid-123"
        assert u.email == "alice@example.com"
        assert u.auth_mode == "firebase"
        assert u.is_teacher is True

    def test_user_from_decoded_token_preserves_group_tags(self) -> None:
        """Firebase JWTs may carry groupTags as custom claims (for
        existing B2B sharing); those round-trip alongside the synthetic
        ``role:teacher`` tag that M8 injects."""
        decoded = {
            "uid": "u1",
            "email": "t@x.com",
            "groupTags": ["dept:physics"],
        }
        u = _user_from_decoded_token(decoded)
        assert u.is_teacher is True
        assert u.group_tags == frozenset({"dept:physics", "role:teacher"})

    def test_user_from_decoded_token_injects_role_teacher_tag(self) -> None:
        """Even when the Firebase JWT carries no custom groupTags claim,
        teacher users get the synthetic role:teacher tag — that's what
        manage-class (and any other tagged-as-teacher-only skill) uses
        to gate access through the existing 5-type evaluator."""
        decoded = {"uid": "u1", "email": "t@x.com"}
        u = _user_from_decoded_token(decoded)
        assert "role:teacher" in u.group_tags


class TestLocalModeStubIsTeacher:
    def test_build_workshop_user_is_teacher(self) -> None:
        """LOCAL_MODE stub user has been the de-facto teacher in dev
        since 1.G-Ph2. Make that explicit so the route guards work in
        LOCAL_MODE without forking the auth shape per env."""
        from auth.local_mode_stub import build_workshop_user

        u = build_workshop_user()
        assert u.is_teacher is True


class TestAnonGroupIsNotTeacher:
    def test_anon_group_user_default_is_not_teacher(self) -> None:
        """Anon-group JWT verification produces a User without
        is_teacher; the route guard rejects with 403."""
        from auth.group_id_auth import AUTH_MODE

        u = User(
            uid="anon-G123-abc",
            email="",
            domain="",
            auth_mode=AUTH_MODE,
            group_id="adjective-noun-12",
        )
        assert u.is_teacher is False


@pytest.mark.asyncio
class TestGetCurrentUserDispatch:
    """Regression: existing get_current_user dispatch paths must keep
    producing User instances. We mock the Firebase verifier to avoid
    needing real ADC credentials in unit tests."""

    async def test_firebase_path_returns_teacher_flagged_user(self, monkeypatch) -> None:
        from auth.firebase_auth import get_current_user

        async def _async_request(scope_state=None):
            from fastapi import Request

            scope = {
                "type": "http",
                "headers": [(b"authorization", b"Bearer fake-firebase-jwt")],
                "method": "GET",
                "path": "/x",
                "query_string": b"",
                "state": scope_state or {},
            }
            req = Request(scope)
            return req

        # Fake the firebase-admin verifier — return a decoded-token shape.
        def fake_verify(token: str):
            return {"uid": "firebase-uid-X", "email": "t@example.com"}

        with patch("auth.firebase_auth.fb_auth.verify_id_token", side_effect=fake_verify):
            req = await _async_request()
            u = await get_current_user(req)
            assert u.is_teacher is True
            assert u.auth_mode == "firebase"
            assert u.uid == "firebase-uid-X"

    async def test_invalid_firebase_token_raises_401(self, monkeypatch) -> None:
        from firebase_admin import auth as fb_auth_real

        from auth.firebase_auth import get_current_user

        async def _async_request():
            from fastapi import Request

            scope = {
                "type": "http",
                "headers": [(b"authorization", b"Bearer bogus")],
                "method": "GET",
                "path": "/x",
                "query_string": b"",
                "state": {},
            }
            return Request(scope)

        def fake_verify(token: str):
            raise fb_auth_real.InvalidIdTokenError("bad")

        with patch("auth.firebase_auth.fb_auth.verify_id_token", side_effect=fake_verify):
            req = await _async_request()
            with pytest.raises(HTTPException) as exc:
                await get_current_user(req)
            assert exc.value.status_code == 401
