"""Unit tests for adk.element_state — the tutor's picture of what is FILLED IN (1.1.69 M1+M2).

The regression this file exists for is Aswin's, 2026-08-10: a student says
"done" without touching the table, and the tutor agrees. The load-bearing
assertion is ``test_untouched_table_reports_empty_on_turn_one`` — with **no**
pushed state at all, an authored table must say EMPTY rather than say nothing.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from adk.element_state import (
    ELEMENT_STATE_CHAR_CAP,
    NoFillChannel,
    describe_element_state,
    make_element_state_wrapper,
)
from db.models.activity_config import (
    ELEMENT_REGISTRY,
    ActivityConfig,
    CalcInput,
    CalculatorElement,
    ChartElement,
    ChecklistItem,
    DocumentElement,
    NoteElement,
    SolutionElement,
    TableColumn,
    TableElement,
    WritingElement,
)


def _cfg(**kwargs) -> ActivityConfig:
    base = {
        "activityId": "act-1",
        "classId": "c",
        "teacherUid": "t",
        "updatedAt": datetime.now(UTC),
    }
    base.update(kwargs)
    return ActivityConfig(**base)


def _table(id_: str = "t1", title: str = "Faldforsøg", rows: int = 5) -> TableElement:
    return TableElement(
        id=id_,
        title=title,
        columns=[
            TableColumn(id="h", label="højde", unit="m", kind="number"),
            TableColumn(id="t", label="tid", unit="s", kind="number"),
        ],
        rows=rows,
    )


def _calc(id_: str = "c1", title: str = "Gennemsnitsfart") -> CalculatorElement:
    return CalculatorElement(
        id=id_,
        title=title,
        formula="s / t",
        inputs=[CalcInput(id="s", label="strækning", unit="m"), CalcInput(id="t", label="tid", unit="s")],
    )


def _pushed(server: str, content: dict) -> dict:
    """Session state as the iframe-context route writes it."""
    return {f"mcp_app_context.{server}.state": {"structuredContent": content, "_pushedAt": 1}}


# --- The bug: untouched must not read as absent ---------------------------


def test_untouched_table_reports_empty_on_turn_one() -> None:
    """**Aswin's exact case.** An authored table, no iframe-context push at all
    (the student never touched it), turn one. Before 1.1.69 the tutor's context
    said nothing — indistinguishable from "there is no table" — so "done" was
    unfalsifiable. It must now say EMPTY."""
    block = describe_element_state(_cfg(table=[_table()]), {})
    assert "EMPTY" in block
    assert "Faldforsøg" in block
    assert "0 of 10 cells filled" in block


def test_absent_element_reports_nothing() -> None:
    """The other half of the same distinction: unknown and empty must never
    collapse. An activity with no table says nothing about tables."""
    block = describe_element_state(_cfg(calculator=[_calc()]), {})
    assert "Data table" not in block


def test_no_fillable_elements_composes_as_before() -> None:
    """A chat-only activity, or one with only non-fillable elements, must
    contribute nothing at all — not an empty header."""
    assert describe_element_state(_cfg(), {}) == ""
    assert describe_element_state(None, {}) == ""
    assert describe_element_state(_cfg(note=[NoteElement(id="n", title="Læs", body="…")]), {}) == ""


def test_partial_table_reports_counts() -> None:
    state = _pushed(
        "table",
        {
            "tableId": "t1",
            "title": "Faldforsøg",
            "filledCells": 3,
            "data": [{"h": "1.0", "t": "0.45"}, {"h": "2.0", "t": ""}],
        },
    )
    block = describe_element_state(_cfg(table=[_table()]), state)
    assert "PARTIAL" in block
    assert "3 of 10 cells filled" in block


def test_complete_table_reports_complete() -> None:
    state = _pushed("table", {"tableId": "t1", "filledCells": 10})
    block = describe_element_state(_cfg(table=[_table()]), state)
    assert "COMPLETE" in block


def test_filled_count_falls_back_to_counting_the_grid() -> None:
    """A snapshot missing ``filledCells`` must not be read as empty — an
    over-report of emptiness is the one error mode that would make the tutor
    refuse work a student really did."""
    state = _pushed("table", {"tableId": "t1", "data": [{"h": "1.0", "t": "0.45"}, {"h": " ", "t": ""}]})
    block = describe_element_state(_cfg(table=[_table()]), state)
    assert "2 of 10 cells filled" in block
    assert "PARTIAL" in block


def test_raw_structured_content_shape_is_accepted() -> None:
    """Tolerate state written without the ``structuredContent`` envelope rather
    than silently reporting a filled table as EMPTY."""
    state = {"mcp_app_context.table.state": {"tableId": "t1", "filledCells": 4}}
    assert "4 of 10 cells filled" in describe_element_state(_cfg(table=[_table()]), state)


def test_snapshot_for_a_different_table_does_not_fill_this_one() -> None:
    """A snapshot must only ever satisfy the table it names.

    (Written when every table shared one ``table.state`` key — 1.1.88 M2 made
    the push an array, and the legacy single-snapshot shape below is still
    accepted for sessions that were live at deploy time.)"""
    state = _pushed("table", {"tableId": "t2", "filledCells": 10})
    block = describe_element_state(_cfg(table=[_table("t1"), _table("t2", title="Anden")]), state)
    lines = {ln.split(":")[0]: ln for ln in block.splitlines() if ln.startswith("Data table")}
    assert "EMPTY" in lines['Data table "Faldforsøg"']
    assert "COMPLETE" in lines['Data table "Anden"']


# --- 1.1.88 M2 / 1.1.71: the array shape ----------------------------------


def test_two_tables_report_separately_from_one_array_push() -> None:
    """**The 1.1.71 defect.** A student filling table one used to make table two
    report EMPTY, because both shared a single ``table.state`` slot and only the
    last-pushed grid was there. Both are in one push now, matched by id."""
    state = _pushed(
        "table",
        {
            "tables": [
                {"tableId": "t1", "filledCells": 10},
                {"tableId": "t2", "filledCells": 3},
            ]
        },
    )
    block = describe_element_state(_cfg(table=[_table("t1"), _table("t2", title="Anden")]), state)
    lines = {ln.split(":")[0]: ln for ln in block.splitlines() if ln.startswith("Data table")}
    assert "COMPLETE" in lines['Data table "Faldforsøg"']
    assert "3 of 10 cells filled" in lines['Data table "Anden"']


def test_array_push_still_reports_an_untouched_table_as_empty() -> None:
    """The array must not accidentally launder a missing table into UNKNOWN —
    an authored table absent from the push is EMPTY, which is the whole point of
    this module."""
    state = _pushed("table", {"tables": [{"tableId": "t1", "filledCells": 4}]})
    block = describe_element_state(_cfg(table=[_table("t1"), _table("t2", title="Anden")]), state)
    lines = {ln.split(":")[0]: ln for ln in block.splitlines() if ln.startswith("Data table")}
    assert "4 of 10 cells filled" in lines['Data table "Faldforsøg"']
    assert "EMPTY" in lines['Data table "Anden"']


def test_array_push_counts_the_grid_when_the_count_is_missing() -> None:
    state = _pushed("table", {"tables": [{"tableId": "t1", "data": [{"h": "1.0", "t": "0.45"}]}]})
    assert "2 of 10 cells filled" in describe_element_state(_cfg(table=[_table()]), state)


def test_legacy_single_snapshot_still_reads_after_the_migration() -> None:
    """A session that was mid-lesson when M2 deployed holds the OLD shape in its
    state. It must keep reading rather than going blank — a student does not
    care that we changed a payload between their turns."""
    state = _pushed("table", {"tableId": "t1", "filledCells": 7})
    assert "7 of 10 cells filled" in describe_element_state(_cfg(table=[_table()]), state)


def test_empty_array_push_is_empty_not_unknown() -> None:
    state = _pushed("table", {"tables": []})
    assert "EMPTY" in describe_element_state(_cfg(table=[_table()]), state)


# --- Calculator -----------------------------------------------------------


def test_untouched_calculator_reports_empty() -> None:
    block = describe_element_state(_cfg(calculator=[_calc()]), {})
    assert "EMPTY" in block
    assert "0 of 2 inputs entered" in block


def test_calculator_reports_its_result() -> None:
    state = _pushed(
        "calculator",
        {"calculators": [{"id": "c1", "inputs": [{"value": "12"}, {"value": "3"}], "result": "4"}]},
    )
    block = describe_element_state(_cfg(calculator=[_calc()]), state)
    assert "COMPLETE" in block
    assert "result 4" in block


def test_calculators_are_matched_individually() -> None:
    """Unlike the table, the calculator snapshot carries every calculator, so a
    missing entry is a TRUE empty rather than an artefact of key collision."""
    state = _pushed("calculator", {"calculators": [{"id": "c2", "inputs": [{"value": "1"}], "result": None}]})
    block = describe_element_state(_cfg(calculator=[_calc("c1"), _calc("c2", title="Anden")]), state)
    lines = {ln.split(":")[0]: ln for ln in block.splitlines() if ln.startswith("Calculator")}
    assert "EMPTY" in lines['Calculator "Gennemsnitsfart"']
    assert "PARTIAL" in lines['Calculator "Anden"']


# --- The registry contract ------------------------------------------------


def test_every_element_kind_declares_a_fill_reader() -> None:
    """The 1.1.62 lesson, inverted for this module.

    The manifest defaults an undescribed kind to a GENERIC line, because a
    too-vague description is better than invisibility. Here the safe default is
    the opposite — a fabricated EMPTY for a kind we cannot observe re-creates
    the very unknown/empty conflation this module removes — so silence is the
    default and the registry must carry a POSITIVE decision for every kind.
    """
    from adk.element_state import _READERS

    missing = set(ELEMENT_REGISTRY) - set(_READERS)
    assert not missing, (
        f"element kinds with no fill decision: {sorted(missing)}. Add a reader, or a "
        "NoFillChannel(reason=...) saying why this kind cannot report fill state."
    )


def test_every_excluded_kind_gives_a_reason() -> None:
    from adk.element_state import _READERS

    for kind, reader in _READERS.items():
        if isinstance(reader, NoFillChannel):
            assert reader.reason.strip(), f"{kind} is excluded with no reason"


def test_solution_and_document_are_excluded_not_reported_empty() -> None:
    """Answers the design doc's Open Question 2, whose guess ("almost
    certainly the same gap") is wrong.

    A solution rides a multimodal chat turn and a document rides the artifact
    loader — the tutor sees both in the conversation, and neither writes
    ``mcp_app_context``. Reporting them EMPTY would therefore be permanently
    false, not merely uninformative.
    """
    cfg = _cfg(solution=[SolutionElement(id="s", prompt="Vis din udregning")], document=[DocumentElement(id="d")])
    assert describe_element_state(cfg, {}) == ""


def test_checklist_state_is_not_duplicated_here() -> None:
    """The store is the checklist's authority (1.1.70 M1 surfaces it). A second,
    client-mirrored view would contradict it after the first AI tick."""
    cfg = _cfg(checklist=[ChecklistItem(id="a", label="Mål faldtiden")])
    state = _pushed("progress", {"done": ["a"], "items": [{"id": "a", "label": "Mål faldtiden"}], "total": 1})
    assert describe_element_state(cfg, state) == ""


def test_chart_alone_reports_nothing() -> None:
    assert describe_element_state(_cfg(chart=[ChartElement(id="ch", title="Graf")]), {}) == ""


# --- Bounds ---------------------------------------------------------------


def test_block_is_bounded_item_wise() -> None:
    cfg = _cfg(
        table=[_table(f"t{n}", title="T" * 120, rows=20) for n in range(5)],
        calculator=[_calc(f"c{n}", title="C" * 120) for n in range(5)],
    )
    block = describe_element_state(cfg, {})
    assert len(block) <= ELEMENT_STATE_CHAR_CAP
    # The instruction must survive truncation — counts with no instruction is
    # the feature silently failing on exactly the largest activities.
    assert "do not mark the step done" in block
    assert "more)" in block


def test_a_reader_that_raises_does_not_break_the_turn() -> None:
    """A bad snapshot shape must cost that element's line, never the session."""
    state = {"mcp_app_context.table.state": {"structuredContent": {"tableId": "t1", "data": "not-a-list"}}}
    block = describe_element_state(_cfg(table=[_table()], calculator=[_calc()]), state)
    assert "Calculator" in block


