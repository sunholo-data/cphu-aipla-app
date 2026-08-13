"""Activity-config REST endpoints.

Each (teacher, class, activity) tuple has exactly one config doc;
``ActivityConfig.doc_id()`` is the deterministic Firestore key. The
teacher_uid in the URL must match the authenticated user — Phase 2's
ownership model is "you own your own configs". Phase 3 swaps this for
the Class-entity ownership check from 1.A.

The save flow is "upsert" — POST and PATCH both call the same
``upsert_activity_config`` helper. We expose both verbs so future
consumers can pick the one that matches their semantics (POST = "I'm
creating a config", PATCH = "I'm tweaking an existing one") without
the backend having to maintain two write paths.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field

from adk.element_manifest import describe_elements
from adk.teacher_focus import build_ilo_precedence_block, compose_teacher_focus, resolve_active_config
from artefacts.loader import is_known_artefact, load_artefact
from auth import User, get_current_user
from db.activity_configs import (
    delete_activity_config,
    get_activity_config,
    list_activity_configs,
    upsert_activity_config,
)
from db.classes import get_class_for_group
from db.models.activity_config import (
    ELEMENT_REGISTRY,
    ActivityConfig,
    CalculatorElement,
    ChartElement,
    ChecklistItem,
    Difficulty,
    DocumentElement,
    InteractionStyle,
    Language,
    MaterialRef,
    NoteElement,
    SolutionElement,
    TableElement,
    WorkbenchType,
)
from personas.loader import resolve_persona_chain

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activity-configs", tags=["activity-config"])

# Teacher-authored activities get a minted id under this namespace so they
# never collide with platform-seeded skill ids (``boldkast``, ``led-planck``…).
_MINT_PREFIX = "teacher:"


def _mint_activity_id() -> str:
    """Mint a fresh teacher-namespaced activity id (TAA-1 M0.2)."""
    return f"{_MINT_PREFIX}{secrets.token_hex(6)}"


class ActivityConfigUpsert(BaseModel):
    """Body shape for ``POST /api/activity-configs`` and
    ``PATCH /api/activity-configs/{teacher_uid}/{class_id}/{activity_id}``.

    ``activity_id`` is optional on POST — when omitted the backend mints a
    teacher-namespaced id (a from-scratch teacher-authored activity).
    """

    activity_id: str | None = Field(default=None, alias="activityId", max_length=128)
    # Day-0 overwrite guard (ALS-1 M0.5-guard): the create page sets this so a
    # SECOND create of the same (teacher, class, activity) is refused (409)
    # rather than silently overwriting the first activity. The edit page leaves
    # it false, preserving the idempotent upsert. Retired once M0 mints distinct
    # ids (no collision possible), but cheap insurance for the live pilot until then.
    create_only: bool = Field(default=False, alias="createOnly")
    class_id: str = Field(alias="classId", min_length=1, max_length=128)
    title: str = Field(default="", alias="title", max_length=200)
    teaching_goal: str = Field(alias="teachingGoal", max_length=2000)
    language: Language = "da"
    difficulty: Difficulty = "standard"
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")
    persona: str | None = Field(default=None, max_length=64)
    paired_workbench: str | None = Field(default=None, alias="pairedWorkbench")
    workbench_type: WorkbenchType = Field(default="none", alias="workbenchType")
    # The vetted artefact this activity hosts (1.1.41) — validated against the
    # catalogue below (a bounded enum, never free input).
    artefact_id: str | None = Field(default=None, alias="artefactId", max_length=64)
    checklist: list[ChecklistItem] = Field(default_factory=list)
    # Teacher-defined data tables the student fills in (1.1.38 M1).
    table: list[TableElement] = Field(default_factory=list)
    # Charts plotting the activity's data table (1.1.38 M2).
    chart: list[ChartElement] = Field(default_factory=list)
    # Formula calculators the student uses (1.1.38 M3).
    calculator: list[CalculatorElement] = Field(default_factory=list)
    # Teacher-authored instructions / reference notes (1.1.38 M4).
    note: list[NoteElement] = Field(default_factory=list)
    # Rich-text solution editor (1.1.45 M4, JB-2).
    solution: list[SolutionElement] = Field(default_factory=list)
    # Document-upload element (1.1.48 — reconciled from workbench_type="document").
    document: list[DocumentElement] = Field(default_factory=list)
    # Curriculum documents cited for this activity (1.1.25 M4). The tutor
    # retrieval tool is scoped to ONLY these docs (student deny-by-default).
    materials: list[MaterialRef] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


def _serialize(cfg: ActivityConfig) -> dict:
    """Return the canonical wire shape (camelCase keys for the frontend)."""
    return cfg.model_dump(by_alias=True, mode="json")


def _assert_owns(user: User, teacher_uid: str) -> None:
    if user.uid != teacher_uid:
        raise HTTPException(status_code=403, detail="teacher_uid mismatch")


def _assert_known_artefact(artefact_id: str | None) -> None:
    """Reject an unknown artefact reference (1.1.41) — the catalogue is the
    vetting gate, so only a catalogued artefact id may be attached."""
    if artefact_id and not is_known_artefact(artefact_id):
        raise HTTPException(status_code=400, detail=f"unknown artefact: {artefact_id}")


def _assert_chart_bindings(body: ActivityConfigUpsert) -> None:
    """Reject a chart bound to a table or column that does not exist (1.1.64).

    Validated at WRITE time, where we can still tell the teacher. A chart whose
    column is deleted AFTERWARDS must still LOAD — that degrades at render with
    a visible note (``resolveChartBinding``), because refusing to load an
    activity over a stale chart reference would brick the whole lesson.
    """
    tables = {t.id: t for t in body.table}
    for chart in body.chart:
        if chart.table_id and chart.table_id not in tables:
            raise HTTPException(
                status_code=400,
                detail=f"chart {chart.id!r} references unknown table {chart.table_id!r}",
            )
        table = tables.get(chart.table_id) if chart.table_id else None
        if table is None:
            continue
        numeric = {c.id for c in table.columns if (c.kind or "number") == "number"}
        for axis, col in (("xColumn", chart.x_column), ("yColumn", chart.y_column)):
            if col and col not in numeric:
                raise HTTPException(
                    status_code=400,
                    detail=(f"chart {chart.id!r} {axis} {col!r} is not a numeric column of table {table.id!r}"),
                )


def _resolve_artefact(artefact_id: str | None) -> dict | None:
    """Resolve an activity's artefact reference to its public catalogue view
    (no ``tutorBlock``), or None if unset / de-catalogued."""
    if not artefact_id:
        return None
    a = load_artefact(artefact_id)
    return a.public() if a is not None else None


@router.post("", status_code=201)
async def post_activity_config(
    body: ActivityConfigUpsert,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Create or overwrite the activity config for the current teacher.

    Idempotent — re-POSTing with the same (class_id, activity_id)
    updates the existing doc in place and returns 201 either way. When
    ``activityId`` is omitted, a teacher-namespaced id is minted (a
    from-scratch teacher-authored activity).
    """
    _assert_known_artefact(body.artefact_id)
    _assert_chart_bindings(body)
    activity_id = body.activity_id or _mint_activity_id()
    # Day-0 overwrite guard (ALS-1 M0.5-guard). Today the create page sends the
    # shared concept-dialogue skill id for every concept activity, so a second
    # create would upsert onto — and silently destroy — the first. When the
    # caller declares create intent, refuse to clobber an existing doc.
    if body.create_only and get_activity_config(teacher_uid=user.uid, class_id=body.class_id, activity_id=activity_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "An activity already exists for this class. Editing the existing "
                "activity is the current limit — saving here would overwrite it. "
                "Multiple activities per class is landing shortly (ALS-1 M0)."
            ),
        )
    cfg = upsert_activity_config(
        teacher_uid=user.uid,
        class_id=body.class_id,
        activity_id=activity_id,
        title=body.title,
        teaching_goal=body.teaching_goal,
        language=body.language,
        difficulty=body.difficulty,
        interaction_style=body.interaction_style,
        persona=body.persona,
        paired_workbench=body.paired_workbench,
        workbench_type=body.workbench_type,
        artefact_id=body.artefact_id,
        checklist=body.checklist,
        table=body.table,
        chart=body.chart,
        calculator=body.calculator,
        note=body.note,
        solution=body.solution,
        document=body.document,
        materials=body.materials,
    )
    log.info(
        "activity_config upsert teacher=%s class=%s activity=%s",
        user.uid,
        body.class_id,
        activity_id,
    )
    return _serialize(cfg)


