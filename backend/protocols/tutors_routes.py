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
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

# Firebase-ONLY verifier: both surfaces are staff. Allowlisted in
# scripts/check-auth-dispatcher.sh with that reason.
from auth.firebase_auth import User, get_current_user
from auth.guards import assert_researcher, assert_teacher
from db.authored_frameworks import list_authored_frameworks
from db.classes import get_class, update_class_tutor
from db.framework_overrides import effective_framework
from db.models.activity_config import InteractionStyle
from db.models.authorship import SEED_AUTHOR, ClientCreatedVia
from db.models.tutor import Tutor
from db.tutor_assignments import clear_assignment, get_assignment, set_assignment
from db.tutors import (
    create_variant,
    delete_authored_tutor,
    get_authored_tutor,
    list_tutor_catalogue,
    resolve_tutor,
    resolve_tutor_for,
    save_tutor,
    set_visibility,
)
from frameworks.loader import load_frameworks
from personas.loader import load_persona
from protocols.authorship import author_emails_for, authorship_fields

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


def _same_words(a: str, b: str) -> bool:
    """Two names that differ only by case, spacing or punctuation."""
    # Explicit escapes: the en/em dashes are the point of this table, and a
    # literal one here trips RUF001 (ambiguous-unicode) on the lint gate.
    strip = str.maketrans("", "", " -\u2013\u2014_().,")
    return a.translate(strip).casefold() == b.translate(strip).casefold()


def plain_framework_name(framework_id: str | None) -> str | None:
    """ "Question-and-use cycle (ESRU)" — never a bare acronym, never a stutter.

    Labels are not uniform: some carry an em-dash subtitle ("ESRU — informal
    formative assessment cycle") and some carry their own acronym in brackets
    ("Claim-Evidence-Reasoning (CER)"). Wrapping the plain name around the
    second kind unmodified produced "Claim, evidence, reasoning
    (Claim-Evidence-Reasoning (CER))", and where the two said the same thing it
    produced "Accountable talk (Accountable Talk)".

    This was invisible until 2026-09-10 because those five frameworks were
    placeholders, and a placeholder is never offered in the picker.
    """
    fw = effective_framework(framework_id)
    if fw is None:
        return None
    plain = _PLAIN_NAME.get(fw.id)
    acronym = fw.label.split("—")[0].strip()
    # A label already carrying its own acronym contributes only the acronym.
    bracketed = re.search(r"\(([^()]+)\)\s*$", acronym)
    if bracketed:
        acronym = bracketed.group(1).strip()
    if not plain:
        return acronym
    # Where the plain name and the label say the same thing, say it once.
    return plain if _same_words(plain, acronym) else f"{plain} ({acronym})"