# --- Per-TURN, not per-build ---------------------------------------------


class _Ctx:
    """Minimal ReadonlyContext stand-in — the provider only reads ``.state``."""

    def __init__(self, state: dict):
        self.state = state


@pytest.mark.asyncio
async def test_the_block_changes_between_turns() -> None:
    """The staleness guard.

    The element MANIFEST is composed once per agent build and deliberately omits
    values for exactly this reason. If this block were baked the same way, a
    table filled during the session would read EMPTY for the rest of it — the
    bug 1.1.69 exists to fix, re-introduced by its own fix.
    """
    wrapper = make_element_state_wrapper(_cfg(table=[_table()]))
    provider = wrapper("BASE INSTRUCTIONS")

    turn_one = await provider(_Ctx({}))
    turn_two = await provider(_Ctx(_pushed("table", {"tableId": "t1", "filledCells": 10})))

    assert "EMPTY" in turn_one
    assert "COMPLETE" in turn_two
    assert turn_one != turn_two


@pytest.mark.asyncio
async def test_provider_chains_onto_an_upstream_provider() -> None:
    """It sits in ``compose_instruction_providers`` beside the iframe-context
    wrapper, so it must accept a provider base as well as a string."""

    async def upstream(_ctx) -> str:
        return "UPSTREAM"

    provider = make_element_state_wrapper(_cfg(table=[_table()]))(upstream)
    out = await provider(_Ctx({}))
    assert out.startswith("UPSTREAM")
    assert "EMPTY" in out


