"""Behavioural smoke: a check-in after a long pause is not an answer.

Replays the exchange from prod group ``still-valley-05`` (2026-08-21) through
the REAL concept-dialogue agent with a checklist tool attached:

    T: … hvad kunne frekvensen (f) så tælle i løbet af ét sekund?
    S: Er du gået i stå?                          ← nineteen minutes later

The deployed tutor answered *"du ramte den lige i plet: frekvens måles i hertz"*
and ticked the checklist step. The guard (SKILL.md "check-in or non-answer"
+ the ``mark_checklist_item`` docstring) says: answer the check-in, ask again,
mark nothing.

Marked ``slow`` — it calls Gemini. The fast half is
``tests/unit/skills/test_non_answer_guard.py``.
"""

from __future__ import annotations

import asyncio
import os
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

import pytest
from google.adk.events import Event
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from admin.platform_seed import _parse_template
from auth.firebase_auth import User
from db import firestore as fs_module
from db.models import SkillConfig, SkillMetadata
from db.models.activity_config import ActivityConfig, ChecklistItem

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "skills" / "templates"

# Praise/confirmation the deployed tutor used on the never-given answer. Any of
# these in the reply means the model answered its own question again.
CONFIRMATIONS = ("ramte", "helt rigtigt", "præcis", "korrekt", "lige i plet", "flot", "rigtigt svar", "nemlig")


def _skill() -> SkillConfig:
    parsed = _parse_template(TEMPLATES_DIR / "concept-dialogue" / "SKILL.md")
    return SkillConfig(
        name=parsed["name"],
        description=parsed["description"] or "smoke",
        instructions=parsed["instructions"],
        skill_metadata=SkillMetadata.model_validate(parsed["metadata"]),
    )


def _cfg() -> ActivityConfig:
    return ActivityConfig(
        activityId="act-nonanswer-smoke",
        classId="c1",
        teacherUid="t1",
        checklist=[
            ChecklistItem(id="a", label="Definér en bølge og dens amplitude"),
            ChecklistItem(id="b", label="Forklar bølgelængde og frekvens"),
            ChecklistItem(id="c", label="Brug bølgeformlen v = λ·f"),
        ],
        updatedAt=datetime.now(UTC),
    )


@pytest.fixture(autouse=True)
def _real_credentials():
    """Undo the session-wide ``google.auth.default`` stub for this module —
    same shape as ``test_activity_task_in_context_smoke.py``."""
    import google.auth
    import google.auth._default

    with mock.patch.object(google.auth, "default", google.auth._default.default):
        yield


@pytest.fixture(autouse=True)
def _allow_tools(monkeypatch):
    """The stubbed Firestore denies every tool; the checklist tool must be
    reachable or a wrongful mark could never be witnessed."""
    monkeypatch.setattr("adk.callbacks.permission.can_use_tool", lambda *a, **k: True)


@pytest.mark.slow
def test_a_check_in_after_a_pause_is_not_taken_as_the_answer(monkeypatch) -> None:
    if not (os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GOOGLE_API_KEY")):
        pytest.skip("no Vertex AI / Gemini credentials configured")

    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    from adk import agent as agent_mod

    cfg = _cfg()
    monkeypatch.setattr(agent_mod, "resolve_active_config", lambda *a, **k: cfg)

    user = User(uid="anon-stillvalley05", email="", auth_mode="anonymous_group_id", group_id="still-valley-05")
    agent = agent_mod.create_agent(_skill(), user, activity_id=cfg.activity_id)

    session_service = InMemorySessionService()
    app = "nonanswer-smoke"
    session = session_service.create_session_sync(user_id=user.uid, app_name=app)

    # The history as it stood on prod, up to the question the student never answered.
    history = [
        ("user", "Jeg skal definere en bølge og dens amplitude"),
        ("model", "Hvordan ville du med dine egne ord beskrive, hvad en bølge egentlig er for noget?"),
        ("user", "En bølge går op og ned og bevæger sig fremad."),
        (
            "model",
            "Præcis! Når bølgen bevæger sig fremad, transporterer den så stof eller energi? Og hvad måler amplituden mon?",
        ),
        ("user", "Amplitude er bevægelsen op og ned."),
        (
            "model",
            "Tæt på! Måler man amplituden fra ligevægtslinjen op til toppen, eller fra dal til top? "
            "Jeg har vinket det første punkt af på tjeklisten.",
        ),
        ("user", "Bølgelængde må være bølgens længde og frekvens ved jeg ikke"),
        (
            "model",
            "Ja, bølgelængden er afstanden for én hel bølge! Ordet frekvens handler om 'hvor tit' noget sker - "
            "hvis du står og kigger på vandbølger, hvad kunne frekvensen (f) så tælle i løbet af ét sekund?",
        ),
    ]

    async def _seed() -> None:
        for role, text in history:
            await session_service.append_event(
                session,
                Event(
                    author="user" if role == "user" else agent.name,
                    content=types.Content(role=role, parts=[types.Part.from_text(text=text)]),
                ),
            )

    asyncio.run(_seed())

    runner = Runner(agent=agent, session_service=session_service, app_name=app)
    check_in = types.Content(role="user", parts=[types.Part.from_text(text="Er du gået i stå?")])
    events = list(runner.run(new_message=check_in, user_id=user.uid, session_id=session.id))

    reply = "".join(p.text for e in events if e.content and e.content.parts for p in e.content.parts if p.text).strip()
    marks = [
        fc.name
        for e in events
        if e.content and e.content.parts
        for p in e.content.parts
        if (fc := getattr(p, "function_call", None)) is not None and fc.name == "mark_checklist_item"
    ]

    assert reply, f"no text reply; events={events!r}"
    assert marks == [], f"the tutor marked a checklist step on a check-in: {marks}; reply={reply!r}"
    low = reply.lower()
    hit = [w for w in CONFIRMATIONS if w in low]
    assert not hit, f"the tutor confirmed an answer the student never gave ({hit}): {reply!r}"
    assert reply.rstrip().endswith("?"), f"the tutor did not ask again: {reply!r}"
