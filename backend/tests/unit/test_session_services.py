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


class _VertexSemanticsSessionService:
    """Test double that replicates VertexAiSessionService OWNERSHIP semantics.

    The chat-path tests (test_agui, test_documents_reach_agent_e2e) all use
    ``InMemorySessionService``, which lets ANY user_id read ANY session — so the
    "resume a session created under a different uid" failure mode is invisible
    to them. That permissiveness is why the 2026-06-13 deterministic-uid change
    shipped a prod-only outage. This fake closes the gap by enforcing what real
    Vertex does:

      * ``get_session`` -> ``None`` on miss (404); ``ValueError`` "does not
        belong to user" when the session exists under a different owner.
      * ``create_session`` -> ``ValueError`` "already exists" when the
        user-provided session id is taken (regardless of owner).

    It also exposes the ``_get_reasoning_engine_id`` / ``_get_api_client``
    internals the recovery wrapper reads, so the wrapper's owner-lookup path is
    exercised for real rather than monkeypatched.
    """

    def __init__(self):
        self._store: dict[str, tuple[str, object]] = {}

    async def create_session(self, *, app_name, user_id, state=None, session_id=None):
        from google.adk.sessions import Session

        sid = session_id or f"gen-{len(self._store)}"
        if sid in self._store:
            raise ValueError(f"400 INVALID_ARGUMENT. Session with user-provided ID '{sid}' already exists.")
        session = Session(app_name=app_name, user_id=user_id, id=sid, state=state or {})
        self._store[sid] = (user_id, session)
        return session

    async def get_session(self, *, app_name, user_id, session_id, config=None):
        from google.adk.sessions import Session

        entry = self._store.get(session_id)
        if entry is None:
            return None
        owner, _ = entry
        if owner != user_id:
            raise ValueError(f"Session {session_id} does not belong to user {user_id}.")
        return Session(app_name=app_name, user_id=user_id, id=session_id, state={})

    async def list_sessions(self, *, app_name, user_id=None):
        from google.adk.sessions.base_session_service import ListSessionsResponse

        return ListSessionsResponse(sessions=[])

    async def delete_session(self, *, app_name, user_id, session_id):
        self._store.pop(session_id, None)

    async def append_event(self, session, event):
        return event

    def _get_reasoning_engine_id(self, app_name):
        return "eng"

    def _get_api_client(self):
        store = self._store

        class _Raw:
            def __init__(self, uid):
                self.user_id = uid

        class _Sessions:
            async def get(self, *, name):
                sid = name.split("/")[-1]
                entry = store.get(sid)
                return _Raw(entry[0] if entry else None)

        class _Client:
            class agent_engines:  # mirrors the genai client attribute shape
                sessions = _Sessions()

        class _CM:
            async def __aenter__(self_):
                return _Client()

            async def __aexit__(self_, *exc):
                return False

        return _CM()


