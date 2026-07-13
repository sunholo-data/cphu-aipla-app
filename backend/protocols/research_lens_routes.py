"""Researcher rubric-lens API (RUBRIC-1 M1/M3 — 1.1.57).

RESEARCHER-ONLY (the shipped 1.1.5 role; ``user.is_researcher``): these lenses
are R1-quarantined from teachers, so every route denies non-researchers with an
enumeration-resistant 404. Consumers: the ``aiplatform rubric`` CLI and the
settings-pane lens panel (M3).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from analytics.rubric_runs import list_rubric_runs
from analytics.session_rubric import (
    MIN_ANCHORS,
    get_lens_config,
    list_lens_configs,
    promote_rubric,
    resolve_target,
    score_target,
    upsert_rubric_def,
)
from auth.firebase_auth import User, get_current_user
from db.firestore import get_document, set_document

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research", tags=["research-lenses"])


def _assert_researcher(user: User) -> None:
    if not getattr(user, "is_researcher", False):
        raise HTTPException(status_code=404, detail="not found")


# --- scoring (M1 — the CLI's twin) ---


class RubricScoreBody(BaseModel):
    """Score target: a **group code** (``crisp-pebble-21``) or a session id.

    Researchers hold group codes, not internal session UUIDs (1.1.57), so
    ``groupCode`` / ``target`` are preferred; ``sessionId`` stays for
    back-compat with the RUBRIC-1 CLI. Exactly one is required.
    """

    target: str | None = Field(default=None, min_length=1, max_length=128)
    group_code: str | None = Field(default=None, alias="groupCode", min_length=1, max_length=128)
    session_id: str | None = Field(default=None, alias="sessionId", min_length=1, max_length=128)
    #: The rubric to score with. ``rubric`` is the RUBRIC-2 name (any id incl.
    #: free-form); ``lens`` is the RUBRIC-1 field, kept for back-compat.
    rubric: str | None = Field(default=None, min_length=1, max_length=64)
    lens: str | None = Field(default=None, min_length=1, max_length=64)

    model_config = ConfigDict(populate_by_name=True)

    @property
    def effective_target(self) -> str:
        return (self.target or self.group_code or self.session_id or "").strip()

    @property
    def effective_lens(self) -> str:
        return (self.rubric or self.lens or "").strip()


@router.post("/rubric-score")
async def rubric_score(
    body: RubricScoreBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Run one lens over one captured session; returns the profile (or a
    reasoned abstain) + the evidence partition, provenance-stamped.

    Accepts a **group code** — resolved to the group's latest session — or a
    raw session id."""
    _assert_researcher(user)
    target = body.effective_target
    if not target:
        raise HTTPException(status_code=400, detail="one of target / groupCode / sessionId is required")
    lens = body.effective_lens
    if not lens:
        raise HTTPException(status_code=400, detail="one of rubric / lens is required")
    try:
        get_lens_config(lens)
    except KeyError:
        raise HTTPException(status_code=400, detail=f"unknown rubric {lens!r}") from None
    result = await score_target(target, lens)
    if result is None:
        # Distinguish "valid group code, no sessions yet" from a bad session id.
        if resolve_target(target) == []:
            raise HTTPException(status_code=404, detail=f"no sessions found for group {target!r}")
        raise HTTPException(status_code=404, detail="session not found")
    log.info("research: rubric-score target=%s rubric=%s by=%s", target, lens, user.uid)
    return result.model_dump(by_alias=True)


# --- anchor-pack lint (M1 — `aiplatform rubric anchors validate`) ---


