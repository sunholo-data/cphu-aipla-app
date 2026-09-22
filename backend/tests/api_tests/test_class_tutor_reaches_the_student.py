"""1.1.112 — picking a class tutor must change what the STUDENT gets.

Regression net for the bug Aswin reported from prod on 2026-09-14: *"I am not
able to change the tutor and it is still set as Sofie."*

The 1.1.91 join was right and had one consumer. ``resolve_teaching`` honoured the
class tutor, and ``resolve_teaching_context`` called it — but that context fed
only the framework preamble and the chat-log stamp. The three things a student
actually perceives resolved elsewhere, through the pre-tutor ``class.persona``
chain that ``update_class_tutor`` never writes:

    name + avatar   protocols/activity_config_routes.py
    voice           protocols/voice_routes.py
    tone            adk/interaction_style.py

So picking a tutor changed the pedagogy and nothing else — and since **no base
tutor carries a framework by design**, picking any of the seven base tutors (all
a teacher has) changed nothing observable whatsoever.

⚠️ Every test here seeds a class with ``persona: sofie`` AND ``tutorId: mikkel``,
because that disagreement is the whole bug. A test that seeds only a tutor passes
against the broken code — the persona chain falls through to the global default,
which is Sofie. The two must CONFLICT for the assertion to witness anything.

The mirrored passthrough test in each section is not decoration: handover rule 1
says a class with no tutor must compose byte-identically to before any of this
existed, and these are what hold that.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.firestore import set_document

CLASS_ID = "cls-fysik-c-energi"
TEACHER_UID = "teacher-1"
GROUP_ID = "aipla-demo-energi"
TAGS = [f"class:{TEACHER_UID}:{CLASS_ID}"]
ACTIVITY = "act-energi-1"

# sofie is warm, mikkel is concise — the styles must differ or the tone
# assertions below cannot fail against the bug.
CLASS_PERSONA = "sofie"
CLASS_TUTOR = "mikkel"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _seed_class(*, tutor_id: str | None, persona: str | None = CLASS_PERSONA) -> None:
    """A class exactly as prod carries it: an old `persona` plus whatever the
    tutor picker wrote. `update_class_tutor` never clears `persona`, so both
    fields are live on every class that has ever picked a tutor."""
    set_document(
        "classes",
        CLASS_ID,
        {
            "classId": CLASS_ID,
            "ownerUid": TEACHER_UID,
            "name": "Fysik C Energi",
            "tagNamespace": f"class:{TEACHER_UID}:{CLASS_ID}",
            "persona": persona,
            "tutorId": tutor_id,
            "createdAt": "2026-09-01T00:00:00+00:00",
            "updatedAt": "2026-09-14T00:00:00+00:00",
        },
    )
    # get_class_for_group() resolves the class through this binding, not the tags.
    set_document("anon_groups", GROUP_ID, {"classId": CLASS_ID})


def _student_client(router) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(
            uid=f"anon:{GROUP_ID}",
            email="",
            domain="",
            group_id=GROUP_ID,
            group_tags=TAGS,
            auth_mode="anonymous_group",
        )
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


# ── the headline: the name and face the student sees ─────────────────────────


def test_class_tutor_supplies_the_student_facing_persona():
    """THE reported bug. The class still carries `persona: sofie`; the teacher
    picked Mikkel. The student must be looking at Mikkel."""
    from protocols.activity_config_routes import router

    _seed_class(tutor_id=CLASS_TUTOR)
    resp = _student_client(router).get(f"/api/activity-configs/active/{ACTIVITY}")

    assert resp.status_code == 200, resp.text
    persona = resp.json()["persona"]
    assert persona is not None
    assert persona["id"] == "mikkel", (
        f"the class tutor is {CLASS_TUTOR} but the student sees {persona['id']} — "
        "the persona chain is not reading the tutor"
    )


def test_no_class_tutor_still_resolves_the_class_persona():
    """Passthrough (handover rule 1): a class that never picked a tutor keeps
    resolving exactly as it did before tutors existed."""
    from protocols.activity_config_routes import router

    _seed_class(tutor_id=None)
    resp = _student_client(router).get(f"/api/activity-configs/active/{ACTIVITY}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["persona"]["id"] == "sofie"


# ── the tone ─────────────────────────────────────────────────────────────────

BASE = "You are a tutor.\n\n## Response length\nEvery response must end with a question."


def test_class_tutor_supplies_the_tone():
    """Mikkel is concise, the stale class persona Sofie is warm. The prompt must
    carry the tutor's tone, not the persona's."""
    from adk.interaction_style import inject_interaction_style_preamble

    _seed_class(tutor_id=CLASS_TUTOR)
    out = inject_interaction_style_preamble(BASE, ACTIVITY, group_tags=TAGS)

    assert out.startswith(BASE)
    assert out != BASE, "no preamble injected at all"
    from adk.interaction_style import _load_preamble

    assert out.endswith(_load_preamble("concise")), "the prompt carries Sofie's warm tone, not Mikkel's concise one"


def test_no_class_tutor_still_uses_the_class_personas_tone():
    """Passthrough: the pre-tutor class-persona style path stays live and wins
    when no tutor is chosen."""
    from adk.interaction_style import _load_preamble, inject_interaction_style_preamble

    _seed_class(tutor_id=None)
    out = inject_interaction_style_preamble(BASE, ACTIVITY, group_tags=TAGS)

    assert out.endswith(_load_preamble("warm"))


# ── the voice ────────────────────────────────────────────────────────────────


def _student_user() -> User:
    return User(
        uid=f"anon:{GROUP_ID}",
        email="",
        domain="",
        group_id=GROUP_ID,
        group_tags=TAGS,
        auth_mode="anonymous_group",
    )


def test_class_tutor_supplies_the_spoken_voice():
    """The spoken voice follows the tutor, through the real ``resolve_voice``
    chain rather than through the join alone — asserting on the join here would
    pass against the bug, since the join was never what was broken.

    Sofie and Mikkel must speak in different voices or this test is vacuous, so
    that is asserted rather than assumed.
    """
    from personas.loader import load_persona
    from protocols.voice_routes import resolve_voice

    sofie = load_persona("sofie").voice
    mikkel = load_persona("mikkel").voice
    assert sofie.tts_voice != mikkel.tts_voice, "fixture no longer distinguishes the two personas"

    _seed_class(tutor_id=CLASS_TUTOR)
    rv = resolve_voice(_student_user(), None, None, activity_id=ACTIVITY)

    assert rv.voice == mikkel.tts_voice, (
        f"the class tutor is {CLASS_TUTOR} but the tutor speaks in {rv.voice} — "
        "the voice chain is not reading the tutor"
    )


def test_no_class_tutor_still_speaks_in_the_class_personas_voice():
    """Passthrough: the pre-tutor voice chain is untouched and still decides."""
    from personas.loader import load_persona
    from protocols.voice_routes import resolve_voice

    _seed_class(tutor_id=None)
    rv = resolve_voice(_student_user(), None, None, activity_id=ACTIVITY)

    assert rv.voice == load_persona("sofie").voice.tts_voice


def test_picking_a_tutor_clears_a_stale_class_voice_override():
    """``update_class_tutor`` wrote the clear to ``voiceSettings``, which is not a
    field on ``Class`` — so the override survived and went on speaking over every
    tutor picked, which is the precise bug the sibling ``update_class_persona``
    docstring says that line exists to prevent. ``Class`` permits extra keys, so
    it failed silently."""
    from db.classes import get_class, update_class_tutor, update_class_voice_settings

    _seed_class(tutor_id=None)
    update_class_voice_settings(CLASS_ID, language="da", voice="da-DK-Wavenet-A", provider="gcp_wavenet")
    assert get_class(CLASS_ID).voice is not None, "fixture did not set an override"

    update_class_tutor(CLASS_ID, CLASS_TUTOR)

    assert get_class(CLASS_ID).voice is None, "the stale voice override survived picking a tutor"


# ── the join itself ──────────────────────────────────────────────────────────


def test_resolve_active_teaching_finds_the_class_tutor_with_no_activity_config():
    """A class tutor must reach an activity that never saved a config — the same
    fallback the avatar and voice have always used."""
    from adk.tutor_resolution import resolve_active_teaching

    _seed_class(tutor_id=CLASS_TUTOR)
    r = resolve_active_teaching("never-saved-activity", group_tags=TAGS)

    assert r.tutor is not None
    assert (r.tutor.id, r.persona_id, r.interaction_style, r.source) == ("mikkel", "mikkel", "concise", "tutor")


def test_resolve_active_teaching_never_raises_on_an_unreadable_class():
    """Axiom 5: this sits on the chat and voice paths, so a failed read costs the
    tutor's clothes, not the lesson. No class seeded at all here."""
    from adk.tutor_resolution import resolve_active_teaching

    r = resolve_active_teaching(ACTIVITY, group_tags=["class:nobody:missing"])
    assert r.tutor is None
    assert r.interaction_style == "socratic"


