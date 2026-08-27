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


def test_activity_to_config_carries_document_element() -> None:
    """1.1.48 regression: the ALS-1 Activity→ActivityConfig adapter must carry the
    ``document`` element through to the student session — dropping it meant a
    document-feedback activity created fine but rendered no upload surface."""
    from datetime import UTC, datetime

    from adk.teacher_focus import _activity_to_config
    from db.models.activity import Activity
    from db.models.activity_config import DocumentElement

    activity = Activity(
        activityId="act-1",
        skillId="concept",
        ownerUid="t",
        title="Doc activity",
        document=[DocumentElement(id="document-1", prompt="Upload din opgave")],
        updatedAt=datetime.now(UTC),
    )
    cfg = _activity_to_config(activity, class_id="c")
    assert [d.id for d in cfg.document] == ["document-1"]
    assert cfg.document[0].prompt == "Upload din opgave"


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


# ---------------------------------------------------------------------------
# 1.1.62 M1 — the element manifest is stacked into the focus
# 1.1.63 M2 — the activity language directive
#
# Both edit compose_teacher_focus and both care about ORDERING, which is why
# they are one milestone rather than two.
# ---------------------------------------------------------------------------


def _cfg(**kwargs):
    from datetime import UTC, datetime

    from db.models.activity_config import ActivityConfig

    base = {
        "activityId": "a",
        "classId": "c",
        "teacherUid": "t",
        "updatedAt": datetime.now(UTC),
    }
    base.update(kwargs)
    return ActivityConfig(**base)


def _sample_table():
    from db.models.activity_config import TableColumn, TableElement

    return TableElement(
        id="t1",
        title="Faldforsøg",
        columns=[
            TableColumn(id="h", label="højde", unit="m", kind="number"),
            TableColumn(id="t", label="tid", unit="s", kind="number"),
        ],
        rows=5,
    )


def test_authored_elements_reach_the_composed_focus() -> None:
    """The whole point of 1.1.62.

    Before this, a tutor in an activity with a data table had no evidence in its
    system prompt that the table existed.
    """
    from adk.teacher_focus import compose_teacher_focus

    focus = compose_teacher_focus(_cfg(table=[_sample_table()], teachingGoal="Measure g"))
    assert "Faldforsøg" in focus
    assert "Measure g" in focus


def test_language_directive_is_emitted_first() -> None:
    """Language frames everything after it, so it leads the composition."""
    from adk.teacher_focus import compose_teacher_focus

    focus = compose_teacher_focus(_cfg(language="en", table=[_sample_table()], teachingGoal="Measure g"))
    assert "English" in focus
    assert focus.index("English") < focus.index("Faldforsøg")
    assert focus.index("English") < focus.index("Measure g")


def test_language_directive_separates_reading_from_speaking() -> None:
    """The A-level curriculum is Danish and stays Danish.

    An English-language activity must still GROUND in it. Conflating "speak
    English" with "the material is English" would break grounding for every
    English activity — so the directive says so explicitly.
    """
    from adk.teacher_focus import compose_teacher_focus

    focus = compose_teacher_focus(_cfg(language="en")).lower()
    assert "another language" in focus or "whatever language" in focus


def test_default_language_emits_no_directive() -> None:
    """``Language`` is ``Literal["da", "en"]`` defaulting to ``"da"`` — it is
    never unset, so "emit whenever it is set" would change the prompt of EVERY
    existing activity eight days before the pilot.

    The directive is emitted only when the activity's language differs from the
    platform default, so a Danish activity composes byte-identically to before.
    Two existing tests assert ``focus == "<the goal>"`` exactly; that contract
    holds.

    Residual gap, accepted deliberately: a Danish activity whose student writes
    in English still gets an English tutor by inference, because nothing states
    Danish explicitly. Fixing that means emitting for both languages and
    re-baselining every activity's prompt — a post-pilot change, not a
    pre-pilot one.
    """
    from adk.teacher_focus import compose_teacher_focus

    assert compose_teacher_focus(_cfg(language="da", teachingGoal="Mål g")) == "Mål g"


