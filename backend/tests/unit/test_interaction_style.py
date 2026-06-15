"""Unit tests for adk.interaction_style — interaction-style preamble injection (1.1.20).

Uses the same LOCAL_MODE Firestore-stub pattern as test_teacher_focus.py so
the real resolution path (resolve_active_config -> get_activity_config) is
exercised, not a mock.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

import adk.interaction_style as mod
from adk.interaction_style import inject_interaction_style_preamble
from adk.teacher_focus import LOCAL_MODE_DEMO_CLASS_ID
from db import firestore as fs_module
from db.activity_configs import upsert_activity_config
from db.local_fixture import WORKSHOP_USER_UID
from db.models.activity_config import ActivityConfig

BASE = "You are a tutor.\n\n## Response length\nEvery response must end with a question."
ACTIVITY = "concept-x"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _seed(style: str, activity_id: str = ACTIVITY) -> None:
    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id=activity_id,
        teaching_goal="g",
        interaction_style=style,  # type: ignore[arg-type]
    )


# --- the field itself --------------------------------------------------------


def test_interaction_style_defaults_to_socratic():
    cfg = ActivityConfig(
        activityId="a",
        classId="c",
        teacherUid="t",
        teachingGoal="g",
        updatedAt=datetime(2026, 6, 10, tzinfo=UTC),
    )
    assert cfg.interaction_style == "socratic"


def test_interaction_style_camelcase_alias_round_trip():
    cfg = ActivityConfig(
        activityId="a",
        classId="c",
        teacherUid="t",
        teachingGoal="g",
        interactionStyle="rigorous",
        updatedAt=datetime(2026, 6, 10, tzinfo=UTC),
    )
    dumped = cfg.model_dump(by_alias=True, mode="json")
    assert dumped["interactionStyle"] == "rigorous"


# --- injection ---------------------------------------------------------------


def test_socratic_is_passthrough():
    _seed("socratic")
    assert inject_interaction_style_preamble(BASE, ACTIVITY) == BASE


def test_unconfigured_activity_is_passthrough():
    # nothing seeded for this id
    assert inject_interaction_style_preamble(BASE, "no-such-activity") == BASE


def test_concise_appends_a_no_question_override():
    _seed("concise")
    out = inject_interaction_style_preamble(BASE, ACTIVITY)
    assert out.startswith(BASE)  # base preserved, override appended
    assert len(out) > len(BASE)
    assert "interaction style: concise" in out.lower()
    assert "follow-up question" in out.lower()  # the no-question override


def test_rigorous_appends_exam_level_override():
    _seed("rigorous")
    out = inject_interaction_style_preamble(BASE, ACTIVITY)
    assert out.startswith(BASE)
    assert "exam" in out.lower()


def test_warm_appends_encouraging_override():
    _seed("warm")
    out = inject_interaction_style_preamble(BASE, ACTIVITY)
    assert out.startswith(BASE)
    assert "interaction style: warm" in out.lower()


def test_missing_preamble_file_falls_back_to_passthrough(monkeypatch):
    _seed("concise")
    monkeypatch.setattr(mod, "_load_preamble", lambda _style: "")
    assert inject_interaction_style_preamble(BASE, ACTIVITY) == BASE


# --- list_interaction_styles: teacher-facing transparency (1.1.32) ---


def test_list_interaction_styles_returns_all_four_with_injected_flags():
    from adk.interaction_style import list_interaction_styles

    styles = {s["id"]: s for s in list_interaction_styles()}
    assert set(styles) == {"socratic", "concise", "rigorous", "warm"}
    # socratic is the baked-in default (not appended); the rest are overrides.
    assert styles["socratic"]["injected"] is False
    assert styles["concise"]["injected"] is True
    assert styles["rigorous"]["injected"] is True
    assert styles["warm"]["injected"] is True


def test_list_interaction_styles_strips_internal_html_comments():
    from adk.interaction_style import list_interaction_styles

    for s in list_interaction_styles():
        # AR-TODOs + the socratic canonical-source banner are HTML comments —
        # never surfaced to teachers.
        assert "<!--" not in s["prompt"]
        assert s["prompt"].strip() != ""


def test_list_interaction_styles_prompt_text_matches_the_style():
    from adk.interaction_style import list_interaction_styles

    styles = {s["id"]: s for s in list_interaction_styles()}
    assert "concise" in styles["concise"]["prompt"].lower()
    assert "exam" in styles["rigorous"]["prompt"].lower()
