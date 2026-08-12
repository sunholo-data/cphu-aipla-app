"""ADK Agent factory — creates agents from SkillConfig documents.

Workshop W2b — ADK: The Foundation (factory)
  `create_agent()` reads a SkillConfig from Firestore and assembles an
  LlmAgent. The three-line model router (Gemini / Claude / LiteLlm) and
  the `_HeuristicRouter` thinking-tier are the moments to linger on during
  the talk — they show what ADK's model abstraction buys you.

The factory has three layers:
  1. `resolve_model(model_id)` — maps a skill's model string to the correct
     ADK model wrapper (Gemini / Claude / LiteLlm).
  2. `resolve_tools(...)` — from `adk.tools` — wraps callables as
     FunctionTool instances for the agent.
  3. `create_agent(skill_config, user)` and `create_agent_with_thinking(...)`
     — assemble the above into an ADK LlmAgent with per-user callbacks.

Thinking strategy (3 tiers, see docs/design/v6.0.0/agent-factory.md):
  A. Gemini only, no `thinking_model` → single agent with
     `BuiltInPlanner(thinking_budget=-1)` (Gemini 2.5 dynamic thinking).
  B. Claude/OpenAI, no `thinking_model` → single agent, no planner.
  C. Any provider, `thinking_model` set → `_HeuristicRouter(fast, thinking,
     picker)` that picks between two agents via `_should_think(message)`.
"""

from __future__ import annotations

import logging
import os
import re
from collections.abc import Callable
from dataclasses import dataclass

from google.adk.agents import LlmAgent
from google.adk.code_executors import BuiltInCodeExecutor
from google.adk.models import Claude, Gemini
from google.adk.models.lite_llm import LiteLlm
from google.adk.planners import BuiltInPlanner
from google.adk.tools import AgentTool
from google.adk.tools.load_artifacts_tool import load_artifacts_tool
from google.adk.tools.load_memory_tool import load_memory_tool
from google.adk.tools.preload_memory_tool import preload_memory_tool
from google.genai.types import ThinkingConfig

from adk.a2ui import A2uiToolConfig, make_a2ui_toolset
from adk.a2ui_surface_context import wrap_with_a2ui_surface_context
from adk.artifact_tools import retrieve_artifact
from adk.callbacks import (
    _handle_large_output,
    make_activity_image_injector,
    make_activity_image_loader,
    make_after_agent_response,
    make_before_agent,
    make_document_injector,
    make_document_loader,
    make_permission_enforcer,
    make_session_tracker,
)
from adk.checklist_tools import build_checklist_tools
from adk.checkpoint_tools import build_checkpoint_tools
from adk.curriculum_retrieval import (
    build_curriculum_grounding_preamble,
    build_curriculum_retrieval_tool,
)
from adk.element_state import make_element_state_wrapper
from adk.iframe_context import wrap_with_iframe_context
from adk.instruction_provider_chain import compose_instruction_providers
from adk.interaction_style import inject_interaction_style_preamble
from adk.mcp_observability import (
    compose_after_tool_callbacks,
    compose_before_tool_callbacks,
    make_mcp_after_tool_callback,
    make_mcp_before_tool_callback,
)
from adk.multimodal import inject_image_input_preamble
from adk.proactive_greet import inject_opening_guidance
from adk.proactive_reactive import inject_reactive_guidance
from adk.proactive_telemetry import tag_proactive_span_from_callback_context
from adk.progress_context import compose_progress_context
from adk.teacher_focus import build_ilo_precedence_block, inject_teacher_focus, resolve_active_config
from adk.tools import resolve_mcp_tools, resolve_tools
from auth.access_context import AccessContext
from auth.firebase_auth import User
from db.models import SkillConfig
from skills.platform import PLATFORM_OWNER_UID
from skills.skill_config import find_by_slug, get_skill
from tools.structured_extraction import structured_extraction_callback

logger = logging.getLogger(__name__)


# --- Model routing ---


def resolve_model(model_id: str) -> Gemini | Claude | LiteLlm:
    """Create the correct ADK model wrapper for the given model ID.

    - `gemini-*` -> `Gemini(model=...)` (Vertex AI via ADC)
    - `claude-*` -> `Claude(model=...)` (Vertex AI Anthropic models)
    - `gpt-*` / `o3*` -> `LiteLlm(model="openai/...")` (requires OPENAI_API_KEY)

    Raises:
        ValueError: If the model_id does not match a known provider prefix.
    """
    if model_id.startswith("gemini-"):
        return Gemini(model=model_id)
    if model_id.startswith("claude-"):
        return Claude(model=model_id)
    if model_id.startswith("gpt-") or model_id.startswith("o3"):
        return LiteLlm(model=f"openai/{model_id}")
    raise ValueError(f"Unsupported model: {model_id!r}")