def test_composed_focus_stays_under_the_skillconfig_instruction_cap() -> None:
    """**Write this test first.** (Sprint plan, M2 risk.)

    ``SkillConfig.instructions`` is validated at ``MAX_INSTRUCTIONS_CHARS``
    (db/models/__init__.py) — 10,000 when this test was written, 25,000 since
    2026-08-06. ``{teacher_focus}`` already stacked a sim
    tutor_block + solution prompt + concept map + goal; the element manifest is
    a FIFTH block. A maximal activity must not push the composed instruction
    past the cap — crossing it silently fails the seed re-read after a partial
    write, which is a deployment failure, not a test failure.
    """
    from adk.teacher_focus import compose_teacher_focus
    from db.models.activity_config import (
        CalcInput,
        CalculatorElement,
        ChartElement,
        ChecklistItem,
        ConceptEdge,
        ConceptMapElement,
        ConceptNode,
        DocumentElement,
        NoteElement,
        SolutionElement,
    )

    maximal = _cfg(
        language="en",
        artefactId="boldkast",
        teachingGoal="G" * 2000,  # the model's max_length for teaching_goal
        checklist=[ChecklistItem(id=f"i{n}", label="L" * 200) for n in range(50)],
        table=[_sample_table() for _ in range(5)],
        chart=[ChartElement(id=f"c{n}", title="T" * 120) for n in range(5)],
        calculator=[
            CalculatorElement(
                id=f"calc{n}",
                title="T" * 120,
                formula="a + b",
                inputs=[CalcInput(id="a", label="A" * 80), CalcInput(id="b", label="B" * 80)],
            )
            for n in range(5)
        ],
        note=[NoteElement(id=f"n{n}", title="T" * 120, body="B" * 4000) for n in range(5)],
        solution=[SolutionElement(id="s", prompt="P" * 2000)],
        document=[DocumentElement(id="d", prompt="P" * 2000)],
        conceptMap=[
            ConceptMapElement(
                id="cm",
                title="Map",
                nodes=[ConceptNode(id=f"n{n}", label="L" * 80) for n in range(30)],
                edges=[ConceptEdge(**{"from": f"n{n}", "to": f"n{n + 1}"}) for n in range(29)],
            )
        ],
    )

    focus = compose_teacher_focus(maximal)

    # The skill template itself needs room too — the focus is SUBSTITUTED INTO
    # instructions, it is not the whole of them. Leave a working margin.
    # 8,000 is _TOTAL_FOCUS_CAP, a deliberate bound on how much ONE activity's
    # focus may contribute — not a derivative of the instructions cap, so it did
    # not move when that went 10,000 -> 25,000 on 2026-08-06. Kept: a single
    # activity composing 8,000+ chars of focus is a problem regardless of how
    # much room the model would tolerate.
    assert len(focus) < 8000, (
        f"composed focus is {len(focus)} chars — over the 8,000 working margin "
        "(_TOTAL_FOCUS_CAP), which is independent of the instructions cap"
    )


def test_maximal_config_still_names_its_elements() -> None:
    """A cap that silently swallows the whole manifest would pass the cap test
    while defeating the feature. Truncation must be item-wise."""
    from adk.teacher_focus import compose_teacher_focus
    from db.models.activity_config import ChecklistItem

    focus = compose_teacher_focus(_cfg(checklist=[ChecklistItem(id=f"i{n}", label=f"Step {n}") for n in range(50)]))
    assert "Step 0" in focus


def test_concept_map_block_is_bounded() -> None:
    """Pre-existing overflow, surfaced by the cap test above (1.1.62 M2).

    A 30-node concept map composed ~3,500 characters with no bound. Stacked
    with a 2,000-char teaching goal and a 2,000-char solution task, a maximal
    activity blew the SkillConfig instruction cap — 10,000 at the time, raised
    to 25,000 on 2026-08-06 — **before** the element manifest existed. It never showed up because nobody had authored a maximal
    activity — and when it did show up it would have failed at SEED time, not
    at request time.
    """
    from adk.teacher_focus import _CONCEPT_MAP_CAP, compose_teacher_focus
    from db.models.activity_config import ConceptEdge, ConceptMapElement, ConceptNode

    cfg = _cfg(
        conceptMap=[
            ConceptMapElement(
                id="cm",
                title="Map",
                nodes=[ConceptNode(id=f"n{n}", label="L" * 80) for n in range(30)],
                edges=[ConceptEdge(**{"from": f"n{n}", "to": f"n{n + 1}"}) for n in range(29)],
            )
        ]
    )
    focus = compose_teacher_focus(cfg)
    assert "more concepts)" in focus
    # The checkpoint contract must survive truncation — dropping it would leave
    # the tutor a concept list with no instruction to check anything off.
    assert "run_checkpoint" in focus
    assert "n0" in focus  # truncation is node-wise, from the end
    assert len(focus) < _CONCEPT_MAP_CAP + 1500


