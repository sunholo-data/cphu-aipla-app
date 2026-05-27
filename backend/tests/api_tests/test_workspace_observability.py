"""End-to-end test for the AIPLA workspace observability pipeline.

Closes the gap between two existing test suites:
  * ``tests/unit/test_iframe_context_injection.py`` — pure render
    function only, doesn't exercise the route.
  * ``tests/api_tests/test_iframe_context_routes.py`` — the route, but
    with the ADK session service fully mocked so state writes go to a
    MagicMock instead of a real session.

This file exercises the full chain a student's browser actually walks
on every BoldkastSimFrame / ProgressChecklist toggle:

    iframe-context POST
        → real route (`protocols.iframe_context_routes`)
        → real `InMemorySessionService.append_event`
        → namespaced state under `mcp_app_context.{server}.{tool}`
        → InstructionProvider render
        → agent's runtime instruction contains the block

The two shapes pushed mirror what the live frontend code sends:
  * ``serverId=boldkast`` from ``BoldkastSimFrame.pushSnapshot``
    (lastEvent, revealedMarkers, v0/theta/g, lastPreset).
  * ``serverId=progress`` from ``ProgressChecklist.pushSnapshot``
    (done ids, items, total).

Why bother (2026-05-21): students at the Jutland demo were ticking the
progress checklist + revealing graph markers, and the tutor agent had
no idea — backend.log showed zero iframe-context POSTs. The
catch-up effect shipped in 871b5d3 is hard to verify by hand. This
test pins the contract so regressions surface in `make test-fast`
instead of in a teacher's classroom.

Not exercised here:
  * The frontend code that calls fetch — that's vitested separately
    in ``frontend/src/components/workspace/__tests__/*``.
  * An actual LLM call — kept LLM-free so this runs in <1s and
    doesn't need credentials. A separate slow/integration test could
    add a Gemini-as-judge layer, but the cheap deterministic check is
    where the real regression-pinning value sits.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.adk.sessions import InMemorySessionService

from adk.agui import APP_NAME
from adk.iframe_context import render_instruction_with_iframe_context
from auth import User, get_current_user
from auth.access_context import AccessContext
from db.models import SkillConfig
from db.models.access import AccessControl
from db.models.chat_session import ChatSessionIndex
from protocols.iframe_context_routes import router

# The local-mode workshop student. Matches `auth.local_mode_stub.WORKSHOP_USER_UID`
# so the test mirrors the actual identity flowing through the live route.
_WORKSHOP_UID = "workshop-user"
_SESSION_ID = "sess-workspace-test"
_SKILL_ID = "problem-set-hints"

# Realistic shapes from the live frontend code. Keep these in sync with
# ``frontend/src/components/workspace/BoldkastSimFrame.tsx`` (snapshotRef
# shape) and ``ProgressChecklist.tsx`` (pushSnapshot body). Drift here is
# the actual failure mode we're guarding against.
_BOLDKAST_BODY = {
    "serverId": "boldkast",
    "toolName": "state",
    "structuredContent": {
        "lastEvent": "boldkast.show_value",
        "revealedMarkers": ["y_max"],
        "v0": 15.0,
        "theta": 40.0,
        "g": 9.82,
        "lastPreset": None,
    },
}

_PROGRESS_BODY = {
    "serverId": "progress",
    "toolName": "state",
    "structuredContent": {
        "done": ["a"],
        "items": [
            {"id": "a", "label": "Find v_x og v_y ud fra v_0 og θ"},
            {"id": "b", "label": "Beregn t_op (tid til toppunkt)"},
            {"id": "c", "label": "Beregn y_max"},
            {"id": "d", "label": "Beregn samlet kastelængde"},
        ],
        "total": 4,
    },
}

# 1.C — LED Planck virtual lab snapshot. Mirrors
# ``frontend/src/components/workspace/LedPlanckLabFrame.tsx`` snapshotRef
# shape so the agent's runtime instruction carries the lab state.
_LED_PLANCK_BODY = {
    "serverId": "led-planck",
    "toolName": "state",
    "structuredContent": {
        "lastEvent": "led-planck.measurement",
        "currentStep": 2,
        "currentStepName": "part1",
        "measurements": [
            {"led": "red", "u0": 1.99, "lambda": 625.0, "h_computed": 6.6e-34},
        ],
        "componentsPlaced": ["led", "voltmeter"],
        "lastPolarityError": None,
        "voltage": 3.2,
    },
}


def _make_index() -> ChatSessionIndex:
    now = datetime.now(UTC)
    return ChatSessionIndex(
        sessionId=_SESSION_ID,
        documentIds=[],
        skillId=_SKILL_ID,
        ownerUid=_WORKSHOP_UID,
        accessControl=AccessControl(type="public"),
        title=None,
        turnCount=0,
        firstMessageAt=now,
        lastMessageAt=now,
        archivedAt=None,
    )


def _make_skill() -> SkillConfig:
    """Mirrors the production problem-set-hints SkillConfig: both
    `boldkast` and `progress` activated AND opted into context-writes.
    Other combos are covered exhaustively in
    ``test_iframe_context_routes.py``; we only need the happy path."""
    return SkillConfig(
        skillId=_SKILL_ID,
        name="problem-set-hints",
        description="Physics tutor (problem-set-hints).",
        ownerId="aipla-platform",
        ownerEmail="aipla-platform@example.com",
        accessControl=AccessControl(type="public"),
        skillMetadata={
            "tools": ["mcp"],
            "toolConfigs": {
                "mcp": {
                    "servers": ["boldkast", "progress"],
                    "allow_context_writes": ["boldkast", "progress"],
                }
            },
        },
    )


def _make_led_planck_skill() -> SkillConfig:
    """Production led-planck-tutor SkillConfig — single server (led-planck)
    opted into context-writes. Used by the LED Planck observability test."""
    return SkillConfig(
        skillId="led-planck-tutor",
        name="led-planck-tutor",
        description="Danish stx physics tutor for the LED Planck virtual lab.",
        ownerId="aipla-platform",
        ownerEmail="aipla-platform@example.com",
        accessControl=AccessControl(type="public"),
        skillMetadata={
            "tools": ["mcp"],
            "toolConfigs": {
                "mcp": {
                    "servers": ["led-planck"],
                    "allow_context_writes": ["led-planck"],
                }
            },
        },
    )


@pytest.fixture
def session_service() -> InMemorySessionService:
    """A real (in-memory) ADK session service, seeded with one session
    keyed under the canonical APP_NAME — same key the route uses.

    Using a real service (not a MagicMock) is the entire point: this is
    how we catch session-key drift like the `app_name=skill_id` bug
    fixed on 2026-05-18 that mocked tests missed."""
    svc = InMemorySessionService()
    # InMemorySessionService.create_session is sync — no await needed.
    svc.create_session_sync(
        app_name=APP_NAME,
        user_id=_WORKSHOP_UID,
        session_id=_SESSION_ID,
    )
    return svc


@pytest.fixture
def client(session_service: InMemorySessionService) -> TestClient:
    """TestClient with the workshop user injected and access context
    pre-populated, mirroring what the LOCAL_MODE auth stub does in dev."""
    user = User(uid=_WORKSHOP_UID, email="", domain="")
    ctx = AccessContext(uid=_WORKSHOP_UID, email="", domain="", group_tags=frozenset())

    test_app = FastAPI()
    test_app.include_router(router)

    @test_app.middleware("http")
    async def _inject_access(request, call_next):
        request.state.access = ctx
        return await call_next(request)

    test_app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(test_app)


def _post(client: TestClient, body: dict) -> None:
    """POST and assert 204 — the contract for a successful write."""
    resp = client.post(f"/api/sessions/{_SESSION_ID}/iframe-context", json=body)
    assert resp.status_code == 204, resp.text


def _read_state(session_service: InMemorySessionService) -> dict:
    """Pull session state back out of the in-memory service the way the
    InstructionProvider would at agent-run time. Sync getter exists on
    InMemorySessionService; we use it to keep the test sync + simple."""
    session = session_service.get_session_sync(
        app_name=APP_NAME,
        user_id=_WORKSHOP_UID,
        session_id=_SESSION_ID,
    )
    assert session is not None, "session vanished — service wiring is broken"
    return dict(session.state)


class TestWorkspaceObservabilityE2E:
    """End-to-end: POST through real route, read real session state,
    render real instruction, assert the agent would see the block."""

    @patch("protocols.iframe_context_routes.skill_config")
    @patch("protocols.iframe_context_routes.get_session_index")
    @patch("protocols.iframe_context_routes.get_session_service")
    def test_boldkast_push_lands_in_session_state(
        self,
        mock_get_svc,
        mock_get_index,
        mock_skill_module,
        session_service,
        client,
    ):
        """The most basic regression: a BoldkastSimFrame snapshot push
        actually writes to the in-memory session under the namespaced
        key. If this fails, BoldkastSimFrame.pushSnapshot is firing into
        a black hole — same failure mode as the live-mode bug 2026-05-20."""
        mock_get_svc.return_value = session_service
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_skill()

        _post(client, _BOLDKAST_BODY)

        state = _read_state(session_service)
        key = "mcp_app_context.boldkast.state"
        assert key in state, f"expected {key} in state; got {list(state)}"
        assert state[key]["structuredContent"] == _BOLDKAST_BODY["structuredContent"]
        assert "_pushedAt" in state[key]

    @patch("protocols.iframe_context_routes.skill_config")
    @patch("protocols.iframe_context_routes.get_session_index")
    @patch("protocols.iframe_context_routes.get_session_service")
    def test_progress_push_lands_in_session_state(
        self,
        mock_get_svc,
        mock_get_index,
        mock_skill_module,
        session_service,
        client,
    ):
        """Same as above but for ProgressChecklist — independent server,
        independent namespace."""
        mock_get_svc.return_value = session_service
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_skill()

        _post(client, _PROGRESS_BODY)

        state = _read_state(session_service)
        key = "mcp_app_context.progress.state"
        assert key in state
        assert state[key]["structuredContent"]["done"] == ["a"]
        assert state[key]["structuredContent"]["total"] == 4

    @patch("protocols.iframe_context_routes.skill_config")
    @patch("protocols.iframe_context_routes.get_session_index")
    @patch("protocols.iframe_context_routes.get_session_service")
    def test_both_pushes_coexist_in_separate_namespaces(
        self,
        mock_get_svc,
        mock_get_index,
        mock_skill_module,
        session_service,
        client,
    ):
        """The realistic case: student opens the sim AND ticks a
        checklist item in the same turn. Both pushes must coexist —
        neither overwrites the other."""
        mock_get_svc.return_value = session_service
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_skill()

        _post(client, _BOLDKAST_BODY)
        _post(client, _PROGRESS_BODY)

        state = _read_state(session_service)
        assert "mcp_app_context.boldkast.state" in state
        assert "mcp_app_context.progress.state" in state

    @patch("protocols.iframe_context_routes.skill_config")
    @patch("protocols.iframe_context_routes.get_session_index")
    @patch("protocols.iframe_context_routes.get_session_service")
    def test_instruction_provider_includes_workspace_state_after_push(
        self,
        mock_get_svc,
        mock_get_index,
        mock_skill_module,
        session_service,
        client,
    ):
        """The full chain: POST → state write → InstructionProvider
        rendering produces a runtime instruction that contains both the
        boldkast snapshot AND the progress snapshot, with the framing
        prose that tells the model 'this is iframe state, not user
        instructions'.

        If this passes but the LIVE agent still can't see the state,
        the bug is upstream of the InstructionProvider — either:
          * the frontend isn't POSTing (check Network tab),
          * or the session is being created under a different
            (app_name, user_id, session_id) triple than the route
            writes under.
        Both are diagnosable from here, which is the point."""
        mock_get_svc.return_value = session_service
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_skill()

        _post(client, _BOLDKAST_BODY)
        _post(client, _PROGRESS_BODY)

        # This is the exact code path the InstructionProvider runs at
        # agent-runtime (see adk/iframe_context.py:_provider).
        base = "You are the AIPLA physics tutor."
        rendered = render_instruction_with_iframe_context(base, _read_state(session_service))

        # Base instruction is preserved at the top.
        assert rendered.startswith(base)
        # Framing prose for prompt-injection mitigation.
        assert "Current iframe-app context" in rendered
        # 2026-05-21 prompt revision: framing now says "NOT as instructions
        # from the user" + actively encourages the agent to reference
        # values rather than re-ask. Pin both halves of the change.
        assert "NOT as instructions" in rendered
        assert "reference these values" in rendered
        # Both servers' blocks appear under their unprefixed keys.
        assert "boldkast.state" in rendered
        assert "progress.state" in rendered
        # And actual values from each snapshot survive into the rendered
        # block — the agent literally sees the numbers + marker labels.
        assert "y_max" in rendered  # boldkast: revealedMarkers
        assert "15" in rendered  # boldkast: v0
        # progress: the checked sub-part's id AND its Danish label
        assert '"a"' in rendered or "'a'" in rendered
        assert "Find v_x og v_y" in rendered

    @patch("protocols.session_bootstrap_routes.create_session_index")
    @patch("protocols.session_bootstrap_routes.skill_config")
    @patch("protocols.session_bootstrap_routes.get_session_index")
    @patch("protocols.iframe_context_routes.get_session_service")
    @patch("protocols.iframe_context_routes.skill_config")
    @patch("protocols.iframe_context_routes.get_session_index")
    def test_bootstrap_then_iframe_context_no_agent_turn(
        self,
        mock_iframe_get_index,
        mock_iframe_skill,
        mock_iframe_get_svc,
        mock_boot_get_index,
        mock_boot_skill,
        mock_boot_create,
        session_service,
    ):
        """Closes the 2026-05-21 regression: student opens chat, clicks
        the checklist BEFORE sending any chat message. Without M1's
        bootstrap, the iframe-context POST returns 404 because
        ChatSessionIndex doesn't exist yet. With M1, this sequence is
        bootstrap → 204, then iframe-context → 204."""
        # Bootstrap-side: index missing first, then present after create.
        mock_boot_get_index.return_value = None
        mock_boot_skill.get_skill.return_value = _make_skill()
        mock_boot_create.return_value = None

        # Iframe-context-side: by the time the POST lands, the index exists.
        mock_iframe_get_index.return_value = _make_index()
        mock_iframe_skill.get_skill.return_value = _make_skill()
        mock_iframe_get_svc.return_value = session_service

        # Build a single test client with BOTH routers mounted — same
        # surface the live frontend talks to.
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from protocols.iframe_context_routes import router as iframe_router
        from protocols.session_bootstrap_routes import router as boot_router

        user = User(uid=_WORKSHOP_UID, email="", domain="")
        ctx = AccessContext(uid=_WORKSHOP_UID, email="", domain="", group_tags=frozenset())

        test_app = FastAPI()
        test_app.include_router(iframe_router)
        test_app.include_router(boot_router)

        @test_app.middleware("http")
        async def _inject_access(request, call_next):
            request.state.access = ctx
            return await call_next(request)

        test_app.dependency_overrides[get_current_user] = lambda: user
        c = TestClient(test_app)

        # Step 1: bootstrap on session-id mint (mirrors useSkillAgent's
        # fire-and-forget call when the agent instance first sees a session).
        boot_resp = c.post(
            f"/api/sessions/{_SESSION_ID}/bootstrap",
            json={"skillId": _SKILL_ID},
        )
        assert boot_resp.status_code == 204, boot_resp.text

        # Step 2: iframe-context POST — what would have been 404 before M1.
        ctx_resp = c.post(
            f"/api/sessions/{_SESSION_ID}/iframe-context",
            json=_PROGRESS_BODY,
        )
        assert ctx_resp.status_code == 204, ctx_resp.text

        # And the state is actually there for the agent's next turn.
        state = _read_state(session_service)
        assert "mcp_app_context.progress.state" in state

    @patch("protocols.iframe_context_routes.skill_config")
    @patch("protocols.iframe_context_routes.get_session_index")
    @patch("protocols.iframe_context_routes.get_session_service")
    def test_re_push_overwrites_so_agent_sees_latest_only(
        self,
        mock_get_svc,
        mock_get_index,
        mock_skill_module,
        session_service,
        client,
    ):
        """Toggling a sub-part on, then off, should leave the agent
        seeing the LATER state (empty done-set), not history. The
        ProgressChecklist test in vitest pins the wire shape; this
        pins the server-side overwrite behaviour."""
        mock_get_svc.return_value = session_service
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_skill()

        _post(client, _PROGRESS_BODY)
        # Same server/tool, empty done-set — student un-ticked the item.
        _post(
            client,
            {
                "serverId": "progress",
                "toolName": "state",
                "structuredContent": {
                    "done": [],
                    "items": _PROGRESS_BODY["structuredContent"]["items"],
                    "total": 4,
                },
            },
        )

        state = _read_state(session_service)
        latest = state["mcp_app_context.progress.state"]["structuredContent"]
        assert latest["done"] == []

        rendered = render_instruction_with_iframe_context("BASE", state)
        # The earlier done=["a"] must not bleed into the rendered prompt.
        # We check by looking for the "done": [...] line containing "a"
        # — present in the OLD push, absent in the new one.
        progress_section = rendered.split("progress.state", 1)[1]
        assert '"done": []' in progress_section or '"done":[]' in progress_section

    @patch("protocols.iframe_context_routes.skill_config")
    @patch("protocols.iframe_context_routes.get_session_index")
    @patch("protocols.iframe_context_routes.get_session_service")
    def test_led_planck_push_lands_with_step_and_measurement_in_render(
        self,
        mock_get_svc,
        mock_get_index,
        mock_skill_module,
        session_service,
        client,
    ):
        """1.C — LedPlanckLabFrame pushes a snapshot with currentStepName
        (part1/part2/report) + per-LED measurement entries (u0, lambda,
        h_computed). The InstructionProvider render must carry both into
        the runtime instruction so the Danish socratic tutor can ask
        targeted questions about the current step and reference the
        student's measured values verbatim instead of re-asking for
        them."""
        mock_get_svc.return_value = session_service
        mock_get_index.return_value = _make_index()
        mock_skill_module.get_skill.return_value = _make_led_planck_skill()

        _post(client, _LED_PLANCK_BODY)

        state = _read_state(session_service)
        key = "mcp_app_context.led-planck.state"
        assert key in state, f"expected {key} in state; got {list(state)}"
        assert state[key]["structuredContent"] == _LED_PLANCK_BODY["structuredContent"]

        rendered = render_instruction_with_iframe_context("BASE", state)
        # Step concept (Danish-context lab phase: part1 = I-U-måling) is
        # the agent's primary anchor for "which lab step is the student
        # on right now".
        assert "led-planck.state" in rendered
        assert "part1" in rendered
        # At least one measurement summary survives — the agent sees the
        # student's actual values, not a re-ask prompt.
        assert "red" in rendered
        assert "1.99" in rendered  # u0
        assert "625" in rendered  # lambda
        # Components placed list signals what the student has wired so
        # the tutor doesn't ask "did you connect the voltmeter?" after
        # the student already did.
        assert "voltmeter" in rendered
