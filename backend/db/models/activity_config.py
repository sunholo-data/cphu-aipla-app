"""ActivityConfig — per-teacher, per-class, per-activity configuration.

Stores the teaching goal that gets injected into a skill's system prompt
at agent-instantiation time via the ``{teacher_focus}`` placeholder. See
``adk/teacher_focus.py`` for the wrapper that performs the substitution.

The doc id is the composite ``{teacher_uid}:{class_id}:{activity_id}`` so
each (teacher, class, activity) tuple has exactly one config row — saves
a query when the agent boots up.

Phase 2 scope (1.G-Ph2): LOCAL_MODE teacher stub owns one seeded demo
class. Firebase teacher auth + multi-class ownership land in Phase 3
(1.G-Ph3) — the access-control field is wired here so the swap is a
no-op in routes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Language = Literal["da", "en"]
Difficulty = Literal["standard", "guided"]

# Tutor interaction style (1.1.20). ``socratic`` is the default and the
# untouched current behaviour (no preamble injected — the SKILL.md rule
# stands). The other styles inject an override preamble that changes the
# tutor's voice for this activity. See ``adk/interaction_style.py``.
InteractionStyle = Literal["socratic", "concise", "rigorous", "warm"]


class MaterialRef(BaseModel):
    """A curriculum document cited for this activity (1.1.25 M3).

    ``doc_id`` resolves to a ``CurriculumDoc`` in the curriculum library.
    ``origin`` is cached from ``CurriculumDoc.origin`` at citation time so the
    grounding preamble can name sources without an extra Firestore read.

    ``student_visible`` (1.1.33 M2a): the teacher decides, per material, whether
    it is shown to students in the Documents workbench surface. Default **false**
    (opt-in). This governs ONLY the student-facing surface — RAG grounding always
    uses every cited material regardless of visibility.
    """

    doc_id: str = Field(alias="docId", min_length=1, max_length=200)
    origin: str = Field(default="", alias="origin", max_length=200)
    student_visible: bool = Field(default=False, alias="studentVisible")

    model_config = ConfigDict(populate_by_name=True)


class ChecklistItem(BaseModel):
    """One teacher-authored, student-tickable sub-step of an activity (M1).

    Generalises the Boldkast a/b/c/d sub-parts: ``id`` is the stable slug
    used as the storage key (must survive reloads); ``label`` is the
    display text. Mirrors the frontend ``ChecklistItem`` in
    ``ProgressChecklist.tsx``.
    """

    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=200)

    model_config = ConfigDict(populate_by_name=True)


class TableColumn(BaseModel):
    """One column of a teacher-defined data table (1.1.38 M1).

    ``unit`` (e.g. ``"s"``, ``"m/s"``) shows in the header and drives the
    units-loop the tutor already runs (1.1.21). ``kind`` gates the student
    input control: a numeric measurement field vs free text.
    """

    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=80)
    unit: str = Field(default="", max_length=24)
    kind: Literal["number", "text"] = "number"

    model_config = ConfigDict(populate_by_name=True)


class TableElement(BaseModel):
    """A teacher-defined data table the student fills in (1.1.38 M1).

    The teacher defines the columns + an empty row count; the student enters
    readings and the committed grid is pushed to the tutor via the existing
    ``iframe-context`` path (the checklist's wire). Ground-truth checking of
    entered values is the offline-lab (1.1.24) extension, NOT authored here.
    """

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=120)
    columns: list[TableColumn] = Field(min_length=1, max_length=8)
    rows: int = Field(default=5, ge=1, le=50)

    model_config = ConfigDict(populate_by_name=True)


ChartKind = Literal["scatter", "line", "bar"]


class ChartElement(BaseModel):
    """A chart that plots the activity's data table (1.1.38 M2).

    v1.1 auto-binds to the activity's data table and plots its first two
    numeric columns (x, y) — deterministic, zero LLM. Per-column selection and
    teacher-supplied static series are future extensions; keeping it auto-bound
    avoids fragile column-id coupling between the chart and table at author time.
    """

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=120)
    chart_kind: ChartKind = Field(default="scatter", alias="chartKind")

    model_config = ConfigDict(populate_by_name=True)


class CalcInput(BaseModel):
    """A named variable a calculator formula references (1.1.38 M3).

    ``id`` is the variable name used in the formula (a simple identifier);
    ``label`` is the student-facing display; ``unit`` is shown beside the field.
    """

    id: str = Field(min_length=1, max_length=24, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    label: str = Field(min_length=1, max_length=80)
    unit: str = Field(default="", max_length=24)

    model_config = ConfigDict(populate_by_name=True)


class CalculatorElement(BaseModel):
    """A teacher-authored formula calculator the student uses (1.1.38 M3).

    The teacher writes a ``formula`` (e.g. ``"s / t"``) over named ``inputs``;
    the student enters values and the result is computed **client-side** by a
    whitelisted safe-expression evaluator (no ``eval`` — Axiom 9). The backend
    only stores the bounded formula string; it never evaluates it, so the
    formula text is inert data here.
    """

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=120)
    formula: str = Field(min_length=1, max_length=200)
    inputs: list[CalcInput] = Field(min_length=1, max_length=8)

    model_config = ConfigDict(populate_by_name=True)


class NoteElement(BaseModel):
    """A teacher-authored reference / instructions note (1.1.38 M4).

    A Markdown ``body`` rendered read-only in the workspace — instructions, a
    formula reference, a definition. This is the architecture's "instructions /
    formula references are AIPLA's job" element; it is distinct from uploaded
    curriculum ``materials`` (which are files surfaced in the Documents tab).
    """

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=120)
    body: str = Field(min_length=1, max_length=4000)

    model_config = ConfigDict(populate_by_name=True)


# Workbench type system (1.J expanded-workbench-types). ``none`` is a
# first-class, no-simulator activity (chat-only Socratic dialogue, the
# v1.1 teacher-authoring headline). ``app`` is a paired MCP-App sim.
WorkbenchType = Literal["app", "drawing", "sensor", "video", "notebook", "none"]


# ---------------------------------------------------------------------------
# Activity element registry (1.1.38 M0)
# ---------------------------------------------------------------------------
# The *platform element* layer — the composable things a teacher layers on top
# of any workbench type (checklist, and later data table / chart / calculator /
# document). This registry is the single source of truth for *which element
# kinds exist* and their bounds, so adding the next element is a registry entry
# + a Pydantic model + a frontend renderer/editor, not a schema rewrite.
#
# The recipe to add element N is documented in
# docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md. The frontend
# mirror lives in frontend/src/lib/activityElements.ts (kept in lock-step via
# the consistency tests on both ends).
#
# v1.1 ships the ``checklist`` (M0) + ``table`` (M1) + ``chart`` (M2) +
# ``calculator`` (M3) + ``note`` (M4 — the teacher-authored instructions /
# reference element). ``quiz`` (inline, A2UI) joins when 1.1.19 M2 builds it.
ElementKind = Literal["checklist", "table", "chart", "calculator", "note"]
ElementRender = Literal["workspace", "inline"]


@dataclass(frozen=True)
class ElementSpec:
    """Registry descriptor for one teacher-authorable activity element.

    ``field`` names the ``ActivityConfig`` field that stores this kind;
    ``max_items`` is the registry-enforced cap (rejects oversized / malformed
    input before persistence or render — 1.1.38 Security: bounded sizes);
    ``render`` is where the element shows (``workspace`` pane vs ``inline``
    A2UI chat card).
    """

    kind: ElementKind
    field: str
    max_items: int
    render: ElementRender


ELEMENT_REGISTRY: dict[ElementKind, ElementSpec] = {
    "checklist": ElementSpec(kind="checklist", field="checklist", max_items=50, render="workspace"),
    # ``max_items`` caps the NUMBER of tables on an activity; per-table column /
    # row bounds live on ``TableElement`` itself.
    "table": ElementSpec(kind="table", field="table", max_items=5, render="workspace"),
    "chart": ElementSpec(kind="chart", field="chart", max_items=5, render="workspace"),
    "calculator": ElementSpec(kind="calculator", field="calculator", max_items=5, render="workspace"),
    "note": ElementSpec(kind="note", field="note", max_items=5, render="workspace"),
}


class ActivityConfig(BaseModel):
    """Firestore document at ``activity_configs/{teacher_uid}:{class_id}:{activity_id}``.

    All fields are camelCased in Firestore (consistent with the rest of
    the v6 store). The Pydantic model accepts either casing because
    ``populate_by_name=True``.
    """

    activity_id: str = Field(alias="activityId")
    class_id: str = Field(alias="classId")
    teacher_uid: str = Field(alias="teacherUid")
    title: str = Field(default="", alias="title", max_length=200)
    teaching_goal: str = Field(default="", alias="teachingGoal", max_length=2000)
    language: Language = "da"
    difficulty: Difficulty = "standard"
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")
    # Persona (1.1.12): the named character picked for this activity. Records
    # provenance + drives the student-facing avatar/name display; the tied
    # configs (interaction_style above) are set from it at author time.
    persona: str | None = Field(default=None, max_length=64)
    paired_workbench: str | None = Field(default=None, alias="pairedWorkbench")
    workbench_type: WorkbenchType = Field(default="none", alias="workbenchType")
    source_activity_id: str | None = Field(default=None, alias="sourceActivityId")
    checklist: list[ChecklistItem] = Field(default_factory=list)
    # Teacher-defined data tables the student fills in (1.1.38 M1). Capped at
    # ELEMENT_REGISTRY["table"].max_items by the element-cap validator below.
    table: list[TableElement] = Field(default_factory=list)
    # Charts plotting the activity's data table (1.1.38 M2).
    chart: list[ChartElement] = Field(default_factory=list)
    # Formula calculators the student uses (1.1.38 M3). The formula string is
    # inert here — evaluated only client-side by a safe parser (no eval).
    calculator: list[CalculatorElement] = Field(default_factory=list)
    # Teacher-authored instructions / reference notes (1.1.38 M4), Markdown body.
    note: list[NoteElement] = Field(default_factory=list)
    # Curriculum documents cited for this activity (1.1.25 M3). The tutor
    # retrieval tool is scoped to ONLY these docs (student deny-by-default).
    materials: list[MaterialRef] = Field(default_factory=list)
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _backfill_workbench_type(self) -> ActivityConfig:
        """Legacy rows (written before TAA-1) have ``paired_workbench`` set
        but no ``workbench_type``. Resolve those to ``app`` so a Boldkast /
        LED-Planck / KineBot config keeps rendering its sim. An explicitly
        chosen type is never overridden.
        """
        if self.workbench_type == "none" and self.paired_workbench:
            self.workbench_type = "app"
        return self

    @model_validator(mode="after")
    def _enforce_element_caps(self) -> ActivityConfig:
        """Reject configs whose element lists exceed the registry cap (1.1.38).

        ``ELEMENT_REGISTRY`` is the single place element bounds live; enforcing
        them on the model keeps a malformed / oversized payload from being
        persisted or rendered. Caps are generous (a real activity never nears
        them) so this is a guard against absurd input, not a behaviour change.
        """
        for spec in ELEMENT_REGISTRY.values():
            value = getattr(self, spec.field, None)
            if isinstance(value, list) and len(value) > spec.max_items:
                raise ValueError(f"{spec.field} has {len(value)} items, exceeds the maximum of {spec.max_items}")
        return self

    @staticmethod
    def doc_id(teacher_uid: str, class_id: str, activity_id: str) -> str:
        """Composite Firestore document id."""
        return f"{teacher_uid}:{class_id}:{activity_id}"

    @property
    def owner_id(self) -> str:
        """Satisfies the ``_HasAccess`` protocol used elsewhere."""
        return self.teacher_uid


__all__ = [
    "ELEMENT_REGISTRY",
    "ActivityConfig",
    "CalcInput",
    "CalculatorElement",
    "ChartElement",
    "ChartKind",
    "ChecklistItem",
    "Difficulty",
    "ElementKind",
    "ElementRender",
    "ElementSpec",
    "InteractionStyle",
    "Language",
    "MaterialRef",
    "NoteElement",
    "TableColumn",
    "TableElement",
    "WorkbenchType",
]