def test_solution_task_is_bounded() -> None:
    """The other unbounded contributor: a 2,000-char solution prompt."""
    from adk.teacher_focus import SOLUTION_FEEDBACK_PROMPT, compose_teacher_focus
    from db.models.activity_config import SolutionElement

    focus = compose_teacher_focus(_cfg(solution=[SolutionElement(id="s", prompt="P" * 2000)]))
    assert "truncated" in focus
    assert SOLUTION_FEEDBACK_PROMPT in focus  # the coaching contract is not what gets cut
    assert len(focus) < 2500


def test_chat_only_activity_composes_exactly_as_before() -> None:
    """No elements, default language: the composition is untouched by 1.1.62/63.

    This is the no-regression guarantee for every existing chat-only activity.
    """
    from adk.teacher_focus import compose_teacher_focus

    assert compose_teacher_focus(_cfg(teachingGoal="Just a goal")) == "Just a goal"


# ---------------------------------------------------------------------------
# 1.1.62 M3b — ILO precedence over the curriculum preamble
#
# Aswin, 2026-08-06: "The chat force students to achieve goals from the
# curriculum only, not with my ILOs."
#
# The mechanism, found while implementing: the composed instruction is
#
#     SKILL.md body (with {teacher_focus} substituted INSIDE it)
#       + curriculum grounding preamble        <- appended after the body
#       + image guidance / style / opening / reactive
#
# so the teacher's goals were ALREADY before the curriculum preamble — and this
# codebase's convention is "later instruction wins" (see the comment on
# inject_interaction_style_preamble). Being first is the WEAK position. The
# design doc's "emit the ILO block before the curriculum preamble" would have
# been a no-op; precedence has to be stated explicitly, in the late position.
# ---------------------------------------------------------------------------


def test_ilo_precedence_block_is_empty_without_a_checklist() -> None:
    from adk.teacher_focus import build_ilo_precedence_block

    assert build_ilo_precedence_block(_cfg(teachingGoal="Just a goal")) == ""
    assert build_ilo_precedence_block(None) == ""


def test_ilo_precedence_block_names_the_teacher_outcomes() -> None:
    from adk.teacher_focus import build_ilo_precedence_block
    from db.models.activity_config import ChecklistItem

    block = build_ilo_precedence_block(_cfg(checklist=[ChecklistItem(id="a", label="Mål faldtiden tre gange")]))
    assert "Mål faldtiden tre gange" in block


def test_ilo_precedence_block_subordinates_curriculum_to_the_teachers_outcomes() -> None:
    """The block must say which one wins, not merely mention both."""
    from adk.teacher_focus import build_ilo_precedence_block
    from db.models.activity_config import ChecklistItem

    block = build_ilo_precedence_block(_cfg(checklist=[ChecklistItem(id="a", label="Step")])).lower()
    assert "curriculum" in block
    assert "reference" in block or "not a competing" in block


def test_ilo_precedence_lands_AFTER_the_curriculum_preamble() -> None:
    """The whole point. Composed the way agent.py composes it.

    If this ever inverts, the curriculum preamble regains the last word and
    Aswin's complaint comes straight back.
    """
    from adk.curriculum_retrieval import build_curriculum_grounding_preamble
    from adk.teacher_focus import build_ilo_precedence_block
    from db.models.activity_config import ChecklistItem, MaterialRef

    cfg = _cfg(
        checklist=[ChecklistItem(id="a", label="Mål faldtiden")],
        materials=[MaterialRef(docId="d1", origin="uvm.dk", title="Fysik B læreplan")],
    )
    composed = "BODY" + build_curriculum_grounding_preamble(cfg.materials) + build_ilo_precedence_block(cfg)
    assert composed.index("Fysik B læreplan") < composed.index("Mål faldtiden")