# --- Name sanitisation ---
# ADK's LlmAgent name validator requires `^[a-zA-Z_][a-zA-Z0-9_]*$`. Skill
# IDs default to UUIDs (contain hyphens) and may start with a digit; kebab-
# case names also have hyphens. Sanitize once at the factory boundary.

_VALID_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _safe_agent_name(skill_id: str) -> str:
    safe = skill_id.replace("-", "_")
    if not safe:
        return "s_"
    if not (safe[0].isalpha() or safe[0] == "_"):
        safe = "s_" + safe
    if not _VALID_IDENT.match(safe):
        safe = re.sub(r"[^a-zA-Z0-9_]", "_", safe)
    return safe


# --- Thinking strategy ---

# Keywords that suggest a user message warrants deeper reasoning. Kept short
# and boring on purpose: false positives route to the better model, the cost
# of being wrong is a few extra tokens — we prefer a high recall heuristic.
THINK_KEYWORDS = frozenset(
    {
        "analyze",
        "analyse",
        "reason",
        "compare",
        "evaluate",
        "plan",
        "design",
        "debug",
        "explain",
        "derive",
        "prove",
    }
)


def _should_think(message: str) -> bool:
    """Heuristic: does this message warrant the thinking model?

    Rules (any one triggers thinking):
      - length > 280 chars (beyond a typical one-liner)
      - contains any THINK_KEYWORDS word
      - has >=2 question marks (compound / multi-part question)
    """
    if len(message) > 280:
        return True
    if message.count("?") >= 2:
        return True
    tokens = {t.strip(".,!?:;").lower() for t in message.split()}
    return bool(tokens & THINK_KEYWORDS)


#: Env var that overrides the default Gemini thinking budget (Tier A).
#: Unset/blank → 0 (thinking off). Set it to -1 to opt IN to Gemini's
#: unbounded dynamic thinking. See ``_resolve_thinking_budget``.
THINKING_BUDGET_ENV = "AIPLA_THINKING_BUDGET"

#: Fallback when ``AIPLA_THINKING_BUDGET`` is absent or unparseable.
#: ``0`` (thinking off), NOT ``-1`` (unbounded) — see the rationale in
#: ``_resolve_thinking_budget``.
DEFAULT_THINKING_BUDGET = 0


def _resolve_thinking_budget() -> int:
    """Thinking-token budget for the default (Tier A) Gemini planner.

    ``ThinkingConfig.thinking_budget`` semantics:
      * ``-1`` — Gemini's *dynamic* thinking: the model decides how much to
        think per request. Unbounded; can add many seconds of pre-first-token
        latency on hard prompts (the 19-36s turns in the 2026-06-23 demo).
      * ``0``  — thinking OFF: fastest first token (valid on 2.5/3.5 *Flash*;
        Pro requires >= 128).
      * ``N>0`` — cap thinking to ~N tokens: bounded latency, some reasoning.

    Read from ``AIPLA_THINKING_BUDGET`` so an environment can trade latency
    against depth WITHOUT a code change or re-seed.

    **Defaults to 0 (thinking off), not -1 (unbounded)** — changed 2026-08-12
    by ACCESS-1 M0. All three deployed environments already set ``=0`` via
    ``cloudbuild.yaml``, so this changes no deployed behaviour; what it changes
    is the behaviour of everything that *isn't* that pipeline. Cloud Run jobs,
    scripts, tests and local processes inherit no env var, and were therefore
    silently running the most expensive setting the knob has. Unbounded thinking
    is a thing you should have to ask for, on a public domain especially.

    This is the simplest dynamic knob; per-skill and per-turn (difficulty-
    routed) budgets are the natural next steps — see the design note.
    """
    raw = os.environ.get(THINKING_BUDGET_ENV)
    if raw is None or raw.strip() == "":
        return DEFAULT_THINKING_BUDGET
    try:
        return int(raw)
    except ValueError:
        logger.warning(
            "%s=%r is not an integer; falling back to %d (thinking off)",
            THINKING_BUDGET_ENV,
            raw,
            DEFAULT_THINKING_BUDGET,
        )
        return DEFAULT_THINKING_BUDGET


def _planner_for(skill_config: SkillConfig) -> BuiltInPlanner | None:
    """Return a BuiltInPlanner for Gemini skills with no thinking_model.

    - Gemini + no thinking_model: `BuiltInPlanner` with the budget from
      `_resolve_thinking_budget()` (default 0 = thinking off; set
      `AIPLA_THINKING_BUDGET=-1` to opt in to unbounded dynamic thinking).
    - Claude / OpenAI: BuiltInPlanner is Gemini-specific; return None.
    - thinking_model set: routing happens in Python via _HeuristicRouter;
      the single-agent case doesn't apply, so return None here.
    """
    if skill_config.skill_metadata.thinking_model is not None:
        return None
    if not skill_config.skill_metadata.model.startswith("gemini-"):
        return None
    return BuiltInPlanner(thinking_config=ThinkingConfig(thinking_budget=_resolve_thinking_budget()))


