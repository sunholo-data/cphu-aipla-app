"""1.1.141 M1 + M3 — the precedence block and tutor notes, END TO END.

Per the "a resolver ships with one consumer" footgun, nothing here calls the
block builders directly: activities are seeded in LOCAL_MODE Firestore, the
agent is built by the real ``create_agent`` on the real ``concept-dialogue``
SKILL.md body, and ``agent.instruction(ctx)`` is awaited the way ADK awaits it.

* A class whose tutor carries an approach (Mikkel, assigned ESRU) gets the
  block IMMEDIATELY after the approach preamble, and its tutor notes are held
  back (the approach owns how to teach).
* A class with no tutor composes byte-identically to the pre-1.1.141 chain —
  the injector swapped back to the plain ``inject_framework_preamble`` — and its
  activity's tutor notes reach the tutor.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from adk.teaching_precedence import TEACHING_PRECEDENCE_BLOCK, TEACHING_PRECEDENCE_TEXT
from auth import User
from db import firestore as fs_module
from db.firestore import set_document

TEACHER_UID = "teacher-prec"
FW_CLASS, PLAIN_CLASS = "cls-prec-fw", "cls-prec-plain"
FW_GROUP, PLAIN_GROUP = "aipla-demo-prec-fw", "aipla-demo-prec-plain"
ACTIVITY = "act-prec-1"
NOTES = "Act as Captain Newton and give hints freely."
FRAMEWORK = "esru"

_SKILL_MD = Path(__file__).resolve().parents[2] / "skills" / "templates" / "concept-dialogue" / "SKILL.md"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _class(class_id: str, tutor_id: str | None) -> None:
    doc = {
        "classId": class_id,
        "ownerUid": TEACHER_UID,
        "name": "Fysik B",
        "tagNamespace": f"class:{TEACHER_UID}:{class_id}",
        "activityIds": [ACTIVITY],
        "createdAt": "2026-10-01T00:00:00+00:00",
        "updatedAt": "2026-10-05T00:00:00+00:00",
    }
    if tutor_id:
        doc["tutorId"] = tutor_id
    set_document("classes", class_id, doc)


def _seed(notes: str = NOTES) -> None:
    from db.activities import save_activity
    from db.models.activity import Activity
    from db.tutor_assignments import set_assignment

    _class(FW_CLASS, "mikkel")
    _class(PLAIN_CLASS, None)
    set_document("anon_groups", FW_GROUP, {"classId": FW_CLASS})
    set_document("anon_groups", PLAIN_GROUP, {"classId": PLAIN_CLASS})
    set_assignment("mikkel", FRAMEWORK, updated_by="test")
    save_activity(
        Activity(
            activityId=ACTIVITY,
            ownerUid=TEACHER_UID,
            title="Energibevarelse",
            teachingGoal="Eleverne forklarer energibevarelse for en pendul.",
            tutorNotes=notes,
        )
    )


def _student(group_id: str, class_id: str) -> User:
    return User(
        uid=f"anon:{group_id}",
        email="",
        domain="",
        group_id=group_id,
        group_tags=[f"class:{TEACHER_UID}:{class_id}"],
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


def _instruction(user: User) -> str:
    from adk.agent import create_agent

    agent = create_agent(_skill(), user, activity_id=ACTIVITY)
    ctx = SimpleNamespace(state={}, user_content=None, session=SimpleNamespace(events=[], id="s"), user_id="u")
    return asyncio.run(agent.instruction(ctx))


def test_with_an_approach_the_block_sits_immediately_after_the_preamble():
    from db.framework_overrides import resolve_framework_instruction

    _seed()
    out = _instruction(_student(FW_GROUP, FW_CLASS))
    preamble = resolve_framework_instruction(FRAMEWORK)
    assert preamble
    # Adjacent: the preamble's last character is followed by the block's first.
    assert preamble + TEACHING_PRECEDENCE_BLOCK in out
    assert out.count(TEACHING_PRECEDENCE_TEXT) == 1


def test_with_an_approach_tutor_notes_are_held_back():
    _seed()
    out = _instruction(_student(FW_GROUP, FW_CLASS))
    assert NOTES not in out
    assert "The teacher's notes on how to tutor this activity" not in out


def test_without_an_approach_no_block_and_byte_identical_to_the_old_chain(monkeypatch):
    """Passthrough (handover rule 1), byte for byte: an activity with no
    approach and no notes composes exactly as it did before 1.1.141."""
    import adk.agent as agent_mod
    from adk.tutor_framework import inject_framework_preamble

    _seed(notes="")
    new = _instruction(_student(PLAIN_GROUP, PLAIN_CLASS))
    assert TEACHING_PRECEDENCE_TEXT not in new

    monkeypatch.setattr(agent_mod, "inject_framework_preamble_with_precedence", inject_framework_preamble)
    monkeypatch.setattr(agent_mod, "build_tutor_notes_block", lambda *_a, **_k: "")
    assert _instruction(_student(PLAIN_GROUP, PLAIN_CLASS)) == new


def test_without_an_approach_tutor_notes_reach_the_tutor():
    _seed()
    out = _instruction(_student(PLAIN_GROUP, PLAIN_CLASS))
    assert NOTES in out
    assert TEACHING_PRECEDENCE_TEXT not in out