def test_ilo_precedence_block_is_bounded() -> None:
    """50 items x 200 chars is 10k on its own — this rides the same shared
    prompt budget as everything else."""
    from adk.teacher_focus import build_ilo_precedence_block
    from db.models.activity_config import ChecklistItem

    block = build_ilo_precedence_block(_cfg(checklist=[ChecklistItem(id=f"i{n}", label="L" * 200) for n in range(50)]))
    assert len(block) < 2000
    assert "more)" in block


def test_ilo_precedence_does_not_weaken_grounding() -> None:
    """Curriculum grounding must survive — an English activity still has to
    ground in Danish material. The block reframes priority, not sourcing."""
    from adk.teacher_focus import build_ilo_precedence_block
    from db.models.activity_config import ChecklistItem

    block = build_ilo_precedence_block(_cfg(checklist=[ChecklistItem(id="a", label="Step")])).lower()
    assert "ignore" not in block
    assert "do not use" not in block


# --- PILOT-1 M1: the per-TURN prompt budget ------------------------------
#
# WRITE THIS TEST FIRST. (Sprint plan, M1 risk row.)
#
# ``_TOTAL_FOCUS_CAP`` bounds ``compose_teacher_focus`` only — the blocks
# substituted into the SKILL.md body ONCE per agent build. PILOT-1 adds two
# blocks that are NOT in that sum:
#
#   * the element fill-state block (1.1.69 M1), appended by a per-turn
#     InstructionProvider, and
#   * the inherited-progress block (1.1.70 M1), composed at agent build.
#
# Neither passes through ``compose_teacher_focus``, so neither is covered by
# the existing cap test — they would ride entirely outside the budget and the
# only symptom would be a diluted tutor. This test sums what a maximal
# activity actually sends per turn and holds the whole thing to one number.


def _maximal_cfg():
    """The largest activity the model permits — every element at max_items,
    every bounded string at its max_length."""
    from db.models.activity_config import (
        CalcInput,
        CalculatorElement,
        ChartElement,
        ChecklistItem,
        ConceptEdge,
        ConceptMapElement,
        ConceptNode,
        DocumentElement,
        NoteElement,
        SolutionElement,
        TableColumn,
        TableElement,
    )

    return _cfg(
        language="en",
        artefactId="boldkast",
        teachingGoal="G" * 2000,
        checklist=[ChecklistItem(id=f"i{n}", label="L" * 200) for n in range(50)],
        table=[
            TableElement(
                id=f"tbl{n}",
                title="T" * 80,
                columns=[TableColumn(id=f"c{c}", label="C" * 80, unit="m/s") for c in range(6)],
                rows=20,
            )
            for n in range(5)
        ],
        chart=[ChartElement(id=f"c{n}", title="T" * 120) for n in range(5)],
        calculator=[
            CalculatorElement(
                id=f"calc{n}",
                title="T" * 120,
                formula="a + b",
                inputs=[CalcInput(id="a", label="A" * 80), CalcInput(id="b", label="B" * 80)],
            )
            for n in range(5)
        ],
        note=[NoteElement(id=f"n{n}", title="T" * 120, body="B" * 4000) for n in range(5)],
        solution=[SolutionElement(id="s", prompt="P" * 2000)],
        document=[DocumentElement(id="d", prompt="P" * 2000)],
        conceptMap=[
            ConceptMapElement(
                id="cm",
                title="Map",
                nodes=[ConceptNode(id=f"n{n}", label="L" * 80) for n in range(30)],
                edges=[ConceptEdge(**{"from": f"n{n}", "to": f"n{n + 1}"}) for n in range(29)],
            )
        ],
    )


def test_element_state_block_is_bounded() -> None:
    """Five 20x6 tables plus five calculators is 600 cells of state. The block
    must bound itself at source rather than relying on the total below."""
    from adk.element_state import ELEMENT_STATE_CHAR_CAP, describe_element_state

    block = describe_element_state(_maximal_cfg(), {})
    assert block, "a maximal activity with no pushed state must still report EMPTY"
    assert len(block) <= ELEMENT_STATE_CHAR_CAP


