"""The prompt contract PREPILOT-1 ships (1.1.62 / 1.1.63 / 1.1.64).

**Why this file exists separately from the evalset.** The sprint's acceptance
criteria are behavioural — "the tutor's opening turn names the table". Verifying
that needs a live model, so it lives in
``tests/eval/evalsets/prepilot_tutor_awareness.evalset.json`` and runs under
``make eval`` with GCP credentials. It does NOT run in CI.

Which would leave the whole sprint ungated on every ordinary push. So this
module pins the deterministic half: whether the right instructions reach the
prompt **at all**. A model can decline to follow an instruction it was given;
it cannot follow one that was never composed — and "never composed" is exactly
the failure that hid element blindness for six weeks while every individual
surface passed its own tests.

Read it as: the evalset asks *did the tutor behave?*; this asks *was it told?*
"""

from __future__ import annotations

from datetime import UTC, datetime

from adk.curriculum_retrieval import build_curriculum_grounding_preamble
from adk.teacher_focus import build_ilo_precedence_block, compose_teacher_focus
from db.models.activity_config import (
    ActivityConfig,
    ChartElement,
    ChecklistItem,
    MaterialRef,
    TableColumn,
    TableElement,
)


def _full_activity(**overrides) -> ActivityConfig:
    """An activity shaped like the one Aswin actually built: a data table, a
    chart, a checklist (his ILOs), and cited curriculum."""
    base: dict = {
        "activityId": "act-fald",
        "classId": "c1",
        "teacherUid": "t1",
        "teachingGoal": "Undersøg sammenhængen mellem faldhøjde og faldtid.",
        "checklist": [
            ChecklistItem(id="a", label="Mål faldtiden tre gange"),
            ChecklistItem(id="b", label="Beregn gennemsnittet"),
        ],
        "table": [
            TableElement(
                id="t1",
                title="Faldforsøg",
                columns=[
                    TableColumn(id="h", label="højde", unit="m", kind="number"),
                    TableColumn(id="t", label="tid", unit="s", kind="number"),
                ],
                rows=5,
            )
        ],
        "chart": [ChartElement(id="c1", title="Højde mod tid", chartKind="scatter")],
        "materials": [MaterialRef(docId="d1", origin="mathematicus.dk", title="Kastebevægelse — noter")],
        "updatedAt": datetime.now(UTC),
    }
    base.update(overrides)
    return ActivityConfig(**base)


def _composed(cfg: ActivityConfig) -> str:
    """The instruction as ``adk/agent.py`` assembles it, in order."""
    return (
        "SKILL BODY\n"
        + compose_teacher_focus(cfg)
        + build_curriculum_grounding_preamble(cfg.materials)
        + build_ilo_precedence_block(cfg)
    )


# --- 1.1.62: the tutor is told what is on the workbench ---------------------


def test_the_tutor_is_told_the_table_exists():
    """Aswin: "The chat never asked me to work on those tools."

    The only element→tutor path was an interaction-triggered push, so before
    the student touched anything the tutor had no evidence the table existed.
    """
    composed = _composed(_full_activity())
    assert "Faldforsøg" in composed
    assert "højde" in composed


def test_the_tutor_is_told_to_raise_the_tools_itself():
    """Naming the tools is not enough — the complaint was that the tutor never
    BROUGHT THEM UP. The behavioural instruction has to be there too."""
    composed = _composed(_full_activity()).lower()
    assert "invite" in composed or "bring" in composed


def test_the_checklist_reaches_the_prompt_as_the_teachers_outcomes():
    """ILOs are the workspace checklist (Aswin's own follow-up)."""
    composed = _composed(_full_activity())
    assert "Mål faldtiden tre gange" in composed


# --- 1.1.62 M3b: precedence over the curriculum -----------------------------


def test_the_ilos_get_the_last_word_over_the_curriculum():
    """The ordering IS the mechanism.

    ``{teacher_focus}`` substitutes inside the SKILL.md body, so the teacher's
    goals were already before the curriculum preamble — and the convention here
    is "later instruction wins". First is the weak position, which is why the
    curriculum held the last word and Aswin saw curriculum goals override his.
    """
    composed = _composed(_full_activity())
    # The checklist appears TWICE, deliberately: once described in the element
    # manifest (early, inside {teacher_focus}) and once restated in the
    # precedence block. `rindex` is the load-bearing one — it is the restatement
    # AFTER the curriculum preamble that actually carries the priority.
    assert composed.index("Kastebevægelse — noter") < composed.rindex("Mål faldtiden tre gange")


def test_the_checklist_is_stated_twice_on_purpose():
    """Once as "here is what's on the workbench", once as "here is what wins".

    If this collapses to one occurrence, check WHICH survived: only the late one
    carries precedence over the curriculum preamble.
    """
    composed = _composed(_full_activity())
    assert composed.count("Mål faldtiden tre gange") == 2


def test_grounding_is_not_weakened_by_the_precedence_block():
    """The curriculum stays the source of truth for the physics — it just stops
    being the source of objectives."""
    composed = _composed(_full_activity()).lower()
    assert "prefer these sources" in composed


# --- 1.1.63: register ------------------------------------------------------


def test_no_template_citation_phrasing_survives():
    """The complaint was our own instruction quoted back."""
    composed = _composed(_full_activity()).lower()
    assert "according to [source" not in composed
    assert "always attribute" not in composed
    assert "always cite" not in composed


def test_sources_are_named_by_title_not_only_domain():
    composed = _composed(_full_activity())
    assert "Kastebevægelse — noter" in composed
    assert composed.index("Kastebevægelse — noter") < composed.index("mathematicus.dk")


def test_an_english_activity_is_told_to_speak_english_and_still_read_danish():
    composed = _composed(_full_activity(language="en")).lower()
    assert "speak english" in composed
    assert "another language" in composed  # read it in whatever language it is written


def test_a_danish_activity_composes_as_before():
    """No-regression: the language directive fires only off the default, so
    every existing Danish activity's prompt is untouched."""
    composed = _composed(_full_activity(language="da")).lower()
    assert "speak danish" not in composed


# --- Budget ----------------------------------------------------------------


def test_the_whole_contract_fits_the_prompt_budget():
    """Everything above shares one budget, and the composed instruction rides
    EVERY turn. A contract that cannot fit is a contract that gets truncated."""
    composed = _composed(_full_activity(language="en"))
    assert len(composed) < 8000
