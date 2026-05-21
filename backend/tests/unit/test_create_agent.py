"""Unit tests for create_agent() (AGENT-FACTORY M2).

The factory assembles an ADK LlmAgent from a SkillConfig + authenticated
User. It reads from `skill_metadata.*`, wires a per-user
`before_tool_callback` via `make_permission_enforcer`, and recurses into
sub-skills (resolved by ID through `skills.skill_config.get_skill`) with
cycle detection.
"""

from __future__ import annotations

import logging
from unittest.mock import patch

import pytest
from a2ui.adk.send_a2ui_to_client_toolset import SendA2uiToClientToolset
from google.adk.agents import LlmAgent

from adk.agent import _safe_agent_name, create_agent
from auth.firebase_auth import User
from db.models import SkillConfig, SkillMetadata


def _user() -> User:
    return User(uid="u1", email="alice@example.com", domain="example.com")


def _skill(
    name: str = "test-skill",
    skill_id: str = "11111111-1111-1111-1111-111111111111",
    tools: list[str] | None = None,
    sub_skills: list[str] | None = None,
    model: str = "gemini-2.5-flash",
    thinking_model: str | None = None,
    instructions: str = "Do the thing.",
) -> SkillConfig:
    return SkillConfig(
        name=name,
        description="Test skill for unit tests.",
        instructions=instructions,
        skillId=skill_id,
        skillMetadata=SkillMetadata(
            model=model,
            thinkingModel=thinking_model,
            tools=tools or [],
            subSkills=sub_skills or [],
        ),
    )


# --- _safe_agent_name ---


def test_safe_agent_name_converts_hyphens_to_underscores():
    # Skill IDs default to UUIDs with hyphens, ADK rejects hyphens.
    assert _safe_agent_name("abc-123-def") == "abc_123_def"


def test_safe_agent_name_prepends_underscore_when_starts_with_digit():
    # UUIDs can start with a digit; ADK names must start with letter/underscore.
    safe = _safe_agent_name("1abc-def")
    assert safe.startswith(("s_", "_"))
    assert "-" not in safe


def test_safe_agent_name_leaves_valid_identifiers_unchanged():
    assert _safe_agent_name("already_valid") == "already_valid"


# --- happy path ---


def test_create_agent_returns_llmagent_with_expected_name_and_instruction():
    agent = create_agent(_skill(), _user())
    assert isinstance(agent, LlmAgent)
    # name is a sanitized skill_id (hyphens -> underscores)
    assert agent.name == _safe_agent_name("11111111-1111-1111-1111-111111111111")
    # Instruction is now an InstructionProvider (sprint 1.25 wraps the
    # static string with `wrap_with_iframe_context` so the runtime can
    # inject `mcp_app_context.*` state at agent-instruction-build time).
    # When session state has no `mcp_app_context.*` keys (the common
    # case), the wrapper returns the base string unchanged. Resolve the
    # callable with a stub ReadonlyContext to assert that contract.
    import asyncio
    from unittest.mock import MagicMock

    assert callable(agent.instruction)
    fake_ctx = MagicMock()
    fake_ctx.state = {}
    # asyncio.run rather than get_event_loop().run_until_complete — the
    # latter relies on the deprecated default-loop-on-main-thread that
    # gets closed by pytest-asyncio fixtures in other tests, leading to
    # "no current event loop" failures that depend on suite ordering.
    resolved = asyncio.run(agent.instruction(fake_ctx))
    assert resolved == "Do the thing."


def test_create_agent_instruction_appends_iframe_context_when_state_has_it():
    """End-to-end: when session state carries `mcp_app_context.*` keys
    (because an MCP App iframe pushed `ui/update-model-context`), the
    agent's runtime instruction MUST include the iframe-context block
    so the model can reference what's currently on screen.

    Sprint 1.25 — pairs with the iframe-context endpoint and the
    frontend `onFallbackRequest` handler."""
    import asyncio
    from unittest.mock import MagicMock

    agent = create_agent(_skill(), _user())
    fake_ctx = MagicMock()
    fake_ctx.state = {
        "mcp_app_context.ext-apps-map.show-map": {
            "structuredContent": {"label": "Munich", "viewUUID": "abc-123"},
        },
    }
    resolved = asyncio.run(agent.instruction(fake_ctx))
    assert resolved.startswith("Do the thing.")
    assert "Current iframe-app context" in resolved
    assert "Munich" in resolved
    assert "ext-apps-map.show-map" in resolved


def test_create_agent_instruction_appends_a2ui_surface_context_when_state_has_it():
    """Sprint 2.10 sibling of the iframe-context test above. When session
    state carries A2UI surface data (either per-turn snapshot under
    ``a2ui_surface_state`` OR persisted action writes under
    ``a2ui_surface_context.{surface}.*``), the agent's runtime
    instruction MUST include the surface-context block so the model
    knows what surfaces the user is viewing."""
    import asyncio
    from unittest.mock import MagicMock

    agent = create_agent(_skill(), _user())
    fake_ctx = MagicMock()
    fake_ctx.state = {
        "a2ui_surface_state": {
            "workspace": {"dataModel": {"activeUsers": "42 users online"}},
        },
        "a2ui_surface_context.workspace.lastAction": {
            "name": "approve",
            "sourceComponentId": "row-47",
        },
    }
    resolved = asyncio.run(agent.instruction(fake_ctx))
    assert resolved.startswith("Do the thing.")
    # A2UI block prose
    assert "A2UI surface state" in resolved
    # Per-turn dataModel content
    assert "42 users online" in resolved
    # Persisted action content
    assert "approve" in resolved
    assert "row-47" in resolved
    # Single workspace heading — both sources merged, not stacked
    assert resolved.count("## workspace") == 1


