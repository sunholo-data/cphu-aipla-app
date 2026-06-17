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

# Model-aware compaction intervals. See backend/config/models.yaml for the
# full model registry. EventsCompactionConfig lives on App, not Agent or Runner.
#
# 1M context (Gemini 3.x, GPT-5.4) → compact every 10 turns
# 200K-400K context (Claude, other GPT-5.x) -> compact every 5 turns
#
# NOTE: gpt-5.4 must come before gpt-5 so the more-specific prefix wins.
_COMPACTION_CONFIGS = {
    "gemini-": EventsCompactionConfig(compaction_interval=10, overlap_size=3),
    "gpt-5.4": EventsCompactionConfig(compaction_interval=10, overlap_size=3),
    "claude-": EventsCompactionConfig(compaction_interval=5, overlap_size=2),
    "gpt-5": EventsCompactionConfig(compaction_interval=5, overlap_size=2),
}
_DEFAULT_COMPACTION = EventsCompactionConfig(compaction_interval=5, overlap_size=2)


def get_compaction_config(model_id: str) -> EventsCompactionConfig:
    """Return model-appropriate EventsCompactionConfig.

    Longer context windows (Gemini) compact less often; shorter ones compact more.
    Config is set on App, not on individual Agents.

    Args:
        model_id: The model identifier string (e.g. "gemini-2.5-flash", "claude-sonnet-4-6").

    Returns:
        EventsCompactionConfig tuned for the model's context window size.
    """
    for prefix, config in _COMPACTION_CONFIGS.items():
        if model_id.startswith(prefix):
            return config
    return _DEFAULT_COMPACTION


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
