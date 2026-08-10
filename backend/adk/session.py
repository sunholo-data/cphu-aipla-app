"""ADK service factories — env-var-driven backend selection.

Returns Vertex AI Agent Engine backends when ``AGENT_ENGINE_ID`` is set,
in-memory backends otherwise. Local dev points at the **dev Agent Engine**
(same pattern as Firebase/Firestore: laptop talks to real cloud resources via
ADC) so chat history survives uvicorn auto-reloads and is observable in the
same place as Cloud Run dev.

Service URI helpers are used by get_fast_api_app() which accepts URI strings.
Direct service constructors are available for testing and custom wiring.
"""

from __future__ import annotations

import logging
import os

from google.adk.apps.app import EventsCompactionConfig
from google.adk.artifacts import GcsArtifactService, InMemoryArtifactService
from google.adk.events import Event
from google.adk.memory import InMemoryMemoryService, VertexAiMemoryBankService
from google.adk.sessions import (
    BaseSessionService,
    InMemorySessionService,
    Session,
    VertexAiSessionService,
)
from google.adk.sessions.base_session_service import (
    GetSessionConfig,
    ListSessionsResponse,
)

from config.gcp import require_gcp_project

logger = logging.getLogger(__name__)

# Model-aware compaction config. See backend/config/models.yaml for the full
# model registry. EventsCompactionConfig lives on App, not Agent or Runner.
#
# COMPACTION IS LOSSY AND INVISIBLE — read this before tuning the numbers.
# When a compaction fires, ADK materialises a summary event and *filters the
# raw events out of the request sent to the model*
# (`flows/llm_flows/contents.py::_process_compaction_events`). The raw events
# stay in the session store, so the UI transcript and the Firestore mirror
# still show every turn — but the model can no longer see them, and has no way
# to reach back for them. A student watching a full transcript reasonably
# assumes the tutor sees it too.
#
# TWO TRIGGERS, AND THEY ARE NOT INTERCHANGEABLE (verified on google-adk 1.31.1):
#
#   token_threshold      — fires on real context pressure. Checked pre-request by
#                          `CompactionRequestProcessor`
#                          (flows/llm_flows/compaction.py) off
#                          `invocation_context.events_compaction_config`, and
#                          again post-invocation inside
#                          `_run_compaction_for_sliding_window` off
#                          `app.events_compaction_config`. This is the trigger we
#                          want doing the work.
#   compaction_interval  — fires on a raw count of user turns, blind to their
#                          size. Checked post-invocation by the Runner
#                          (runners.py:622).
#
# Turn count is the wrong trigger on a 1M-token model: ten short clarifying
# turns might be 8K tokens, and discarding them buys nothing while losing
# exactly the detail the student spent those turns establishing. So the token
# threshold is the primary mechanism and the interval is a backstop, set high
# enough that it only catches pathological sessions.
#
# Thresholds are ~25% of the usable window: early enough that one large turn
# can't blow the context, late enough that a normal lesson never compacts.
#
# `event_retention_size` is REQUIRED whenever `token_threshold` is set (ADK's
# model validator rejects one without the other): when token compaction fires,
# the last N *raw events* survive uncompacted. Events, NOT turns — one turn is
# several events (user message, tool call, tool response, model reply).
#
# NOTE: gpt-5.4 must come before gpt-5 so the more-specific prefix wins.
_COMPACTION_CONFIGS = {
    # 1M context (Gemini 3.x, GPT-5.4)
    "gemini-": EventsCompactionConfig(
        compaction_interval=40, overlap_size=5, token_threshold=250_000, event_retention_size=60
    ),
    "gpt-5.4": EventsCompactionConfig(
        compaction_interval=40, overlap_size=5, token_threshold=250_000, event_retention_size=60
    ),
    # 200K-400K context (Claude, other GPT-5.x)
    "claude-": EventsCompactionConfig(
        compaction_interval=20, overlap_size=4, token_threshold=120_000, event_retention_size=40
    ),
    "gpt-5": EventsCompactionConfig(
        compaction_interval=20, overlap_size=4, token_threshold=120_000, event_retention_size=40
    ),
}
# Unknown model → assume the SMALLEST window. Compacting too eagerly degrades an
# answer; overflowing the context fails the turn outright.
_DEFAULT_COMPACTION = EventsCompactionConfig(
    compaction_interval=20, overlap_size=4, token_threshold=120_000, event_retention_size=40
)