def _serialize(t: Tutor, *, viewer: User | None = None, emails: dict[str, str] | None = None) -> dict:
    persona = load_persona(t.persona_id) if t.persona_id else None
    fw = effective_framework(t.framework_id)
    stored = get_authored_tutor(t.id) is not None
    return {
        **t.model_dump(by_alias=True, mode="json"),
        # 1.1.150 M1 — `isOwn` (did I make it), distinct from `canEdit` (may I
        # change it), plus the author's email for researchers only. See
        # protocols/authorship.py for the 2026-10-05 seminar that needed it.
        **authorship_fields(t.author_uid, viewer, emails),
        # A tutor nobody authored: a YAML base, or one the deploy seed wrote
        # from a SKILL.md. Its `authorRole` defaults to "researcher" in the
        # model, which on screen would credit a person with the platform's own
        # catalogue — so the UI says "built in" instead of reading the role.
        "isBuiltIn": (not stored) or t.author_uid in (None, SEED_AUTHOR),
        "persona": (
            {"id": persona.id, "name": persona.name, "title": persona.title, "avatar": persona.avatar}
            if persona
            else None
        ),
        "frameworkName": plain_framework_name(t.framework_id),
        "frameworkSummary": (" ".join(fw.summary.split()) if fw and fw.summary else None),
        # 2026-09-21 — the approach is built from several students' talk, so the
        # class must be recording its lesson; the picker greys the tutor out
        # otherwise and the PUT above refuses it.
        "requiresGroupTalk": bool(fw and fw.requires_group_talk),
        "isVariant": t.is_variant,
        # 1.1.91 M7 — migrated from a SKILL.md. Present in the catalogue so
        # there is ONE definition of a tutor and so 1.1.92 / 1.1.107 can address
        # them as baseline arms, but NOT an identity a class picks: choosing
        # "KineBot" for a class whose activity runs concept-dialogue is
        # incoherent. The picker filters on this.
        "isSkillBound": t.is_skill_bound,
        # TUTOR-2 M2 — computed HERE, per row, never re-derived in the client.
        # A second copy of an access rule disagrees with the first the moment
        # one changes; `canEdit` on the custom-approach list is the precedent.
        #
        # Only an AUTHORED tutor is editable at all: a YAML base has no
        # Firestore row, so "share" and "delete" have nothing to act on. That is
        # why this asks the store rather than trusting the object in hand.
        "canEdit": _may_edit(t, viewer),
        # Whether a RESEARCHER has assigned this tutor an approach, as distinct
        # from the tutor carrying one of its own. The two are different acts and
        # only one of them can be undone:
        #   PUT  .../framework {null}  = "this tutor teaches with nothing" — an
        #                                assignment that OVERRIDES what the
        #                                tutor says about itself.
        #   DELETE .../framework       = remove my assignment entirely, so the
        #                                tutor falls back to its own value.
        # Without this flag the UI cannot offer the second, which is why
        # `clearTutorFramework` sat unmounted: there was nothing to render it on.
        "hasAssignment": get_assignment(t.id) is not None,
    }


async def _author_emails(viewer: User | None, tutors: list[Tutor]) -> dict[str, str]:
    return await author_emails_for(viewer, (t.author_uid for t in tutors))


def _may_edit(t: Tutor, viewer: User | None) -> bool:
    """Owner, or a researcher, and only for a tutor that has a stored row."""
    if viewer is None or get_authored_tutor(t.id) is None:
        return False
    return bool(viewer.is_researcher or (t.author_uid and t.author_uid == viewer.uid))


class TutorWrite(BaseModel):
    id: str = Field(min_length=2, max_length=64)
    display_name: str = Field(min_length=1, max_length=120, alias="displayName")
    summary: str | None = Field(default=None, max_length=600)
    persona_id: str | None = Field(default=None, alias="personaId", max_length=64)
    framework_id: str | None = Field(default=None, alias="frameworkId", max_length=64)
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")
    # 1.1.150 M2 — the only channels a client may claim. `seed`, `sync` and
    # `adopt` are server-only and a body naming them is a 422.
    created_via: ClientCreatedVia = Field(default="ui", alias="createdVia")

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
    if framework_id and effective_framework(framework_id) is None:
        raise HTTPException(status_code=400, detail=f"unknown framework: {framework_id}")


# ── teacher-facing ───────────────────────────────────────────────────────────


