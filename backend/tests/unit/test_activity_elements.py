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
    DocumentElement,
    NoteElement,
    SolutionElement,
    TableColumn,
    TableElement,
    WritingElement,
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


def test_every_element_field_is_present_on_all_activity_models() -> None:
    """A new element must be threaded through ALL THREE activity stores, not just
    ActivityConfig: the ALS-1 split added a class-independent ``Activity`` + its
    ``ActivityUpsert`` request body, both ``extra="forbid"``. Missing the field on
    ActivityUpsert → the builder's ``document: []`` 422s with extra_forbidden
    (the 1.1.48 document regression). This guards the whole surface at once."""
    from db.models.activity import Activity
    from protocols.activity_routes import ActivityUpsert

    for spec in ELEMENT_REGISTRY.values():
        for model in (ActivityConfig, Activity, ActivityUpsert):
            assert spec.field in model.model_fields, f"{model.__name__} missing element field {spec.field!r}"


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


# --- sim artefact reference (1.1.41 M1) -----------------------------------


def test_artefact_id_resolves_workbench_type_to_app() -> None:
    cfg = _config(artefactId="boldkast")
    assert cfg.artefact_id == "boldkast"
    assert cfg.workbench_type == "app"  # backfilled


def test_no_artefact_keeps_workbench_none() -> None:
    assert _config().workbench_type == "none"
    assert _config().artefact_id is None


def test_explicit_workbench_type_not_overridden_by_artefact() -> None:
    cfg = _config(artefactId="boldkast", workbenchType="notebook")
    assert cfg.workbench_type == "notebook"


# --- solution editor element (1.1.45 M4, JB-2) ---


def test_solution_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["solution"]
    assert spec.field == "solution"
    assert spec.render == "workspace"
    # One solution editor per activity — the student's writing is session state.
    assert spec.max_items == 1


def test_solution_within_cap_roundtrips() -> None:
    cfg = _config(solution=[SolutionElement(id="sol-1", prompt="Solve problem 3")])
    assert len(cfg.solution) == 1
    assert cfg.solution[0].prompt == "Solve problem 3"


def test_solution_over_cap_is_rejected() -> None:
    with pytest.raises(ValidationError):
        _config(solution=[SolutionElement(id=f"s{i}", prompt="") for i in range(2)])


# --- document element + legacy workbench_type migration (1.1.48) ---


def test_document_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["document"]
    assert spec.field == "document"
    assert spec.render == "workspace"
    assert spec.max_items == 1


def test_document_within_cap_roundtrips() -> None:
    cfg = _config(document=[DocumentElement(id="document-1", prompt="Upload your worksheet")])
    assert len(cfg.document) == 1
    assert cfg.document[0].prompt == "Upload your worksheet"


def test_legacy_workbench_type_document_migrates_to_an_element() -> None:
    # Old document-feedback activities picked workbenchType="document"; that mode
    # is reconciled (1.1.48) to a composable document element + a neutral type.
    cfg = _config(workbenchType="document")
    assert cfg.workbench_type == "none"
    assert len(cfg.document) == 1
    assert cfg.document[0].id == "document-1"


def test_migration_does_not_clobber_an_explicit_document_element() -> None:
    cfg = _config(
        workbenchType="document",
        document=[DocumentElement(id="d-keep", prompt="keep me")],
    )
    assert cfg.workbench_type == "none"
    assert [d.id for d in cfg.document] == ["d-keep"]


# --- writing element (1.1.73) ---------------------------------------------


def test_writing_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["writing"]
    assert spec.field == "writing"
    assert spec.render == "workspace"
    # NOT a singleton, deliberately: a lab report wanting both a "method" and a
    # "conclusion" box is the obvious first ask, and 1.1.71 is the second time a
    # positional singleton had to be un-picked at the cost of re-minting ids that
    # student data is keyed by.
    assert spec.max_items == 3


def test_writing_within_cap_roundtrips() -> None:
    cfg = _config(
        writing=[
            WritingElement(id="writing-1", title="Konklusion", prompt="Skriv din konklusion", minWords=150),
            WritingElement(id="writing-2", title="Metode"),
        ]
    )
    assert [w.id for w in cfg.writing] == ["writing-1", "writing-2"]
    assert cfg.writing[0].min_words == 150
    # The default bound is the store's ceiling, so an element authored with no
    # explicit cap still cannot be used to write an unbounded document.
    assert cfg.writing[1].max_chars == 20000


def test_writing_over_cap_is_rejected() -> None:
    cap = ELEMENT_REGISTRY["writing"].max_items
    with pytest.raises(ValidationError):
        _config(writing=[WritingElement(id=f"w{i}") for i in range(cap + 1)])


def test_writing_bounds_are_enforced() -> None:
    with pytest.raises(ValidationError):
        WritingElement(id="w1", maxChars=999999)
    with pytest.raises(ValidationError):
        WritingElement(id="w1", minWords=-1)
    with pytest.raises(ValidationError):
        WritingElement(id="w1", title="x" * 200)


def test_writing_needs_no_authoring_to_be_valid() -> None:
    """A teacher who adds the element and types nothing still gets a usable box —
    the prompt is the empty state, not a required field."""
    w = WritingElement(id="writing-1")
    assert w.prompt == ""
    assert w.min_words == 0


# --- Every hand-enumeration of the element set, machine-checked --------------
#
# The registry exists so "which element kinds exist" has ONE source. But several
# places still SPELL OUT the element fields — a Pydantic model, a function
# signature, a response dict — and a spelled-out list goes stale in silence.
# `writing` (1.1.73) and `conceptMap` (CONCEPT-1) were both saved correctly and
# both invisible to students because ONE such list was never updated.
#
# The rule these tests encode: an element field may be enumerated by hand, but
# never unchecked.


def test_every_element_kind_is_accepted_by_the_legacy_upsert() -> None:
    """`upsert_activity_config` takes one keyword per element kind.

    It was missing BOTH `writing` and `concept_map`, so the legacy per-class
    path silently dropped them on save.
    """
    import inspect

    from db.activity_configs import upsert_activity_config

    params = set(inspect.signature(upsert_activity_config).parameters)
    for spec in ELEMENT_REGISTRY.values():
        assert spec.field in params, (
            f"upsert_activity_config cannot accept element kind {spec.kind!r} "
            f"(expected a {spec.field!r} keyword) — it will be dropped on save"
        )


def test_every_element_kind_survives_the_legacy_upsert_round_trip(monkeypatch) -> None:
    """Accepting the keyword is not the same as storing it."""
    from db import firestore as fs_module
    from db.activity_configs import get_activity_config, upsert_activity_config

    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    try:
        cfg = upsert_activity_config(
            teacher_uid="t",
            class_id="c",
            activity_id="a",
            teaching_goal="g",
            writing=[WritingElement(id="w1", title="Konklusion")],
        )
        assert [w.id for w in cfg.writing] == ["w1"]
        stored = get_activity_config(teacher_uid="t", class_id="c", activity_id="a")
        assert stored is not None
        assert [w.id for w in stored.writing] == ["w1"], "accepted, then dropped on the way to Firestore"
    finally:
        fs_module._reset_client_for_testing()
