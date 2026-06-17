"""Tests for adk/session.py service singletons."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from adk.session import (
    _reset_artifact_service_for_tests,
    _reset_session_service_for_tests,
    get_artifact_service,
    get_session_service,
)


@pytest.fixture(autouse=True)
def _reset_singletons():
    """Ensure singletons are reset between tests."""
    _reset_artifact_service_for_tests()
    _reset_session_service_for_tests()
    yield
    _reset_artifact_service_for_tests()
    _reset_session_service_for_tests()


class TestArtifactServiceSingleton:
    def test_returns_same_instance_on_repeated_calls(self):
        svc1 = get_artifact_service()
        svc2 = get_artifact_service()
        assert svc1 is svc2

    def test_without_bucket_env_returns_in_memory(self):
        from google.adk.artifacts import InMemoryArtifactService

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ADK_ARTIFACT_BUCKET", None)
            svc = get_artifact_service()
        assert isinstance(svc, InMemoryArtifactService)

    def test_with_bucket_env_returns_gcs(self):
        from google.adk.artifacts import GcsArtifactService

        with patch.dict(os.environ, {"ADK_ARTIFACT_BUCKET": "my-test-bucket"}):
            svc = get_artifact_service()
        assert isinstance(svc, GcsArtifactService)

    def test_reset_clears_singleton(self):
        svc1 = get_artifact_service()
        _reset_artifact_service_for_tests()
        svc2 = get_artifact_service()
        assert svc1 is not svc2


class TestSessionServiceSingleton:
    def test_returns_same_instance_on_repeated_calls(self):
        svc1 = get_session_service()
        svc2 = get_session_service()
        assert svc1 is svc2

    def test_without_agent_engine_returns_in_memory(self):
        from google.adk.sessions import InMemorySessionService

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AGENT_ENGINE_ID", None)
            svc = get_session_service()
        assert isinstance(svc, InMemorySessionService)


class TestLocalSessionEscapeHatch:
    """TTFT-OPTIMIZATION 1.21 — AITANA_LOCAL_SESSION=memory forces
    InMemory* services even when AGENT_ENGINE_ID is set, so laptop dev
    avoids per-turn round-trips to Vertex Agent Engine in europe-west1.
    Production unaffected (env var is only set in dev shells)."""

    def test_force_in_memory_overrides_agent_engine_id(self):
        from google.adk.sessions import InMemorySessionService

        with patch.dict(
            os.environ,
            {"AGENT_ENGINE_ID": "999", "AITANA_LOCAL_SESSION": "memory"},
        ):
            svc = get_session_service()
        assert isinstance(svc, InMemorySessionService), "AITANA_LOCAL_SESSION=memory must override AGENT_ENGINE_ID"

    def test_force_in_memory_also_applies_to_memory_service(self):
        from google.adk.memory import InMemoryMemoryService

        from adk.session import get_memory_service

        with patch.dict(
            os.environ,
            {"AGENT_ENGINE_ID": "999", "AITANA_LOCAL_SESSION": "memory"},
        ):
            mem_svc = get_memory_service()
        assert isinstance(mem_svc, InMemoryMemoryService)

    def test_unrelated_value_does_not_force_in_memory(self):
        """Only the literal value 'memory' opts in. Other values (typo,
        empty, '0', 'true') must keep Vertex behaviour so a stray env
        var can't silently downgrade production."""
        from adk.session import _force_in_memory_session

        for val in ("", "true", "1", "yes", "memry", "MEMORY ", "in-memory"):
            with patch.dict(os.environ, {"AITANA_LOCAL_SESSION": val}):
                if val.strip().lower() == "memory":
                    assert _force_in_memory_session(), f"value {val!r} should opt in"
                else:
                    assert not _force_in_memory_session(), f"value {val!r} must NOT opt in"

    def test_uri_helpers_also_respect_the_escape_hatch(self):
        """get_session_service_uri / get_memory_service_uri are passed to
        get_fast_api_app at import time and decide which backend ADK
        uses for its built-in agent endpoints. They MUST honour the
        escape hatch or `make dev` will route the SSE/agent endpoints
        through Vertex even though our skill_processor uses in-memory."""
        from adk.session import get_memory_service_uri, get_session_service_uri

        with patch.dict(
            os.environ,
            {"AGENT_ENGINE_ID": "999", "AITANA_LOCAL_SESSION": "memory"},
        ):
            assert get_session_service_uri() is None
            assert get_memory_service_uri() is None

    def test_memory_value_is_case_insensitive_and_trimmed(self):
        """`MEMORY`, `Memory`, ` memory ` should all opt in — devs will
        type any of these from muscle memory."""
        from adk.session import _force_in_memory_session

        for val in ("memory", "Memory", "MEMORY", " memory", "memory ", "  Memory  "):
            with patch.dict(os.environ, {"AITANA_LOCAL_SESSION": val}):
                assert _force_in_memory_session(), f"value {val!r} should opt in (case/trim)"


