"""1.1.149 — the workbench reaches the STUDENT's composed instruction, end to end.

Per the "a resolver ships with one consumer" footgun, nothing here calls
``compose_workbench_affordances`` directly: an activity with a sim and a table is
seeded in LOCAL_MODE Firestore, the agent is built by the real ``create_agent``
on the real ``concept-dialogue`` SKILL.md body, and ``agent.instruction(ctx)`` is
awaited the way ADK awaits it on a turn.

The class carries a tutor with a framework (Mikkel, assigned ESRU), so there is a
framework preamble for the block to be AFTER — acceptance criterion 1.

The mirror test holds the passthrough: an activity with no sim and no element
composes byte-identically with and without the wrapper.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from auth import User
from db import firestore as fs_module
from db.firestore import set_document

CLASS_ID = "cls-fysik-wb"
TEACHER_UID = "teacher-wb"
GROUP_ID = "aipla-demo-wb"
TAGS = [f"class:{TEACHER_UID}:{CLASS_ID}"]
SIM_ACTIVITY = "act-wb-kettle"
EMPTY_ACTIVITY = "act-wb-chat-only"
FRAMEWORK = "esru"

_SKILL_MD = Path(__file__).resolve().parents[2] / "skills" / "templates" / "concept-dialogue" / "SKILL.md"
_DENIAL = "There is no simulator on screen"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _seed() -> None:
    from db.activities import save_activity
    from db.models.activity import Activity
    from db.models.activity_config import ChecklistItem, TableColumn, TableElement
    from db.tutor_assignments import set_assignment

    set_document(
        "classes",
        CLASS_ID,
        {
            "classId": CLASS_ID,
            "ownerUid": TEACHER_UID,
            "name": "Fysik B",
            "tagNamespace": f"class:{TEACHER_UID}:{CLASS_ID}",
            "tutorId": "mikkel",
            "createdAt": "2026-10-01T00:00:00+00:00",
            "updatedAt": "2026-10-05T00:00:00+00:00",
        },
    )
    set_document("anon_groups", GROUP_ID, {"classId": CLASS_ID})
    set_assignment("mikkel", FRAMEWORK, updated_by="test")
    save_activity(
        Activity(
            activityId=SIM_ACTIVITY,
            ownerUid=TEACHER_UID,
            title="Effekt og nyttevirkning med simulering",
            teachingGoal="Eleverne bestemmer elkedlens nyttevirkning.",
            artefactId="kettle-efficiency",
            checklist=[ChecklistItem(id="c1", label="Mål effekten")],
            table=[TableElement(id="t1", title="Måleskema", columns=[TableColumn(id="a", label="Tid", unit="s")])],
        )
    )
    save_activity(
        Activity(
            activityId=EMPTY_ACTIVITY,
            ownerUid=TEACHER_UID,
            title="Energikilder — debat",
            teachingGoal="Diskuter fordele og ulemper ved energikilder.",
        )
    )


def _student() -> User:
    return User(
        uid=f"anon:{GROUP_ID}",
        email="",
        domain="",
        group_id=GROUP_ID,
        group_tags=TAGS,
        auth_mode="anonymous_group",
    )


def _skill():
    from admin.platform_seed import _parse_template
    from db.models import SkillConfig, SkillMetadata

    parsed = _parse_template(_SKILL_MD)
    return SkillConfig(
        name="concept-dialogue",
        description="t",
        instructions=parsed["instructions"],
        proactiveGreet=True,
        openingTemplate=parsed["openingTemplate"],
        skillId="44444444-4444-4444-4444-444444444444",
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )


def _instruction(activity_id: str, *, events=None, user_text: str | None = None) -> str:
    from adk.agent import create_agent

    agent = create_agent(_skill(), _student(), activity_id=activity_id)
    content = SimpleNamespace(parts=[SimpleNamespace(text=user_text)]) if user_text else None
    ctx = SimpleNamespace(
        state={}, user_content=content, session=SimpleNamespace(events=events or [], id="s"), user_id="u"
    )
    return asyncio.run(agent.instruction(ctx))


def _framework_preamble() -> str:
    from db.framework_overrides import resolve_framework_instruction

    preamble = resolve_framework_instruction(FRAMEWORK)
    assert preamble, "fixture: the framework renders no instruction"
    return preamble


def test_a_sim_activity_tells_the_student_tutor_what_is_on_the_bench():
    _seed()
    out = _instruction(SIM_ACTIVITY)

    assert "WORKBENCH — what the student has beside this chat" in out
    assert 'Simulation "Elkedel — energi og nyttevirkning"' in out
    assert 'Data table "Måleskema"' in out
    assert "(b) when the student is stuck" in out
    # Criterion 2: the denial is gone from the body the tutor runs on.
    assert _DENIAL not in out


def test_the_block_comes_after_the_framework_preamble_and_the_fill_state():
    """Criterion 1 — the position IS the fix: 1.1.62's manifest sat early, and
    the framework preamble, appended last, said nothing about the workbench."""
    _seed()
    out = _instruction(SIM_ACTIVITY)
    block_at = out.index("WORKBENCH — what the student has beside this chat")

    preamble_at = out.index(_framework_preamble()[:200])
    assert preamble_at < block_at

    fill_state_at = out.index("Workbench state right now")
    assert fill_state_at < block_at


def test_the_opening_points_at_the_sim_not_the_checklist():
    _seed()
    out = _instruction(SIM_ACTIVITY, user_text="[session_start]")
    assert 'First thing on the workbench: the simulation "Elkedel' in out
    assert "Reminder:" not in out  # never nudged on the opening turn


def test_the_nudge_reaches_the_model_after_k_non_referring_turns():
    from adk.workbench_affordances import NUDGE_EVERY_K

    def ev(author: str, text: str):
        return SimpleNamespace(author=author, content=SimpleNamespace(parts=[SimpleNamespace(text=text)]))

    events = []
    for _ in range(NUDGE_EVERY_K):
        events += [ev("user", "hmm"), ev("concept_dialogue", "Hvad tror du selv?")]
    events.append(ev("user", "jeg ved det ikke"))

    _seed()
    assert "Reminder: your last 3 replies" in _instruction(SIM_ACTIVITY, events=events)


def test_no_sim_and_no_element_composes_byte_identically_without_the_wrapper(monkeypatch):
    """Passthrough (handover rule 1): the block contributes nothing to a
    chat-only activity, byte for byte."""
    import adk.agent as agent_mod

    _seed()
    with_wrapper = _instruction(EMPTY_ACTIVITY)
    assert "WORKBENCH —" not in with_wrapper

    monkeypatch.setattr(agent_mod, "make_workbench_affordances_wrapper", lambda *a, **k: lambda base: base)
    assert _instruction(EMPTY_ACTIVITY) == with_wrapper
