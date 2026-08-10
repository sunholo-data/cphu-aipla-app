"""AG-UI / ADK glue for the skill streaming endpoint.

`ag_ui_adk.ADKAgent` already converts ADK events to AG-UI events (its
1.3kloc `event_translator.py` handles the full mapping). Rolling our own
translator just to re-emit the same SSE sequence would duplicate that
work and drift against upstream. Instead this module does the two things
the library does *not* do:

  * `build_agui_adk_agent(agent, ...)` — wraps an ADK agent with platform
    defaults (``app_name``, the three real backing services from
    ``adk.session``, thread-id-as-session-id) so the skill processor gets
    a ready-to-run bridge.
  * `stream_agui_events(agui_agent, run_input)` — serializes each AG-UI
    event to a JSON-safe dict (what the SSE layer writes to the wire).

Design reconciliation (2026-04-21): the AGENT-FACTORY sprint plan called
for a `_to_agui_event(adk_event)` helper "moved from the spike". The
spike used the library, not a hand-rolled translator, so there is no
such logic to move. The library boundary — `ADKAgent.run()` — is where
this module integrates instead.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from ag_ui.core import RunAgentInput
from ag_ui_adk import ADKAgent
from google.adk.agents import BaseAgent
from google.adk.artifacts import BaseArtifactService
from google.adk.memory import BaseMemoryService
from google.adk.sessions import BaseSessionService

APP_NAME = "aitana_platform"
_DEFAULT_APP_NAME = APP_NAME  # backwards-compat alias


def _deployment_app():
    """The `App` declared in ``backend/app.py``.

    Imported lazily and inside the function, not at module scope: ``app.py``
    imports from ``adk.*`` (artifact tools, session services), so a top-level
    import here would close a cycle. It also builds the root agent and its
    tool tree at import time, which module-level would put GCP SDK
    construction on the critical path of anything that merely imports
    ``adk.agui`` — including the CLI and most unit tests.

    Kept as a seam (rather than inlined) so a test can substitute an App
    without monkeypatching a module attribute.
    """
    from app import app as deployment_app

    return deployment_app


def build_agui_adk_agent(
    agent: BaseAgent,
    *,
    user_id: str | None = None,
    session_service: BaseSessionService | None = None,
    memory_service: BaseMemoryService | None = None,
    artifact_service: BaseArtifactService | None = None,
    app_name: str = APP_NAME,
) -> ADKAgent:
    """Wrap a built ADK agent as an AG-UI middleware agent.

    Defaults every backing service to the singletons in ``adk.session`` so
    the production skill stream gets the *real* Vertex/GCS backends, not
    ag_ui_adk's silent in-memory fallback. Tests pass explicit services and
    keep working unchanged.

    ``user_id`` MUST be the authenticated Firebase uid in production paths
    (chat-history-deep-fixes-2 / 1.15). When omitted, ag_ui_adk falls back
    to a default extractor that derives the user_id from the AG-UI
    thread_id (``f"thread_user_{thread_id}"``). The Firestore
    ``chat_sessions/{id}.owner_uid`` is written from the Firebase uid, so
    the default extractor produces a Vertex session under a different
    user_id than the one we look it up by — every subsequent
    ``GET /api/sessions/{id}/messages`` then 500s with
    ``ValueError: Session ... does not belong to user``. Pass the Firebase
    uid here to keep the (app_name, user_id, session_id) triple consistent.

    ``use_in_memory_services=True`` is left set so the credential service
    (which we don't have a real backend for) gets ag_ui_adk's
    InMemoryCredentialService default. Our explicit
    ``session_service``/``memory_service``/``artifact_service`` arguments
    win over the in-memory fallback because ag_ui_adk uses
    ``provided or InMemoryX()`` — see
    ``ag_ui_adk/adk_agent.py:176-184``.

    ``use_thread_id_as_session_id=True`` so AG-UI threadIds map 1:1 onto
    ADK sessions; default is False (mints a fresh ADK session per turn
    and discards conversation memory between turns).
    """
    # Lazy import: adk.session imports heavy GCP SDKs whose presence we
    # don't want at module-import time (test isolation, fast CLI startup).
    from adk.session import (
        get_artifact_service,
        get_memory_service,
        get_session_service,
    )

    # COMPACTION-WIRE M1 (ported from upstream v6.23.0) — build via `from_app`
    # so the deployment's App (and therefore `events_compaction_config`) reaches
    # the Runner.
    #
    # WHY: ag_ui_adk only sets its internal `_app` from `from_app()`. Built the
    # old way (`ADKAgent(adk_agent=...)`), `_app` stays None and `_create_runner`
    # takes the component branch — `Runner(app_name=…, agent=…)` with NO App. A
    # Runner with `app is None` disables both compaction triggers
    # (google-adk 1.31.1 runners.py:622 and :1480 each guard on it), which is
    # why the tuning table in `adk/session.py` had never affected a chat turn.
    # Upstream measured 25 turns at compaction_interval=10: 0 compactions.
    #
    # The App we pass carries OUR per-skill agent as root, not the deployment's
    # global root agent. `from_app` does `cls(adk_agent=app.root_agent, ...)`,
    # so handing it the App unmodified would make every skill execute the global
    # root agent — every physics tutor silently becoming the same generic
    # assistant, with no error raised. `app_name` rides on the same copy (the
    # App owns the name under `from_app`).
    base_app = _deployment_app()
    request_app = base_app.model_copy(update={"root_agent": agent, "name": app_name})

    kwargs: dict[str, Any] = {
        "session_service": session_service or get_session_service(),
        "memory_service": memory_service or get_memory_service(),
        "artifact_service": artifact_service or get_artifact_service(),
        "use_in_memory_services": True,
        "use_thread_id_as_session_id": True,
        # DO NOT REMOVE. ag_ui_adk's SessionManager runs a background sweep
        # (every ``cleanup_interval_seconds``) that DELETES any tracked session
        # idle longer than ``session_timeout_seconds`` — and both defaults are
        # hostile to a persistent chat product: 1200s (20 min) and
        # ``delete_session_on_cleanup=True``. With Vertex as the session store
        # that delete is permanent: it removes the session AND its events from
        # Agent Engine, so a conversation a class had 20 minutes ago is gone.
        #
        # The Firestore ``chat_sessions`` index is metadata-only and is NOT
        # touched by the sweep, so the row survives — the conversation keeps
        # listing in the left panel and resuming it renders a blank chat. On
        # the upstream template this destroyed 19 of 75 real conversations
        # before it was caught. AIPLA's shared per-group sessions make an
        # idle-20-minutes-then-resume pattern the NORM (lessons, homework),
        # not the tail.
        #
        # Sessions are durable by design here — Vertex applies its own 365-day
        # TTL — so cleanup must never delete. The timeout is raised too so the
        # sweep stops treating a 20-minute-idle chat as garbage at all.
        "delete_session_on_cleanup": False,
        "session_timeout_seconds": 86400,
    }
    if user_id is not None:
        kwargs["user_id"] = user_id
    # NOTE: every session knob above must stay passed EXPLICITLY. `from_app`
    # re-declares them with ag_ui_adk's own hostile defaults
    # (delete_session_on_cleanup=True, session_timeout_seconds=1200,
    # use_thread_id_as_session_id=False). `TestSessionSafetySurvivesTheWiring`
    # in tests/unit/test_compaction_reaches_chat_runner.py fails loudly if any
    # of them regress.
    return ADKAgent.from_app(request_app, **kwargs)


async def stream_agui_events(
    agui_agent: ADKAgent,
    run_input: RunAgentInput,
) -> AsyncGenerator[dict, None]:
    """Run the agent and yield each AG-UI event as a plain dict.

    `ADKAgent.run()` yields `ag_ui.core.BaseEvent` pydantic models. We
    serialize via `model_dump(by_alias=True)` so SSE writers can call
    `json.dumps(event)` without bespoke encoders.

    TTFT instrumentation: between each ADK event we drain any pending
    STAGE_PROGRESS Custom events queued on the per-request LatencyTracker
    (see ``observability/timing.py``). ``first_agui_event`` and
    ``first_model_token`` (= first TEXT_MESSAGE_CONTENT) are marked here.
    All instrumentation calls short-circuit when ``AITANA_TTFT_MODE=off``.
    """
    # Lazy import: avoid pulling observability into module-import path of
    # tests that don't exercise the streaming code.
    from observability.timing import (
        STAGE_FIRST_AGUI_EVENT,
        STAGE_FIRST_MODEL_TOKEN,
        get_current_tracker,
    )

    tracker = get_current_tracker()
    first_agui_event_seen = False
    first_model_token_seen = False

    # Drain any STAGE_PROGRESS that fired before the agent yielded its
    # first event (the loader runs entirely before ADK emits anything).
    for stage_event in tracker.drain_stage_events():
        yield stage_event.model_dump(by_alias=True, exclude_none=True)

    async for event in agui_agent.run(run_input):
        if not first_agui_event_seen:
            tracker.mark(STAGE_FIRST_AGUI_EVENT)
            first_agui_event_seen = True

        # First TEXT_MESSAGE_CONTENT == first model-emitted token reaching
        # the wire. Earlier signals (RUN_STARTED, TEXT_MESSAGE_START) are
        # handshake events ag_ui_adk emits before the model speaks.
        event_type = getattr(event, "type", None)
        if not first_model_token_seen and event_type is not None:
            type_value = getattr(event_type, "value", str(event_type))
            if type_value == "TEXT_MESSAGE_CONTENT":
                tracker.mark(STAGE_FIRST_MODEL_TOKEN)
                first_model_token_seen = True
            elif type_value == "TOOL_CALL_START":
                tracker.increment_tool_invocations()

        yield event.model_dump(by_alias=True, exclude_none=True)

        # After each ADK event, flush any STAGE_PROGRESS that fired during
        # callback execution (e.g. before_model_callback marks
        # ``before_model_done`` with label "Thinking…"). Done in-loop so
        # the order on the wire matches the order marks fired.
        for stage_event in tracker.drain_stage_events():
            yield stage_event.model_dump(by_alias=True, exclude_none=True)