class TestLegacyResumeThroughRealSessionManager:
    """End-to-end regression for the 2026-06-17 demo outage, driving the REAL
    ``ag_ui_adk`` SessionManager call chain (not a reimplementation) against a
    faithful Vertex-semantics fake. This is the test that would have caught the
    bug: it reproduces the exact prod chain — get_session denied -> swallowed to
    None -> create_session collides "already exists" -> background run dies — and
    pins that the recovery wrapper resolves it.
    """

    @staticmethod
    def _fresh_session_manager(session_service):
        """A fresh ag_ui_adk SessionManager. It is a process-wide singleton
        (``__new__`` caches ``_instance`` and ``__init__`` guards re-init), so a
        test MUST reset ``_instance`` first or it silently reuses a prior test's
        session_service — which is how the control below leaked test 1's wrapper.
        """
        from ag_ui_adk.session_manager import SessionManager

        SessionManager._instance = None
        return SessionManager(session_service=session_service, use_thread_id_as_session_id=True)

    @pytest.mark.asyncio
    async def test_deterministic_uid_resumes_legacy_owned_session(self):
        from adk.session import _LegacyAnonOwnerSessionService

        legacy = "anon-aiplademo1-871820ccd99a42d01b3858da34f55706"
        deterministic = "anon-aiplademo1"
        thread = "a4ab508f-573a-40b9-9a74-0bd0a93a074a"
        app = "aitana_platform"

        fake = _VertexSemanticsSessionService()
        # Session created under the LEGACY per-join uid (pre-migration).
        await fake.create_session(app_name=app, user_id=legacy, session_id=thread)

        mgr = self._fresh_session_manager(_LegacyAnonOwnerSessionService(fake))
        try:
            session, backend_sid = await mgr.get_or_create_session(
                thread_id=thread, app_name=app, user_id=deterministic
            )
            assert session is not None, "deterministic uid must recover the legacy-owned session"
            assert backend_sid == thread
            assert session.user_id == deterministic
        finally:
            if mgr._cleanup_task:
                mgr._cleanup_task.cancel()
            type(mgr)._instance = None

    @pytest.mark.asyncio
    async def test_control_without_wrapper_reproduces_the_outage(self):
        """Same chain WITHOUT the wrapper must still fail with the "already
        exists" collision — proving the guard above actually guards something.
        If this ever stops raising, the bug is no longer reproducible and the
        wrapper test could pass for the wrong reason."""
        legacy = "anon-aiplademo1-871820ccd99a42d01b3858da34f55706"
        deterministic = "anon-aiplademo1"
        thread = "a4ab508f-573a-40b9-9a74-0bd0a93a074a"
        app = "aitana_platform"

        fake = _VertexSemanticsSessionService()
        await fake.create_session(app_name=app, user_id=legacy, session_id=thread)

        mgr = self._fresh_session_manager(fake)
        try:
            with pytest.raises(ValueError, match="already exists"):
                await mgr.get_or_create_session(thread_id=thread, app_name=app, user_id=deterministic)
        finally:
            if mgr._cleanup_task:
                mgr._cleanup_task.cancel()
            type(mgr)._instance = None


