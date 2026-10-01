"""The tutor acts on the simulation — 1.1.133 M1 (the tool) and M2 (the level).

What these pin, in the design's acceptance order:

1. a sim with no ``commands`` → no ``control_sim`` in the tool list, over the
   REAL agent builder (and none without an activity at all);
4. the result is allow-listed in the stream filter, and the allow-list guard
   goes red when it is not;
5. a ``view`` tutor's schema has no ``lock``; a ``restrict`` tutor's does;

plus the tool's own contract: undeclared commands, disallowed commands and
malformed args are refused before anything reaches the browser, and at most
three changes go out per turn.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from adk import sim_control_tools as sct
from adk.sim_control_tools import (
    DEFAULT_SIM_CONTROL,
    MAX_CALLS_PER_TURN,
    admitted_commands,
    build_sim_control_tools,
    resolve_sim_control_level,
)
from adk.stream_redaction import should_redact_tool
from artefacts.arg_schema import validate_args
from artefacts.loader import load_artefact

_REPO = Path(__file__).resolve().parents[3]


def _cfg(artefact_id: str | None = "sol-jord-maane") -> NS:
    return NS(artefact_id=artefact_id, activity_id="act-1", class_id="cls-1")


def _student() -> NS:
    return NS(group_id="sweet-bison-13")


def _ctx(invocation: str = "inv-1") -> NS:
    return NS(invocation_id=invocation, session=NS(id="sess-1"), function_call_id="fc-1")


def _tool(level: str = "view", artefact_id: str | None = "sol-jord-maane"):
    tools = build_sim_control_tools(_cfg(artefact_id), _student(), level=level, skill_id="sk")
    assert len(tools) == 1
    return tools[0]


def _declared_commands(tool) -> list[str]:
    return list(tool._get_declaration().parameters.properties["command"].enum)


@pytest.fixture
def emitted(monkeypatch):
    """Capture chat-log rows instead of writing them."""
    rows: list[dict] = []
    import observability.chat_log as chat_log

    monkeypatch.setattr(chat_log, "emit_workbench_event", lambda **kw: rows.append(kw))
    return rows


# --- When the tool exists at all -------------------------------------------


@pytest.mark.parametrize(
    "cfg",
    [None, _cfg(None), _cfg("boldkast"), _cfg("no-such-sim")],
    ids=["no-activity", "no-sim", "sim-without-commands", "unknown-sim"],
)
def test_no_tool_without_a_commanding_sim(cfg) -> None:
    assert build_sim_control_tools(cfg, _student(), level="restrict") == []


def test_a_none_tutor_never_gets_the_tool() -> None:
    """M2: an approach that declares `sim_control: none` builds no tool, even on
    a sim that declares every command."""
    assert build_sim_control_tools(_cfg(), _student(), level="none") == []
    assert admitted_commands(load_artefact("sol-jord-maane"), "none") == []


def test_the_tool_is_named_for_the_client_and_the_allow_list() -> None:
    assert _tool().name == "control_sim" == sct.TOOL_NAME


# --- M2: the level shapes the schema ----------------------------------------


def test_a_view_tutor_cannot_see_state_changing_commands() -> None:
    """Acceptance 5. A disallowed command is not in the schema at all, so the
    model never sees it — not merely refused when called."""
    names = _declared_commands(_tool("view"))
    assert "jump" in names and "setView" in names
    assert not {"lock", "configure", "setTask", "toast", "startMission"} & set(names)


def test_levels_are_cumulative() -> None:
    view = set(_declared_commands(_tool("view")))
    scaffold = set(_declared_commands(_tool("scaffold")))
    restrict = set(_declared_commands(_tool("restrict")))
    assert view < scaffold < restrict
    assert "setTask" in scaffold and "lock" not in scaffold
    assert {"lock", "configure"} <= restrict


def test_a_view_tutor_calling_lock_is_refused_server_side_too(emitted) -> None:
    """The declaration is a hint to the model, not a guarantee."""
    result = _tool("view").func("lock", {"controls": ["time"]}, tool_context=_ctx())
    assert result["ok"] is False
    assert "not available" in result["error"]
    assert emitted == []


def test_the_default_level_is_view() -> None:
    """Decision 2026-10-01: the design's proposal."""
    assert DEFAULT_SIM_CONTROL == "view"
    assert resolve_sim_control_level(None) == "view"


