"""Unit tests for the persona catalogue (1.1.12)."""

from __future__ import annotations

from datetime import UTC, datetime

from db.models.activity_config import ActivityConfig
from db.models.persona import Persona
from personas.loader import load_persona, load_personas

EXPECTED_IDS = {"astrid", "frida", "henrik", "jonas", "mikkel", "sofie"}
VALID_STYLES = {"socratic", "concise", "rigorous", "warm"}


def test_load_personas_returns_the_danish_educator_catalogue():
    personas = load_personas()
    assert {p.id for p in personas} == EXPECTED_IDS
    assert all(isinstance(p, Persona) for p in personas)


def test_each_persona_ties_a_valid_style_and_has_a_name():
    for p in load_personas():
        assert p.interaction_style in VALID_STYLES
        assert p.name
        assert p.language == "da"


def test_each_persona_has_a_wired_avatar_path():
    for p in load_personas():
        assert p.avatar == f"/personas/{p.id}.png"


def test_frida_ties_warm_style_and_a_voice():
    frida = load_persona("frida")
    assert frida is not None
    assert frida.interaction_style == "warm"
    assert frida.voice is not None
    assert frida.voice.tts_voice == "da-DK-Wavenet-D"


def test_load_persona_unknown_is_none():
    assert load_persona("nobody") is None


def test_persona_serializes_with_camelcase_alias():
    astrid = load_persona("astrid")
    assert astrid is not None
    dumped = astrid.model_dump(by_alias=True, mode="json")
    assert dumped["interactionStyle"] == "rigorous"
    assert dumped["id"] == "astrid"


def test_activity_config_persona_field_defaults_none_and_round_trips():
    cfg = ActivityConfig(
        activityId="a",
        classId="c",
        teacherUid="t",
        teachingGoal="g",
        updatedAt=datetime(2026, 6, 10, tzinfo=UTC),
    )
    assert cfg.persona is None

    cfg2 = ActivityConfig(
        activityId="a",
        classId="c",
        teacherUid="t",
        teachingGoal="g",
        persona="frida",
        updatedAt=datetime(2026, 6, 10, tzinfo=UTC),
    )
    assert cfg2.persona == "frida"
    assert cfg2.model_dump(by_alias=True)["persona"] == "frida"