@router.get("/api/tutors")
async def list_tutors_route(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """The pickable catalogue: base tutors first, then variants."""
    assert_teacher(user)
    # TUTOR-2 M0 — scoped to what this caller may see. A researcher's read is
    # UNFILTERED and logged: the lineage question 1.1.91 exists to answer is
    # unanswerable over a filtered view, and an elevated read that leaves no
    # trace is the thing `_load_for_modify` already refuses to do for activities.
    if user.is_researcher:
        log.info("tutors: unfiltered catalogue read by researcher uid=%s", user.uid)
    catalogue = list_tutor_catalogue(user.uid, see_all=user.is_researcher)
    emails = await _author_emails(user, catalogue)
    return {
        # Identity tutors only — what a class can actually be given. The
        # skill-bound four are addressable via /api/tutors/{id} and live in
        # `skillBoundTutors` for research use.
        "tutors": [_serialize(t, viewer=user, emails=emails) for t in catalogue if not t.is_skill_bound],
        "skillBoundTutors": [_serialize(t, viewer=user, emails=emails) for t in catalogue if t.is_skill_bound],
        # The picker needs these to offer "create a variant" without a second
        # round trip, and to render a framework chooser.
        "frameworks": [
            {
                "id": f.id,
                "name": plain_framework_name(f.id),
                "summary": " ".join(f.summary.split()) if f.summary else "",
                "isPlaceholder": f.is_placeholder,
                "isCustom": False,
            }
            for f in load_frameworks()
        ]
        # Custom approaches the caller may see — their own plus shared ones.
        # Omitting these left the tutor builder offering only the seven
        # published approaches, while its help text said "or one of your own"
        # and create_tutor_route already accepted a custom id. Named by their
        # label as written: plain_framework_name's acronym handling would cut a
        # teacher's label at its first em-dash.
        + [
            {
                "id": f.id,
                "name": f.label,
                "summary": " ".join(f.summary.split()) if f.summary else "",
                "isPlaceholder": f.is_placeholder,
                "isCustom": True,
                # 1.1.150 M3 — shown on the tutor's row in MyTutorsPanel. A
                # teacher-gated route (assert_teacher above): sources never
                # travel to a group token.
                "sources": [s.model_dump(by_alias=True, mode="json") for s in f.sources],
            }
            for f in list_authored_frameworks(user.uid, see_all=user.is_researcher)
        ],
    }


@router.get("/api/tutors/{tutor_id}")
async def get_tutor_route(
    tutor_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    assert_teacher(user)
    # As a PERSON sees it: an authored tutor they cannot see falls back to the
    # YAML base rather than 404ing, so one researcher's private draft of "Sofie"
    # does not delete Sofie for every teacher.
    t = resolve_tutor_for(tutor_id, user.uid, see_all=user.is_researcher)
    if t is None:
        raise HTTPException(status_code=404, detail="tutor not found")
    return _serialize(t)


def _assert_setting_fits_class(tutor: Tutor | None, cls) -> None:
    """Refuse a group-talk approach on a class that is not recording its lesson.

    AR/JB, 2026-09-21: Accountable Talk is built from several students'
    statements, so "we can only use this TP when the voice recording is
    active". The tutor's EFFECTIVE framework decides (a variant may carry a
    different one from its base); a class's lesson recording is the only
    surface where several students' talk exists at all. 409, not 400: the
    request is well-formed, the pairing is what cannot work — and the message
    says what to change, because the picker shows it verbatim.
    """
    if tutor is None:
        return
    fw = effective_framework(tutor.framework_id)
    if fw is None or not fw.requires_group_talk:
        return
    if getattr(cls, "recording_enabled", False):
        return
    raise HTTPException(
        status_code=409,
        detail=(
            f"{fw.label} builds on several students' statements, so it needs the class's lesson "
            "recording. Turn on 'Record this class' in the class settings first, then pick this tutor."
        ),
    )


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
    # TUTOR-2 M0 — resolved the way the PICKER resolved it, so the two cannot
    # disagree: a teacher may only set a tutor their own catalogue offered them.
    chosen = resolve_tutor_for(body.tutor_id, user.uid, see_all=user.is_researcher) if body.tutor_id else None
    if body.tutor_id and chosen is None:
        raise HTTPException(status_code=400, detail=f"unknown tutor: {body.tutor_id}")
    if body.tutor_id:
        _assert_setting_fits_class(resolve_tutor(body.tutor_id), cls)
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
    """Author a tutor from scratch.

    TUTOR-2 M2 opens this to teachers **on one condition**: the tutor must name
    an approach. 1.1.91 M1 kept teachers out because *"a tutor with a theory
    field and no theory in it makes an unfounded claim look founded"* — that
    objection is about the CLAIM, and 1.1.110 already showed where the claim
    actually lives: a custom approach is labelled as authored and claims
    nothing, which is why teachers were given those. So the rule is not "who you
    are" but "the tutor points at an approach somebody can read". A researcher
    may still author one with no framework at all — that is a deliberate
    baseline arm (the four skill-bound tutors are exactly that, and 1.1.92
    measures against them).
    """
    assert_teacher(user)
    if not user.is_researcher and not body.framework_id:
        raise HTTPException(
            status_code=400,
            detail="choose a teaching approach for this tutor — or start from an existing tutor instead",
        )
    _validate_refs(body.id, body.persona_id, body.framework_id)
    # 1.1.150 F4 — refuse a taken id, as the variant route always did. The id
    # is slugged from the display name in the client, so two teachers each
    # creating "Didaktisk tutor" used to yield ONE row, owned by whoever saved
    # last; and a teacher naming a tutor "Sofie" wrote an authored row that
    # shadowed the base tutor for every class (authored wins in resolve_tutor).
    # `resolve_tutor`, not a visibility-filtered read: someone else's PRIVATE
    # tutor holds the id just as firmly.
    if resolve_tutor(body.id) is not None:
        raise HTTPException(
            status_code=409,
            detail=f"a tutor with id {body.id} already exists — choose a different name",
        )
    tutor = Tutor(
        id=body.id,
        displayName=body.display_name,
        summary=body.summary,
        personaId=body.persona_id,
        frameworkId=body.framework_id,
        interactionStyle=body.interaction_style,
        authorRole="researcher" if user.is_researcher else "teacher",
        # New rows are private EXPLICITLY — see Tutor.visibility.
        visibility="private",
    )
    saved = save_tutor(tutor, updated_by=user.uid, created_via=body.created_via)
    log.info("tutor authored: id=%s by=%s via=%s", saved.id, user.uid, body.created_via)
    return _serialize(saved, viewer=user)


@router.post("/api/research/tutors/variant")
async def create_variant_route(
    body: VariantWrite = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Fork an existing tutor. The parent is never written to.

    TUTOR-2 M2: re-gated from ``assert_researcher`` to ``assert_teacher``. 1.1.91
    M1 restricted teachers to variants *of* an existing tutor, which is exactly
    what this endpoint makes — the restriction was never "researchers only", it
    was "not a blank tutor with an empty theory field".
    """
    assert_teacher(user)
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
            author_role="researcher" if user.is_researcher else "teacher",
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    log.info("tutor variant created: id=%s parent=%s by=%s", variant.id, body.parent_id, user.uid)
    return _serialize(variant, viewer=user)


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


class TutorFrameworkAssignment(BaseModel):
    """Which teaching approach a researcher gives a tutor.

    ``framework_id`` of ``None`` is meaningful and not the same as not sending
    the field: it records "this tutor teaches with no framework" and can clear
    one the tutor itself declares. Removing the decision entirely is DELETE.
    """

    framework_id: str | None = Field(default=None, alias="frameworkId", max_length=64)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.put("/api/research/tutors/{tutor_id}/framework")
async def set_tutor_framework_route(
    tutor_id: str = Path(...),
    body: TutorFrameworkAssignment = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Give a tutor — including a default one — a teaching approach.

    This is where the pedagogical claim gets made. Base tutors ship with
    ``frameworkId: null`` because "Sofie teaches with ESRU" is a claim, and the
    catalogue does not make claims nobody signed off. Made HERE it is signed off:
    by a named researcher, in the running app, with the uid recorded. The YAML
    stays null.

    A placeholder framework is refused. Assigning one would produce a tutor that
    announces an approach and teaches with none — the same rule the variant
    dialog applies, enforced on the server so it holds for any caller.
    """
    assert_researcher(user)
    if resolve_tutor(tutor_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown tutor: {tutor_id}")
    if body.framework_id:
        fw = effective_framework(body.framework_id)
        if fw is None:
            raise HTTPException(status_code=400, detail=f"unknown framework: {body.framework_id}")
        if fw.is_placeholder:
            raise HTTPException(
                status_code=400,
                detail=f"{body.framework_id} has no drafted teaching moves yet",
            )
    set_assignment(tutor_id, body.framework_id, updated_by=user.uid)
    return {"tutor": _serialize(resolve_tutor(tutor_id)), "assignment": get_assignment(tutor_id)}


@router.delete("/api/research/tutors/{tutor_id}/framework")
async def clear_tutor_framework_route(
    tutor_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Remove the assignment, restoring whatever the tutor itself declares."""
    assert_researcher(user)
    clear_assignment(tutor_id)
    return {"tutor": _serialize(resolve_tutor(tutor_id)), "assignment": None}


# ── preview (1.1.91 M3) ──────────────────────────────────────────────────────


class PreviewBody(BaseModel):
    """A scratch turn against one or two tutors.

    TWO tutors is the normal case, not a bonus: *"the question is nearly always
    comparative"*. One tutor tells you what it said; two tell you what the
    approach changed.
    """

    message: str = Field(min_length=1, max_length=2000)
    tutor_ids: list[str] = Field(alias="tutorIds", min_length=1, max_length=2)

    model_config = ConfigDict(populate_by_name=True)


@router.post("/api/research/tutors/preview")
async def preview_tutors_route(
    body: PreviewBody = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Talk to one or two tutors, side by side, on your own turn.

    **Teacher-accessible, deliberately.** The 09-09 meeting asked for the tutor
    library as teacher training — *"teachers can use the tutors as teaching
    training to see the different ways we teach"* — and this is that, pointed at
    a person rather than a configuration screen. It reads the app's own prompts,
    which a teacher can already see through the tutor picker's disclosure; it
    reads no student data and no literature.

    ⚠️ **No student data, and it cannot read as teaching.** Turns are the
    caller's own and are logged under ``preview:{uid}`` WITHOUT content, so spend
    stays visible while the researcher chat-log lens excludes them by
    construction. A preview is a real tutor turn carrying a real framework_id —
    unmarked, it would land in a framework tab as classroom evidence when nobody
    was taught.
    """
    assert_teacher(user)

    from analytics.tutor_preview import run_preview_turn

    replies = [await run_preview_turn(tid, body.message, uid=user.uid) for tid in body.tutor_ids]
    return {"message": body.message, "replies": replies}


@router.get("/api/research/tutors/{tutor_id}/preview-prompt")
async def preview_prompt_route(
    tutor_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """What this tutor would be told in a preview, and what that is made of.

    Shown beside the reply so a reviewer can hold one against the other — the
    same reviewability property the whole framework layer exists for. States
    what a preview does NOT carry (activity materials, teacher ILOs, group
    history) rather than implying parity with a lesson turn.
    """
    assert_teacher(user)

    from analytics.tutor_preview import compose_preview_instruction

    composed = compose_preview_instruction(tutor_id)
    if not composed.get("ok"):
        raise HTTPException(status_code=404, detail=composed.get("error", "unknown tutor"))
    return composed


class VisibilityWrite(BaseModel):
    """Share an authored tutor, or take it back (TUTOR-2 M0)."""

    visibility: Literal["private", "shared"]

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.put("/api/research/tutors/{tutor_id}/visibility")
async def set_tutor_visibility_route(
    body: VisibilityWrite = Body(...),  # noqa: B008
    tutor_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """The share control's endpoint — the activities library's gesture, for a tutor.

    Owner-only, and a researcher may share anyone's: the same asymmetry 1.1.110
    already draws for custom approaches, where a researcher may edit any of them
    and a teacher only their own.
    """
    assert_teacher(user)
    tutor = get_authored_tutor(tutor_id)
    # A YAML base has no row to write visibility onto and is shared by
    # definition, so this is 404 rather than a write that silently does nothing.
    if tutor is None or (not user.is_researcher and tutor.author_uid != user.uid):
        raise HTTPException(status_code=404, detail="tutor not found")
    updated = set_visibility(tutor_id, body.visibility)
    log.info("tutor visibility: id=%s -> %s by=%s", tutor_id, body.visibility, user.uid)
    return _serialize(updated, viewer=user) if updated else {}
