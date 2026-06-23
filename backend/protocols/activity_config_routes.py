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

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field

from adk.teacher_focus import resolve_active_config
from auth import User, get_current_user
from db.activity_configs import (
    delete_activity_config,
    get_activity_config,
    list_activity_configs,
    upsert_activity_config,
)
from db.classes import get_class_for_group
from db.models.activity_config import (
    ActivityConfig,
    CalculatorElement,
    ChartElement,
    ChecklistItem,
    Difficulty,
    InteractionStyle,
    Language,
    MaterialRef,
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
    class_id: str = Field(alias="classId", min_length=1, max_length=128)
    title: str = Field(default="", alias="title", max_length=200)
    teaching_goal: str = Field(alias="teachingGoal", max_length=2000)
    language: Language = "da"
    difficulty: Difficulty = "standard"
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")
    persona: str | None = Field(default=None, max_length=64)
    paired_workbench: str | None = Field(default=None, alias="pairedWorkbench")
    workbench_type: WorkbenchType = Field(default="none", alias="workbenchType")
    checklist: list[ChecklistItem] = Field(default_factory=list)
    # Teacher-defined data tables the student fills in (1.1.38 M1).
    table: list[TableElement] = Field(default_factory=list)
    # Charts plotting the activity's data table (1.1.38 M2).
    chart: list[ChartElement] = Field(default_factory=list)
    # Formula calculators the student uses (1.1.38 M3).
    calculator: list[CalculatorElement] = Field(default_factory=list)
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
    activity_id = body.activity_id or _mint_activity_id()
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
        checklist=body.checklist,
        table=body.table,
        chart=body.chart,
        calculator=body.calculator,
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
            "checklist": [],
            "table": [],
            "chart": [],
            "calculator": [],
            "workbenchType": "none",
            "persona": persona_block,
            "materials": [],
        }
    # 1.1.33 M2b: surface ALL of the activity's materials (names-always) with a
    # studentVisible flag. The Documents workbench shows every source name (so
    # "what is this grounded in?" is debuggable / transparent); the flag gates
    # whether the student can OPEN the content, not whether the name shows.
    # RAG grounding is unaffected — it uses every cited material regardless.
    materials = [{"docId": m.doc_id, "origin": m.origin, "studentVisible": m.student_visible} for m in cfg.materials]
    return {
        "activityId": activity_id,
        "title": cfg.title,
        "checklist": [item.model_dump() for item in cfg.checklist],
        "table": [t.model_dump(by_alias=True) for t in cfg.table],
        "chart": [c.model_dump(by_alias=True) for c in cfg.chart],
        "calculator": [c.model_dump(by_alias=True) for c in cfg.calculator],
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
        checklist=body.checklist,
        table=body.table,
        chart=body.chart,
        calculator=body.calculator,
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
