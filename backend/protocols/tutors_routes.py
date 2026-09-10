"""Tutor catalogue + variant authoring (1.1.91 M1).

Two audiences on one collection:

* **Teachers** read the catalogue (``GET /api/tutors``) to pick one for an
  activity. Read-only, and Firebase-teacher scoped.
* **Researchers** create and edit tutors and variants under
  ``/api/research/tutors``, ``assert_researcher``-gated like the framework
  routes beside them.

Each row is served **already resolved** — the persona's display fields and the
framework's plain-language name travel with it — so the picker can render a
readable card without three follow-up requests, and so the plain-language name
is defined in ONE place rather than re-invented in the UI.
"""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from pydantic import BaseModel, Field

# Firebase-ONLY verifier: both surfaces are staff. Allowlisted in
# scripts/check-auth-dispatcher.sh with that reason.
from auth.firebase_auth import User, get_current_user
from auth.guards import assert_researcher, assert_teacher
from db.classes import get_class, update_class_tutor
from db.models.activity_config import InteractionStyle
from db.models.tutor import Tutor
from db.tutors import create_variant, delete_authored_tutor, list_tutor_catalogue, resolve_tutor, save_tutor
from frameworks.loader import load_framework, load_frameworks
from personas.loader import load_persona

log = logging.getLogger(__name__)

router = APIRouter(tags=["tutors"])

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")

#: Plain-language names for the teacher-facing picker. A teacher should never be
#: shown a bare research acronym; the acronym follows in brackets so a
#: researcher still recognises it, and so the two audiences read one label.
#: Deliberately here and not in the YAML: the YAML label is the framework's
#: scholarly name and should stay that.
_PLAIN_NAME = {
    "esru": "Question-and-use cycle",
    "authentic-dialogue": "Open dialogue",
    "5e": "Five-phase learning cycle",
    "accountable-talk": "Accountable talk",
    "cer": "Claim, evidence, reasoning",
    "poe": "Predict, observe, explain",
    "toulmin": "Argument analysis",
}


def plain_framework_name(framework_id: str | None) -> str | None:
    """ "Question-and-use cycle (ESRU)" — never a bare acronym."""
    fw = load_framework(framework_id)
    if fw is None:
        return None
    plain = _PLAIN_NAME.get(fw.id)
    acronym = fw.label.split("—")[0].strip()
    return f"{plain} ({acronym})" if plain else acronym


def _serialize(t: Tutor) -> dict:
    persona = load_persona(t.persona_id) if t.persona_id else None
    fw = load_framework(t.framework_id)
    return {
        **t.model_dump(by_alias=True, mode="json"),
        "persona": (
            {"id": persona.id, "name": persona.name, "title": persona.title, "avatar": persona.avatar}
            if persona
            else None
        ),
        "frameworkName": plain_framework_name(t.framework_id),
        "frameworkSummary": (" ".join(fw.summary.split()) if fw and fw.summary else None),
        "isVariant": t.is_variant,
        # 1.1.91 M7 — migrated from a SKILL.md. Present in the catalogue so
        # there is ONE definition of a tutor and so 1.1.92 / 1.1.107 can address
        # them as baseline arms, but NOT an identity a class picks: choosing
        # "KineBot" for a class whose activity runs concept-dialogue is
        # incoherent. The picker filters on this.
        "isSkillBound": t.is_skill_bound,
    }


class TutorWrite(BaseModel):
    id: str = Field(min_length=2, max_length=64)
    display_name: str = Field(min_length=1, max_length=120, alias="displayName")
    summary: str | None = Field(default=None, max_length=600)
    persona_id: str | None = Field(default=None, alias="personaId", max_length=64)
    framework_id: str | None = Field(default=None, alias="frameworkId", max_length=64)
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")

    model_config = {"populate_by_name": True}


class VariantWrite(BaseModel):
    parent_id: str = Field(alias="parentId", min_length=1, max_length=64)
    id: str = Field(min_length=2, max_length=64)
    display_name: str = Field(min_length=1, max_length=120, alias="displayName")
    summary: str | None = Field(default=None, max_length=600)
    persona_id: str | None = Field(default=None, alias="personaId", max_length=64)
    framework_id: str | None = Field(default=None, alias="frameworkId", max_length=64)
    interaction_style: InteractionStyle | None = Field(default=None, alias="interactionStyle")

    model_config = {"populate_by_name": True}


def _validate_refs(tutor_id: str, persona_id: str | None, framework_id: str | None) -> None:
    """Reject a tutor that points at something that does not exist.

    A dangling framework id would resolve to "no framework" at runtime — the
    tutor would simply teach as though it had none, with nothing to see. Better
    a 400 at author time than a silently inert tutor in a classroom.
    """
    if not _ID_RE.match(tutor_id):
        raise HTTPException(status_code=400, detail="id must be lowercase letters, digits and hyphens")
    if persona_id and load_persona(persona_id) is None:
        raise HTTPException(status_code=400, detail=f"unknown persona: {persona_id}")
    if framework_id and load_framework(framework_id) is None:
        raise HTTPException(status_code=400, detail=f"unknown framework: {framework_id}")