@router.get("/anchor-packs/{activity_id}/validate")
async def validate_anchor_pack(
    activity_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Lint an activity's anchor pack against the 1.1.57 calibration floor."""
    _assert_researcher(user)
    doc = get_document("rubric_anchor_packs", activity_id)
    problems: list[str] = []
    anchors = (doc or {}).get("anchors") or []
    if doc is None:
        problems.append("no anchor pack stored for this activity")
    else:
        if len(anchors) < MIN_ANCHORS:
            problems.append(f"only {len(anchors)} anchors — the calibration floor is {MIN_ANCHORS}")
        if not any("NA_solver" in str(a.get("scores", {})) for a in anchors):
            problems.append("no NA(solver) example — the judge needs one to calibrate abstention")
        for i, a in enumerate(anchors):
            for key in ("solution", "scores", "rationale"):
                if not a.get(key):
                    problems.append(f"anchor {i + 1} is missing {key!r}")
    return {"activityId": activity_id, "ok": not problems, "anchors": len(anchors), "problems": problems}


# --- lens configs (M3 — the settings surface) ---


class LensConfigUpdate(BaseModel):
    enabled: bool | None = None
    model: str | None = Field(default=None, max_length=64)
    prompt_override: str | None = Field(default=None, alias="promptOverride", max_length=8000)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.get("/lens-configs")
async def get_lens_configs(user: User = Depends(get_current_user)) -> dict[str, Any]:  # noqa: B008
    """Every lens's EFFECTIVE config (override merged over the code default)."""
    _assert_researcher(user)
    return {"lenses": [c.model_dump() for c in list_lens_configs()]}


@router.put("/lens-configs/{lens_id}")
async def put_lens_config(
    lens_id: str,
    body: LensConfigUpdate,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Write the researcher override for one lens.

    A prompt edit BUMPS ``prompt_version`` (``{lens}-r{n}``) so every stored
    score stays interpretable against the prompt that produced it — the
    researcher-versioned prompt layer. Passing ``promptOverride: null``
    resets the prompt to the code default (version bumps too: the behaviour
    changed).
    """
    _assert_researcher(user)
    try:
        current = get_lens_config(lens_id)
    except KeyError:
        raise HTTPException(status_code=400, detail=f"unknown lens {lens_id!r}") from None

    fields = body.model_dump(exclude_unset=True, by_alias=False)
    update: dict[str, Any] = {"updated_by": user.uid}
    if "enabled" in fields and fields["enabled"] is not None:
        update["enabled"] = fields["enabled"]
    if fields.get("model"):
        update["model"] = fields["model"]
    if "prompt_override" in fields:
        update["prompt_override"] = fields["prompt_override"]  # None = reset to default
        rev = int(current.prompt_version.rsplit("-r", 1)[-1] or 1) if "-r" in current.prompt_version else 1
        update["prompt_version"] = f"{lens_id}-r{rev + 1}"

    existing = get_document("analytics_lens_configs", lens_id) or {}
    set_document("analytics_lens_configs", lens_id, {**existing, **update}, merge=True)
    log.info("research: lens-config %s updated by %s (%s)", lens_id, user.uid, sorted(update))
    return {"lens": get_lens_config(lens_id).model_dump()}


# --- free-form rubrics (RUBRIC-2 M1 — the experimentation registry) ---


class RubricDefBody(BaseModel):
    """Create/update a free-form researcher rubric (a whole framework as data)."""

    label: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=20000)
    output_keys: list[str] = Field(alias="outputKeys", min_length=1, max_length=64)
    family: str = Field(default="", max_length=64)
    score_scale: str = Field(default="", alias="scoreScale", max_length=64)
    model: str | None = Field(default=None, max_length=64)
    requires_anchors: bool = Field(default=False, alias="requiresAnchors")
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.get("/rubrics")
async def list_rubrics(user: User = Depends(get_current_user)) -> dict[str, Any]:  # noqa: B008
    """Every scorable rubric — seed lenses + free-form researcher rubrics."""
    _assert_researcher(user)
    return {"rubrics": [c.model_dump() for c in list_lens_configs()]}


@router.get("/rubrics/{rubric_id}")
async def get_rubric(rubric_id: str, user: User = Depends(get_current_user)) -> dict[str, Any]:  # noqa: B008
    """One rubric's effective config (seed or free-form)."""
    _assert_researcher(user)
    try:
        return {"rubric": get_lens_config(rubric_id).model_dump()}
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown rubric {rubric_id!r}") from None


@router.put("/rubrics/{rubric_id}")
async def put_rubric(
    rubric_id: str,
    body: RubricDefBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Create or update a free-form rubric. A prompt change bumps the version.

    Seed lenses (``maps``/``saar``) are code-owned — edit those via
    ``/lens-configs``; this route rejects their ids with a 400.
    """
    _assert_researcher(user)
    try:
        upsert_rubric_def(
            rubric_id,
            label=body.label,
            prompt=body.prompt,
            output_keys=body.output_keys,
            family=body.family,
            score_scale=body.score_scale,
            model=body.model,
            requires_anchors=body.requires_anchors,
            meta=body.meta,
            updated_by=user.uid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"rubric": get_lens_config(rubric_id).model_dump()}


# --- versioning + run store (RUBRIC-2 M3) ---


class PromoteBody(BaseModel):
    version: str = Field(min_length=1, max_length=64)

    model_config = ConfigDict(populate_by_name=True)


@router.post("/rubrics/{rubric_id}/promote")
async def promote(
    rubric_id: str,
    body: PromoteBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Mark a free-form rubric version live (the one live scoring uses)."""
    _assert_researcher(user)
    try:
        promote_rubric(rubric_id, body.version, updated_by=user.uid)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown rubric {rubric_id!r}") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"rubric": get_lens_config(rubric_id).model_dump()}


@router.get("/rubric-runs")
async def rubric_runs_list(
    groupCode: str | None = None,
    rubric: str | None = None,
    limit: int = 50,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Recent rubric runs (provenance records), newest-first."""
    _assert_researcher(user)
    runs = list_rubric_runs(group_code=groupCode, rubric_id=rubric, limit=min(max(limit, 1), 200))
    return {"runs": runs}