# Ops override for the token trigger, so a threshold can be tuned (or compaction
# exercised deliberately in a debugging session) without a redeploy. Applies to
# every family — it is an escape hatch, not a second tuning surface.
_TOKEN_THRESHOLD_ENV = "COMPACTION_TOKEN_THRESHOLD"

# COMPACTION-LATENCY M1 (ported from upstream) — how much higher the
# PRE-REQUEST trigger sits than the routine one. Upstream measured the cost of
# in-request compaction (2026-08-06, 18 real turns): TTFT +13.6s, tail +28.2s,
# and every compacting turn compacted TWICE (both ADK paths fired). The two
# paths read DIFFERENT config objects, which is the whole trick: raise the
# threshold on the per-invocation copy and the pre-request path stops firing,
# while the App-level config keeps the post-invocation path doing the routine
# work at the end of the turn, while the student reads.
#
# The pre-request path is NOT disabled — it is the safety net that stops a turn
# exceeding the model's context window, and a failed turn is worse than a slow
# one. DERIVED FROM THE MODEL'S REAL WINDOW, not a multiple of the routine
# threshold: a relative threshold moves with the routine one, so a big enough
# conversation crosses both and the fix defeats itself (upstream measured
# exactly that with `routine * 3`).
_EMERGENCY_WINDOW_FRACTION = 0.8

# Fallback when the model isn't in the registry. Assumes the smallest window we
# ship — an emergency threshold that is too LOW merely compacts in-request
# sooner; too HIGH risks a failed turn.
_FALLBACK_CONTEXT_WINDOW = 200_000

# Built once, shared by every config copy. The summarizer is stateless and
# resolving a model is not free, so rebuilding it per call would put a registry
# lookup on a path that runs for every agent construction.
_summarizer_singleton = None
_summarizer_built = False


def _compaction_summarizer():
    """The explicit summarizer (see adk/compaction_summarizer.py).

    Lazy + memoised, including a memoised None: if the model can't be resolved
    we must not retry the lookup on every call, and ADK falls back to its own
    default summarizer (which drops tool results but still works).
    """
    global _summarizer_singleton, _summarizer_built
    if not _summarizer_built:
        from adk.compaction_summarizer import build_compaction_summarizer

        _summarizer_singleton = build_compaction_summarizer()
        _summarizer_built = True
    return _summarizer_singleton


