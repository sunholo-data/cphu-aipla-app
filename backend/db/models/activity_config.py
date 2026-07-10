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

from db.models.curriculum import StxLevel

Language = Literal["da", "en"]
Difficulty = Literal["standard", "guided"]

# Tutor interaction style (1.1.20). ``socratic`` is the default and the
# untouched current behaviour (no preamble injected — the SKILL.md rule
# stands). The other styles inject an override preamble that changes the
# tutor's voice for this activity. See ``adk/interaction_style.py``.
InteractionStyle = Literal["socratic", "concise", "rigorous", "warm"]


class MaterialRef(BaseModel):
    """A resource cited for this activity.

    Two kinds (``kind`` discriminator; legacy rows have no ``kind`` → curriculum):

    ``kind="curriculum"`` (1.1.25 M3) — a ``CurriculumDoc`` in the RAG library.
      ``doc_id`` resolves to the doc; ``origin`` is cached from ``CurriculumDoc.origin``
      at citation time so the grounding preamble can name sources without an extra
      Firestore read. The tutor reaches it via ``build_curriculum_retrieval_tool``.

    ``kind="image"`` (1.1.44) — a teacher-attached image the tutor SEES multimodally
      (a diagram/graph/photographed worksheet). ``material_id`` + ``mime_type``
      identify the bytes in the activity artifact slot (``adk/activity_images.py``);
      a session-start loader copies it into the student session and an injector
      inlines it as an image Part. ``alt`` is a short label shown to the tutor.

    ``student_visible`` (1.1.33 M2a): the teacher decides, per material, whether it is
    shown to students in the Documents workbench surface. Default **false** (opt-in).
    This governs ONLY the student-facing surface — RAG grounding always uses every
    cited curriculum material, and the tutor always sees every image material,
    regardless of visibility.
    """

    kind: Literal["curriculum", "image"] = "curriculum"
    # curriculum
    doc_id: str = Field(default="", alias="docId", max_length=200)
    origin: str = Field(default="", alias="origin", max_length=200)
    # image (1.1.44)
    material_id: str = Field(default="", alias="materialId", max_length=64)
    mime_type: str = Field(default="", alias="mimeType", max_length=40)
    alt: str = Field(default="", alias="alt", max_length=300)
    # both
    student_visible: bool = Field(default=False, alias="studentVisible")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _require_id_for_kind(self) -> MaterialRef:
        if self.kind == "curriculum" and not self.doc_id:
            raise ValueError("curriculum material requires docId")
        if self.kind == "image" and not self.material_id:
            raise ValueError("image material requires materialId")
        return self


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


class SolutionElement(BaseModel):
    """A teacher-authored rich-text solution-editor element (1.1.45 M4, JB-2).

    The teacher authors only the ``prompt`` ("Write your solution to…"); the
    *student* writes the answer in the TipTap editor on the workbench. The
    student's submission is session state (pushed to the tutor over the
    ``iframe-context`` wire, the same path the data table uses) — NOT stored on
    the activity config. The tutor critiques it via the solution feedback prompt.
    """

    id: str = Field(min_length=1, max_length=64)
    prompt: str = Field(default="", max_length=2000)

    model_config = ConfigDict(populate_by_name=True)


class DocumentElement(BaseModel):
    """A document-upload element (1.1.45 M3b → reconciled 1.1.48, JB-1 "din fil").

    The student uploads their own file(s) and the tutor critiques the active one
    (the StudentDocumentWorkbench surface). The teacher authors only the
    ``prompt`` ("Upload your worksheet…"); the files are the student's own
    group-owned ``parsed_documents``, not stored here. **Reconciled from the
    legacy ``workbench_type="document"`` MODE into a composable element** so a
    document activity can also carry a checklist / note / other elements.
    """

    id: str = Field(min_length=1, max_length=64)
    prompt: str = Field(default="", max_length=2000)

    model_config = ConfigDict(populate_by_name=True)


class QuizOption(BaseModel):
    """One answer option of a check question (the 1.1.19 ``QuizItem`` shape).

    ``correct`` never reaches a *student-facing payload* in the 1.1.19 form-quiz
    design (Axiom 10). In the chat-native checkpoint flow the whole question set
    travels only to the MODEL via the ``run_checkpoint`` tool result — see the
    Axiom-10 note on ``CheckQuestion``.
    """

    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=200)
    correct: bool = False

    model_config = ConfigDict(populate_by_name=True)


