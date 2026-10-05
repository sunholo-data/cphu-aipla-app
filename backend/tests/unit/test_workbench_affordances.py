"""1.1.149 M2 — the workbench affordances block: inventory, rule, nudge.

The end-to-end proof that a STUDENT's composed instruction carries this block
is ``tests/api_tests/test_workbench_reaches_the_model.py`` (through the real
``create_agent``); these pin the block's own contract.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace as NS

import pytest

from adk.element_state import read_element_fills
from adk.workbench_affordances import (
    AFFORDANCES_CHAR_CAP,
    NUDGE_EVERY_K,
    TurnFills,
    bench_items,
    compose_workbench_affordances,
    make_workbench_affordances_wrapper,
    non_referring_streak,
    render_nudge,
    render_rule,
    resolve_workbench_use,
    should_nudge,
    tutor_turns,
)
from artefacts.loader import load_artefact
from db.models.activity_config import (
    ActivityConfig,
    CalcInput,
    CalculatorElement,
    ChecklistItem,
    TableColumn,
    TableElement,
)


def _cfg(**kw) -> ActivityConfig:
    base = {"activityId": "act-1", "classId": "c", "teacherUid": "t", "updatedAt": datetime.now(UTC)}
    base.update(kw)
    return ActivityConfig(**base)


def _table(tid: str = "t1", title: str = "Måleskema") -> TableElement:
    return TableElement(id=tid, title=title, columns=[TableColumn(id="a", label="Tid", unit="s")], rows=3)


def _items(cfg: ActivityConfig, state: dict | None = None, **kw):
    state = state or {}
    meta = load_artefact(cfg.artefact_id) if cfg.artefact_id else None
    return bench_items(cfg, state, read_element_fills(cfg, state), sim_meta=meta, **kw)


# --- inventory --------------------------------------------------------------------


def test_the_sim_is_listed_first_by_display_name() -> None:
    cfg = _cfg(
        artefactId="kettle-efficiency",
        checklist=[ChecklistItem(id="a", label="Mål effekten")],
        table=[_table()],
    )
    items = _items(cfg)
    assert [i.kind for i in items] == ["sim", "checklist", "table"]
    assert 'Simulation "Elkedel — energi og nyttevirkning"' in items[0].line
    assert "[untouched]" in items[0].line


def test_the_sims_tutor_block_is_not_repeated() -> None:
    cfg = _cfg(artefactId="kettle-efficiency")
    meta = load_artefact("kettle-efficiency")
    block = compose_workbench_affordances(_items(cfg))
    assert meta.tutor_block[:80] not in block


def test_a_sim_with_state_reads_in_use() -> None:
    cfg = _cfg(artefactId="boldkast")
    items = _items(cfg, {"mcp_app_context.boldkast.state": {"angle": 45}})
    assert "[in use]" in items[0].line
    assert items[0].untouched is False


def test_control_sim_is_mentioned_only_when_available() -> None:
    cfg = _cfg(artefactId="sol-jord-maane")
    assert "control_sim" not in _items(cfg)[0].line
    assert "control_sim" in _items(cfg, control_sim=True)[0].line


def test_element_fill_state_reads_from_the_observation() -> None:
    cfg = _cfg(
        table=[_table()],
        calculator=[
            CalculatorElement(
                id="c1",
                title="Effekt",
                formula="a*b",
                inputs=[CalcInput(id="a", label="U"), CalcInput(id="b", label="I")],
            )
        ],
    )
    state = {"mcp_app_context.table.state": {"tables": [{"tableId": "t1", "data": [{"a": "3.2"}]}]}}
    items = {i.kind: i for i in _items(cfg, state)}
    assert "[in use]" in items["table"].line
    assert "[untouched]" in items["calculator"].line


def test_an_untitled_element_is_never_called_untitled() -> None:
    items = _items(_cfg(table=[_table(title="")]))
    assert '"untitled"' not in items[0].line.replace('never as "untitled"', "")


def test_no_sim_and_no_element_is_empty() -> None:
    assert _items(_cfg()) == []
    assert compose_workbench_affordances([]) == ""


# --- the rule ---------------------------------------------------------------------


def test_balanced_rule_carries_all_four_triggers() -> None:
    rule = render_rule("balanced")
    for t in ("(a) in your opening turn", "(b) when the student is stuck", "(c)", "(d)"):
        assert t in rule
    assert "(e)" not in rule


def test_dialogue_first_names_the_bench_once_instead_of_opening_on_it() -> None:
    rule = render_rule("dialogue_first")
    assert "(a) once, early" in rule
    assert "(a) in your opening turn" not in rule
    assert "(b)" in rule and "(d)" in rule


def test_workbench_first_adds_try_before_discussing() -> None:
    rule = render_rule("workbench_first")
    assert "(e) before discussing" in rule
    assert rule.index("(d)") < rule.index("(e)")


def test_an_unknown_policy_falls_back_to_balanced() -> None:
    assert render_rule("nonsense") == render_rule("balanced")


def test_null_framework_resolves_to_balanced(monkeypatch) -> None:
    import db.framework_overrides as fo

    monkeypatch.setattr(fo, "effective_framework", lambda fid: NS(workbench_use=None) if fid == "fw" else None)
    assert resolve_workbench_use(None) == "balanced"
    assert resolve_workbench_use("fw") == "balanced"
    assert resolve_workbench_use("gone") == "balanced"
    monkeypatch.setattr(fo, "effective_framework", lambda fid: NS(workbench_use="workbench_first"))
    assert resolve_workbench_use("fw") == "workbench_first"


# --- cap --------------------------------------------------------------------------


def test_cap_truncates_items_and_keeps_rule_and_nudge() -> None:
    from adk.workbench_affordances import BenchItem

    sim = _items(_cfg(artefactId="kettle-efficiency"))[0]
    items = [sim] + [
        BenchItem(
            "table", f"t{i}", f"the data table {i}", f'- Data table "Tabel nummer {i} med en lang titel" [untouched]'
        )
        for i in range(30)
    ]
    nudge = "Reminder: do the thing."
    block = compose_workbench_affordances(items, nudge=nudge)
    assert len(block) <= AFFORDANCES_CHAR_CAP
    assert "more)" in block
    assert render_rule("balanced") in block
    assert block.endswith(nudge)
    assert "Simulation" in block  # sim first, so it survives truncation


def test_a_realistic_full_bench_fits_without_truncation() -> None:
    cfg = _cfg(
        artefactId="kettle-efficiency",
        checklist=[ChecklistItem(id="a", label="Mål effekten")],
        table=[_table("t1", ""), _table("t2", "Kontrolmåling")],
    )
    items = _items(cfg)
    block = compose_workbench_affordances(items, nudge=render_nudge(items[0]))
    assert "more)" not in block
    assert len(block) <= AFFORDANCES_CHAR_CAP


# --- the nudge --------------------------------------------------------------------


def _ev(author: str, text: str = "", call: str | None = None):
    parts = []
    if text:
        parts.append(NS(text=text, function_call=None))
    if call:
        parts.append(NS(text=None, function_call=NS(name=call)))
    return NS(author=author, content=NS(parts=parts))


def _dialogue(tutor_replies: list[str]) -> list:
    events = []
    for r in tutor_replies:
        events.append(_ev("user", "hmm"))
        events.append(_ev("tutor", r))
    events.append(_ev("user", "jeg ved det ikke"))  # the current turn
    return events


def test_tutor_turns_group_a_tool_call_with_its_reply() -> None:
    events = [
        _ev("user", "hej"),
        _ev("tutor", call="control_sim"),
        _ev("tutor"),
        _ev("tutor", "Se nu."),
        _ev("user", "ok"),
    ]
    assert tutor_turns(events) == [("Se nu.", ["control_sim"])]


def test_streak_counts_back_to_the_last_referral() -> None:
    events = _dialogue(["Åbn simuleringen.", "Hvad tror du?", "Hvorfor?"])
    assert non_referring_streak(events, None) == 2


@pytest.mark.parametrize(("streak", "fires"), [(0, False), (2, False), (3, True), (4, False), (5, False), (6, True)])
def test_nudge_fires_at_exactly_k_and_its_multiples(streak: int, fires: bool) -> None:
    assert NUDGE_EVERY_K == 3
    assert should_nudge(streak, opening_turn=False) is fires


def test_never_on_the_opening_turn() -> None:
    assert should_nudge(3, opening_turn=True) is False


def _run(cfg, events, state=None, user_text="jeg ved det ikke", **kw) -> str:
    wrapper = make_workbench_affordances_wrapper(cfg, **kw)
    ctx = NS(
        state=state or {},
        user_content=NS(parts=[NS(text=user_text)]),
        session=NS(events=events, id="s"),
    )
    return asyncio.run(wrapper("BODY")(ctx))


def test_wrapper_nudges_after_k_non_referring_turns_with_an_untouched_item() -> None:
    cfg = _cfg(artefactId="boldkast")
    out = _run(cfg, _dialogue(["Hvad tror du?"] * NUDGE_EVERY_K))
    assert "Reminder: your last 3 replies" in out
    assert 'the simulation "Boldkast' in out.split("Reminder:")[1]


def test_wrapper_does_not_nudge_before_k() -> None:
    out = _run(_cfg(artefactId="boldkast"), _dialogue(["Hvad tror du?"] * (NUDGE_EVERY_K - 1)))
    assert "Reminder:" not in out


def test_wrapper_does_not_nudge_when_everything_is_in_use() -> None:
    cfg = _cfg(artefactId="boldkast")
    out = _run(cfg, _dialogue(["Hvad tror du?"] * NUDGE_EVERY_K), state={"mcp_app_context.boldkast.state": {"a": 1}})
    assert "WORKBENCH" in out
    assert "Reminder:" not in out


def test_wrapper_does_not_nudge_on_the_greet_turn() -> None:
    out = _run(_cfg(artefactId="boldkast"), _dialogue(["Hvad tror du?"] * NUDGE_EVERY_K), user_text="[session_start]")
    assert "Reminder:" not in out


def test_activity_names_count_as_referrals_for_the_nudge() -> None:
    """The vocabulary is the activity's own: naming the table by its title is a
    referral even with no generic word in it."""
    cfg = _cfg(table=[_table(title="Måleskema")])
    out = _run(cfg, _dialogue(["Hvad tror du?", "Hvorfor?", "Åbn Måleskema og skriv tiden."]))
    assert "Reminder:" not in out


def test_wrapper_is_a_passthrough_for_an_empty_activity() -> None:
    assert _run(_cfg(), _dialogue(["x"] * 3)) == "BODY"
    assert _run(None, _dialogue(["x"] * 3)) == "BODY"


def test_wrapper_reads_the_shared_observation_when_given_one() -> None:
    """The fill-state wrapper's observation is used, not a second read."""
    cfg = _cfg(table=[_table()])
    shared = TurnFills()
    ctx = NS(state={}, user_content=None, session=NS(events=[], id="s"))
    from adk.element_state import ElementFill

    shared.observe(ctx, [ElementFill(kind="table", element_id="t1", title="Måleskema", filled=2, total=3)])
    out = asyncio.run(make_workbench_affordances_wrapper(cfg, turn_fills=shared)("BODY")(ctx))
    assert "[in use]" in out  # the state dict is empty, so this came from the observation
    assert shared.take(ctx) is None  # consumed