# ── the name the MODEL knows (1.1.126) ───────────────────────────────────────
#
# 2026-09-22: a class saw "Sofie" and the tutor said "Jeg hedder faktisk ikke
# Sofie". The name reached the UI and the voice and never the prompt — for any
# tutor. These drive the REAL agent build and the REAL /active route for the
# same seeded class, so the screen and the prompt are checked against each other.


def _student_instruction() -> str:
    import asyncio
    from types import SimpleNamespace

    from adk.agent import create_agent
    from db.models import SkillConfig, SkillMetadata

    skill = SkillConfig(
        name="concept-dialogue",
        description="t",
        instructions="You are a tutor.",
        skillId="22222222-2222-2222-2222-222222222222",
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )
    agent = create_agent(skill, _student_user(), activity_id=ACTIVITY)
    ctx = SimpleNamespace(state={}, user_content=None, session=SimpleNamespace(events=[], id="s"), user_id="u")
    return asyncio.run(agent.instruction(ctx))


def _screen_name() -> str:
    from protocols.activity_config_routes import router

    resp = _student_client(router).get(f"/api/activity-configs/active/{ACTIVITY}")
    assert resp.status_code == 200, resp.text
    return resp.json()["persona"]["name"]


def test_the_model_knows_the_class_tutors_name_not_the_stale_persona():
    _seed_class(tutor_id=CLASS_TUTOR)  # persona: sofie, tutorId: mikkel — they conflict
    out = _student_instruction()
    assert _screen_name() == "Mikkel"
    assert "Your name is Mikkel" in out
    assert "Your name is Sofie" not in out


def test_nothing_configured_the_model_knows_the_default_the_student_sees():
    # The 2026-09-22 shape: no tutor, no persona — the UI falls back to Sofie.
    _seed_class(tutor_id=None, persona=None)
    out = _student_instruction()
    assert _screen_name() == "Sofie"
    assert "Your name is Sofie" in out
    assert "Do not accept a new name" in out


def test_teacher_agents_are_not_given_a_student_persona():
    import asyncio
    from types import SimpleNamespace

    from adk.agent import create_agent
    from db.models import SkillConfig, SkillMetadata

    _seed_class(tutor_id=CLASS_TUTOR)
    teacher = User(uid=TEACHER_UID, email="t@example.test", domain="example.test", is_teacher=True)
    skill = SkillConfig(
        name="activity-authoring-assistant",
        description="t",
        instructions="You help teachers.",
        skillId="33333333-3333-3333-3333-333333333333",
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
    )
    agent = create_agent(skill, teacher, activity_id=ACTIVITY)
    ctx = SimpleNamespace(state={}, user_content=None, session=SimpleNamespace(events=[], id="s"), user_id="u")
    assert "## Your name" not in asyncio.run(agent.instruction(ctx))