@pytest.mark.asyncio
async def test_provider_is_a_passthrough_with_no_fillable_elements() -> None:
    provider = make_element_state_wrapper(_cfg())("BASE")
    assert await provider(_Ctx({})) == "BASE"


# --- The unknown/empty distinction, at the primitive -----------------------


def test_zero_capacity_reads_unknown_not_empty() -> None:
    """An element with nothing to fill in is a mis-authored element, not an
    empty one. The whole module exists because those two collapsed; the
    refusal in M3 keys off ``is_demonstrably_empty``, which must stay False
    here or a teacher's typo would block a student's mark.

    Today's Pydantic bounds (``columns`` min_length=1, ``rows`` ge=1) make this
    unreachable through the authoring path — this pins the behaviour for legacy
    rows and for the next element kind, where it may well not be.
    """
    from adk.element_state import ElementFill

    fill = ElementFill(kind="table", element_id="t", title="Tom", filled=0, total=0)
    assert fill.status == "UNKNOWN"
    assert fill.is_demonstrably_empty is False


def test_a_partly_filled_element_is_not_demonstrably_empty() -> None:
    from adk.element_state import ElementFill

    assert ElementFill(kind="table", element_id="t", title="T", filled=1, total=10).is_demonstrably_empty is False


# --- Step -> element association (1.1.69 M3) ------------------------------