@dataclass
class _HeuristicRouter:
    """Wraps two agents (`fast` and `thinking`) and a picker heuristic.

    Not itself an ADK Agent — the SSE endpoint calls `pick_agent(message)`
    to choose which agent to hand to the Runner for a given turn.
    """

    fast: LlmAgent
    thinking: LlmAgent
    picker: Callable[[str], bool]

    def pick_agent(self, message: str) -> LlmAgent:
        return self.thinking if self.picker(message) else self.fast


# --- Model-aware search tool wiring ---


def _resolve_search_tools(
    tool_names: list[str],
    tool_configs: dict,
) -> list:
    """Return search AgentTools for a skill — one or two sub-agents as needed.

    All models (Gemini, Claude, OpenAI) use the sub-agent pattern so the root
    agent never has grounding built-ins alongside FunctionTools (400 INVALID_ARGUMENT).
    ADK tracks this as TODO(b/448114567) and will remove the workaround when fixed upstream.

    google_search and VertexAiSearchTool use incompatible API-level tool types
    (google_search vs retrieval) and cannot share an agent, so each gets its own:
      - google_search → GoogleSearchAgentTool (ADK-native, propagates grounding metadata)
      - ai_search     → AgentTool(enterprise_search_agent, propagate_grounding_metadata=True)
      - both          → two AgentTools, both returned
    """
    from google.adk.tools.google_search_agent_tool import GoogleSearchAgentTool

    from tools.search_agent import create_enterprise_search_agent, create_web_search_agent

    wants_web = "google_search" in tool_names
    wants_enterprise = "ai_search" in tool_names

    if not (wants_web or wants_enterprise):
        return []

    result = []
    if wants_web:
        result.append(GoogleSearchAgentTool(create_web_search_agent()))
    if wants_enterprise:
        datastore_id: str | None = (tool_configs.get("ai_search") or {}).get("datastore_id")
        if datastore_id:
            result.append(AgentTool(create_enterprise_search_agent(datastore_id), propagate_grounding_metadata=True))
        else:
            logger.warning("ai_search tool requested but no datastore_id in tool_configs; skipping enterprise search")
    return result


def _resolve_code_executor(
    tool_names: list[str],
    model_id: str,
) -> tuple[BuiltInCodeExecutor | None, list]:
    """Return (code_executor, extra_tools) for a skill's code execution needs.

    Gemini agents: BuiltInCodeExecutor attached directly to the LlmAgent.
    Claude/OpenAI agents: AgentTool wrapping a Gemini CodeAgent sub-agent.

    Returns:
        (executor, tools) — executor is None when model is non-Gemini or no
        code_execution tool requested; tools is empty for Gemini agents.
    """
    if "code_execution" not in tool_names:
        return None, []

    if model_id.startswith("gemini-"):
        return BuiltInCodeExecutor(), []

    from tools.code_execution.agent import create_code_agent

    return None, [AgentTool(create_code_agent())]


def _request_has_image_part(llm_request: object) -> bool:
    """True if any content part in the request carries image bytes — a 1.1.7
    photo upload, the solution element's photo/drawing (1.1.48), or an injected
    activity image (1.1.44). Used to decide whether to strip grounding built-ins,
    which Gemini rejects alongside non-text input."""
    for content in getattr(llm_request, "contents", None) or []:
        for part in getattr(content, "parts", None) or []:
            blob = getattr(part, "inline_data", None)
            mime = getattr(blob, "mime_type", "") if blob is not None else ""
            if (mime or "").startswith("image/"):
                return True
    return False


def _strip_grounding_tools(llm_request: object) -> int:
    """Drop grounding built-ins (Vertex RAG ``retrieval`` + ``google_search``)
    from a request's tool list; return how many were removed. FunctionTools
    (``function_declarations``) and everything else are kept, so the only effect
    is to disable curriculum grounding for this one (multimodal) turn — Gemini
    400s otherwise. Defensive ``getattr`` throughout: non-Gemini requests simply
    have no such typed tools and pass through unchanged."""
    config = getattr(llm_request, "config", None)
    tools = getattr(config, "tools", None) if config is not None else None
    if not tools:
        return 0
    kept = [
        t
        for t in tools
        if not (
            getattr(t, "retrieval", None)
            or getattr(t, "google_search", None)
            or getattr(t, "google_search_retrieval", None)
        )
    ]
    removed = len(tools) - len(kept)
    if removed:
        config.tools = kept
    return removed