class TestLegacyAnonOwnerRecovery:
    """A deterministic anon-group uid (`anon-{code}`, post 2026-06-13) must be
    able to resume a Vertex session created under the LEGACY per-join uid
    (`anon-{code}-{hex}`). Before this wrapper, `get_session` raised
    "... does not belong to user", ag_ui_adk swallowed it to None, and the
    reused thread_id then collided on `create_session` — killing the chat run
    so no text streamed. Reproduces the 2026-06-17 demo outage.
    """

    @staticmethod
    def _build(inner):
        from adk.session import _LegacyAnonOwnerSessionService

        return _LegacyAnonOwnerSessionService(inner)

    @pytest.mark.asyncio
    async def test_recovers_session_owned_by_legacy_suffixed_uid(self):
        from google.adk.sessions import Session

        legacy_owner = "anon-aiplademo1-871820ccd99a42d01b3858da34f55706"
        deterministic = "anon-aiplademo1"
        sid = "a4ab508f-573a-40b9-9a74-0bd0a93a074a"

        class FakeInner:
            async def get_session(self, *, app_name, user_id, session_id, config=None):
                if user_id == legacy_owner:
                    return Session(app_name=app_name, user_id=legacy_owner, id=session_id)
                raise ValueError(f"Session {session_id} does not belong to user {user_id}.")

            def _get_reasoning_engine_id(self, app_name):
                return "5594904500356775936"

        svc = self._build(FakeInner())

        async def fake_read_owner(app_name, session_id):
            return legacy_owner

        svc._read_owner_uid = fake_read_owner  # type: ignore[method-assign]

        session = await svc.get_session(app_name="aitana_platform", user_id=deterministic, session_id=sid)
        assert session is not None, "legacy-owned session must be recoverable"
        # Presented under the requested deterministic uid (append_event keys off id).
        assert session.user_id == deterministic
        assert session.id == sid

    @pytest.mark.asyncio
    async def test_reraises_when_owner_is_a_different_group(self):
        deterministic = "anon-aiplademo1"

        class FakeInner:
            async def get_session(self, *, app_name, user_id, session_id, config=None):
                raise ValueError(f"Session {session_id} does not belong to user {user_id}.")

        svc = self._build(FakeInner())

        async def fake_read_owner(app_name, session_id):
            return "anon-othergroup-deadbeef"  # different group → no recovery

        svc._read_owner_uid = fake_read_owner  # type: ignore[method-assign]

        with pytest.raises(ValueError, match="does not belong to user"):
            await svc.get_session(app_name="aitana_platform", user_id=deterministic, session_id="s1")

    @pytest.mark.asyncio
    async def test_does_not_intercept_teacher_uid_mismatch(self):
        """Firebase teacher uids never start with `anon-`; an ownership error
        for one must surface unchanged, not trigger legacy recovery."""

        class FakeInner:
            async def get_session(self, *, app_name, user_id, session_id, config=None):
                raise ValueError(f"Session {session_id} does not belong to user {user_id}.")

        svc = self._build(FakeInner())
        with pytest.raises(ValueError, match="does not belong to user"):
            await svc.get_session(app_name="aitana_platform", user_id="firebase-teacher-uid", session_id="s1")

    @pytest.mark.asyncio
    async def test_passes_through_normal_hit_without_owner_lookup(self):
        from google.adk.sessions import Session

        class FakeInner:
            async def get_session(self, *, app_name, user_id, session_id, config=None):
                return Session(app_name=app_name, user_id=user_id, id=session_id)

        svc = self._build(FakeInner())
        session = await svc.get_session(app_name="aitana_platform", user_id="anon-aiplademo1", session_id="s1")
        assert session is not None
        assert session.user_id == "anon-aiplademo1"