def test_create_agent_instruction_appends_both_iframe_and_a2ui_blocks():
    """Chain coexistence: when state has BOTH mcp_app_context.* AND
    a2ui_surface_state, the agent prompt carries BOTH blocks. The two
    InstructionProvider wrappers are independent — each appends its
    own block in order (iframe first, A2UI second)."""
    import asyncio
    from unittest.mock import MagicMock

    agent = create_agent(_skill(), _user())
    fake_ctx = MagicMock()
    fake_ctx.state = {
        "mcp_app_context.ext-apps-map.show-map": {
            "structuredContent": {"label": "Munich"},
        },
        "a2ui_surface_state": {
            "workspace": {"dataModel": {"revenue": "$1,234"}},
        },
    }
    resolved = asyncio.run(agent.instruction(fake_ctx))
    assert resolved.startswith("Do the thing.")
    assert "Current iframe-app context" in resolved
    assert "Munich" in resolved
    assert "A2UI surface state" in resolved
    assert "$1,234" in resolved
    # iframe block appears first (inner wrapper appends earlier)
    assert resolved.index("iframe-app context") < resolved.index("A2UI surface state")


def test_create_agent_includes_a2ui_toolset():
    """A2UI is delivered via SendA2uiToClientToolset tool calls, not fenced blocks."""
    agent = create_agent(_skill(), _user())
    a2ui_toolsets = [t for t in agent.tools if isinstance(t, SendA2uiToClientToolset)]
    assert len(a2ui_toolsets) == 1


def test_create_agent_omits_a2ui_toolset_when_opted_out():
    """AIPLA 2026-05-21 — skills declaring `tool_configs.a2ui.enabled: false`
    have NO A2UI toolset attached, so the model can't see or call
    send_a2ui_json_to_client. Closes upstream-feedback #22."""
    skill = SkillConfig(
        name="chat-only",
        description="A minimalist chat-only skill.",
        instructions="Just chat. No tools.",
        skillId="22222222-2222-2222-2222-222222222222",
        skillMetadata=SkillMetadata(
            model="gemini-2.5-flash",
            tools=[],
            toolConfigs={"a2ui": {"enabled": False}},
        ),
    )
    agent = create_agent(skill, _user())
    a2ui_toolsets = [t for t in agent.tools if isinstance(t, SendA2uiToClientToolset)]
    assert len(a2ui_toolsets) == 0


def test_create_agent_omits_default_tools_when_opted_out():
    """AIPLA 2026-05-21 — skills declaring `tool_configs.defaults.artifacts: false`
    + `defaults.memory: false` get NEITHER the artifact-loading tools NOR
    the memory tools. Model can't see them, can't accidentally call them.
    Closes upstream-feedback #25."""
    from google.adk.tools.load_artifacts_tool import load_artifacts_tool
    from google.adk.tools.load_memory_tool import load_memory_tool
    from google.adk.tools.preload_memory_tool import preload_memory_tool

    from adk.artifact_tools import retrieve_artifact

    skill = SkillConfig(
        name="chat-only",
        description="Minimalist chat-only skill.",
        instructions="Just chat.",
        skillId="44444444-4444-4444-4444-444444444444",
        skillMetadata=SkillMetadata(
            model="gemini-2.5-flash",
            tools=[],
            toolConfigs={"defaults": {"artifacts": False, "memory": False}},
        ),
    )
    agent = create_agent(skill, _user())
    # By identity (function object) — these are imported singletons.
    assert load_artifacts_tool not in agent.tools
    assert retrieve_artifact not in agent.tools
    assert load_memory_tool not in agent.tools
    assert preload_memory_tool not in agent.tools


def test_create_agent_keeps_default_tools_by_default():
    """Inherited workshop demos don't declare `defaults`; the four
    template-default tools stay attached (backwards-compat)."""
    from google.adk.tools.load_artifacts_tool import load_artifacts_tool
    from google.adk.tools.load_memory_tool import load_memory_tool

    agent = create_agent(_skill(), _user())
    assert load_artifacts_tool in agent.tools
    assert load_memory_tool in agent.tools


def test_create_agent_includes_a2ui_toolset_when_explicitly_enabled():
    """The default is enabled=True so this is the same as the default-case
    test above, but the explicit declaration must also work — round-trip
    through `from_tool_configs`."""
    skill = SkillConfig(
        name="opt-in",
        description="Explicitly opting back in.",
        instructions="…",
        skillId="33333333-3333-3333-3333-333333333333",
        skillMetadata=SkillMetadata(
            model="gemini-2.5-flash",
            tools=[],
            toolConfigs={"a2ui": {"enabled": True}},
        ),
    )
    agent = create_agent(skill, _user())
    a2ui_toolsets = [t for t in agent.tools if isinstance(t, SendA2uiToClientToolset)]
    assert len(a2ui_toolsets) == 1


