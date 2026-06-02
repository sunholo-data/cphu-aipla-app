"""REST endpoints for the analytics-chat tool layer (sprint
ANALYTICS-CHAT-AND-INSIGHTS, M5).

Two endpoints under ``/api/analytics/*``:

- ``GET /api/analytics/tools`` — list the six analytics tools (name +
  description). Teacher-gated. No execution; safe to call as a
  discovery / capability probe.
- ``POST /api/analytics/probe/{tool_name}`` — run a single tool for
  the calling teacher and return its raw structured output. Used by
  the ``aiplatform analytics probe`` CLI and by integration tests
  that need to verify a query without going through the agent.

The probe endpoint constructs a minimal ``ToolContext`` stub so the
analytics tools (which read ``state['user:id']``) work unchanged. It
preserves the HARD GATE from M2: any ``PermissionError`` from the
tool surfaces as ``404 class not accessible`` — byte-identical for
missing-class, not-owned-class, and not-owned-group-code. Cross-tenant
enumeration must not be possible via this surface.
"""

from __future__ import annotations

import inspect
import logging
from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from analytics import summarise as _summarise
from analytics import tools as _tools
from analytics.auth import PERMISSION_ERROR_MESSAGE
from auth import User, get_current_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ---------------------------------------------------------------------------
# Tool registry — local to this module; mirrors the SKILL.md `tools:` list.
# Keeping it here (rather than re-importing from adk/tools.py) avoids a
# dependency on the FunctionTool factory and keeps the REST surface
# independent of the ADK tool-wiring layer.
# ---------------------------------------------------------------------------


_ANALYTICS_TOOLS: dict[str, Any] = {
    "count_messages": _tools.count_messages,
    "time_on_task": _tools.time_on_task,
    "sim_runs_per_skill": _tools.sim_runs_per_skill,
    "most_active_groups": _tools.most_active_groups,
    "group_summary": _tools.group_summary,
    "summarise_chat_excerpts": _summarise.summarise_chat_excerpts,
}


def _assert_teacher(user: User) -> None:
    """Mirror ``classes_routes._assert_teacher`` — analytics is teacher-only.
    Anonymous-group students never reach this surface."""
    if not user.is_teacher:
        raise HTTPException(status_code=403, detail="teacher access required")


def _summarise_signature(fn: Any) -> list[dict[str, Any]]:
    """Return a JSON-serializable parameter spec for ``fn``. Skips
    ``tool_context`` since it is supplied server-side."""
    sig = inspect.signature(fn)
    out: list[dict[str, Any]] = []
    for name, param in sig.parameters.items():
        if name == "tool_context":
            continue
        annotation = param.annotation.__name__ if hasattr(param.annotation, "__name__") else str(param.annotation)
        out.append(
            {
                "name": name,
                "type": annotation,
                "required": param.default is inspect.Parameter.empty,
                "default": None if param.default is inspect.Parameter.empty else param.default,
            }
        )
    return out


def _make_tool_context(user: User) -> SimpleNamespace:
    """The analytics tools read ``tool_context.state['user:id']``. A
    minimal duck-typed stub keeps the tools untouched when called from
    a REST surface that already has the authenticated ``User``."""
    return SimpleNamespace(state={"user:id": user.uid})


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class AnalyticsToolDescriptor(BaseModel):
    name: str
    description: str
    parameters: list[dict[str, Any]]


class AnalyticsToolsResponse(BaseModel):
    tools: list[AnalyticsToolDescriptor]


@router.get("/tools", response_model=AnalyticsToolsResponse)
async def list_tools(
    user: User = Depends(get_current_user),  # noqa: B008
) -> AnalyticsToolsResponse:
    """List the analytics tools the analytics-chat skill can call.
    Teacher-gated — same gate as ``/api/classes/*``."""
    _assert_teacher(user)
    tools = [
        AnalyticsToolDescriptor(
            name=name,
            description=(fn.__doc__ or "").strip().split("\n\n")[0],
            parameters=_summarise_signature(fn),
        )
        for name, fn in _ANALYTICS_TOOLS.items()
    ]
    return AnalyticsToolsResponse(tools=tools)


class AnalyticsProbeRequest(BaseModel):
    """Body for ``POST /api/analytics/probe/{tool_name}``.

    ``class_id`` is required; everything else is forwarded as kwargs
    to the tool. The tools clamp / default their own parameters so we
    don't validate per-tool here — keeping the probe surface generic."""

    class_id: str = Field(min_length=1)
    kwargs: dict[str, Any] = Field(default_factory=dict)


@router.post("/probe/{tool_name}")
async def probe_tool(
    tool_name: str = Path(..., min_length=1),
    body: AnalyticsProbeRequest = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Execute a single analytics tool for the calling teacher.

    Returns the tool's structured output verbatim. On
    ``PermissionError`` (missing class, not-owned class, not-owned
    group code), returns 404 with the same ``class not accessible``
    message — byte-identical to preserve the HARD GATE.
    """
    _assert_teacher(user)
    fn = _ANALYTICS_TOOLS.get(tool_name)
    if fn is None:
        raise HTTPException(status_code=404, detail="tool not found")

    tool_context = _make_tool_context(user)
    try:
        result = await fn(
            class_id=body.class_id,
            **body.kwargs,
            tool_context=tool_context,
        )
    except PermissionError as exc:
        # Byte-identical refusal: missing-class, not-owned-class,
        # not-owned-group-code all collapse to the same message.
        log.info(
            "analytics_tool tool=%s class_id=%s teacher_uid=%s outcome=refused",
            tool_name,
            body.class_id,
            user.uid,
        )
        raise HTTPException(status_code=404, detail=str(exc) or PERMISSION_ERROR_MESSAGE) from exc
    except TypeError as exc:
        # Bad kwargs from the caller — the tool signature rejected
        # something. Surface as 400 with the message so the CLI can
        # show a useful hint.
        raise HTTPException(status_code=400, detail=f"invalid arguments: {exc}") from exc

    # Cloud Logging marker — M10 observability gate. Filter via
    # `jsonPayload.message:"analytics_tool"` on the dev project.
    log.info(
        "analytics_tool tool=%s class_id=%s teacher_uid=%s outcome=ok",
        tool_name,
        body.class_id,
        user.uid,
    )
    return {"tool": tool_name, "class_id": body.class_id, "result": result}