# ── teacher-facing ───────────────────────────────────────────────────────────


@router.get("/api/tutors")
async def list_tutors_route(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """The pickable catalogue: base tutors first, then variants."""
    assert_teacher(user)
    catalogue = list_tutor_catalogue()
    return {
        # Identity tutors only — what a class can actually be given. The
        # skill-bound four are addressable via /api/tutors/{id} and live in
        # `skillBoundTutors` for research use.
        "tutors": [_serialize(t) for t in catalogue if not t.is_skill_bound],
        "skillBoundTutors": [_serialize(t) for t in catalogue if t.is_skill_bound],
        # The picker needs these to offer "create a variant" without a second
        # round trip, and to render a framework chooser.
        "frameworks": [
            {
                "id": f.id,
                "name": plain_framework_name(f.id),
                "summary": " ".join(f.summary.split()) if f.summary else "",
                "isPlaceholder": f.is_placeholder,
            }
            for f in load_frameworks()
        ],
    }


@router.get("/api/tutors/{tutor_id}")
async def get_tutor_route(
    tutor_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    assert_teacher(user)
    t = resolve_tutor(tutor_id)
    if t is None:
        raise HTTPException(status_code=404, detail="tutor not found")
    return _serialize(t)


class ClassTutorUpdate(BaseModel):
    tutor_id: str | None = Field(default=None, alias="tutorId", max_length=64)

    model_config = {"populate_by_name": True}


@router.put("/api/tutors/class/{class_id}")
async def set_class_tutor_route(
    class_id: str = Path(...),
    body: ClassTutorUpdate = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Set the class's tutor — the one identity choice for every activity in it.

    Class-level by the 1.1.32 Q4 decision: a duplicate per-activity picker was
    problem 4 of the teacher-UX refinement, so identity is chosen once here and
    every activity inherits it (shown read-only in the builder).
    """
    assert_teacher(user)
    cls = get_class(class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="class not found")
    if cls.owner_uid and cls.owner_uid != user.uid and not user.is_researcher:
        raise HTTPException(status_code=403, detail="not your class")
    if body.tutor_id and resolve_tutor(body.tutor_id) is None:
        raise HTTPException(status_code=400, detail=f"unknown tutor: {body.tutor_id}")
    update_class_tutor(class_id, body.tutor_id)
    log.info("class tutor set: class=%s tutor=%s by=%s", class_id, body.tutor_id, user.uid)
    t = resolve_tutor(body.tutor_id) if body.tutor_id else None
    return {"classId": class_id, "tutor": _serialize(t) if t else None}


# ── researcher-facing ────────────────────────────────────────────────────────


@router.post("/api/research/tutors")
async def create_tutor_route(
    body: TutorWrite = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    assert_researcher(user)
    _validate_refs(body.id, body.persona_id, body.framework_id)
    tutor = Tutor(
        id=body.id,
        displayName=body.display_name,
        summary=body.summary,
        personaId=body.persona_id,
        frameworkId=body.framework_id,
        interactionStyle=body.interaction_style,
        authorRole="researcher",
    )
    saved = save_tutor(tutor, updated_by=user.uid)
    log.info("tutor authored: id=%s by=%s", saved.id, user.uid)
    return _serialize(saved)


@router.post("/api/research/tutors/variant")
async def create_variant_route(
    body: VariantWrite = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Fork an existing tutor. The parent is never written to."""
    assert_researcher(user)
    _validate_refs(body.id, body.persona_id, body.framework_id)
    if resolve_tutor(body.id) is not None:
        raise HTTPException(status_code=409, detail=f"a tutor with id {body.id} already exists")
    try:
        variant = create_variant(
            body.parent_id,
            variant_id=body.id,
            display_name=body.display_name,
            created_by=user.uid,
            framework_id=body.framework_id,
            persona_id=body.persona_id,
            interaction_style=body.interaction_style,
            summary=body.summary,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    log.info("tutor variant created: id=%s parent=%s by=%s", variant.id, body.parent_id, user.uid)
    return _serialize(variant)


@router.delete("/api/research/tutors/{tutor_id}")
async def delete_tutor_route(
    tutor_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Remove an authored tutor. A base tutor of the same id becomes visible
    again — the YAML catalogue is the floor, so this can never empty the list."""
    assert_researcher(user)
    delete_authored_tutor(tutor_id)
    log.info("authored tutor deleted: id=%s by=%s", tutor_id, user.uid)
    return {"deleted": tutor_id, "resolvesTo": _serialize(t) if (t := resolve_tutor(tutor_id)) else None}
