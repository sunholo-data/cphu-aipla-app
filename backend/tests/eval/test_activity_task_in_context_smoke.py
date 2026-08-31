"""End-to-end LLM smoke for 1.1.87 — the tutor HAS the task, and it is the right one.

Marked ``@pytest.mark.slow``: it calls the model, so it is excluded from
``make test-fast`` / the CI inner loop and runs under ``make test`` or an explicit
``-m slow``. Same shape and same rationale as ``test_verbosity_smoke.py``.

**Why this exists alongside the evalset.** ``tests/eval/evalsets/activity_task_in_context.evalset.json``
is the ``adk eval`` artifact for the *deployed* path — it needs a real Activity in
Firestore with two cited papers, so it runs against dev after a seed, and it is the
form the manual "rebuild the teacher's activity" check takes. This file needs
nothing seeded: it constructs the two-paper activity in memory and can be run on a
laptop with ADC today. The evalset documents the cases; this one can be *run*.

What it asserts — the 21-August report, in two halves:

  1. **The tutor has the task.** One neutral opening turn, no mention of a file.
     The tutor must engage with the task and must not ask the student to paste or
     upload it. ("It still asked students to upload the assignment text.")
  2. **It is the RIGHT paper's Question 5.** Two papers are in context, each with a
     question numbered 5, and the two questions are about unmistakably different
     physics. Asked about one paper by name, the answer must carry that paper's
     subject and not the other's. ("One group experienced it talking about a
     completely different Question 5.")

The deterministic half — that the text reaches ``llm_request.contents`` at all — is
``tests/tool_tests/test_activity_document_callbacks.py`` and runs in CI. This file
is the behavioural confirmation that the model then uses it.

**Verified against the pre-1.1.87 baseline, 2026-08-31.** Citing the same two papers
the way the teacher actually cited them — ``kind="curriculum"`` — the tutor answered:

    "I'd love to help you with question 5, but I'm having a little trouble accessing
    the uploaded May 2019 exam paper right now. Could you type out or describe what
    question 5 asks so we can tackle it together?"

which is the teacher's report word for word. So these assertions bite on the change
that matters.

**What this file does NOT separate — read before trusting it as the injector's test.**
Disabling the injector alone still passes, because the LOADER has by then written the
task into a session artifact and ADK's ``load_artifacts_tool`` lets the model fetch
it. That is the unreliable path ``make_document_injector`` was written to stop
depending on — the model *decides* to call it, and per that docstring sometimes calls
it with empty ``artifact_names`` and then says no document was provided. So: the
loader makes the task REACHABLE and these tests prove that; the injector makes it
CERTAIN, and only the deterministic callback tests prove that. Do not read a green
run here as evidence the injector is wired.
"""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace
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
from db.models.activity_config import MaterialRef

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "skills" / "templates"

# Two papers, each with a Question 5, about physics that cannot be confused. The
# discriminators are deliberately concrete nouns rather than numbers: a model
# answering from the WRONG paper reaches for the wrong noun, and that is legible
# in an assertion in a way "did it get 0.55 or 0.54" is not.
_PAPER_MAY_2019 = """\
Physics A written examination, May 2019.

Question 4: State Newton's second law.

Question 5: A PENDULUM of length 1.20 m swings with small amplitude. Calculate its
period of oscillation, and explain why the period does not depend on the mass of
the bob.

Question 6: Define angular frequency.
"""

_PAPER_DEC_2020 = """\
Physics A written examination, December 2020.

Question 4: Define electric field strength.

Question 5: A RADIOACTIVE sample of iodine-131 has a half-life of 8.0 days.
Calculate the fraction of the original sample remaining after 24 days, and explain
what is meant by activity.

Question 6: State the unit of the becquerel.
"""

_DOCS = {
    "doc-may-2019": ("Physics A exam, May 2019", _PAPER_MAY_2019),
    "doc-dec-2020": ("Physics A exam, December 2020", _PAPER_DEC_2020),
}