class CheckQuestion(BaseModel):
    """A node-bound check question for a chat-native checkpoint (living-concept-map).

    Reuses the 1.1.19 ``QuizItem`` shape (prompt / options / explanation) plus an
    ``expected_answer`` the tutor judges free-text answers against. ``options``
    are OPTIONAL — the general principle (M, 2026-07-10) is that student
    assessment is chat-native: the tutor asks in its own voice, so most check
    questions are just prompt + expected answer. A non-empty ``options`` list
    needs 2-6 entries (the 1.1.19 bound).

    Axiom-10 note: ``expected_answer`` (and any ``correct`` flags) are judging
    material for the MODEL, delivered via the ``run_checkpoint`` tool result —
    they ride the session stream, which a determined student could inspect.
    Accepted for the formative dev demo; strip tool-result payloads from
    student-visible frames before pilot (tracked in concept-map-sprint.md risks).
    """

    id: str = Field(min_length=1, max_length=64)
    prompt: str = Field(min_length=1, max_length=500)
    options: list[QuizOption] = Field(default_factory=list, max_length=6)
    expected_answer: str = Field(default="", alias="expectedAnswer", max_length=1000)
    explanation: str = Field(default="", max_length=1000)

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _options_bound(self) -> CheckQuestion:
        if self.options and len(self.options) < 2:
            raise ValueError("options, when given, need at least 2 entries (1.1.19 QuizItem bound)")
        return self


class ConceptNode(BaseModel):
    """One concept in the activity's prerequisite graph (living-concept-map M0).

    ``id`` is a stable slug (survives relabels — edges and check-off state key on
    it); ``level`` is the optional stx A/B/C tag; ``dra`` links the node to a DRA
    map entry (1.K). ``check_questions`` power the chat-native checkpoint.
    """

    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    level: StxLevel | None = None
    dra: str | None = Field(default=None, max_length=64)
    check_questions: list[CheckQuestion] = Field(default_factory=list, alias="checkQuestions", max_length=5)

    model_config = ConfigDict(populate_by_name=True)


class ConceptEdge(BaseModel):
    """A prerequisite edge: ``from`` must be demonstrated before ``to``.

    ``from`` is a Python keyword, hence the ``from_`` field + alias (the design
    doc's wire shape is ``{"from": ..., "to": ...}``).
    """

    from_: str = Field(alias="from", min_length=1, max_length=64)
    to: str = Field(min_length=1, max_length=64)
    kind: Literal["prerequisite"] = "prerequisite"

    model_config = ConfigDict(populate_by_name=True)


class ConceptMapElement(BaseModel):
    """The teacher-authored living concept map (living-concept-map M0).

    A prerequisite DAG over the activity's concepts. A *list* rendering is a
    projection of this same data (nodes in topological/teacher order) — one data
    shape, two view modes. Cycle-guarded: prerequisite edges must form a DAG, so
    a student always has a well-defined "what's next".
    """

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=120)
    nodes: list[ConceptNode] = Field(default_factory=list, max_length=30)
    edges: list[ConceptEdge] = Field(default_factory=list, max_length=60)

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _validate_graph(self) -> ConceptMapElement:
        ids = [n.id for n in self.nodes]
        id_set = set(ids)
        if len(ids) != len(id_set):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            raise ValueError(f"duplicate node ids: {dupes}")
        for e in self.edges:
            if e.from_ == e.to:
                raise ValueError(f"edge from {e.from_!r} to itself forms a cycle")
            unknown = {e.from_, e.to} - id_set
            if unknown:
                raise ValueError(f"edge references unknown node ids: {sorted(unknown)}")
        # Kahn's algorithm — reject any cycle (prerequisites must be a DAG).
        indegree = dict.fromkeys(id_set, 0)
        for e in self.edges:
            indegree[e.to] += 1
        queue = [nid for nid, deg in indegree.items() if deg == 0]
        seen = 0
        while queue:
            nid = queue.pop()
            seen += 1
            for e in self.edges:
                if e.from_ == nid:
                    indegree[e.to] -= 1
                    if indegree[e.to] == 0:
                        queue.append(e.to)
        if seen != len(id_set):
            raise ValueError("prerequisite edges contain a cycle — the concept map must be a DAG")
        return self