# --- Agent factory ---


def create_agent(
    skill_config: SkillConfig,
    user: User,
    *,
    activity_id: str | None = None,
    access_context: AccessContext | None = None,
    _seen: set[str] | None = None,
    _model_override: str | None = None,
    _planner_override: BuiltInPlanner | None = None,
) -> LlmAgent:
    """Build an ADK LlmAgent from a SkillConfig + authenticated User.

    - `name` = sanitized `skill_id` (ADK rejects hyphens)
    - `instruction` = `skill_config.instructions` (Agent Skills spec field)
    - `tools` resolved from `skill_metadata.tools` (unknowns skipped+logged)
    - `sub_agents` recursed from `skill_metadata.sub_skills` (skill IDs
      looked up via `skills.skill_config.get_skill`); cycle-detected via
      the private `_seen` set.
    - `before_tool_callback` = `make_permission_enforcer(user.email, user.domain)`

    Args:
        _seen: internal. Set of skill IDs already on the current call stack,
            used to detect cycles. Callers should leave as None.
        _model_override: internal. When building router sub-agents,
            _create_router_sub_agent uses this to swap the model without
            duplicating the recursion logic.
        _planner_override: internal. Same deal for the planner — None means
            "use _planner_for(skill_config)".

    Raises:
        ValueError: if a sub-skill cycle is detected.
    """
    seen = set(_seen) if _seen else set()
    if skill_config.skill_id in seen:
        raise ValueError(
            f"Sub-skill cycle detected: {skill_config.skill_id!r} already on the resolution stack {seen!r}"
        )
    seen.add(skill_config.skill_id)

    # ALS-1 M0: the activity whose teacher-focus / materials / interaction-style
    # shape THIS agent. When the caller passes an explicit ``act-…`` id (the
    # student opened a specific activity), that selects the config; otherwise we
    # fall back to ``skill_config.skill_id`` — the legacy welding, which keeps
    # every existing call site (sub-agents, skills with no activity) unchanged.
    _activity_id = activity_id or skill_config.skill_id

    md = skill_config.skill_metadata
    effective_model = _model_override or md.model
    model = resolve_model(effective_model)
    # Default tools every skill gets (unless opted out via
    # `tool_configs.defaults.<flag>: false` in SKILL.md):
    #   load_artifacts_tool  - LLM-driven artifact retrieval (legacy path; the
    #                          before_model_callback in callbacks.py also
    #                          eager-injects docs on resumed sessions).
    #   retrieve_artifact    - keyword/section search inside a known artifact.
    #   load_memory_tool     - LLM-driven semantic search over the Vertex
    #                          memory bank (cross-session recall).
    #   preload_memory_tool  - auto-fetches relevant memories before the LLM
    #                          turn (same memory bank). Pairs with
    #                          load_memory_tool: preload primes context,
    #                          load_memory follows up for deeper queries.
    #
    # AIPLA 2026-05-21 — these were always-on regardless of `tools: []`,
    # mirroring the A2UI anti-pattern fixed in upstream-feedback #22. For
    # chat-only skills (problem-set-hints) the model invokes them gratuitously
    # ("Tool: load_artifacts" chips in the chat) without value. Defaults
    # block in tool_configs controls per-skill opt-out. See upstream-feedback #25.
    #
    # AIPLA 2026-06-17 — memory tools now default OFF. Cross-session recall is
    # foreclosed by anonymous group IDs (ADR-001 — we deliberately cannot follow
    # individuals) and the Vertex memory bank is never populated (no
    # `add_session_to_memory` write path anywhere), so load_memory only ever
    # returned empty while costing prompt tokens + a per-turn preload fetch. All
    # shipped AIPLA skill templates already opt out; flipping the default removes
    # the footgun for new/inherited skills. The opt-in
    # (`tool_configs.defaults.memory: true`) is retained for upstream-template
    # parity / any future populated-memory deployment. See
    # docs/design/aipla/v2.0.0-handover/self-hosting-and-terraform-handover.md §7.
    defaults_cfg = (md.tool_configs or {}).get("defaults") or {}
    tools: list = []
    if defaults_cfg.get("artifacts", True):
        tools.append(load_artifacts_tool)
        tools.append(retrieve_artifact)
    if defaults_cfg.get("memory", False):
        tools.append(load_memory_tool)
        tools.append(preload_memory_tool)
    tools.extend(resolve_tools(md.tools, md.tool_configs))
    tools.extend(_resolve_search_tools(md.tools, md.tool_configs))
    tools.extend(resolve_mcp_tools(md.tool_configs))
    # 1.1.25 M3 — curriculum retrieval: attach a VertexAiRagRetrieval tool
    # scoped to the activity's cited materials (deny-by-default ACL — the
    # student never sees the open corpus, only their activity's allow-list).
    # resolve_active_config is the same Firestore path used by inject_teacher_focus
    # below; the double read is acceptable at agent-build-time (once per session).
    _active_cfg = resolve_active_config(_activity_id, group_tags=user.group_tags)
    _materials = _active_cfg.materials if _active_cfg else []
    _curriculum_tool = build_curriculum_retrieval_tool(_materials)
    if _curriculum_tool is not None:
        tools.append(_curriculum_tool)
    # CONCEPT-1 M3 — chat-native checkpoint tools, built per session like the
    # curriculum tool above: the closures capture the resolved concept map +
    # the VERIFIED group identity, so group/activity are never model params.
    # No-op (empty list) unless the activity has a map AND the caller is an
    # anonymous-group student.
    tools.extend(build_checkpoint_tools(_active_cfg, user))
    # 1.1.62 M3 — chat-native checklist (ILO) tools, same construction and same
    # guarantees: group comes from the VERIFIED claim, never a model parameter.
    # No-op unless the activity has a checklist AND the caller is a student.
    tools.extend(build_checklist_tools(_active_cfg, user))
    # MULTI-SURFACE-A2UI M1 — read the skill's `tool_configs.a2ui` block so
    # the toolset emits `surface_id`/`update_mode` siblings alongside
    # `validated_a2ui_json`. Defaults (no a2ui block) preserve pre-M1
    # inline-in-chat behaviour. Invalid combinations (e.g. patch+chat)
    # raise here at agent-build time, not at the first tool call.
    #
    # AIPLA 2026-05-21 — A2UI is now opt-out via `tool_configs.a2ui.enabled
    # = false`. Skills wanting minimalist chat-only behaviour (e.g. AIPLA's
    # problem-set-hints) declare it and the toolset is not attached at
    # all — the model literally cannot see send_a2ui_json_to_client.
    # Default remains True so inherited template skills work unchanged.
    # See upstream-feedback #22.
    a2ui_cfg = A2uiToolConfig.from_tool_configs(md.tool_configs)
    if a2ui_cfg.enabled:
        tools.append(make_a2ui_toolset(config=a2ui_cfg))
    code_executor, code_tools = _resolve_code_executor(md.tools, effective_model)
    tools.extend(code_tools)
    planner = _planner_override if _planner_override is not None else _planner_for(skill_config)

    sub_agents: list[LlmAgent] = []
    for sub_id in md.sub_skills:
        sub = get_skill(sub_id)
        if sub is None:
            logger.warning(
                "sub-skill %r referenced by %r not found; skipping",
                sub_id,
                skill_config.skill_id,
            )
            continue
        sub_agents.append(create_agent(sub, user, access_context=access_context, _seen=seen))

    # AgentTool delegation (call-and-return): unlike `sub_skills` → `sub_agents`
    # (LLM transfer of control), each `agent_tools` skill is wrapped as an
    # AgentTool the parent CALLS like a function and gets the answer back from,
    # staying in control of its own turn. Lets a "hub" skill (manage-class)
    # consult a focused specialist (analytics-chat) and reuse its whole prompt +
    # tools + guardrails without copy-listing them. Same `_seen` cycle guard.
    for at_ref in md.agent_tools:
        # Resolve by document id first, then by platform slug — so a SKILL.md
        # template can reference a platform skill by its stable slug
        # (e.g. "analytics-chat") rather than a per-environment UUID.
        at_skill = get_skill(at_ref) or find_by_slug(PLATFORM_OWNER_UID, at_ref)
        if at_skill is None:
            logger.warning(
                "agent_tool %r referenced by %r not found; skipping",
                at_ref,
                skill_config.skill_id,
            )
            continue
        at_agent = create_agent(at_skill, user, access_context=access_context, _seen=seen)
        # The wrapped agent's name becomes the tool's function name the hub LLM
        # selects on (and the frontend tool-call pill). Derive it from the
        # skill's human name (e.g. "analytics-chat" → "analytics_chat") rather
        # than the default sanitized-UUID skill_id, so tool selection is
        # reliable and the UI reads cleanly.
        at_agent.name = _safe_agent_name(at_skill.name)
        tools.append(AgentTool(at_agent))

    _before_agent = make_before_agent(
        skill_config.skill_id,
        tool_configs=md.tool_configs,
        access_context=access_context,
    )
    _session_tracker = make_session_tracker(user.uid, skill_config.skill_id, user.group_id)
    _document_loader = make_document_loader()
    _document_injector = make_document_injector()
    # 1.1.44 — twins of the document loader/injector for teacher-attached image
    # materials: copy the activity's images from the durable slot into the
    # session, then inline them as image Parts so the tutor SEES them. Reuses the
    # already-resolved _active_cfg (no extra Firestore read).
    _activity_image_loader = make_activity_image_loader(_active_cfg)
    _activity_image_injector = make_activity_image_injector(_active_cfg)

    async def _composed_before_agent(callback_context: object) -> None:
        # TTFT mark: ADK has finished its runner setup and is now invoking
        # our before_agent_callback. The gap from agent_factory_done →
        # runner_setup_done attributes ag_ui_adk wrap + ADK runner enter
        # + plugin setup — the second-largest unexplained cost the M1
        # baseline revealed. See docs/design/v6.1.0/ttft-optimization.md.
        from observability.timing import STAGE_RUNNER_SETUP_DONE, get_current_tracker

        get_current_tracker().mark(STAGE_RUNNER_SETUP_DONE)

        # Sprint PROACTIVE-SIM-REACTIVE M7: tag the OTel span with
        # tutor.proactive_kind when this invocation was triggered by a
        # proactive sentinel ([session_start] for Phase A or
        # [event_reactive:<kind>] for Phase B). Reads
        # callback_context.user_content (ADK's typed view of the latest
        # user message). No-op on regular student turns. Telemetry-only
        # — never raises.
        tag_proactive_span_from_callback_context(callback_context)

        _before_agent(callback_context)
        _session_tracker(callback_context)
        await _document_loader(callback_context)
        # 1.1.44 — copy the activity's image materials into this session (idempotent).
        await _activity_image_loader(callback_context)

        # TTFT: mark the end of the synchronous before-agent chain. Show
        # a user-facing "Reading documents…" label only when the loader
        # actually loaded something (avoids flashing the label for 0ms
        # on chats with no docs attached).
        from adk.callbacks import _STATE_DOCS_LOADED
        from observability.timing import (
            STAGE_BEFORE_AGENT_DONE,
            get_current_tracker,
        )

        state = getattr(callback_context, "state", None)
        loaded = list(state.get(_STATE_DOCS_LOADED) or []) if state is not None else []
        label: str | None = None
        if loaded:
            suffix = "s" if len(loaded) != 1 else ""
            label = f"Reading {len(loaded)} document{suffix}…"
        get_current_tracker().mark(STAGE_BEFORE_AGENT_DONE, user_label=label)

    _after_agent_response = make_after_agent_response(user.uid, skill_config.skill_id, user.group_id)

    async def _composed_after_agent(callback_context: object) -> None:
        _after_agent_response(callback_context)
        await structured_extraction_callback(callback_context)

    # Sprint 2.12 (M2): pluggable budget enforcement. The before/after
    # model callback pair consults the registered enforcer pre-call,
    # raises BudgetExceededError on hard block (caught by AG-UI's
    # error translator), and reconciles the held projection with
    # realised usage post-call. No-ops when no enforcer is registered
    # OR the skill has no `tool_configs.budget` block — back-compat
    # with every existing skill.
    from adk.budget_config import BudgetConfig
    from budget import get_registered_enforcer
    from budget.callback import make_budget_callbacks

    _budget_before, _budget_after = make_budget_callbacks(
        get_registered_enforcer(),
        user=user,
        skill_id=skill_config.skill_id,
        budget_config=BudgetConfig.from_tool_configs(md.tool_configs),
    )

    async def _composed_before_model(callback_context: object, llm_request: object) -> None:
        # Document injector runs FIRST so docs are visible to the
        # budget projection (longer prompt = higher projected cost).
        # The injector predates the budget gate; if dropping a
        # participant here, see test_composed_before_model.py.
        await _document_injector(callback_context, llm_request)
        # 1.1.44 — inline the activity's teacher-attached images as image Parts
        # (after docs, before the budget gate so the projection sees them).
        await _activity_image_injector(callback_context, llm_request)
        # 1.1.7 images need no injector: they arrive as native AG-UI
        # ImageInputContent parts that ag_ui_adk turns into ADK Parts in the
        # user event, so they're already in llm_request.contents (and replayed
        # from session history every turn). The budget gate sees them naturally.
        #
        # 1.1.48 — Gemini 400s ("grounding is not supported non-text input.
        # Remove the retrieval tool") when a grounding built-in (the curriculum
        # VertexAiRagRetrieval / google_search) rides alongside image input. The
        # solution element's photo/drawing, a 1.1.7 upload, or an injected
        # activity image all make THIS turn multimodal — strip the grounding
        # tools for it (per-turn: text turns keep grounding). The curriculum
        # *preamble* stays in the instruction, so grounding degrades gracefully
        # (curriculum_retrieval.py promises exactly this). Sibling case:
        # _resolve_search_tools dodges grounding-alongside-FunctionTools the
        # same way, via sub-agents.
        if _request_has_image_part(llm_request):
            removed = _strip_grounding_tools(llm_request)
            if removed:
                logger.info("stripped %d grounding tool(s) for an image turn (Gemini non-text incompat)", removed)
        await _budget_before(callback_context, llm_request)

    async def _composed_after_model(callback_context: object, llm_response: object) -> None:
        await _budget_after(callback_context, llm_response)

    # M2B-BACKEND (MCP-APP-INTEGRATIONS): tag OTel spans on every MCP tool
    # call with mcp_app.server_id, and mcp_app.has_ui_resource=true when the
    # tool returned an EmbeddedResource carrying a UI app. Composed AFTER the
    # existing callbacks so permission-enforcer / large-output handlers keep
    # their override semantics; observability is purely additive.
    _before_tool = compose_before_tool_callbacks(
        make_permission_enforcer(user.email, user.domain),
        make_mcp_before_tool_callback(),
    )
    _after_tool = compose_after_tool_callbacks(
        _handle_large_output,
        make_mcp_after_tool_callback(),
    )

    return LlmAgent(
        name=_safe_agent_name(skill_config.skill_id),
        model=model,
        # Chained InstructionProviders, applied LEFT-TO-RIGHT — each
        # wrapper's prompt block is appended in the order listed:
        #   * iframe-context (sprint 1.25): mcp_app_context.* block when
        #     an MCP App iframe pushed `ui/update-model-context`.
        #   * A2UI surface-context (sprint 2.10): a2ui_surface_context
        #     block when frontend SurfaceModels have active data OR a
        #     user dispatched an A2uiClientAction.
        # Each wrapper passes through unchanged when its respective
        # state is empty, so this is safe to apply unconditionally
        # for every skill. Adding a third wrapper later is just a
        # third argument here — no nesting to re-order.
        instruction=compose_instruction_providers(
            # Phase 1.I-PhA: when the skill opts into proactive greeting,
            # append the skill-author's `## Opening` guidance to the
            # instruction so the synthetic empty-message turn fired by
            # POST /api/sessions/{id}/greet produces a meaningful first
            # tutor turn. No-op when proactive_greet is False or the
            # opening template is empty. The block frames itself as
            # system context so the model treats it as opening guidance,
            # not student input. See
            # docs/design/aipla/v1.0.0-pilot/proactive-tutor.md.
            #
            # Phase 1.G-Ph2: substitute {teacher_focus} with the active
            # ActivityConfig.teaching_goal for this skill so the tutor's
            # Socratic scaffolding is shaped by the teacher's free-text
            # goal. No-op when the skill has no {teacher_focus} placeholder
            # OR when no config has been saved. LOCAL_MODE scope only —
            # Phase 3 will swap the constant (teacher, class) tuple for a
            # real Class-entity lookup.
            # Phase 1.1.2 Phase B: when the skill opts into proactive
            # sim-reactive turns, append the skill-author's `## Reactive
            # turn` guidance after the opening block. Composition order
            # matters: opening guidance lands first so the model sees
            # opening expectations before reactive expectations when both
            # flags are on. No-op when proactive_event_reactive is False
            # or the reactive_template is empty. The block frames itself
            # as system context so the model treats it as reactive
            # guidance, not student input. See
            # docs/design/aipla/v1.1.0-feedback/proactive-sim-reactive-tutor.md.
            inject_teacher_focus(
                inject_reactive_guidance(
                    inject_opening_guidance(
                        # Phase 1.1.20: append the activity's interaction-style
                        # override preamble (concise/rigorous/warm) to the base
                        # instructions. `socratic` (default) is a passthrough,
                        # so existing tutors are unchanged. Innermost so the
                        # override sits right after the SKILL.md body it
                        # countermands. A persona (1.1.12) resolves down to this
                        # interaction_style.
                        inject_interaction_style_preamble(
                            # Phase 1.1.7: when the skill opts into image
                            # upload, append the shared image-input guidance
                            # (units-loop / no-solve / privacy) right after
                            # the SKILL.md body. Innermost so it sits closest
                            # to the body it extends; passthrough when
                            # multimodal_input is False. Centralised rather
                            # than inlined per-SKILL.md — originally forced by
                            # the 10k body cap (problem-set-hints sat at 9,876
                            # of it). The cap is 25k since 2026-08-06, so this
                            # is now a DRY choice rather than a workaround:
                            # one place to edit the units-loop guidance.
                            inject_image_input_preamble(
                                # 1.1.25 M3: when the activity has cited materials,
                                # append a grounding preamble (cite origin, prefer
                                # curriculum content, "no source" on miss). Pure
                                # function; uses MaterialRef.origin cached at
                                # citation time — no extra Firestore read.
                                # 1.1.62 M3b: the teacher's ILOs land AFTER the
                                # curriculum preamble, deliberately. The
                                # convention here is "later instruction wins"
                                # (see inject_interaction_style_preamble), and
                                # {teacher_focus} substitutes INSIDE the body —
                                # i.e. already before this preamble, which is the
                                # weak position. That is the mechanism behind
                                # "the chat forces curriculum goals, not my ILOs":
                                # the curriculum preamble held the last word.
                                skill_config.instructions
                                + build_curriculum_grounding_preamble(_materials)
                                + build_ilo_precedence_block(_active_cfg)
                                # 1.1.70 M1 — what this GROUP has already been
                                # recorded as doing. Both summaries were
                                # written, exported and unit-tested in 1.1.62 /
                                # CONCEPT-1 and never wired, so the tutor only
                                # ever learned about progress by ASKING, and
                                # what came back could not be told apart from
                                # work it had watched happen. That is the
                                # "Jonas forgot everything, then claimed to
                                # remember" report.
                                #
                                # They land AFTER the ILO block on the same
                                # "later instruction wins" convention: the ILOs
                                # say what the outcomes are, these say where
                                # the group has got to, and the second has to
                                # be able to redirect the first away from a
                                # wrap-up. Empty string when the group has no
                                # recorded progress, so an untouched activity
                                # composes byte-identically to before.
                                + compose_progress_context(_active_cfg, user),
                                skill_config.multimodal_input,
                            ),
                            _activity_id,
                            group_tags=user.group_tags,
                        ),
                        proactive_greet=skill_config.proactive_greet,
                        opening_template=skill_config.opening_template,
                        # 1.1.72 — the greet turn is the ONE turn generated
                        # with no conversational context, and it was composed
                        # without the activity. So the tutor opened by asking
                        # what the student would like to explore, for an
                        # activity whose topic the teacher had set. The config
                        # is resolved a dozen lines above; this is the whole
                        # fix. None (no saved activity) composes as before.
                        cfg=_active_cfg,
                    ),
                    proactive_event_reactive=skill_config.proactive_event_reactive,
                    reactive_template=skill_config.reactive_template,
                ),
                _activity_id,
                # Phase 3: resolve the teacher's goal from THIS student's
                # verified group→class binding, not the LOCAL_MODE stub.
                group_tags=user.group_tags,
            ),
            wrap_with_iframe_context,
            # 1.1.69 M1+M2 — the server's own reading of what the student has
            # actually FILLED IN, composed per TURN from the same session state
            # the iframe-context block above dumps raw.
            #
            # It lands AFTER that block deliberately, on this file's "later
            # instruction wins" convention: the raw JSON is evidence, this is
            # the reading of it, and the reading has to carry the counts for the
            # elements that pushed NOTHING. That is the whole fix — an untouched
            # table writes no state at all, so it was previously invisible in a
            # way indistinguishable from having no table.
            #
            # It must stay a wrapper here rather than a string composed above:
            # fill-state changes mid-session, and the element MANIFEST omits
            # values precisely because it is built once.
            make_element_state_wrapper(_active_cfg),
            wrap_with_a2ui_surface_context,
        ),
        description=skill_config.description,
        tools=tools,
        sub_agents=sub_agents,
        planner=planner,
        code_executor=code_executor,
        before_agent_callback=_composed_before_agent,
        before_model_callback=_composed_before_model,
        after_agent_callback=_composed_after_agent,
        after_model_callback=_composed_after_model,
        before_tool_callback=_before_tool,
        after_tool_callback=_after_tool,
    )