def test_the_level_comes_from_the_tutors_framework(monkeypatch) -> None:
    import db.framework_overrides as fo

    frameworks = {
        "fw-none": NS(sim_control="none"),
        "fw-restrict": NS(sim_control="restrict"),
        "fw-silent": NS(sim_control=None),
    }
    monkeypatch.setattr(fo, "effective_framework", lambda fid: frameworks.get(fid))
    assert resolve_sim_control_level("fw-none") == "none"
    assert resolve_sim_control_level("fw-restrict") == "restrict"
    # A framework that says nothing, or one that cannot be found, is the default.
    assert resolve_sim_control_level("fw-silent") == "view"
    assert resolve_sim_control_level("fw-gone") == "view"


def test_every_published_framework_parses_with_a_valid_level() -> None:
    """The field is optional and today no published framework sets it — every
    base tutor and every framework tutor is therefore at the default. A POE
    tutor wanting `restrict` is a decision for the framework file, signed off by
    the people who own the pedagogy, not a default slipped in here."""
    from frameworks.loader import load_frameworks

    for fw in load_frameworks():
        assert fw.sim_control in (None, "none", "view", "scaffold", "restrict"), fw.id


def test_the_framework_field_reads_from_yaml_and_refuses_nonsense() -> None:
    from pydantic import ValidationError

    from db.models.teaching_framework import TeachingFramework

    assert TeachingFramework(id="x", label="X", simControl="restrict").sim_control == "restrict"
    assert TeachingFramework(id="x", label="X").sim_control is None
    with pytest.raises(ValidationError):
        TeachingFramework(id="x", label="X", simControl="everything")


@pytest.mark.parametrize(
    ("level", "has_tool", "has_lock"),
    [("none", False, False), ("view", True, False), ("scaffold", True, False), ("restrict", True, True)],
)
def test_the_tutors_framework_decides_what_the_agent_is_built_with(
    _activity_env, monkeypatch, level, has_tool, has_lock
) -> None:
    """End to end over the real agent builder: the class tutor's framework sets
    `sim_control`, and the agent the student talks to is built accordingly — a
    `none` tutor never gets the tool, a `view` tutor gets one with no `lock`."""
    import adk.agent as agent_mod
    import db.framework_overrides as fo
    from adk.tutor_resolution import TeachingContext

    monkeypatch.setattr(
        agent_mod,
        "resolve_teaching_context",
        lambda *a, **k: TeachingContext(
            tutor_id="t",
            framework_id="fw",
            persona_id=None,
            class_id=None,
            activity_id=None,
            interaction_style=None,
            source="tutor",
        ),
    )
    monkeypatch.setattr(fo, "effective_framework", lambda fid: NS(sim_control=level) if fid == "fw" else None)
    tools = _agent_tools("sol-jord-maane")
    control = [t for t in tools if getattr(t, "name", "") == "control_sim"]
    assert bool(control) is has_tool
    if control:
        assert ("lock" in _declared_commands(control[0])) is has_lock


# --- M1: the call ------------------------------------------------------------


def test_a_valid_command_returns_what_the_client_routes_and_renders(emitted) -> None:
    result = _tool().func("jump", {"event": "solform"}, tool_context=_ctx())
    assert result == {
        "ok": True,
        "artefactId": "sol-jord-maane",
        "command": "jump",
        "args": {"event": "solform"},
        "effect": "Sprang til næste solformørkelse",
        "power": "view",
    }


