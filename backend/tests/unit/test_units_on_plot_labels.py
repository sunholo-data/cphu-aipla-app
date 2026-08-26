"""Every plot and table label carries its unit.

Teachers, 25 Aug: *"Notation showing on labels units - fundamentals"* — units on
axis and column labels are a general principle for ALL plots and graphs the
platform produces, because it is what is taught to the students. A graph with a
bare "tid" axis models bad practice at exactly the moment a student is learning
the habit.

The rendering half was already right: `axisLabel()` composes "tid (s)" from the
column's label and unit. The gap was upstream — `unit` was documented as
optional (`{"label", "unit"?}`) in the authoring co-pilot's `add_element`
contract, so a proposed table could omit it, and a chart takes its axis labels
straight from those columns. Optional in the contract meant absent in practice.

`unit` stays structurally optional in the Pydantic model, because a trial
number or a free-text note genuinely has none. What changed is that the
INSTRUCTION now expects it. These tests guard the instruction; only an eval can
prove the model complies.
"""

from __future__ import annotations

from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[2]
_SKILL = _BACKEND / "skills" / "templates" / "activity-authoring-assistant" / "SKILL.md"
_TOOLS = _BACKEND / "adk" / "authoring_tools.py"


@pytest.fixture(scope="module")
def skill_text() -> str:
    assert _SKILL.is_file(), f"authoring SKILL.md not found at {_SKILL}"
    return _SKILL.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def tools_text() -> str:
    assert _TOOLS.is_file(), f"authoring_tools.py not found at {_TOOLS}"
    return _TOOLS.read_text(encoding="utf-8")


class TestTheInstructionAsksForUnits:
    def test_skill_states_units_are_not_optional(self, skill_text: str):
        assert "Units are not optional" in skill_text, (
            "The units rule is gone from the authoring skill. Without it the "
            "co-pilot proposes unitless columns and every chart built on them "
            "gets a bare axis."
        )

    def test_skill_explains_the_chart_consequence(self, skill_text: str):
        """The rule sticks better when it says WHY, because the cost is one step
        removed from the thing being authored."""
        lowered = skill_text.lower()
        assert "axis" in lowered and "column" in lowered

    def test_tool_contract_no_longer_marks_column_unit_optional(self, tools_text: str):
        assert '{"label", "unit"?, "kind"' not in tools_text, (
            'The add_element contract advertises unit as optional again ("unit"?). '
            "That is what let unitless tables through."
        )

    def test_tool_contract_no_longer_marks_calc_unit_optional(self, tools_text: str):
        assert '{"id", "label", "unit"?}' not in tools_text

    def test_tool_contract_tells_the_model_when_to_omit(self, tools_text: str):
        """Not 'always' — a trial number has no unit, and a rule that is wrong
        some of the time gets ignored all of the time."""
        assert "trial number" in tools_text


class TestTheModelStillAllowsUnitlessColumns:
    """The rule is an instruction, not a schema constraint. A counter column
    must still be expressible, or authoring breaks on legitimate cases."""

    def test_a_column_without_a_unit_is_still_valid(self):
        from db.models.activity_config import TableColumn

        col = TableColumn(id="col-1", label="Forsøg nr.", kind="number")
        assert col.unit == ""

    def test_a_column_with_a_unit_round_trips(self):
        from db.models.activity_config import TableColumn

        col = TableColumn(id="col-2", label="tid", unit="s", kind="number")
        assert col.unit == "s"


class TestRenderingComposesLabelAndUnit:
    def test_the_frontend_axis_helper_still_appends_the_unit(self):
        """Guards the render half. If axisLabel stops composing "label (unit)",
        every column's unit becomes invisible and the instruction above is
        pointless."""
        helper = (_BACKEND.parent / "frontend" / "src" / "lib" / "resolveChartBinding.ts").read_text(encoding="utf-8")
        assert "c.unit ?" in helper and "(${c.unit})" in helper, (
            "axisLabel no longer composes the unit into the axis label."
        )