def create_agent_with_thinking(
    skill_config: SkillConfig,
    user: User,
    *,
    activity_id: str | None = None,
    access_context: AccessContext | None = None,
) -> LlmAgent | _HeuristicRouter:
    """Dispatch to the three-tier thinking strategy.

    - thinking_model unset → single `create_agent(...)` (planner may be
      attached for Gemini via `_planner_for`).
    - thinking_model set → two agents built (fast from `metadata.model`,
      thinking from `metadata.thinking_model`), wrapped in `_HeuristicRouter`.

    ``activity_id`` (ALS-1 M0) selects the specific activity whose teacher-focus
    shapes the agent; ``None`` falls back to the skill id (legacy welding).

    See module docstring for the three tiers in full.
    """
    md = skill_config.skill_metadata
    if md.thinking_model is None:
        return create_agent(skill_config, user, activity_id=activity_id, access_context=access_context)

    # Tier 3: two agents + picker. Build both via the same recursive factory
    # so sub-skills/tools/callbacks stay wired identically.
    fast = create_agent(skill_config, user, activity_id=activity_id, access_context=access_context)
    thinking = create_agent(
        skill_config,
        user,
        activity_id=activity_id,
        access_context=access_context,
        _model_override=md.thinking_model,
        _planner_override=None,
    )
    return _HeuristicRouter(fast=fast, thinking=thinking, picker=_should_think)