def test_the_command_is_stamped_on_the_chat_log(emitted) -> None:
    teaching = NS(tutor_id="t-sofie", tutor_version=3, framework_id="esru")
    tool = build_sim_control_tools(_cfg(), _student(), level="view", skill_id="sk", teaching=teaching)[0]
    tool.func("setView", {"id": "surface"}, tool_context=_ctx())
    assert len(emitted) == 1
    row = emitted[0]
    assert row["group_id"] == "sweet-bison-13"
    assert row["session_id"] == "sess-1"
    assert row["server"] == "sol-jord-maane"
    assert row["tool"] == "control_sim"
    assert row["field"] == "setView"
    # The catalogue's own effect text, with the view's student-facing name.
    assert row["label"].startswith("Skiftede udsigt: Fra Jorden")
    assert row["label"].endswith("observatør")
    assert row["activity_id"] == "act-1" and row["class_id"] == "cls-1"
    # Which tutor moved the sim, stamped now rather than joined later.
    assert row["value"]["tutorId"] == "t-sofie"
    assert row["value"]["frameworkId"] == "esru"
    assert row["value"]["args"] == {"id": "surface"}


def test_a_teacher_preview_logs_nothing(emitted) -> None:
    tool = build_sim_control_tools(_cfg(), NS(group_id=None), level="view")[0]
    assert tool.func("play", {}, tool_context=_ctx())["ok"] is True
    assert emitted == []


@pytest.mark.parametrize(
    ("command", "args", "needle"),
    [
        ("teleport", {}, "unknown command"),
        ("jump", {}, "args.event is required"),
        ("jump", {"event": "christmas"}, "must be one of"),
        ("jump", {"event": "solform", "silent": True}, "is not an argument"),
        ("setScale", {"scale": 3}, "must be one of"),
        ("look", {"fov": 500}, "must be <= 120"),
    ],
)
def test_bad_calls_are_refused_and_never_reach_the_log(emitted, command, args, needle) -> None:
    result = _tool().func(command, args, tool_context=_ctx())
    assert result["ok"] is False
    assert needle in result["error"]
    assert emitted == []


def test_at_most_three_changes_per_turn(emitted) -> None:
    tool = _tool()
    for _ in range(MAX_CALLS_PER_TURN):
        assert tool.func("play", {}, tool_context=_ctx("turn-A"))["ok"] is True
    refused = tool.func("pause", {}, tool_context=_ctx("turn-A"))
    assert refused["ok"] is False and "per turn" in refused["error"]
    # A new turn starts a new budget.
    assert tool.func("pause", {}, tool_context=_ctx("turn-B"))["ok"] is True
    assert len(emitted) == MAX_CALLS_PER_TURN + 1


def test_args_may_be_omitted_for_a_command_that_takes_none(emitted) -> None:
    assert _tool().func("pause", None, tool_context=_ctx())["ok"] is True


def test_the_declaration_types_the_args_for_gemini() -> None:
    """Gemini refuses an OBJECT parameter with no properties, which is what a
    bare ``args: dict`` declares. The args schema is the typed union instead."""
    decl = _tool("restrict")._get_declaration()
    args = decl.parameters.properties["args"]
    assert args.properties, "args must carry properties"
    assert set(args.properties["event"].enum) >= {"solform", "maaneform"}
    # `id` is a view on setView and a mission on startMission — merged, not lost.
    assert {"surface", "M1"} <= set(args.properties["id"].enum)
    # Gemini enums are strings only; a numeric enum keeps its type, not its enum.
    assert args.properties["secondsPerSecond"].enum is None
    assert decl.parameters.required == ["command"]
    assert "jump" in decl.description and "card" in decl.description


def test_validate_args_subset() -> None:
    schema = {
        "type": "object",
        "properties": {"xs": {"type": "array", "maxItems": 2, "items": {"enum": ["a", "b"]}}},
    }
    assert validate_args(schema, {"xs": ["a"]}) == []
    assert validate_args(schema, {"xs": ["a", "c"]}) == ["args.xs[1] must be one of ['a', 'b']"]
    assert validate_args(schema, {"xs": ["a", "a", "a"]}) == ["args.xs must have at most 2 items"]
    assert validate_args(schema, {"xs": "a"}) == ["args.xs must be array"]
    assert validate_args({"type": "object", "properties": {"n": {"type": "integer"}}}, {"n": True}) == [
        "args.n must be integer"
    ]