def _build_skill_config_from_template(skill_name: str) -> SkillConfig:
    """Construct an in-memory SkillConfig from the SKILL.md template (no Firestore).

    Same helper as test_verbosity_smoke, same reason: the resolved instructions
    match what a deployed skill would carry, without depending on a seeded backend.
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


def _two_paper_activity() -> SimpleNamespace:
    """An ActivityConfig-shaped stub citing both papers as context materials.

    A stub rather than a real ActivityConfig because ``resolve_active_config`` is
    patched wholesale — the agent factory only reads ``materials``, ``teacher_uid``
    and ``activity_id`` off it, and building the real model would drag in the
    class/teacher tuple this test has no use for.
    """
    return SimpleNamespace(
        teacher_uid="smoke-teacher",
        activity_id="act-smoke-exam",
        materials=[
            MaterialRef(kind="context", docId=doc_id, origin="teacher upload", title=title)
            for doc_id, (title, _text) in _DOCS.items()
        ],
        # Fields other callbacks may read off a config; None/empty is the
        # "teacher set nothing" case and is what an activity with only materials
        # actually looks like.
        teacher_focus="",
        concept_map=None,
        checklist=[],
        elements=[],
        interaction_style="socratic",
        language="en",
    )


def _run_turn(user_text: str) -> str:
    """Run ONE turn against a tutor whose activity cites both papers in context."""
    skill = _build_skill_config_from_template("kinebot-kinematics-tutor")
    user = User(uid="task-context-smoke-user", email="", auth_mode="anonymous_group_id", group_id="smoke-test")
    agent = create_agent(skill, user)

    session_service = InMemorySessionService()
    session = session_service.create_session_sync(user_id=user.uid, app_name="task-context-smoke")
    # An artifact service is REQUIRED here, unlike the verbosity smoke: the whole
    # mechanism under test copies the task into a session artifact. In-memory
    # keeps the test off GCS while exercising the real save→load round trip.
    runner = Runner(
        agent=agent,
        session_service=session_service,
        artifact_service=InMemoryArtifactService(),
        app_name="task-context-smoke",
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
    """Undo the session-wide ``google.auth.default`` stub for THIS module.

    ``tests/conftest.py`` replaces ``google.auth.default`` for the whole session so
    that client construction succeeds without ADC — correct for the 3200 tests that
    must never touch the network, and fatal for the handful that must. Without this
    the model call dies inside the genai client with ``Mock object has no attribute
    'token'``, which reads like an SDK bug rather than a deliberate test stub.

    Restores the real resolver (function-scoped, so it layers over the session
    fixture) and leaves it restored only for the duration of each test here.
    """
    import google.auth
    import google.auth._default

    with mock.patch.object(google.auth, "default", google.auth._default.default):
        yield


@pytest.fixture(autouse=True)
def _allow_tools(monkeypatch):
    """Allow tool calls, which the stubbed Firestore otherwise denies.

    ``can_use_tool`` resolves an anonymous-group student (empty email) through the
    ``tool_permissions/*`` wildcard document, and ``tests/conftest.py`` stubs the
    Firestore client to return "not found" for everything — so every tool the tutor
    reaches for is denied with ``ToolPermissionDenied`` before the turn completes.
    That is a harness artefact, not the behaviour under test.
    """
    monkeypatch.setattr("adk.callbacks.permission.can_use_tool", lambda *a, **k: True)


@pytest.fixture
def two_paper_activity(monkeypatch):
    """Patch the activity resolution + the stored parsed text, so no Firestore.

    ``resolve_active_config`` is patched in ``adk.agent``'s namespace (it is
    imported there by name). ``get_curriculum_content`` is patched at its source
    module because the loader imports it inside the function body.
    """
    monkeypatch.setattr("adk.agent.resolve_active_config", lambda *a, **k: _two_paper_activity())

    def _content(doc_id: str):
        entry = _DOCS.get(doc_id)
        return {"text": entry[1], "chars": len(entry[1])} if entry else None

    monkeypatch.setattr("db.curriculum.get_curriculum_content", _content)


def _require_credentials() -> None:
    if not (os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GOOGLE_API_KEY")):
        pytest.skip("no Vertex AI / Gemini credentials configured (set GOOGLE_CLOUD_PROJECT or GOOGLE_API_KEY)")


@pytest.mark.slow
def test_tutor_has_the_task_without_being_asked(two_paper_activity) -> None:
    """Half one: 'It still asked students to upload the assignment text.'

    A neutral opener that never mentions a file. The tutor must show it has the
    task — by naming something only the papers contain — and must not ask for it.
    """
    _require_credentials()
    response = _run_turn("Hi, I've started on the assignment. What is it about?")
    assert response, "agent produced no text response"

    low = response.lower()
    knows_the_task = any(w in low for w in ("pendulum", "radioactive", "iodine", "half-life", "oscillat"))
    assert knows_the_task, (
        "the tutor gave no sign it had the papers — it should be able to say what the "
        f"assignment covers without being told. Response was: {response!r}"
    )

    asks_for_upload = any(
        p in low for p in ("paste", "upload", "copy the text", "send me the", "share the assignment", "attach")
    )
    assert not asks_for_upload, (
        "the tutor asked the student to hand over a task it was already given — the "
        f"reported failure. Response was: {response!r}"
    )


@pytest.mark.slow
def test_answers_from_the_named_paper_not_the_other(two_paper_activity) -> None:
    """Half two, the load-bearing one: 'a completely different Question 5'.

    Two Question 5s are in context. Named the May 2019 paper, the tutor must be on
    the pendulum and not on the iodine sample. Getting this wrong is worse than a
    refusal, because the student cannot tell.
    """
    _require_credentials()
    response = _run_turn("Can you help me with question 5 in the May 2019 paper?")
    assert response, "agent produced no text response"

    low = response.lower()
    assert "pendulum" in low or "oscillat" in low or "period" in low, (
        f"the tutor did not engage with the May 2019 paper's Question 5 (a pendulum). Response was: {response!r}"
    )
    assert not any(w in low for w in ("iodine", "radioactive", "half-life", "becquerel")), (
        "the tutor answered from the OTHER paper's Question 5 — this is the exact "
        f"reported defect. Response was: {response!r}"
    )
