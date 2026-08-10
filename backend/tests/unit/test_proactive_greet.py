"""Unit tests for adk.proactive_greet — OPENING GUIDANCE injection."""

from __future__ import annotations

import pytest

from adk.proactive_greet import inject_opening_guidance

BASE = "You are a friendly Socratic tutor for projectile motion."


def test_proactive_greet_false_is_a_noop():
    assert inject_opening_guidance(BASE, proactive_greet=False, opening_template="anything") == BASE


def test_empty_opening_template_is_a_noop():
    assert inject_opening_guidance(BASE, proactive_greet=True, opening_template=None) == BASE
    assert inject_opening_guidance(BASE, proactive_greet=True, opening_template="   ") == BASE


def test_appends_opening_block_when_both_set():
    opening = "Hej! Greet the student and ask them what angle they think gives the longest range."
    out = inject_opening_guidance(BASE, proactive_greet=True, opening_template=opening)
    assert out != BASE
    assert BASE in out
    assert opening in out
    assert "OPENING GUIDANCE" in out
    assert "subsequent turns" in out.lower()


def test_appends_after_existing_instructions_without_doubling_newlines():
    out = inject_opening_guidance(
        BASE,
        proactive_greet=True,
        opening_template="A short opening.",
    )
    assert out.count("\n\n\n") == 0
    assert out.index(BASE) < out.index("OPENING GUIDANCE")


def test_opening_template_with_leading_trailing_whitespace_is_trimmed():
    out = inject_opening_guidance(
        BASE,
        proactive_greet=True,
        opening_template="   \n\n  Greet warmly.  \n  ",
    )
    assert "Greet warmly." in out
    assert "\n   Greet" not in out


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


# ---------------------------------------------------------------------------
# The opening knows the lesson (1.1.72 / PILOT-1 M5)
#
# Aswin, 2026-08-10: *"Jonas always starts with 'Hvilket emne eller fysikbegreb
# har du lyst til, at vi skal undersøge sammen i dag?' even though the lesson
# is about wave. After students start to chat, then he tells students that the
# lesson is about wave."*
#
# The tutor knew one turn later — {teacher_focus} carries the goal. The greet
# turn is the only one generated with no conversational context, and it was
# composed without the activity.
# ---------------------------------------------------------------------------

from datetime import UTC, datetime  # noqa: E402

from db.models.activity_config import ActivityConfig, ChecklistItem, NoteElement  # noqa: E402


def _activity(**kwargs) -> ActivityConfig:
    base = {
        "activityId": "act-boelger",
        "classId": "c",
        "teacherUid": "t",
        "updatedAt": datetime.now(UTC),
    }
    base.update(kwargs)
    return ActivityConfig(**base)


def _open(cfg=None, template: str = "Greet the student warmly."):
    return inject_opening_guidance("BODY", proactive_greet=True, opening_template=template, cfg=cfg)


def test_the_opening_names_the_lesson():
    """**Aswin's exact case.**"""
    out = _open(_activity(title="Stående bølger på en snor", teachingGoal="Find bølgelængden og beregn frekvensen."))
    assert "Stående bølger på en snor" in out
    assert "Find bølgelængden" in out


def test_it_forbids_asking_the_student_to_choose_a_topic():
    """The reported first sentence, verbatim, was a topic question. Naming the
    lesson is necessary but not sufficient — a template that says 'ask what
    they want to explore' would still win without this."""
    out = _open(_activity(title="Bølger", teachingGoal="Bølgelængde"))
    assert "Do NOT ask the student to choose a topic" in out


def test_it_points_at_the_first_workbench_element():
    out = _open(_activity(title="Bølger", checklist=[ChecklistItem(id="a", label="Mål bølgelængden")]))
    assert "First thing on the workbench" in out
    assert "Mål bølgelængden" in out


def test_it_points_at_a_non_checklist_element_by_title():
    out = _open(_activity(title="Bølger", note=[NoteElement(id="n", title="Sådan måler du", body="…")]))
    assert 'the note "Sådan måler du"' in out


def test_a_title_only_activity_still_names_itself():
    """Degradation table: config present, teaching_goal empty -> name the title."""
    out = _open(_activity(title="Stående bølger"))
    assert "Stående bølger" in out


def test_no_activity_composes_byte_identically_to_before():
    """The majority of callers: chat-only and unconfigured skills."""
    before = inject_opening_guidance("BODY", proactive_greet=True, opening_template="Greet the student warmly.")
    assert _open(None) == before
    assert "Today's activity" not in before


def test_an_empty_activity_composes_byte_identically_to_before():
    """A saved config with no title, no goal and no elements has nothing to
    say — it must not emit an empty scaffold."""
    assert _open(_activity()) == _open(None)


def test_proactive_greet_off_is_still_a_noop():
    out = inject_opening_guidance(
        "BODY", proactive_greet=False, opening_template="Greet.", cfg=_activity(title="Bølger")
    )
    assert out == "BODY"


def test_an_empty_template_is_still_a_noop():
    """The activity block rides the opening template; with no template there is
    no opening turn to shape."""
    out = inject_opening_guidance("BODY", proactive_greet=True, opening_template="  ", cfg=_activity(title="Bølger"))
    assert out == "BODY"


def test_the_activity_block_is_bounded():
    from adk.proactive_greet import OPENING_ACTIVITY_CAP, _activity_facts

    facts = _activity_facts(_activity(title="T" * 200, teachingGoal="G" * 2000))
    assert len(facts) < OPENING_ACTIVITY_CAP + len("Today's activity is not open-ended") + 400
    assert "…" in facts  # the goal was clipped, not dropped


def test_it_does_not_restate_the_whole_teaching_goal():
    """The tutor already receives the full goal through {teacher_focus};
    restating it spends the same budget twice."""
    from adk.proactive_greet import _activity_facts

    goal = "G" * 2000
    assert goal not in _activity_facts(_activity(title="Bølger", teachingGoal=goal))


def test_the_language_directive_precedes_the_opening():
    """The greet turn has no student message to infer language from, so it is
    the most likely place for an English activity to fall back to Danish.

    Nothing in the opening block states a language — that would duplicate, and
    could contradict, the 1.1.63 M2 directive. This asserts the composition
    order that makes the single directive sufficient: it is substituted into
    the SKILL.md body, which sits BEFORE the appended opening block.
    """
    from adk.teacher_focus import compose_teacher_focus

    cfg = _activity(title="Standing waves", language="en", teachingGoal="Find the wavelength.")
    body = f"BODY {compose_teacher_focus(cfg)}"
    composed = inject_opening_guidance(body, proactive_greet=True, opening_template="Greet.", cfg=cfg)

    assert composed.index("Speak English with the student") < composed.index("Today's activity is not open-ended")