# Workbench type system (1.J expanded-workbench-types). ``none`` is a
# first-class, no-simulator activity (chat-only Socratic dialogue, the
# v1.1 teacher-authoring headline). ``app`` is a paired MCP-App sim.
# ``document`` (1.1.45 M3b) is DEPRECATED (1.1.48): document-feedback is now a
# composable ``document`` *element*, not an activity mode. The literal value is
# kept only so legacy Firestore rows load; ``_migrate_document_workbench`` below
# normalises any such row to a document element + ``workbench_type="none"``. New
# configs never set it. ``workbench_type`` now means only the runtime surface
# (``app`` = sim iframe, ``none`` = standard element workspace).
WorkbenchType = Literal["app", "drawing", "sensor", "video", "notebook", "document", "none"]


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
ElementKind = Literal["checklist", "table", "chart", "calculator", "note", "solution", "document", "conceptMap"]
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
    # One rich-text solution editor per activity (JB-2 "din løsning"); the
    # student's writing is session state, not config — so the cap is on the
    # number of editor surfaces, which is 1.
    "solution": ElementSpec(kind="solution", field="solution", max_items=1, render="workspace"),
    # One document-upload surface per activity (JB-1 "din fil"); reconciled from
    # the legacy workbench_type="document" mode (1.1.48).
    "document": ElementSpec(kind="document", field="document", max_items=1, render="workspace"),
    # One living concept map per activity (living-concept-map M0) — the
    # prerequisite DAG the tutor checks off in-session. Per-map node/edge
    # bounds live on ``ConceptMapElement`` itself.
    "conceptMap": ElementSpec(kind="conceptMap", field="concept_map", max_items=1, render="workspace"),
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
    # The vetted MCP-App artefact this activity hosts (1.1.41). When set, the
    # workspace mounts that artefact and ``workbench_type`` resolves to ``app``.
    # The SAME artefact appears in many activities with different goals + 1.1.38
    # elements; validated against the catalogue at the route layer (bounded enum).
    artefact_id: str | None = Field(default=None, alias="artefactId", max_length=64)
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
    # Rich-text solution editor (1.1.45 M4, JB-2). Teacher authors the prompt;
    # the student's writing is session state (iframe-context), not stored here.
    solution: list[SolutionElement] = Field(default_factory=list)
    # Document-upload element (1.1.48 — reconciled from workbench_type="document").
    document: list[DocumentElement] = Field(default_factory=list)
    # The living concept map (living-concept-map M0) — prerequisite DAG +
    # per-node check questions; the in-session check-off keys on its node ids.
    concept_map: list[ConceptMapElement] = Field(default_factory=list, alias="conceptMap")
    # Curriculum documents cited for this activity (1.1.25 M3). The tutor
    # retrieval tool is scoped to ONLY these docs (student deny-by-default).
    materials: list[MaterialRef] = Field(default_factory=list)
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _backfill_workbench_type(self) -> ActivityConfig:
        """Resolve ``workbench_type`` to ``app`` when the activity hosts a sim.

        Legacy rows (pre-TAA-1) carry ``paired_workbench``; new rows (1.1.41)
        carry ``artefact_id``. Either implies an ``app`` workbench. An explicitly
        chosen type is never overridden.
        """
        if self.workbench_type == "none" and (self.paired_workbench or self.artefact_id):
            self.workbench_type = "app"
        return self

    @model_validator(mode="after")
    def _migrate_document_workbench(self) -> ActivityConfig:
        """Reconcile the legacy ``workbench_type="document"`` MODE into a composable
        ``document`` element (1.1.48). Old configs picked a document-feedback
        *activity type* that pre-empted the workspace; the upload surface is now an
        element like any other. Normalise any such row to a document element + a
        neutral ``workbench_type`` so the element registry drives rendering. New
        configs never set "document". Runs before the cap check below.
        """
        if self.workbench_type == "document":
            if not self.document:
                self.document = [DocumentElement(id="document-1", prompt="")]
            self.workbench_type = "none"
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
    "CheckQuestion",
    "ChecklistItem",
    "ConceptEdge",
    "ConceptMapElement",
    "ConceptNode",
    "Difficulty",
    "ElementKind",
    "ElementRender",
    "ElementSpec",
    "InteractionStyle",
    "Language",
    "MaterialRef",
    "NoteElement",
    "QuizOption",
    "TableColumn",
    "TableElement",
    "WorkbenchType",
]
