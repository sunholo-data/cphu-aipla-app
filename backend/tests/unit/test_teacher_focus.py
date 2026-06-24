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


# --- Phase 3: real (teacher, class) resolution from the student's group tag ---


def test_group_tag_resolves_to_class_owners_config():
    """A bound student carries group_tags={class:<owner>:<class_id>}; the goal
    must resolve from the REAL (owner, class) tuple, not the workshop stub."""
    upsert_activity_config(
        teacher_uid="teacher-9",
        class_id="cls-7b",
        activity_id="0078a171-concept",
        teaching_goal="Discover energy conservation Socratically.",
    )
    base = "{teacher_focus}"
    out = inject_teacher_focus(base, "0078a171-concept", group_tags=frozenset({"class:teacher-9:cls-7b"}))
    assert "Discover energy conservation" in out


def test_group_tag_takes_precedence_over_workshop_stub():
    # Workshop stub has a different goal for the same activity id.
    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id="act-x",
        teaching_goal="WORKSHOP STUB GOAL",
    )
    upsert_activity_config(
        teacher_uid="teacher-real",
        class_id="cls-real",
        activity_id="act-x",
        teaching_goal="REAL CLASS GOAL",
    )
    out = inject_teacher_focus("{teacher_focus}", "act-x", group_tags=frozenset({"class:teacher-real:cls-real"}))
    assert out == "REAL CLASS GOAL"


def test_unbound_group_falls_back_to_stub():
    """No class tag (pre-1.A unbound group) → fall back to the workshop stub."""
    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id="act-y",
        teaching_goal="STUB GOAL",
    )
    out = inject_teacher_focus("{teacher_focus}", "act-y", group_tags=frozenset())
    assert out == "STUB GOAL"


def test_group_tag_isolation_across_classes():
    upsert_activity_config(
        teacher_uid="t-a",
        class_id="cls-a",
        activity_id="act-z",
        teaching_goal="CLASS A GOAL",
    )
    # Student bound to class B asks for the same activity → no config for B → empty.
    out = inject_teacher_focus("{teacher_focus}", "act-z", group_tags=frozenset({"class:t-b:cls-b"}))
    assert out == ""


# --- ALS-1 M0 dual-read: minted act- ids resolve via the new Activity store ---


def test_minted_activity_resolves_from_new_store():
    """An ``act-…`` id resolves the class-independent Activity; class_id comes
    from the student's verified group tag."""
    from db.activities import create_activity
    from db.models.activity import Activity

    a = create_activity(
        Activity(activityId="act-real-1", ownerUid="teacher-9", teachingGoal="Energy conservation via Activity store.")
    )
    out = inject_teacher_focus("{teacher_focus}", a.activity_id, group_tags=frozenset({"class:teacher-9:cls-7b"}))
    assert "Energy conservation via Activity store" in out


def test_two_activities_one_class_resolve_to_distinct_goals():
    """The bug fix at the resolution layer: two distinct activities in one class
    no longer collide — each resolves to its OWN goal."""
    from db.activities import create_activity
    from db.models.activity import Activity

    create_activity(Activity(activityId="act-aaa", ownerUid="t", teachingGoal="GOAL A"))
    create_activity(Activity(activityId="act-bbb", ownerUid="t", teachingGoal="GOAL B"))
    tags = frozenset({"class:t:cls-1"})
    assert inject_teacher_focus("{teacher_focus}", "act-aaa", group_tags=tags) == "GOAL A"
    assert inject_teacher_focus("{teacher_focus}", "act-bbb", group_tags=tags) == "GOAL B"


def test_missing_new_store_activity_falls_back_to_legacy():
    """An ``act-*`` id absent from the new store falls THROUGH to the legacy
    composite lookup (dual-read), so pre-cutover rows keep resolving."""
    upsert_activity_config(
        teacher_uid="t-legacy",
        class_id="cls-legacy",
        activity_id="act-legacyonly",
        teaching_goal="LEGACY COMPOSITE GOAL",
    )
    out = inject_teacher_focus("{teacher_focus}", "act-legacyonly", group_tags=frozenset({"class:t-legacy:cls-legacy"}))
    assert out == "LEGACY COMPOSITE GOAL"


# --- artefact tutor-block composition (1.1.41 M2) ---


def test_artefact_tutor_block_is_composed_with_the_goal():
    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id="sim-act",
        teaching_goal="Find the angle for the longest range.",
        artefact_id="boldkast",
    )
    out = inject_teacher_focus("Focus:\n{teacher_focus}", "sim-act")
    # The boldkast tutorBlock (placeholder) AND the goal are both present...
    assert "simulation" in out.lower()  # from the artefact tutorBlock
    assert "longest range" in out
    # ...with the artefact block FIRST (sim context, then the lesson goal).
    assert out.lower().index("simulation") < out.index("longest range")


def test_same_artefact_different_goals_compose_differently():
    for act, goal in [("a1", "Goal about energy."), ("a2", "Goal about momentum.")]:
        upsert_activity_config(
            teacher_uid=WORKSHOP_USER_UID,
            class_id=LOCAL_MODE_DEMO_CLASS_ID,
            activity_id=act,
            teaching_goal=goal,
            artefact_id="boldkast",
        )
    out1 = inject_teacher_focus("{teacher_focus}", "a1")
    out2 = inject_teacher_focus("{teacher_focus}", "a2")
    # The SAME sim, different per-activity goals — the unlock.
    assert "energy" in out1 and "momentum" not in out1
    assert "momentum" in out2 and "energy" not in out2
    # ...both still carry the shared artefact block (the sim mechanics).
    assert "simulation" in out1.lower() and "simulation" in out2.lower()


def test_unknown_artefact_falls_back_to_goal_only():
    upsert_activity_config(
        teacher_uid=WORKSHOP_USER_UID,
        class_id=LOCAL_MODE_DEMO_CLASS_ID,
        activity_id="bad-sim",
        teaching_goal="Just the goal.",
        artefact_id="does-not-exist",
    )
    assert inject_teacher_focus("{teacher_focus}", "bad-sim") == "Just the goal."


# --- solution feedback prompt injection (1.1.45 M4, JB-2) ---


def test_solution_element_injects_feedback_prompt_and_task() -> None:
    from datetime import UTC, datetime

    from adk.teacher_focus import SOLUTION_FEEDBACK_PROMPT, compose_teacher_focus
    from db.models.activity_config import ActivityConfig, SolutionElement

    cfg = ActivityConfig(
        activityId="a",
        classId="c",
        teacherUid="t",
        teachingGoal="Understand projectile motion",
        solution=[SolutionElement(id="sol-1", prompt="Find the range")],
        updatedAt=datetime.now(UTC),
    )
    focus = compose_teacher_focus(cfg)
    assert SOLUTION_FEEDBACK_PROMPT in focus
    assert "Find the range" in focus
    assert "Understand projectile motion" in focus


def test_no_solution_element_omits_the_feedback_prompt() -> None:
    from datetime import UTC, datetime

    from adk.teacher_focus import SOLUTION_FEEDBACK_PROMPT, compose_teacher_focus
    from db.models.activity_config import ActivityConfig

    cfg = ActivityConfig(
        activityId="a",
        classId="c",
        teacherUid="t",
        teachingGoal="Just a goal",
        updatedAt=datetime.now(UTC),
    )
    focus = compose_teacher_focus(cfg)
    assert SOLUTION_FEEDBACK_PROMPT not in focus
    assert focus == "Just a goal"
