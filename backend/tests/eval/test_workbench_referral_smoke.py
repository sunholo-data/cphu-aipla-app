"""End-to-end LLM smoke for 1.1.149 — the tutor SENDS the student to the workbench.

Marked ``@pytest.mark.slow``: it calls the model, so it is excluded from
``make test-fast`` and runs under ``make test`` or an explicit ``-m slow`` (needs
ADC). Same shape as ``test_activity_task_in_context_smoke.py``: the activity is
built in memory, nothing is seeded.

The complaint (M, teacher seminar 2026-10-05): *"The tutor never asked the
student to use the simulations."* On prod that evening the kettle activity's
tutor opened with *"Hvilke tanker gør du dig om…"* and did not mention the sim
until a student asked how to stop it.

What it asserts: one in-memory activity with a sim (Boldkast) and a data table,
on the real ``concept-dialogue`` SKILL.md, through the real ``create_agent``. A
neutral opening and then a planted *stuck* turn; the tutor's reply to the stuck
turn must be a referral by the shared matcher (``analytics.workbench_referral``)
— the same one the runtime nudge fires on and the prod SQL counts with.

The deterministic half — that the block reaches the instruction at all, after
the framework preamble — is ``tests/api_tests/test_workbench_reaches_the_model.py``
and runs in CI. This file is the behavioural confirmation that the model uses it.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

import pytest
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from adk.agent import create_agent
from admin.platform_seed import _parse_template
from analytics.workbench_referral import is_referral, referral_vocabulary
from auth.firebase_auth import User
from db.models import SkillConfig, SkillMetadata
from db.models.activity_config import ActivityConfig, TableColumn, TableElement

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "skills" / "templates"


def _skill() -> SkillConfig:
    parsed = _parse_template(TEMPLATES_DIR / "concept-dialogue" / "SKILL.md")
    return SkillConfig(
        name=parsed["name"],
        description=parsed["description"] or "smoke-test skill",
        instructions=parsed["instructions"],
        skill_metadata=SkillMetadata.model_validate(parsed["metadata"]),
    )


def _activity() -> ActivityConfig:
    return ActivityConfig(
        activityId="act-smoke-boldkast",
        classId="smoke",
        teacherUid="smoke-teacher",
        updatedAt=datetime.now(UTC),
        title="Boldkast — hvilken vinkel giver længst kast?",
        teachingGoal="Eleverne undersøger, hvordan udgangsvinklen påvirker rækkevidden.",
        artefactId="boldkast",
        table=[
            TableElement(
                id="t1",
                title="Rækkevidde",
                rows=6,
                columns=[
                    TableColumn(id="v", label="Vinkel", unit="°"),
                    TableColumn(id="r", label="Rækkevidde", unit="m"),
                ],
            )
        ],
    )


@pytest.fixture(autouse=True)
def _real_credentials():
    """Undo the session-wide ``google.auth.default`` stub (see the sibling smoke)."""
    import google.auth
    import google.auth._default

    with mock.patch.object(google.auth, "default", google.auth._default.default):
        yield


@pytest.fixture(autouse=True)
def _activity_resolved(monkeypatch):
    cfg = _activity()
    monkeypatch.setattr("adk.agent.resolve_active_config", lambda *a, **k: cfg)
    monkeypatch.setattr("adk.teacher_focus.resolve_active_config", lambda *a, **k: cfg)
    monkeypatch.setattr("adk.callbacks.permission.can_use_tool", lambda *a, **k: True)
    return cfg


def _require_credentials() -> None:
    if not (os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GOOGLE_API_KEY")):
        pytest.skip("no Vertex AI / Gemini credentials configured (set GOOGLE_CLOUD_PROJECT or GOOGLE_API_KEY)")


def _text(events) -> str:
    return "".join(p.text for e in events if e.content and e.content.parts for p in e.content.parts if p.text).strip()


@pytest.mark.slow
def test_a_stuck_student_is_sent_to_the_workbench(_activity_resolved) -> None:
    _require_credentials()
    user = User(uid="wb-referral-smoke", email="", auth_mode="anonymous_group_id", group_id="smoke-test")
    agent = create_agent(_skill(), user, activity_id="act-smoke-boldkast")
    sessions = InMemorySessionService()
    session = sessions.create_session_sync(user_id=user.uid, app_name="wb-referral-smoke")
    runner = Runner(agent=agent, session_service=sessions, app_name="wb-referral-smoke")

    def turn(text: str) -> str:
        msg = types.Content(role="user", parts=[types.Part.from_text(text=text)])
        return _text(list(runner.run(new_message=msg, user_id=user.uid, session_id=session.id)))

    opening = turn("Hej. Vi skal finde ud af noget med at kaste en bold i dag.")
    assert opening, "agent produced no text response"
    stuck = turn("Jeg ved det ikke. Hvordan skal jeg finde ud af det?")
    assert stuck, "agent produced no text response"

    vocab = referral_vocabulary(_activity_resolved)
    assert is_referral(stuck, vocab), (
        "a stuck student was not sent to the workbench (trigger (b)). "
        f"Opening: {opening!r} · reply to the stuck turn: {stuck!r}"
    )