@router.get("")
async def list_my_activity_configs(
    class_id: str | None = Query(default=None, alias="classId"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> list[dict]:
    """List the current teacher's activities, optionally scoped to one class.

    Teacher-scoped by construction — never returns another teacher's
    activities. Backs ``aiplatform activity list`` and the builder index.
    """
    cfgs = list_activity_configs(teacher_uid=user.uid, class_id=class_id)
    return [_serialize(c) for c in cfgs]


def _element_block(cfg: ActivityConfig | None) -> dict[str, Any]:
    """Every registered element kind, keyed by its WIRE name.

    Registry-driven, and that is the whole point. This response used to
    hand-enumerate the element fields, and a hand-written enumeration goes stale
    silently: `writing` (1.1.73) and `conceptMap` (CONCEPT-1) were both saved
    correctly, both rendered correctly by the client, and both invisible to every
    student, because neither was ever added to the dict literal here.

    The frontend half of the same contract never had this bug, because
    `ElementRenderContext` is a `Record<ElementKind, …>` and the compiler refuses
    a missing key. This is the server-side equivalent: iterate the registry, and
    a new element kind is carried by construction.

    Keys use the model's ALIAS (`concept_map` -> `conceptMap`), which is what the
    client reads.
    """
    block: dict[str, Any] = {}
    for spec in ELEMENT_REGISTRY.values():
        field = ActivityConfig.model_fields[spec.field]
        key = field.alias or spec.field
        items = getattr(cfg, spec.field, None) or [] if cfg is not None else []
        block[key] = [i.model_dump(by_alias=True) for i in items]
    return block


@router.get("/active/{activity_id}")
async def get_active_activity_config(
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Student-facing: resolve THIS student's active config for an activity.

    Resolves the (teacher, class) tuple from the student's verified
    group→class binding (same path as teacher_focus injection, M1.2 +
    Phase 3) and returns the teacher-authored surface the student needs —
    currently the progress checklist + title. Empty checklist when no
    config is set, so the workspace simply renders nothing extra.
    """
    cfg = resolve_active_config(activity_id, group_tags=user.group_tags)
    # Resolve the persona (1.1.12) for the student-facing chat avatar/name.
    # Chain: activity persona > THIS class's default persona > global default —
    # so the chat always shows a real educator avatar + name, and a teacher can
    # set the identity once at the class level. An explicit activity persona wins.
    cls = get_class_for_group(getattr(user, "group_id", None))
    class_persona = cls.persona if cls is not None else None
    p = resolve_persona_chain(cfg.persona if cfg is not None else None, class_persona)
    persona_block = {"id": p.id, "name": p.name, "title": p.title, "avatar": p.avatar} if p is not None else None
    if cfg is None:
        return {
            "activityId": activity_id,
            "title": "",
            **_element_block(None),
            "artefact": None,
            "workbenchType": "none",
            "persona": persona_block,
            "materials": [],
        }
    # 1.1.33 M2b: surface ALL of the activity's materials (names-always) with a
    # studentVisible flag. The Documents workbench shows every source name (so
    # "what is this grounded in?" is debuggable / transparent); the flag gates
    # whether the student can OPEN the content, not whether the name shows.
    # RAG grounding is unaffected — it uses every cited material regardless.
    # 1.1.44: image materials carry kind/materialId/mimeType/alt so the student
    # Documents surface can fetch + render the picture (the curriculum docId fields
    # stay empty for them). The studentVisible flag still gates display.
    materials = [
        {
            "kind": m.kind,
            "docId": m.doc_id,
            "origin": m.origin,
            "studentVisible": m.student_visible,
            "materialId": m.material_id,
            "mimeType": m.mime_type,
            "alt": m.alt,
        }
        for m in cfg.materials
    ]
    return {
        "activityId": activity_id,
        "title": cfg.title,
        **_element_block(cfg),
        # The resolved artefact (public view — never the tutorBlock) so the
        # student workspace has the render path; None if unset or de-catalogued
        # (graceful degradation — the activity stays chat + elements).
        "artefact": (_resolve_artefact(cfg.artefact_id)),
        "workbenchType": cfg.workbench_type,
        "persona": persona_block,
        "materials": materials,
    }


@router.get("/mine/{class_id}/{activity_id}")
async def get_my_activity_config(
    class_id: str = Path(...),
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Convenience alias — fetch the current teacher's config without
    threading their uid through the URL. Used by the frontend so it
    doesn't have to round-trip a `whoami` first.
    """
    cfg = get_activity_config(teacher_uid=user.uid, class_id=class_id, activity_id=activity_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail="activity config not found")
    return _serialize(cfg)


@router.get("/resolved-focus/{class_id}/{activity_id}")
async def get_resolved_focus(
    class_id: str = Path(...),
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Show exactly what the tutor is told about this activity (1.1.62 M1).

    The element-blindness bug was invisible for six weeks precisely because
    **nothing rendered the composed prompt**. Every individual surface passed
    its own tests: the elements rendered, pushed on change, and carded. Nobody
    could see that the tutor's system prompt never mentioned them.

    Owner-scoped: a teacher can only resolve their own activity's focus.
    """
    cfg = get_activity_config(teacher_uid=user.uid, class_id=class_id, activity_id=activity_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail="activity config not found")

    element_counts = {
        kind: len(getattr(cfg, spec.field, None) or [])
        for kind, spec in ELEMENT_REGISTRY.items()
        if getattr(cfg, spec.field, None)
    }
    focus = compose_teacher_focus(cfg)
    # 1.1.62 M3b — appended in agent.py AFTER the curriculum preamble, so it is
    # not part of compose_teacher_focus. Surfaced here anyway: a prompt layer
    # this endpoint cannot render is a prompt layer nobody can debug, which is
    # the exact gap that hid the element blindness for six weeks.
    ilo_block = build_ilo_precedence_block(cfg)
    return {
        "activityId": activity_id,
        "classId": class_id,
        "language": cfg.language,
        "elementCounts": element_counts,
        "manifest": describe_elements(cfg),
        "resolvedFocus": focus,
        "focusChars": len(focus),
        "iloPrecedence": ilo_block,
    }


@router.get("/{teacher_uid}/{class_id}/{activity_id}")
async def get_activity_config_route(
    teacher_uid: str = Path(...),
    class_id: str = Path(...),
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Fetch the config for a (teacher, class, activity). 404 if missing."""
    _assert_owns(user, teacher_uid)
    cfg = get_activity_config(teacher_uid=teacher_uid, class_id=class_id, activity_id=activity_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail="activity config not found")
    return _serialize(cfg)


@router.patch("/{teacher_uid}/{class_id}/{activity_id}")
async def patch_activity_config(
    body: ActivityConfigUpsert,
    teacher_uid: str = Path(...),
    class_id: str = Path(...),
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Update the config — same shape as POST but on a known resource id.

    The body's class_id / activity_id must match the URL (sanity check —
    catches client bugs early). ``activityId`` may be omitted from the
    body on PATCH — the URL is authoritative for the resource id.
    """
    _assert_owns(user, teacher_uid)
    if body.class_id != class_id or (body.activity_id is not None and body.activity_id != activity_id):
        raise HTTPException(
            status_code=400,
            detail="body class_id/activity_id does not match URL",
        )
    _assert_known_artefact(body.artefact_id)
    _assert_chart_bindings(body)
    cfg = upsert_activity_config(
        teacher_uid=teacher_uid,
        class_id=class_id,
        activity_id=activity_id,
        title=body.title,
        teaching_goal=body.teaching_goal,
        language=body.language,
        difficulty=body.difficulty,
        interaction_style=body.interaction_style,
        persona=body.persona,
        paired_workbench=body.paired_workbench,
        workbench_type=body.workbench_type,
        artefact_id=body.artefact_id,
        checklist=body.checklist,
        table=body.table,
        chart=body.chart,
        calculator=body.calculator,
        note=body.note,
        solution=body.solution,
        document=body.document,
        materials=body.materials,
    )
    return _serialize(cfg)


@router.delete("/{teacher_uid}/{class_id}/{activity_id}", status_code=204)
async def delete_activity_config_route(
    teacher_uid: str = Path(...),
    class_id: str = Path(...),
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    """Hard-delete the config. Idempotent — 204 whether the doc existed or not."""
    _assert_owns(user, teacher_uid)
    delete_activity_config(teacher_uid=teacher_uid, class_id=class_id, activity_id=activity_id)
    return None
