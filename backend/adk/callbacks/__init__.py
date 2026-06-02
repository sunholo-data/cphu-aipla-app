"""ADK callback hooks for the AIPLA platform.

Callbacks wired into every skill by ``adk.agent.create_agent``:
  * ``before_tool_callback``   = ``make_permission_enforcer(email, domain)``
  * ``before_agent_callback``  = ``make_before_agent(skill_id)`` composed with
                                 ``make_session_tracker(owner_uid)``
  * ``after_agent_callback``   = ``make_after_agent_response(owner_uid)``
  * ``after_tool_callback``    = ``_handle_large_output``

Submodules:
  permission   — tool permission enforcement + OTEL span annotation
  document     — document loading into artifacts + LLM request injection
  session      — session index creation + turn counter maintenance
  large_output — oversized tool-response offloading to ADK artifacts
"""

from adk.callbacks.document import (
    _STATE_DOC_LOAD_ERROR,
    _STATE_DOCS_LOADED,
    _STATE_RESUMED_SESSION,
    make_document_injector,
    make_document_loader,
)
from adk.callbacks.large_output import _handle_large_output
from adk.callbacks.permission import make_before_agent, make_permission_enforcer
from adk.callbacks.session import (
    _STATE_INITIALIZED,
    _STATE_TURN_COUNT,
    _TURN_FLUSH_INTERVAL,
    _derive_access_control,
    _try_generate_title,
    make_after_agent_response,
    make_session_tracker,
)

__all__ = [
    "_STATE_DOCS_LOADED",
    "_STATE_DOC_LOAD_ERROR",
    "_STATE_INITIALIZED",
    "_STATE_RESUMED_SESSION",
    "_STATE_TURN_COUNT",
    "_TURN_FLUSH_INTERVAL",
    "_after_agent",
    "_derive_access_control",
    "_handle_large_output",
    "_try_generate_title",
    "make_after_agent_response",
    "make_before_agent",
    "make_document_injector",
    "make_document_loader",
    "make_permission_enforcer",
    "make_session_tracker",
]


def _after_agent(*_args: object, **_kwargs: object) -> None:
    """Retained for import compatibility; agent factory uses make_after_agent_response."""
    return None