# --- The stream filter --------------------------------------------------------


def test_the_result_reaches_the_student_client() -> None:
    """Without this, the card never draws AND the command never reaches the sim
    — the client routes from the result."""
    assert should_redact_tool("control_sim") is False


def test_the_allow_list_guard_goes_red_without_control_sim(tmp_path: Path) -> None:
    """Acceptance 4 — the 1.1.101 footgun. Run the real guard over a copy of the
    tree with `control_sim` removed from the allow-list."""
    if shutil.which("bash") is None:  # pragma: no cover
        pytest.skip("bash unavailable")
    (tmp_path / "scripts").mkdir()
    shutil.copy(_REPO / "scripts" / "check-stream-render-allowlist.sh", tmp_path / "scripts")
    (tmp_path / "backend" / "adk").mkdir(parents=True)
    filter_src = (_REPO / "backend" / "adk" / "stream_redaction.py").read_text(encoding="utf-8")
    assert '        "control_sim",\n' in filter_src
    (tmp_path / "frontend" / "src" / "components" / "chat").mkdir(parents=True)
    bubble = _REPO / "frontend" / "src" / "components" / "chat" / "MessageBubble.tsx"
    shutil.copy(bubble, tmp_path / "frontend" / "src" / "components" / "chat")
    script = tmp_path / "scripts" / "check-stream-render-allowlist.sh"

    (tmp_path / "backend" / "adk" / "stream_redaction.py").write_text(filter_src, encoding="utf-8")
    ok = subprocess.run(["bash", str(script)], capture_output=True, text=True, check=False)
    assert ok.returncode == 0, ok.stdout + ok.stderr

    (tmp_path / "backend" / "adk" / "stream_redaction.py").write_text(
        filter_src.replace('        "control_sim",\n', ""), encoding="utf-8"
    )
    red = subprocess.run(["bash", str(script)], capture_output=True, text=True, check=False)
    assert red.returncode != 0
    assert "control_sim" in red.stdout


# --- Over the real agent builder ---------------------------------------------


@pytest.fixture
def _activity_env(monkeypatch):
    from db import firestore as fs_module

    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _agent_tool_names(artefact_id: str | None) -> list[str]:
    return [getattr(t, "name", type(t).__name__) for t in _agent_tools(artefact_id)]


def _agent_tools(artefact_id: str | None) -> list:
    from adk.agent import create_agent
    from adk.teacher_focus import LOCAL_MODE_DEMO_CLASS_ID
    from auth.firebase_auth import User
    from db.activity_configs import upsert_activity_config
    from db.local_fixture import WORKSHOP_USER_UID
    from db.models import SkillConfig, SkillMetadata

    skill_id = "44444444-4444-4444-4444-444444444444"
    if artefact_id is not None:
        upsert_activity_config(
            teacher_uid=WORKSHOP_USER_UID,
            class_id=LOCAL_MODE_DEMO_CLASS_ID,
            activity_id=skill_id,
            teaching_goal="Forklar formørkelser.",
            artefact_id=artefact_id,
        )
    skill = SkillConfig(
        name="t",
        description="d",
        instructions="Do the thing.",
        skillId=skill_id,
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )
    student = User(uid="group-x", email="", domain="", group_id="sweet-bison-13", auth_mode="anonymous_group_id")
    agent = create_agent(skill, student)
    return list(agent.tools)


def test_the_agent_gets_control_sim_on_a_commanding_sim(_activity_env) -> None:
    assert "control_sim" in _agent_tool_names("sol-jord-maane")


def test_the_agent_tool_list_is_unchanged_without_one(_activity_env) -> None:
    """Acceptance 1 + the passthrough guarantee."""
    assert "control_sim" not in _agent_tool_names("boldkast")
    assert "control_sim" not in _agent_tool_names(None)