def test_association_prefers_the_named_element_over_the_kind_noun() -> None:
    """With several tables, only the named one can be the association — the
    kind-noun rule is explicitly disabled at that point."""
    from adk.element_state import find_empty_element_for_step

    cfg = _cfg(table=[_table("t1", "Faldforsøg"), _table("t2", "Energiforsøg")])
    hit = find_empty_element_for_step(cfg, "Udfyld tabellen Energiforsøg", {})
    assert hit is not None
    assert hit.title == "Energiforsøg"


def test_a_two_character_title_is_not_matched() -> None:
    """A title like "A" appears in most Danish prose. Matching on it would
    refuse marks essentially at random."""
    from adk.element_state import find_empty_element_for_step

    cfg = _cfg(table=[_table("t1", "A")])
    assert find_empty_element_for_step(cfg, "Beskriv hvad der sker", {}) is None


def test_the_calculator_has_no_kind_noun_rule() -> None:
    """ "Beregn" is the ordinary Danish verb for "calculate", so a step reading
    "Beregn gennemsnittet" is a TASK, not a reference to the calculator
    element. Matching it would refuse marks for work done on paper."""
    from adk.element_state import find_empty_element_for_step

    cfg = _cfg(calculator=[_calc("c1", "Gennemsnitsfart")])
    assert find_empty_element_for_step(cfg, "Beregn gennemsnittet af dine målinger", {}) is None
    # Named explicitly, it still associates.
    assert find_empty_element_for_step(cfg, "Brug Gennemsnitsfart til at finde v", {}) is not None