def get_compaction_config(model_id: str) -> EventsCompactionConfig:
    """Return model-appropriate EventsCompactionConfig.

    Larger context windows get a higher token threshold and a higher turn-count
    backstop. An unrecognised model gets the SMALLEST window's config, because
    compacting too eagerly costs answer quality while overflowing the context
    fails the turn outright.

    ``COMPACTION_TOKEN_THRESHOLD`` overrides the token trigger for every family.

    Args:
        model_id: The model identifier string (e.g. "gemini-3.5-flash-lite",
            "claude-sonnet-4-6"). Matched by prefix against the model family.

    Returns:
        EventsCompactionConfig tuned for the model's context window size. Always
        a FRESH copy carrying an explicit summarizer — see below.
    """
    config = _DEFAULT_COMPACTION
    for prefix, candidate in _COMPACTION_CONFIGS.items():
        if model_id.startswith(prefix):
            config = candidate
            break

    # Never hand out the module-level singleton. ADK's
    # `_ensure_compaction_summarizer` MUTATES the config in place
    # (`config.summarizer = LlmEventSummarizer(llm=agent.canonical_model)`), so
    # returning the shared object would let the first skill that compacts pin
    # its own model as the summarizer for every skill afterwards. Setting
    # `summarizer` ourselves also makes that ADK branch return early, so the
    # copy is belt-and-braces — but the copy is what makes it SAFE if the
    # summarizer ever fails to build and comes back None.
    config = config.model_copy(update={"summarizer": _compaction_summarizer()})

    override = os.environ.get(_TOKEN_THRESHOLD_ENV)
    if override:
        try:
            threshold = int(override)
        except ValueError:
            # Never let a typo'd env var silently restore turn-count compaction —
            # that failure would be invisible and would look like a model bug.
            logger.warning(
                "%s=%r is not an integer; ignoring and using the %s default (%s).",
                _TOKEN_THRESHOLD_ENV,
                override,
                model_id,
                config.token_threshold,
            )
        else:
            if threshold <= 0:
                logger.warning(
                    "%s=%d must be > 0 (ADK rejects it); ignoring.",
                    _TOKEN_THRESHOLD_ENV,
                    threshold,
                )
            else:
                logger.info(
                    "%s=%d overriding the %s default (%s).",
                    _TOKEN_THRESHOLD_ENV,
                    threshold,
                    model_id,
                    config.token_threshold,
                )
                return config.model_copy(update={"token_threshold": threshold})
    return config


def context_window_for(model_id: str) -> int:
    """The model's real context window, from the registry.

    Accepts either a registry id (``gemini-3-6-flash``) or a raw API name
    (``gemini-3.6-flash``) — the latter is the form a running agent actually
    carries (``agent.model.model``), so without that match every production
    lookup would silently take the fallback and quietly halve the emergency
    line. Falls back to the smallest window we ship when the model isn't
    registered; erring small is the safe direction (a low emergency threshold
    just compacts in-request sooner, while a high one risks a failed turn).
    """
    if not model_id:
        return _FALLBACK_CONTEXT_WINDOW
    try:
        from config.models import load_models_config

        for candidate in load_models_config().models:
            if model_id in (candidate.id, candidate.api_name) and candidate.context_window:
                return int(candidate.context_window)
    except Exception as exc:
        logger.debug("context window lookup failed for %r (%s); using fallback", model_id, exc)
    return _FALLBACK_CONTEXT_WINDOW


def emergency_compaction_config(config: EventsCompactionConfig, model_id: str = "") -> EventsCompactionConfig:
    """The same config with the token trigger raised to emergency-only.

    Applied to the PER-INVOCATION copy so the pre-request processor stops doing
    routine work. The App-level config is untouched, so post-invocation
    compaction — which runs at the end of a turn, while the student reads —
    still keeps the conversation in budget.

    The emergency threshold is an ABSOLUTE line derived from the model's context
    window, NOT a multiple of the routine threshold — a relative threshold rises
    with the routine one, so a large conversation crosses both and the
    pre-request path fires anyway. Emergency has to mean "this turn is about to
    overflow", not "somewhat more than usual".

    Never LOWERS the threshold — on a small-window model the derived value can
    land under the routine one, and lowering it would make the pre-request path
    fire *more* eagerly, the exact opposite of the point.

    Returns a COPY. Mutating the input would defeat the whole thing: these
    configs are shared, and ADK itself mutates ``summarizer`` in place.
    """
    if config.token_threshold is None:
        # No token trigger to demote (a config relying on the turn-count
        # backstop alone). Leave it exactly as it is.
        return config
    emergency = int(context_window_for(model_id) * _EMERGENCY_WINDOW_FRACTION)
    if emergency <= config.token_threshold:
        # No demotion possible. Legitimate on a genuinely small-window model,
        # but it ALSO happens when `model_id` couldn't be resolved and we fell
        # back to the smallest window — in which case the latency fix silently
        # does nothing. Log it, so a no-op is observable rather than assumed.
        logger.info(
            "compaction: no pre-request demotion for model=%r "
            "(emergency line %d <= routine %d) — routine compaction may still land in TTFT",
            model_id or "<unknown>",
            emergency,
            config.token_threshold,
        )
        return config
    return config.model_copy(update={"token_threshold": emergency})


