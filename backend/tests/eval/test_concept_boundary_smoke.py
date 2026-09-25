"""End-to-end LLM smoke for CONCEPT-2 M0 — the map bounds, and does not muzzle.

Marked ``@pytest.mark.slow``: it calls the model, so it is excluded from
``make test-fast`` and runs under ``make test`` or an explicit ``-m slow``. Same
shape and rationale as ``test_activity_task_in_context_smoke.py``.

**The report.** M, 2026-09-25: *"tutors stray from the lesson plans despite
keeping character."* ``adk/concept_steering.py`` answers it by telling the tutor
the map is the boundary of the lesson.

**Why the second test matters as much as the first.** 1.1.90 is explicit that
the maps guide *"while allowing for limited deviation"*, and the obvious
implementation — forbid everything off the map — trades a wandering tutor for a
stonewalling one, which is worse. So this file asserts BOTH directions:

  1. An off-map question is engaged with and then returned from.
  2. An **on-map** question that merely departs from where the tutor was heading
     is NOT deflected — following the student into a concept the teacher
     authored is the lesson working, not a digression.

The deterministic half — that the boundary and the frontier reach the composed
instruction at all — is ``tests/unit/test_concept_steering.py`` and runs in CI.
This file is the behavioural confirmation that the model then honours it.

The map here is English because the skill is ``kinebot-kinematics-tutor``, which
is deliberately English (Denmark + Indian-English audience); a Danish map under
an English tutor would test the language resolution, not the boundary.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

import pytest
from google.adk.artifacts import InMemoryArtifactService
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from adk.agent import create_agent
from admin.platform_seed import _parse_template
from auth.firebase_auth import User
from db.models import SkillConfig, SkillMetadata
from db.models.activity_config import (
    ActivityConfig,
    ConceptEdge,
    ConceptMapElement,
    ConceptNode,
)

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "skills" / "templates"

# The shipped prod shape (26 activities carry exactly this graph, in Danish):
# two roots feeding one dependent node.
_ON_MAP = ("vector", "trigonometr", "projectile", "component", "horizontal", "vertical")
# Physics the map does NOT contain, and that no amount of projectile motion
# leads to. Concrete nouns, so a wandering tutor is legible in an assertion.
_OFF_MAP_TOPIC = "how black holes form when a massive star collapses"
_OFF_MAP_WORDS = ("black hole", "star", "collaps", "gravity", "singularity")


def _activity() -> ActivityConfig:
    return ActivityConfig(
        activityId="act-concept-boundary-smoke",
        classId="smoke-class",
        teacherUid="smoke-teacher",
        updatedAt=datetime.now(UTC),
        language="en",
        teachingGoal="The student can resolve a launch velocity into components and predict the range.",
        conceptMap=[
            ConceptMapElement(
                id="cm",
                title="Projectile motion",
                nodes=[
                    ConceptNode(id="vectors", label="Vectors"),
                    ConceptNode(id="trigonometry", label="Trigonometry"),
                    ConceptNode(id="projectile", label="Projectile motion"),
                ],
                edges=[
                    ConceptEdge(**{"from": "vectors", "to": "projectile"}),
                    ConceptEdge(**{"from": "trigonometry", "to": "projectile"}),
                ],
            )
        ],
    )


def _build_skill_config_from_template(skill_name: str) -> SkillConfig:
    skill_md = TEMPLATES_DIR / skill_name / "SKILL.md"
    parsed = _parse_template(skill_md)
    metadata = SkillMetadata.model_validate(parsed["metadata"])
    return SkillConfig(
        name=parsed["name"],
        description=parsed["description"] or "smoke-test skill",
        instructions=parsed["instructions"],
        skill_metadata=metadata,
    )


def _run_turn(user_text: str) -> str:
    skill = _build_skill_config_from_template("kinebot-kinematics-tutor")
    user = User(uid="concept-boundary-smoke", email="", auth_mode="anonymous_group_id", group_id="smoke-test")
    agent = create_agent(skill, user)

    session_service = InMemorySessionService()
    session = session_service.create_session_sync(user_id=user.uid, app_name="concept-boundary-smoke")
    # An artifact service is required even though nothing here uses one: the
    # tutor carries ``load_artifacts_tool``, and ADK resolves its artifact list
    # during preprocessing on every turn.
    runner = Runner(
        agent=agent,
        session_service=session_service,
        artifact_service=InMemoryArtifactService(),
        app_name="concept-boundary-smoke",
    )

    message = types.Content(role="user", parts=[types.Part.from_text(text=user_text)])
    events = list(runner.run(new_message=message, user_id=user.uid, session_id=session.id))

    chunks: list[str] = []
    for event in events:
        if not event.content or not event.content.parts:
            continue
        for part in event.content.parts:
            if part.text:
                chunks.append(part.text)
    return "".join(chunks).strip()


@pytest.fixture(autouse=True)
def _real_credentials():
    """Undo ``tests/conftest.py``'s session-wide ``google.auth.default`` stub for
    this module — see the same fixture in ``test_activity_task_in_context_smoke``."""
    import google.auth
    import google.auth._default

    with mock.patch.object(google.auth, "default", google.auth._default.default):
        yield


@pytest.fixture(autouse=True)
def _allow_tools(monkeypatch):
    monkeypatch.setattr("adk.callbacks.permission.can_use_tool", lambda *a, **k: True)


@pytest.fixture(autouse=True)
def _mapped_activity(monkeypatch):
    monkeypatch.setattr("adk.agent.resolve_active_config", lambda *a, **k: _activity())


def _require_credentials() -> None:
    if not (os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GOOGLE_API_KEY")):
        pytest.skip("no Vertex AI / Gemini credentials configured (set GOOGLE_CLOUD_PROJECT or GOOGLE_API_KEY)")


@pytest.mark.slow
def test_an_off_map_question_is_engaged_with_and_then_returned_from() -> None:
    """The reported failure, from the other side: the tangent is taken
    seriously for a turn and the lesson is picked back up in the SAME reply."""
    _require_credentials()
    response = _run_turn(f"Random question before we start — do you know {_OFF_MAP_TOPIC}?")
    assert response, "agent produced no text response"
    low = response.lower()

    engaged = any(w in low for w in _OFF_MAP_WORDS)
    assert engaged, (
        "the tutor gave the student's question nothing at all — the boundary is meant to license a "
        f"brief excursion, not refuse one. Response was: {response!r}"
    )

    returned = any(w in low for w in _ON_MAP)
    assert returned, (
        "the tutor followed the tangent and never came back to the lesson's concepts — this is the "
        f"straying that CONCEPT-2 M0 exists to stop. Response was: {response!r}"
    )


@pytest.mark.slow
def test_an_on_map_question_is_not_deflected() -> None:
    """The counter-test 1.1.90 makes a first-class requirement.

    Components of a vector are ON the authored map, so a student who jumps to
    them is doing the lesson, not leaving it. A tutor that redirects here has
    turned the boundary into a script — the worse failure, and the one a naive
    'stay on topic' instruction produces."""
    _require_credentials()
    response = _run_turn("Can we talk about how you split a vector into horizontal and vertical components?")
    assert response, "agent produced no text response"
    low = response.lower()

    engaged = any(w in low for w in ("component", "horizontal", "vertical", "vector"))
    assert engaged, f"the tutor did not engage with a concept its own map contains. Response was: {response!r}"

    deflections = (
        "off topic",
        "off-topic",
        "outside this lesson",
        "outside the lesson",
        "not part of this lesson",
        "let's get back",
        "let us get back",
        "back on track",
        "stay focused on",
        "stick to",
    )
    used = [d for d in deflections if d in low]
    assert not used, (
        f"the tutor deflected a question that is ON its own map ({used}) — the boundary has become a "
        f"muzzle. Response was: {response!r}"
    )