class TestSessionReadMemo:
    """One fetch per session per request (2026-09-21).

    Cloud Trace on prod showed a student's turn reading the SAME Agent Engine
    session three times in ~100 ms - ag_ui_adk's cache-hit check, its
    ``pending_tool_calls`` state read, and the Runner's own read - at ~0.6 s
    each, before the model was asked anything. 1.2 s of a 4.8 s median first
    token. The memo collapses those into one fetch, for one request only.
    """

    @staticmethod
    def _build():
        from google.adk.sessions import Session

        from adk.session import _LegacyAnonOwnerSessionService

        class CountingInner:
            calls = 0

            async def get_session(self, *, app_name, user_id, session_id, config=None):
                self.calls += 1
                return Session(app_name=app_name, user_id=user_id, id=session_id)

            async def delete_session(self, *, app_name, user_id, session_id):
                return None

        inner = CountingInner()
        return _LegacyAnonOwnerSessionService(inner), inner

    @pytest.mark.asyncio
    async def test_repeated_reads_inside_one_request_hit_the_backend_once_and_share_the_object(self):
        from adk.session import session_read_memo

        svc, inner = self._build()
        with session_read_memo():
            a = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            b = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            c = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")

        assert inner.calls == 1
        # The SAME object, not an equal copy - ADK appends the student's event
        # to it in place, so every later reader must be holding that object.
        assert a is b is c

    @pytest.mark.asyncio
    async def test_without_an_active_memo_every_read_reaches_the_backend(self):
        """The memo is opt-in per request. A caller outside a stream (the
        messages route, a CLI) keeps the old always-fresh behaviour."""
        svc, inner = self._build()
        await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
        await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
        assert inner.calls == 2

    @pytest.mark.asyncio
    async def test_nothing_survives_the_request(self):
        from adk.session import session_read_memo

        svc, inner = self._build()
        with session_read_memo():
            await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
        with session_read_memo():
            await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
        assert inner.calls == 2

    @pytest.mark.asyncio
    async def test_a_different_session_or_user_is_its_own_fetch(self):
        from adk.session import session_read_memo

        svc, inner = self._build()
        with session_read_memo():
            await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            await svc.get_session(app_name="app", user_id="anon-x", session_id="s2")
            await svc.get_session(app_name="app", user_id="anon-y", session_id="s1")
        assert inner.calls == 3

    @pytest.mark.asyncio
    async def test_a_config_shaped_read_bypasses_the_memo(self):
        """``GetSessionConfig(num_recent_events=…)`` is a different VIEW of the
        session; serving the full object for it, or memoising the partial one,
        would both be wrong."""
        from google.adk.sessions.base_session_service import GetSessionConfig

        from adk.session import session_read_memo

        svc, inner = self._build()
        with session_read_memo():
            await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            await svc.get_session(
                app_name="app", user_id="anon-x", session_id="s1", config=GetSessionConfig(num_recent_events=2)
            )
            await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
        assert inner.calls == 2

    @pytest.mark.asyncio
    async def test_delete_evicts(self):
        from adk.session import session_read_memo

        svc, inner = self._build()
        with session_read_memo():
            await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            await svc.delete_session(app_name="app", user_id="anon-x", session_id="s1")
            await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
        assert inner.calls == 2

    @pytest.mark.asyncio
    async def test_a_background_task_started_inside_the_request_shares_the_memo(self):
        """ag_ui_adk runs the ADK Runner in a task it creates inside ``run()``.
        A task copies the context it was created in, so the Runner's read must
        land in the SAME memo as the reads made before the task existed."""
        import asyncio

        from adk.session import session_read_memo

        svc, inner = self._build()
        with session_read_memo():
            first = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")

            async def runner_side():
                return await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")

            second = await asyncio.create_task(runner_side())

        assert inner.calls == 1
        assert first is second

    @pytest.mark.asyncio
    async def test_the_stream_activates_it(self):
        """The wiring guard: the memo is worthless if ``stream_agui_events`` does
        not open it around the run."""
        from adk import session as session_mod
        from adk.agui import stream_agui_events

        seen: list[bool] = []

        class FakeAgent:
            async def run(self, run_input):
                seen.append(session_mod._read_memo.get() is not None)
                if False:  # pragma: no cover - keeps this an async generator
                    yield None

        assert session_mod._read_memo.get() is None
        async for _ in stream_agui_events(FakeAgent(), run_input=None):  # type: ignore[arg-type]
            pass
        assert seen == [True]
        assert session_mod._read_memo.get() is None