def test_no_elements_never_associates() -> None:
    from adk.element_state import find_empty_element_for_step

    assert find_empty_element_for_step(_cfg(), "Udfyld tabellen", {}) is None
    assert find_empty_element_for_step(None, "Udfyld tabellen", {}) is None


def test_an_empty_step_label_never_associates() -> None:
    from adk.element_state import find_empty_element_for_step

    assert find_empty_element_for_step(_cfg(table=[_table()]), "   ", {}) is None


# --- writing surface (1.1.73) ---------------------------------------------


def _writing(id_: str = "w1", title: str = "Konklusion", target: int = 0) -> WritingElement:
    return WritingElement(id=id_, title=title, minWords=target)


def _writing_state(*docs: dict) -> dict:
    """The calculator-shaped snapshot: EVERY writing element in one array."""
    return _pushed("writing", {"docs": list(docs)})


def test_an_untouched_writing_surface_reports_empty_not_silence() -> None:
    """The whole point of the module, applied to the element where "I've written
    it" is the most tempting untrue claim a student can make."""
    block = describe_element_state(_cfg(writing=[_writing()]), {})
    assert "EMPTY" in block
    assert "written nothing" in block


def test_a_written_surface_reports_its_word_count() -> None:
    block = describe_element_state(
        _cfg(writing=[_writing()]),
        _writing_state({"id": "w1", "title": "Konklusion", "words": 142}),
    )
    assert "142 words written" in block
    # "EMPTY" also appears in the block's standing footer, so assert on the
    # element's own line rather than the whole block.
    assert 'Writing surface "Konklusion": EMPTY' not in block


def test_an_untargeted_surface_is_never_unknown() -> None:
    """`total <= 0` renders UNKNOWN ("nothing authored to fill in"), which would
    stop the M3 refusal firing. An untargeted surface carries a nominal total of
    1, so zero words is demonstrably EMPTY — and the line never says "0 of 1"."""
    block = describe_element_state(_cfg(writing=[_writing(target=0)]), {})
    assert "UNKNOWN" not in block
    assert "0 of 1" not in block


def test_a_word_target_is_reported_alongside_the_count() -> None:
    block = describe_element_state(
        _cfg(writing=[_writing(target=150)]),
        _writing_state({"id": "w1", "words": 60}),
    )
    assert "60 words written" in block
    assert "target 150" in block
    assert "PARTIAL" in block


def test_several_writing_surfaces_are_matched_by_id() -> None:
    """Unlike the table (one snapshot key, the 1.1.71 defect), writing pushes
    every element in one array — so a second surface is not falsely EMPTY just
    because the student is working in the first."""
    cfg = _cfg(writing=[_writing("w1", "Metode"), _writing("w2", "Konklusion")])
    block = describe_element_state(
        cfg,
        _writing_state({"id": "w1", "words": 80}, {"id": "w2", "words": 12}),
    )
    assert "80 words written" in block
    assert "12 words written" in block


def test_an_unpushed_surface_among_pushed_ones_is_truly_empty() -> None:
    cfg = _cfg(writing=[_writing("w1", "Metode"), _writing("w2", "Konklusion")])
    block = describe_element_state(cfg, _writing_state({"id": "w1", "words": 80}))
    assert 'Writing surface "Konklusion": EMPTY' in block


def test_writing_declares_a_fill_reader_not_an_exclusion() -> None:
    """Unlike solution/document — whose work arrives as a chat turn, so a
    synthesised EMPTY would be false the moment a student submits — writing has
    a real observable channel, so it must be read rather than excluded."""
    from adk.element_state import _READERS

    assert not isinstance(_READERS["writing"], NoFillChannel)