def _normalize_agent_engine_id(value: str) -> str:
    """Accept either a full resource name or just the numeric ID; return numeric ID.

    ADK's VertexAiSessionService / VertexAiMemoryBankService expect the trailing
    numeric suffix. If a caller passes the full `projects/.../reasoningEngines/NNN`
    resource name, the SDK builds a URL with a doubled `reasoningEngines/` prefix
    and every session call 404s. Strip defensively so either form works.
    """
    return value.rstrip("/").rsplit("/", 1)[-1] if "/" in value else value


def _session_location() -> str:
    """Resolve the GCP region for VertexAiSessionService / VertexAiMemoryBankService.

    Defaults to ``GOOGLE_CLOUD_LOCATION`` to preserve the upstream-template
    behaviour (where the same region serves both Gemini and Agent Engine).
    AIPLA overrides ``GOOGLE_CLOUD_LOCATION=global`` so gemini-3.5-flash
    routes via the global Vertex endpoint; Agent Engine isn't hosted on
    ``global``, so a dedicated ``VERTEX_SESSION_LOCATION`` env var pins
    sessions + memory to a real region (europe-west1 on AIPLA dev).
    """
    return os.environ.get("VERTEX_SESSION_LOCATION") or os.environ["GOOGLE_CLOUD_LOCATION"]


def _force_in_memory_session() -> bool:
    """Local-dev escape hatch — force InMemory* services even when
    AGENT_ENGINE_ID is set.

    Why: from a laptop the Vertex Agent Engine session-service round-trip
    to europe-west1 dominates per-turn TTFT (~5.7s of a 9s first-token
    time, per docs/design/v6.1.0/ttft-optimization.md M1 baseline).
    Cloud Run in europe-west1 pays only ~120ms for the same call, so
    production behaviour is unaffected — this flag is for laptops.

    Set ``AITANA_LOCAL_SESSION=memory`` in a developer's shell or
    ``backend/.env`` to opt in. Any other value (including unset) keeps
    Vertex when ``AGENT_ENGINE_ID`` is set, matching the historical
    default.

    The flag intentionally affects BOTH session AND memory services —
    they share the same ``AGENT_ENGINE_ID`` and the same per-turn
    round-trip pattern. Artifact service (GCS) is left alone; it's
    touched on document upload, not on every chat turn.
    """
    return os.environ.get("AITANA_LOCAL_SESSION", "").strip().lower() == "memory"


def _is_deterministic_anon_uid(uid: str) -> bool:
    """True for the post-2026-06-13 deterministic anon-group uid ``anon-{code}``.

    The deterministic uid has exactly one hyphen (the ``anon-`` prefix); the
    LEGACY per-join uid ``anon-{code}-{random_hex}`` has two, and teacher
    Firebase uids never start with ``anon-``. See
    ``auth/group_id_auth.py:_synthesize_uid``.
    """
    return uid.startswith("anon-") and uid.count("-") == 1


