"""Unit tests for adk.teacher_focus — {teacher_focus} substitution."""

from __future__ import annotations

import pytest

from adk.teacher_focus import LOCAL_MODE_DEMO_CLASS_ID, inject_teacher_focus
from db import firestore as fs_module
from db.activity_configs import upsert_activity_config
from db.local_fixture import WORKSHOP_USER_UID


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def test_no_placeholder_is_a_noop():
    base = "You are a Socratic tutor."
    assert inject_teacher_focus(base, "boldkast") == base


def test_missing_config_substitutes_empty_string():
    base = "Base prompt.\nTEACHER FOCUS:\n{teacher_focus}\nEnd."
    out = inject_teacher_focus(base, "boldkast")
    assert "{teacher_focus}" not in out
    assert "TEACHER FOCUS:\n\nEnd." in out


def test_present_config_substitutes_teaching_goal():
    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id="boldkast",
        teaching_goal="Independence of vx and vy; 45 deg gives the longest range.",
    )

    base = "Base prompt.\nTEACHER FOCUS:\n{teacher_focus}\nEnd."
    out = inject_teacher_focus(base, "boldkast")
    assert "Independence of vx and vy" in out
    assert "{teacher_focus}" not in out


def test_config_for_other_activity_does_not_leak():
    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id="led-planck",
        teaching_goal="Estimate Planck constant from threshold voltages.",
    )

    base = "{teacher_focus}"
    # Asking for boldkast — should be empty, not the led-planck goal.
    out = inject_teacher_focus(base, "boldkast")
    assert out == ""