def test_inherited_progress_block_is_bounded() -> None:
    """50 checklist items x (200-char label + 500-char evidence) is 35k on its
    own. Same treatment as every other variable-length contributor."""
    from adk.checklist_tools import INHERITED_PROGRESS_CAP, checklist_state_summary
    from auth.firebase_auth import User
    from db.checklist_progress import record_item_state

    cfg = _maximal_cfg()
    for n in range(50):
        record_item_state(
            "grp-budget",
            cfg.activity_id,
            f"i{n}",
            done=True,
            by="ai",
            evidence_summary="E" * 500,
        )
    user = User(uid="u", email="", domain="", group_id="grp-budget")
    block = checklist_state_summary(cfg, user)
    assert block
    assert len(block) <= INHERITED_PROGRESS_CAP


def test_checkpoint_summary_block_is_bounded() -> None:
    """The twin. A 30-node map is the model's maximum."""
    from adk.checkpoint_tools import CHECKPOINT_SUMMARY_CAP, checkpoint_state_summary
    from auth.firebase_auth import User
    from db.concept_progress import record_checkpoint_state

    cfg = _maximal_cfg()
    for n in range(30):
        record_checkpoint_state("grp-ckpt", cfg.activity_id, f"n{n}", "demonstrated", "E" * 500)
    block = checkpoint_state_summary(cfg, User(uid="u", email="", domain="", group_id="grp-ckpt"))
    assert block
    assert len(block) <= CHECKPOINT_SUMMARY_CAP


# The per-turn per-activity content budget. NOT a validation limit — an
# attention and input-cost one, for the same reason ``_TOTAL_FOCUS_CAP`` is:
# every character here rides EVERY turn, and a tutor that has just been told a
# table is empty must not lose that among ten thousand other characters.
#
# 8,000 of it is ``_TOTAL_FOCUS_CAP``; the rest is the ILO block plus the three
# blocks PILOT-1 adds, each individually capped in its own module. Raising this
# number is a DECISION about how much of the model's attention per-activity
# content may take, and should be made here, deliberately, with the individual
# caps adjusted to match — not absorbed silently by a block that grew.
_PER_TURN_ACTIVITY_BUDGET = 13_000


def test_per_turn_prompt_stays_within_budget() -> None:
    """The sum is what the model actually reads.

    Five contributors shared ``_TOTAL_FOCUS_CAP`` before this sprint; PILOT-1
    makes it eight, and three of the eight are outside that cap by
    construction — they are appended to the composed instruction rather than
    substituted into ``{teacher_focus}``. Nothing else would have noticed.
    """
    from adk.element_state import describe_element_state
    from adk.progress_context import compose_progress_context
    from adk.teacher_focus import build_ilo_precedence_block, compose_teacher_focus
    from auth.firebase_auth import User
    from db.checklist_progress import record_item_state
    from db.concept_progress import record_checkpoint_state

    cfg = _maximal_cfg()
    user = User(uid="u", email="", domain="", group_id="grp-total")
    for n in range(50):
        record_item_state("grp-total", cfg.activity_id, f"i{n}", done=True, by="ai", evidence_summary="E" * 500)
    for n in range(30):
        record_checkpoint_state("grp-total", cfg.activity_id, f"n{n}", "demonstrated", "E" * 500)

    per_turn = "\n\n".join(
        [
            compose_teacher_focus(cfg),
            build_ilo_precedence_block(cfg),
            describe_element_state(cfg, {}),
            compose_progress_context(cfg, user),
        ]
    )

    # The authored SKILL.md body is validated separately at 25,000 characters
    # and is NOT counted here — this is the per-activity content stacked onto it.
    assert len(per_turn) <= _PER_TURN_ACTIVITY_BUDGET, (
        f"per-turn per-activity content is {len(per_turn)} chars against a "
        f"{_PER_TURN_ACTIVITY_BUDGET} budget — bound the new block at source, or raise the budget "
        "deliberately and say why"
    )


def test_a_first_ever_session_pays_nothing_for_the_progress_blocks() -> None:
    """Graceful degradation is also a budget property: the common case is a
    group with no recorded progress, and it must compose byte-identically to
    before 1.1.70."""
    from adk.progress_context import compose_progress_context
    from auth.firebase_auth import User

    assert compose_progress_context(_maximal_cfg(), User(uid="u", email="", domain="", group_id="brand-new")) == ""