class _LegacyAnonOwnerSessionService(BaseSessionService):
    """Let a deterministic anon-group uid open sessions owned by a LEGACY uid.

    Anonymous-group students used to get a per-join uid
    ``anon-{code}-{random_hex}`` (each join = a distinct ADK user). On
    2026-06-13 this became a deterministic ``anon-{code}`` so a group shares
    one conversation (``auth/group_id_auth.py:_synthesize_uid``). ADK + Firestore
    *queries* were taught to match BOTH schemes (``anon_owner_uid_match``), but a
    live Vertex Agent Engine session is owned by exactly one uid and
    ``VertexAiSessionService.get_session`` enforces an exact match. So a session
    created before the migration (owner ``anon-{code}-{hex}``) raises
    ``... does not belong to user anon-{code}`` when the deterministic uid
    resumes it; ag_ui_adk swallows that to ``None``, ``create_session`` then
    collides on the reused thread_id ("Session ... already exists"), the
    background ADK run dies, and chat returns no text.

    This wrapper closes the gap at the service layer — every caller goes through
    ``get_session_service()``. On an ownership mismatch for a deterministic anon
    uid it reads the session's real owner; if that owner is a legacy uid of the
    SAME group (``anon-{code}-*``) it re-opens the session under the real owner
    and presents it back under the requested uid. ``append_event`` addresses the
    backend by session id (not uid), so writes keep working. Sessions created
    after the migration match exactly and never hit this path.
    """

    def __init__(self, inner: BaseSessionService) -> None:
        self._inner = inner

    async def create_session(
        self,
        *,
        app_name: str,
        user_id: str,
        state: dict | None = None,
        session_id: str | None = None,
    ) -> Session:
        return await self._inner.create_session(app_name=app_name, user_id=user_id, state=state, session_id=session_id)

    async def get_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        config: GetSessionConfig | None = None,
    ) -> Session | None:
        try:
            return await self._inner.get_session(
                app_name=app_name, user_id=user_id, session_id=session_id, config=config
            )
        except ValueError as exc:
            if "does not belong to user" not in str(exc) or not _is_deterministic_anon_uid(user_id):
                raise
            owner = await self._read_owner_uid(app_name, session_id)
            if not owner or not owner.startswith(f"{user_id}-"):
                raise
            logger.warning(
                "anon-group legacy session recovery: re-opening %s (owner %s) under %s",
                session_id,
                owner,
                user_id,
            )
            session = await self._inner.get_session(
                app_name=app_name, user_id=owner, session_id=session_id, config=config
            )
            if session is not None:
                # Present under the requested deterministic uid; append_event
                # addresses the backend by session id so persistence is unaffected.
                session.user_id = user_id
            return session

    async def list_sessions(self, *, app_name: str, user_id: str | None = None) -> ListSessionsResponse:
        return await self._inner.list_sessions(app_name=app_name, user_id=user_id)

    async def delete_session(self, *, app_name: str, user_id: str, session_id: str) -> None:
        await self._inner.delete_session(app_name=app_name, user_id=user_id, session_id=session_id)

    async def append_event(self, session: Session, event: Event) -> Event:
        return await self._inner.append_event(session=session, event=event)

    async def _read_owner_uid(self, app_name: str, session_id: str) -> str | None:
        """Read a session's true owner uid via the inner Vertex client.

        Returns None (caller re-raises the original "does not belong" error) when
        the inner service doesn't expose the Vertex internals or the lookup fails.
        """
        get_engine = getattr(self._inner, "_get_reasoning_engine_id", None)
        get_client = getattr(self._inner, "_get_api_client", None)
        if get_engine is None or get_client is None:
            return None
        try:
            engine = get_engine(app_name)
            async with get_client() as client:
                raw = await client.agent_engines.sessions.get(name=f"reasoningEngines/{engine}/sessions/{session_id}")
            return getattr(raw, "user_id", None)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("anon-group legacy recovery: owner lookup failed for %s: %s", session_id, exc)
            return None

    def __getattr__(self, name: str):
        # Forward any non-overridden attribute (express-mode helpers, list_events,
        # etc.) to the wrapped service. Guard _inner to avoid recursion before
        # __init__ has set it.
        if name == "_inner":
            raise AttributeError(name)
        return getattr(self._inner, name)


_session_service_singleton: BaseSessionService | None = None


def _reset_session_service_for_tests() -> None:
    """Reset the singleton so tests can exercise different env-var combinations."""
    global _session_service_singleton
    _session_service_singleton = None