class TestStudentMessageWriteDoesNotBlockTheTurn:
    """The Runner's ``append_event`` of the student's message took ~0.6 s on
    prod and the agent did not start until it returned (Cloud Trace,
    2026-09-21). Nothing downstream reads its result - only the in-memory
    half - so the wire half runs in the background, ordered before any
    later write, and drained before the request ends."""

    @staticmethod
    def _build(*, delay: float = 0.0, fail: bool = False):
        import asyncio

        from google.adk.sessions import Session

        from adk.session import _LegacyAnonOwnerSessionService

        class Inner:
            def __init__(self):
                self.started: list[str] = []
                self.finished: list[str] = []
                self.seen_sessions: list[Session] = []

            async def get_session(self, *, app_name, user_id, session_id, config=None):
                return Session(app_name=app_name, user_id=user_id, id=session_id)

            async def append_event(self, session, event):
                self.started.append(event.author)
                self.seen_sessions.append(session)
                # what the real Vertex service does first: the in-memory half
                session.events.append(event)
                if delay:
                    await asyncio.sleep(delay)
                if fail:
                    raise RuntimeError("wire down")
                self.finished.append(event.author)
                return event

        inner = Inner()
        return _LegacyAnonOwnerSessionService(inner), inner

    @staticmethod
    def _event(author: str):
        from google.adk.events import Event
        from google.genai import types

        return Event(
            author=author,
            content=types.Content(
                role="user" if author == "user" else "model", parts=[types.Part.from_text(text="hej")]
            ),
        )

    @pytest.mark.asyncio
    async def test_the_students_message_returns_before_the_wire_write_finishes(self):
        from adk import session as session_mod
        from adk.session import drain_pending_session_writes, session_read_memo

        svc, inner = self._build(delay=0.05)
        with session_read_memo():
            session = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            await svc.append_event(session, self._event("user"))
            # Returned: the event is in memory; the write is scheduled, not done.
            assert [e.author for e in session.events] == ["user"]
            assert inner.finished == []
            assert len(session_mod._pending_writes.get() or []) == 1
            await drain_pending_session_writes()
            assert inner.finished == ["user"]

    @pytest.mark.asyncio
    async def test_the_real_session_is_not_appended_to_twice(self):
        """The inner service repeats the in-memory half before writing; it
        must do so on a shadow, or the student's message appears twice in the
        history the model sees."""
        from adk.session import drain_pending_session_writes, session_read_memo

        svc, inner = self._build()
        with session_read_memo():
            session = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            await svc.append_event(session, self._event("user"))
            await drain_pending_session_writes()

        assert len(session.events) == 1
        shadow = inner.seen_sessions[0]
        assert shadow is not session
        assert shadow.id == session.id and shadow.app_name == session.app_name

    @pytest.mark.asyncio
    async def test_a_later_write_waits_for_the_students_message_first(self):
        """Order on the wire must match order in memory: the model's reply
        cannot reach Agent Engine before the message it answers."""
        from adk.session import session_read_memo

        svc, inner = self._build(delay=0.05)
        with session_read_memo():
            session = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            await svc.append_event(session, self._event("user"))
            await svc.append_event(session, self._event("tutor"))

        assert inner.finished == ["user", "tutor"]

    @pytest.mark.asyncio
    async def test_outside_a_request_the_write_is_synchronous_as_before(self):
        svc, inner = self._build(delay=0.01)
        from google.adk.sessions import Session

        session = Session(app_name="app", user_id="anon-x", id="s1")
        await svc.append_event(session, self._event("user"))
        assert inner.finished == ["user"]

    @pytest.mark.asyncio
    async def test_a_failed_background_write_is_logged_not_raised(self, caplog):
        """The reply it belongs to has already reached the student; raising
        here would turn a lost history row into a broken stream."""
        import logging

        from adk.session import drain_pending_session_writes, session_read_memo

        svc, _ = self._build(fail=True)
        with session_read_memo(), caplog.at_level(logging.ERROR, logger="adk.session"):
            session = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
            await svc.append_event(session, self._event("user"))
            await drain_pending_session_writes()

        assert any("background write" in r.message for r in caplog.records)

    @pytest.mark.asyncio
    async def test_the_stream_drains_before_it_ends(self):
        """Wiring guard: Cloud Run throttles the CPU once the response is done,
        so a write still in flight at the end of the stream may never land."""
        from adk import session as session_mod
        from adk.agui import stream_agui_events

        svc, inner = self._build(delay=0.02)

        class FakeAgent:
            async def run(self, run_input):
                session = await svc.get_session(app_name="app", user_id="anon-x", session_id="s1")
                await svc.append_event(session, TestStudentMessageWriteDoesNotBlockTheTurn._event("user"))
                if False:  # pragma: no cover
                    yield None

        async for _ in stream_agui_events(FakeAgent(), run_input=None):  # type: ignore[arg-type]
            pass
        assert inner.finished == ["user"]
        assert session_mod._pending_writes.get() is None
