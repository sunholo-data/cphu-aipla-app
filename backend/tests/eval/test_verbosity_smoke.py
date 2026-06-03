"""End-to-end LLM smoke for the tutor response-length constraint.

Marked ``@pytest.mark.slow`` because it actually calls the model
(``gemini-2.5-flash`` for ``led-planck-tutor``). LLM calls cost
tokens, take several seconds, and depend on network + Vertex AI
authentication, so this test is excluded from ``make test-fast`` /
CI inner loop and only runs under ``make test`` or an explicit
``-m slow`` invocation.

What it asserts:
  1. The response ends with a question mark (``?``) — confirms the
     "end with a question" half of the constraint reached the model.
  2. The response contains at most 4 sentence-ending punctuation
     marks (``.``, ``?``, ``!``) — proxy for the <=3-sentence cap
     with a +1 tolerance for the final question mark and for
     numeric/abbreviation periods that don't terminate sentences.

The unit-level guarantee that the constraint substrings survive
SKILL.md parsing into the resolved system prompt is in
``tests/unit/skills/test_response_length_constraint.py`` and runs
in test-fast — this file is the behavioural confirmation that the
model actually obeys the prompt.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from adk.agent import create_agent
from admin.platform_seed import _parse_template
from auth.firebase_auth import User
from db.models import SkillConfig, SkillMetadata

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "skills" / "templates"


def _build_skill_config_from_template(skill_name: str) -> SkillConfig:
    """Construct an in-memory SkillConfig from the SKILL.md template.

    Bypasses Firestore so the smoke test doesn't depend on a seeded
    backend. Uses the same parser the platform_seed.seed() flow uses
    in production, so the resolved instructions match what a deployed
    skill would carry.
    """
    skill_md = TEMPLATES_DIR / skill_name / "SKILL.md"
    parsed = _parse_template(skill_md)
    metadata = SkillMetadata.model_validate(parsed["metadata"])
    return SkillConfig(
        name=parsed["name"],
        description=parsed["description"] or "smoke-test skill",
        instructions=parsed["instructions"],
        skill_metadata=metadata,
    )


@pytest.mark.slow
def test_led_planck_tutor_obeys_response_length_constraint() -> None:
    """Smoke-test the resolved led-planck-tutor agent against a simple
    greeting. The response must end with a question and contain at most
    4 sentence-ending punctuation marks (proxy for <=3 sentences +1
    tolerance for the question mark and numeric periods)."""
    # Skip cleanly if Vertex auth isn't wired (e.g. on a laptop without
    # ADC). The test-fast harness excludes slow tests anyway; this guard
    # just makes a manual ``pytest -m slow`` run produce a clear skip
    # instead of an opaque auth error.
    if not (os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GOOGLE_API_KEY")):
        pytest.skip("no Vertex AI / Gemini credentials configured (set GOOGLE_CLOUD_PROJECT or GOOGLE_API_KEY)")

    skill = _build_skill_config_from_template("led-planck-tutor")
    user = User(uid="verbosity-smoke-user", email="", auth_mode="anonymous_group_id", group_id="smoke-test")
    agent = create_agent(skill, user)

    session_service = InMemorySessionService()
    session = session_service.create_session_sync(user_id=user.uid, app_name="verbosity-smoke")
    runner = Runner(agent=agent, session_service=session_service, app_name="verbosity-smoke")

    message = types.Content(role="user", parts=[types.Part.from_text(text="hej")])
    events = list(runner.run(new_message=message, user_id=user.uid, session_id=session.id))

    # Aggregate every text part across all model events into one string.
    response_chunks: list[str] = []
    for event in events:
        if not event.content or not event.content.parts:
            continue
        for part in event.content.parts:
            if part.text:
                response_chunks.append(part.text)
    response = "".join(response_chunks).strip()

    assert response, f"agent produced no text response; events={events!r}"
    assert response.endswith("?"), (
        f"response must end with a question mark per the response-length constraint, but ended with: {response[-30:]!r}"
    )
    sentence_terminators = response.count(".") + response.count("?") + response.count("!")
    assert sentence_terminators <= 4, (
        f"response exceeded the <=3-sentence cap (sentence terminators={sentence_terminators}); "
        f"response was: {response!r}"
    )
