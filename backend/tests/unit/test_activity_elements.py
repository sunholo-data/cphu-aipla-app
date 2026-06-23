"""Activity element registry — 1.1.38 M0.

The registry (``ELEMENT_REGISTRY``) is the single source of truth for which
teacher-authorable element kinds exist and their bounds. These tests pin the
two M0 guarantees: the registry is internally consistent, and the per-kind cap
is enforced on ``ActivityConfig`` (without changing checklist behaviour).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from db.models.activity_config import (
    ELEMENT_REGISTRY,
    ActivityConfig,
    CalcInput,
    CalculatorElement,
    ChartElement,
    ChecklistItem,
    NoteElement,
    TableColumn,
    TableElement,
)


def _config(**overrides: object) -> ActivityConfig:
    base: dict[str, object] = {
        "activityId": "act-1",
        "classId": "class-1",
        "teacherUid": "teacher-1",
        "updatedAt": datetime.now(UTC),
    }
    base.update(overrides)
    return ActivityConfig(**base)  # type: ignore[arg-type]


def _checklist(n: int) -> list[ChecklistItem]:
    return [ChecklistItem(id=f"s{i}", label=f"step {i}") for i in range(n)]


def test_registry_specs_are_internally_consistent() -> None:
    for kind, spec in ELEMENT_REGISTRY.items():
        assert spec.kind == kind, "registry key must match spec.kind"
        assert spec.render in ("workspace", "inline")
        assert spec.max_items > 0
        # every registered element's storage field must exist on ActivityConfig
        assert spec.field in ActivityConfig.model_fields, f"{spec.field} missing on ActivityConfig"


def test_checklist_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["checklist"]
    assert spec.field == "checklist"
    assert spec.render == "workspace"


def test_checklist_within_cap_roundtrips() -> None:
    cfg = _config(checklist=_checklist(5))
    assert len(cfg.checklist) == 5


def test_checklist_at_cap_is_allowed() -> None:
    cap = ELEMENT_REGISTRY["checklist"].max_items
    cfg = _config(checklist=_checklist(cap))
    assert len(cfg.checklist) == cap


def test_checklist_over_cap_is_rejected() -> None:
    cap = ELEMENT_REGISTRY["checklist"].max_items
    with pytest.raises(ValidationError):
        _config(checklist=_checklist(cap + 1))


# --- data table element (1.1.38 M1) ---------------------------------------


def _table(n_cols: int = 2, rows: int = 5) -> TableElement:
    cols = [TableColumn(id=f"c{i}", label=f"col {i}", unit="s") for i in range(n_cols)]
    return TableElement(id="t1", title="Measurements", columns=cols, rows=rows)


def test_table_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["table"]
    assert spec.field == "table"
    assert spec.render == "workspace"


def test_table_within_cap_roundtrips() -> None:
    cfg = _config(table=[_table()])
    assert len(cfg.table) == 1
    assert cfg.table[0].columns[0].unit == "s"


def test_table_over_cap_is_rejected() -> None:
    cap = ELEMENT_REGISTRY["table"].max_items
    tables = [TableElement(id=f"t{i}", columns=[TableColumn(id="c", label="x")]) for i in range(cap + 1)]
    with pytest.raises(ValidationError):
        _config(table=tables)


def test_table_requires_at_least_one_column() -> None:
    with pytest.raises(ValidationError):
        TableElement(id="t", columns=[])


def test_table_rejects_too_many_columns() -> None:
    cols = [TableColumn(id=f"c{i}", label=f"c{i}") for i in range(9)]
    with pytest.raises(ValidationError):
        TableElement(id="t", columns=cols)


def test_table_rows_must_be_in_bounds() -> None:
    col = [TableColumn(id="c", label="x")]
    with pytest.raises(ValidationError):
        TableElement(id="t", columns=col, rows=0)
    with pytest.raises(ValidationError):
        TableElement(id="t", columns=col, rows=51)


# --- chart element (1.1.38 M2) --------------------------------------------


def test_chart_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["chart"]
    assert spec.field == "chart"
    assert spec.render == "workspace"


def test_chart_within_cap_roundtrips() -> None:
    cfg = _config(chart=[ChartElement(id="c1", title="v-t", chartKind="line")])
    assert len(cfg.chart) == 1
    assert cfg.chart[0].chart_kind == "line"


def test_chart_defaults_to_scatter() -> None:
    assert ChartElement(id="c1").chart_kind == "scatter"


def test_chart_rejects_unknown_kind() -> None:
    with pytest.raises(ValidationError):
        ChartElement(id="c1", chartKind="pie")


def test_chart_over_cap_is_rejected() -> None:
    cap = ELEMENT_REGISTRY["chart"].max_items
    charts = [ChartElement(id=f"c{i}") for i in range(cap + 1)]
    with pytest.raises(ValidationError):
        _config(chart=charts)


# --- calculator element (1.1.38 M3) ---------------------------------------


def _calc() -> CalculatorElement:
    return CalculatorElement(
        id="calc1",
        title="Fart",
        formula="s / t",
        inputs=[CalcInput(id="s", label="Strækning"), CalcInput(id="t", label="Tid", unit="s")],
    )


def test_calculator_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["calculator"]
    assert spec.field == "calculator"
    assert spec.render == "workspace"


def test_calculator_within_cap_roundtrips() -> None:
    cfg = _config(calculator=[_calc()])
    assert cfg.calculator[0].formula == "s / t"
    assert [i.id for i in cfg.calculator[0].inputs] == ["s", "t"]


def test_calculator_requires_a_formula() -> None:
    with pytest.raises(ValidationError):
        CalculatorElement(id="c", formula="", inputs=[CalcInput(id="s", label="S")])


def test_calculator_requires_at_least_one_input() -> None:
    with pytest.raises(ValidationError):
        CalculatorElement(id="c", formula="s", inputs=[])


def test_calc_input_id_must_be_an_identifier() -> None:
    # The formula references inputs by id, so an id must be a safe identifier
    # (no spaces / operators) — never an injection vector regardless.
    with pytest.raises(ValidationError):
        CalcInput(id="2 s", label="bad")
    with pytest.raises(ValidationError):
        CalcInput(id="s+t", label="bad")
    assert CalcInput(id="v_0", label="ok").id == "v_0"


# --- note element (1.1.38 M4) ---------------------------------------------


def test_note_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["note"]
    assert spec.field == "note"
    assert spec.render == "workspace"


def test_note_within_cap_roundtrips() -> None:
    cfg = _config(note=[NoteElement(id="n1", title="Husk", body="**v = s / t**")])
    assert cfg.note[0].body == "**v = s / t**"


def test_note_requires_a_body() -> None:
    with pytest.raises(ValidationError):
        NoteElement(id="n", body="")


def test_note_over_cap_is_rejected() -> None:
    cap = ELEMENT_REGISTRY["note"].max_items
    notes = [NoteElement(id=f"n{i}", body="x") for i in range(cap + 1)]
    with pytest.raises(ValidationError):
        _config(note=notes)