def test_create_agent_wires_tools_from_skill_metadata():
    # list_documents + get_document_content are in the registry (model-agnostic).
    # ai_search/google_search are model-aware and handled by agent.py directly, so not here.
    agent = create_agent(_skill(tools=["list_documents", "get_document_content"]), _user())
    # Defaults from agent.py: load_artifacts_tool + retrieve_artifact +
    # load_memory_tool + preload_memory_tool. Plus 2 registry tools and
    # SendA2uiToClientToolset = 7 total.
    assert len(agent.tools) == 7
    tool_names = _tool_ids(agent)
    assert "load_artifacts" in tool_names
    assert "load_memory" in tool_names
    assert "preload_memory" in tool_names


def _tool_ids(agent) -> list[str]:
    """Return a list of identifiers for each tool in agent.tools.

    ADK tools may be raw functions (use __name__) or FunctionTool/built-in
    objects (use .name). This helper normalises both so tests aren't brittle
    against ADK's internal wrapping choices.
    """
    ids = []
    for t in agent.tools:
        ids.append(getattr(t, "name", None) or getattr(t, "__name__", type(t).__name__))
    return ids


def test_create_agent_search_uses_sub_agent_pattern():
    """Search skills use AgentTool(search_agent) for all models — keeps root agent
    FunctionTool-compatible so retrieve_artifact and a2ui coexist with search."""
    from google.adk.tools import AgentTool

    agent = create_agent(_skill(tools=["google_search"], model="gemini-2.5-flash"), _user())
    tool_ids = _tool_ids(agent)
    # FunctionTools are NOT excluded — search goes via sub-agent
    assert "retrieve_artifact" in tool_ids
    a2ui_toolsets = [t for t in agent.tools if isinstance(t, SendA2uiToClientToolset)]
    assert len(a2ui_toolsets) == 1
    # Search is delivered as an AgentTool wrapping the search_agent sub-agent
    agent_tools = [t for t in agent.tools if isinstance(t, AgentTool)]
    assert any(getattr(t.agent, "name", None) == "web_search_agent" for t in agent_tools)


def test_create_agent_non_gemini_search_retains_retrieve_artifact():
    """Non-search Gemini skills should still get retrieve_artifact."""
    agent = create_agent(_skill(tools=["list_documents"], model="gemini-2.5-flash"), _user())
    assert "retrieve_artifact" in _tool_ids(agent)


def test_create_agent_unknown_tool_raises():
    """Unknown tool names raise ValueError to prevent silent misconfiguration."""
    with pytest.raises(ValueError, match="not_a_real_tool"):
        create_agent(_skill(tools=["list_documents", "not_a_real_tool"]), _user())


def test_create_agent_attaches_permission_enforcer_callback():
    agent = create_agent(_skill(), _user())
    # ADK may coerce a single callback into a list; handle both.
    cb = agent.before_tool_callback
    assert cb is not None
    if isinstance(cb, list):
        assert len(cb) >= 1
    else:
        assert callable(cb)


# --- sub-agent recursion ---


def test_create_agent_recurses_into_sub_skills():
    child = _skill(name="child-skill", skill_id="child-id", instructions="child work")
    parent = _skill(name="parent-skill", skill_id="parent-id", sub_skills=["child-id"])
    with patch("adk.agent.get_skill", return_value=child):
        agent = create_agent(parent, _user())
    assert len(agent.sub_agents) == 1
    assert agent.sub_agents[0].name == _safe_agent_name("child-id")


def test_create_agent_missing_sub_skill_warns_and_skips(caplog):
    parent = _skill(name="parent-skill", skill_id="parent-id", sub_skills=["missing-id"])
    with patch("adk.agent.get_skill", return_value=None):
        with caplog.at_level(logging.WARNING):
            agent = create_agent(parent, _user())
    assert agent.sub_agents == []
    assert any("missing-id" in rec.message for rec in caplog.records)


def test_create_agent_detects_direct_self_cycle():
    # Skill references itself as a sub-skill — must raise.
    skill = _skill(name="loop-skill", skill_id="loop-id", sub_skills=["loop-id"])
    with patch("adk.agent.get_skill", return_value=skill):
        with pytest.raises(ValueError, match="Sub-skill cycle detected"):
            create_agent(skill, _user())


def test_create_agent_detects_indirect_cycle():
    a = _skill(name="a-skill", skill_id="a-id", sub_skills=["b-id"])
    b = _skill(name="b-skill", skill_id="b-id", sub_skills=["a-id"])
    lookup = {"a-id": a, "b-id": b}
    with patch("adk.agent.get_skill", side_effect=lambda sid: lookup.get(sid)):
        with pytest.raises(ValueError, match="Sub-skill cycle detected"):
            create_agent(a, _user())