def get_session_service() -> BaseSessionService:
    """Get session service — Vertex AI Agent Engine or in-memory.

    Returns a module-level singleton so all callers (skill_processor, messages
    endpoint) share the same in-memory store in local dev. In prod the Vertex
    AI service is stateless so multiple instances would be fine, but a
    singleton is still cheaper to construct.

    The Vertex service is wrapped in ``_LegacyAnonOwnerSessionService`` so
    anonymous-group sessions created under the pre-2026-06-13 per-join uid
    remain resumable under the current deterministic group uid.
    """
    global _session_service_singleton
    if _session_service_singleton is None:
        agent_engine_id = os.environ.get("AGENT_ENGINE_ID")
        if agent_engine_id and not _force_in_memory_session():
            _session_service_singleton = _LegacyAnonOwnerSessionService(
                VertexAiSessionService(
                    project=require_gcp_project(),
                    location=_session_location(),
                    agent_engine_id=_normalize_agent_engine_id(agent_engine_id),
                )
            )
        else:
            _session_service_singleton = InMemorySessionService()
    return _session_service_singleton


def get_memory_service() -> InMemoryMemoryService | VertexAiMemoryBankService:
    """Get memory service — Vertex AI Agent Engine or in-memory."""
    agent_engine_id = os.environ.get("AGENT_ENGINE_ID")
    if agent_engine_id and not _force_in_memory_session():
        return VertexAiMemoryBankService(
            project=require_gcp_project(),
            location=_session_location(),
            agent_engine_id=_normalize_agent_engine_id(agent_engine_id),
        )
    return InMemoryMemoryService()


_artifact_service_singleton: InMemoryArtifactService | GcsArtifactService | None = None


def _reset_artifact_service_for_tests() -> None:
    """Reset the singleton so tests can exercise different env-var combinations."""
    global _artifact_service_singleton
    _artifact_service_singleton = None


def get_artifact_service() -> InMemoryArtifactService | GcsArtifactService:
    """Get artifact service — GCS or in-memory, process-level singleton.

    Singleton ensures the upload endpoint and ADK runner share the same
    InMemoryArtifactService in local dev. In prod GCS is shared by bucket name
    and a singleton is still cheaper to construct.
    """
    global _artifact_service_singleton
    if _artifact_service_singleton is None:
        bucket = os.environ.get("ADK_ARTIFACT_BUCKET")
        if bucket:
            _artifact_service_singleton = GcsArtifactService(bucket_name=bucket)
        else:
            _artifact_service_singleton = InMemoryArtifactService()
    return _artifact_service_singleton


# --- URI helpers for get_fast_api_app() ---


def get_session_service_uri() -> str | None:
    """Get session service URI for get_fast_api_app(). None = in-memory.

    Returns the FULL resource path (``agentengine://projects/.../locations/<loc>/reasoningEngines/<id>``)
    so ADK's service registry pulls the location off the URI itself rather
    than falling back to ``GOOGLE_CLOUD_LOCATION``. AIPLA sets
    ``GOOGLE_CLOUD_LOCATION=global`` for gemini-3.5-flash routing; Agent
    Engine doesn't live on ``global``, so a bare numeric URI would 404.
    """
    agent_engine_id = os.environ.get("AGENT_ENGINE_ID")
    if agent_engine_id and not _force_in_memory_session():
        numeric = _normalize_agent_engine_id(agent_engine_id)
        project = require_gcp_project()
        location = _session_location()
        return f"agentengine://projects/{project}/locations/{location}/reasoningEngines/{numeric}"
    return None


def get_artifact_service_uri() -> str | None:
    """Get artifact service URI for get_fast_api_app(). None = in-memory."""
    bucket = os.environ.get("ADK_ARTIFACT_BUCKET")
    if bucket:
        return f"gs://{bucket}"
    return None


def get_memory_service_uri() -> str | None:
    """Get memory service URI for get_fast_api_app(). None = in-memory.

    Returns the FULL resource path so ADK's service registry parses
    location off the URI rather than ``GOOGLE_CLOUD_LOCATION``. See
    ``get_session_service_uri`` for the rationale.
    """
    agent_engine_id = os.environ.get("AGENT_ENGINE_ID")
    if agent_engine_id and not _force_in_memory_session():
        numeric = _normalize_agent_engine_id(agent_engine_id)
        project = require_gcp_project()
        location = _session_location()
        return f"agentengine://projects/{project}/locations/{location}/reasoningEngines/{numeric}"
    return None
