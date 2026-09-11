"""Researcher-facing teaching-framework endpoints (1.1.91 M1).

The surface that makes 1.1.91's premise true: *"a tutor is a file in git, and
the people who own the pedagogy cannot write files in git."* A researcher can
read every framework's instruction, edit it, and revert — with no commit, no
deploy and no seed.

Every route is ``assert_researcher``-gated. A researcher is a Firebase teacher
identity carrying ``role: researcher`` (1.1.5); students never reach these, and
an ordinary teacher gets 403 rather than a silently narrowed view.

The response always carries BOTH the researcher's override and the instruction
rendered from the YAML constructs, so the editor can show an edit as a visible
delta from the theory. That is what keeps a hand-edited prompt reviewable — the
property the whole framework layer exists for.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

# Firebase-ONLY verifier, deliberately: this is a researcher surface and an
# anonymous-group student JWT has no business reaching it (see
# scripts/check-auth-dispatcher.sh, where this file is allowlisted with that
# reason). The dispatcher would let a group token through to assert_researcher
# and be denied there instead — safe, but a layer too late and against the
# stated convention.
from auth.firebase_auth import User, get_current_user
from auth.guards import assert_researcher, assert_teacher
from db.authored_frameworks import (
    delete_authored_framework,
    get_authored_framework,
    is_custom_id,
    list_authored_frameworks,
    make_framework_id,
    may_edit,
    save_authored_framework,
)
from db.framework_overrides import (
    clear_framework_override,
    default_framework_instruction,
    effective_framework,
    get_framework_override,
    resolve_framework_instruction,
    save_framework_structure,
)
from db.models.teaching_framework import Construct, FrameworkRegister, Provenance, TeachingFramework
from frameworks.instruction import build_framework_instruction
from frameworks.loader import load_framework, load_frameworks

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research/frameworks", tags=["research", "frameworks"])

# Generous but bounded: the ESRU render is ~2k, and a researcher elaborating on
# four constructs has room. Unbounded free text into a system prompt is not a
# thing to ship.
_MAX_INSTRUCTION = 20000


class StructureUpdate(BaseModel):
    """A researcher's edit to the framework's THEORY, not its rendered text.

    The instruction is regenerated from this, so an edit made here stays
    reviewable — a reader can still hold the prompt against the constructs it
    came from. Editing the rendered text (``InstructionUpdate``) cannot offer
    that, which is why both exist and why the store records which one is live.

    ⚠️ ``Provenance`` is reused verbatim rather than re-declared, so
    ``vouched_by`` keeps its no-default, min-length-1 constraint. An unvouched
    citation is unconstructable here — the never-invent-a-citation requirement
    enforced by the type system rather than by review, and the reason it will
    still hold when the M2 co-pilot is the thing filling this in.

    ``register`` joined this payload in 1.1.111, when tone stopped being a
    separate axis. It belongs HERE, beside the constructs, because that is the
    whole point: the person choosing the voice is the person looking at the
    moves it has to live with, in the same preview.
    """

    summary: str = Field(default="", max_length=800)
    constructs: list[Construct] = Field(default_factory=list, max_length=20)
    provenance: list[Provenance] = Field(default_factory=list, max_length=10)
    register_: FrameworkRegister | None = Field(default=None, alias="register")

    def merged_onto(self, base: TeachingFramework) -> TeachingFramework:
        """This edit applied to the git framework, validated as a whole.

        Validating the MERGE rather than the payload alone is what stops a
        partial edit producing a framework that could not exist — the model's
        own constraints get the final say, exactly as they do for the YAML.
        """
        merged = base.model_dump(by_alias=True, mode="json")
        merged.update(self.model_dump(by_alias=True, mode="json"))
        merged["id"] = base.id
        merged["source"] = "firestore"
        return TeachingFramework.model_validate(merged)


def _serialize(fw: TeachingFramework) -> dict:
    """One framework, with its default render and any researcher override.

    The body is the EFFECTIVE framework — git YAML with any structural edit
    applied — so the editor opens on what is live rather than on the git default
    a researcher already changed. ``defaultConstructs`` carries the git version
    alongside it, which is what lets the structural editor show a revert that
    tells the truth.
    """
    override = get_framework_override(fw.id)
    default = default_framework_instruction(fw.id)
    live = effective_framework(fw.id) or fw
    return {
        **live.model_dump(by_alias=True, mode="json"),
        # What the tutor actually receives right now — regenerated from the
        # edited constructs in structured mode, the saved text in text mode.
        "instruction": resolve_framework_instruction(fw.id) or default,
        # What it would receive with no override — always sent, so the editor can
        # show the delta and offer a truthful Revert.
        "defaultInstruction": default,
        "isOverridden": override is not None,
        "overriddenBy": (override or {}).get("updatedBy"),
        "overriddenAt": (override or {}).get("updatedAt"),
        "overrideVersion": (override or {}).get("version"),
        # "text" (the rendered instruction was hand-edited) or "structured" (the
        # constructs were), so the UI opens the editor the researcher last used
        # instead of guessing.
        "overrideMode": (override or {}).get("mode"),
        # The git constructs, for the structural editor's revert and diff.
        "defaultConstructs": [c.model_dump(by_alias=True, mode="json") for c in fw.constructs],
        "defaultProvenance": [p.model_dump(by_alias=True, mode="json") for p in fw.provenance],
        "defaultSummary": fw.summary,
    }


def _require(framework_id: str) -> TeachingFramework:
    fw = load_framework(framework_id)
    if fw is None:
        raise HTTPException(status_code=404, detail="framework not found")
    return fw


@router.get("")
async def list_frameworks_route(
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """The whole catalogue, with each framework's live and default instruction."""
    assert_researcher(user)
    return {"frameworks": [_serialize(fw) for fw in load_frameworks()]}


# ── researcher cross-view (1.1.91 M4) ────────────────────────────────────────
#
# ⚠️ DEFINED BEFORE `GET /{framework_id}`, and it has to be. FastAPI matches in
# declaration order, so a catch-all single-segment path defined earlier swallows
# every literal after it: with this below, `/crossview` resolved to
# `framework_id="crossview"` and answered **404 framework not found** — a
# plausible-looking error for a route that exists. (`/custom/list` is safe only
# because it has two segments.)


# ── researcher cross-view (1.1.91 M4) ────────────────────────────────────────


@router.get("/crossview")
async def crossview_route(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """Every tutor and every authored approach, with lineage and real usage.

    The ``scope=all`` pattern the class reads already use, applied to the tutor
    layer. **Read-only and logged**: the span carries ``auth.researcher_bypass``,
    so "who looked at whose work" is answerable — the same audit property a
    cross-tenant class read has had since 1.1.5.

    ⚠️ This is teachers' professional work. The design is explicit that they
    should be told it is visible, and the trust-card principle applies to
    teachers as much as to students — so the custom-approach panel says so where
    the work is written, rather than relying on someone having mentioned it once.

    Usage is MEASURED (turns actually taught) and kept apart from INTENT (tutors
    that name an approach). A framework assigned in March and never run is not
    busy, and conflating the two would say it was.
    """
    assert_researcher(user)

    from analytics.tutor_crossview import tutor_crossview

    return _read_crossview(tutor_crossview)


def _read_crossview(fn):
    """A failed read is reported, never rendered as an empty catalogue."""
    try:
        return fn()
    except Exception as exc:
        log.warning("crossview failed (%s): %s", type(exc).__name__, exc)
        raise HTTPException(
            status_code=503,
            detail=f"could not read the tutor catalogue ({type(exc).__name__}) — a failed read, not an empty one",
        ) from exc


@router.get("/{framework_id}")
async def get_framework_route(
    framework_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    assert_researcher(user)
    return _serialize(_require(framework_id))


@router.delete("/{framework_id}/instruction")
async def delete_framework_instruction_route(
    framework_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Revert to the instruction rendered from the YAML constructs.

    The only revert there is, and it covers both override shapes: a structural
    edit and a legacy hand-written one are one row, and deleting it restores the
    published framework either way.
    """
    assert_researcher(user)
    fw = _require(framework_id)
    clear_framework_override(fw.id)
    log.info("framework instruction reverted: framework=%s by=%s", fw.id, user.uid)
    return _serialize(fw)


@router.put("/{framework_id}/structure")
async def put_framework_structure_route(
    framework_id: str = Path(...),
    body: StructureUpdate = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Save an edited framework structure — constructs, behaviours, citations.

    Rejects a payload that would not validate as a framework, and rejects it
    BEFORE writing: a stored structure that cannot be loaded degrades to the git
    default at read time, which would look like the edit silently not saving.
    """
    assert_researcher(user)
    base = _require(framework_id)
    try:
        merged = body.merged_onto(base)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid framework structure: {exc}") from exc
    if not merged.constructs:
        # A framework with no constructs renders no instruction, so saving one
        # would silently turn the tutor's teaching off. Deleting the override is
        # how you revert; this is not that.
        raise HTTPException(
            status_code=422,
            detail="a framework must keep at least one construct — delete the override to revert",
        )
    save_framework_structure(
        framework_id,
        body.model_dump(by_alias=True, mode="json"),
        updated_by=user.uid,
    )
    log.info("frameworks: %s structure edited by %s", framework_id, user.uid)
    return _serialize(base)


@router.post("/{framework_id}/structure/preview")
async def preview_framework_structure_route(
    framework_id: str = Path(...),
    body: StructureUpdate = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Render an edit WITHOUT saving it — the structural editor's live preview.

    The generator is deterministic Python, so the only honest preview is one the
    server produced. A client-side approximation would drift from what the tutor
    is actually told, which is the exact failure this layer exists to prevent.
    """
    assert_researcher(user)
    base = _require(framework_id)
    try:
        merged = body.merged_onto(base)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid framework structure: {exc}") from exc
    return {
        "instruction": build_framework_instruction(merged),
        "defaultInstruction": default_framework_instruction(framework_id),
    }


# ── custom approaches (1.1.110) ──────────────────────────────────────────────
#
# The one thing on this screen a TEACHER may edit. Everything above operates on
# the seven published frameworks and is researcher-only; these routes are open
# to any teacher, who may create approaches and edit their own.
#
# A custom approach makes no claim to a literature, which is what makes this
# safe to open up — see db/authored_frameworks.py for why this departs from
# M1's "teachers get variants, not blank frameworks".


class CustomApproachBody(BaseModel):
    """A custom approach as the client sends it.

    ``authorUid``/``authorRole`` are deliberately absent: they come from the
    verified token. A body that supplies them is not rejected, it is simply
    never consulted.
    """

    label: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=800)
    instruction_text: str = Field(alias="instructionText", min_length=1, max_length=20000)
    # `register_` because a bare `register` shadows a pydantic BaseModel
    # attribute and warns at import; the wire name is unaffected.
    register_: FrameworkRegister | None = Field(default=None, alias="register")
    material_refs: list[dict] = Field(default_factory=list, alias="materialRefs", max_length=20)

    model_config = ConfigDict(populate_by_name=True)


def _custom_or_404(framework_id: str) -> TeachingFramework:
    fw = get_authored_framework(framework_id)
    if fw is None:
        raise HTTPException(status_code=404, detail="approach not found")
    return fw


@router.get("/custom/list")
async def list_custom_approaches_route(
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Every custom approach, with whether THIS caller may edit each one.

    ``canEdit`` is computed server-side and sent per row rather than left to the
    client to derive. A UI deriving it would be a second copy of the rule, and
    the two would disagree the first time one changed — the shape of the
    money-gate join footgun.
    """
    assert_teacher(user)
    rows = list_authored_frameworks()
    return {
        "approaches": [
            {
                **fw.model_dump(by_alias=True, mode="json"),
                "canEdit": may_edit(fw, uid=user.uid, is_researcher=user.is_researcher),
            }
            for fw in rows
        ]
    }


@router.post("/custom")
async def create_custom_approach_route(
    body: CustomApproachBody = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Create a custom approach. Any teacher may."""
    assert_teacher(user)
    framework_id = make_framework_id(body.label)
    if get_authored_framework(framework_id) is not None:
        raise HTTPException(status_code=409, detail=f"an approach named {body.label!r} already exists")
    fw = TeachingFramework(
        id=framework_id,
        label=body.label,
        summary=body.summary,
        layer="custom",
        # A custom approach is usable the moment it is written. `ready_for_review`
        # is the published frameworks' state and means AR/JB owe it a sign-off;
        # nobody owes a teacher's own approach anything.
        status="ready",
        instruction_text=body.instruction_text,
        material_refs=body.material_refs,
        teaching_register=body.register_,
        source="firestore",
    )
    saved = save_authored_framework(
        fw,
        author_uid=user.uid,
        author_role="researcher" if user.is_researcher else "teacher",
    )
    log.info("custom approach created: %s by %s", saved.id, user.uid)
    return {**saved.model_dump(by_alias=True, mode="json"), "canEdit": True}


@router.put("/custom/{framework_id}")
async def update_custom_approach_route(
    framework_id: str = Path(...),
    body: CustomApproachBody = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Edit a custom approach — yours, or anyone's if you are a researcher."""
    assert_teacher(user)
    existing = _custom_or_404(framework_id)
    if not may_edit(existing, uid=user.uid, is_researcher=user.is_researcher):
        raise HTTPException(status_code=403, detail="this approach belongs to someone else")
    updated = existing.model_copy(
        update={
            "label": body.label,
            "summary": body.summary,
            "instruction_text": body.instruction_text,
            "material_refs": body.material_refs,
            "teaching_register": body.register_,
        }
    )
    saved = save_authored_framework(
        updated,
        author_uid=user.uid,
        author_role="researcher" if user.is_researcher else "teacher",
    )
    return {**saved.model_dump(by_alias=True, mode="json"), "canEdit": True}


@router.delete("/custom/{framework_id}")
async def delete_custom_approach_route(
    framework_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Delete a custom approach.

    ⚠️ Does NOT check whether a tutor or class still points at it. Framework
    resolution is None-tolerant by design (Axiom 5) — an unknown id degrades to
    a tutor with no approach rather than raising — so a dangling reference is a
    silent loss of pedagogy, not an outage. Surfacing usage before deletion is
    worth doing and is not done here; see the design doc's open questions.
    """
    assert_teacher(user)
    existing = _custom_or_404(framework_id)
    if not may_edit(existing, uid=user.uid, is_researcher=user.is_researcher):
        raise HTTPException(status_code=403, detail="this approach belongs to someone else")
    delete_authored_framework(framework_id)
    log.info("custom approach deleted: %s by %s", framework_id, user.uid)
    return {"deleted": framework_id}


# ── source passages (1.1.110) ────────────────────────────────────────────────


class PassageQuery(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    top_k: int = Field(default=5, ge=1, le=20, alias="topK")

    model_config = ConfigDict(populate_by_name=True)


@router.post("/{framework_id}/sources/search")
async def search_sources_route(
    framework_id: str = Path(...),
    body: PassageQuery = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Passages from the papers this framework is drafted from.

    What turns ``vouchedBy: M`` from a claim into something a reader can check:
    the citation says which paper, this shows the sentence.

    RESEARCHER-ONLY, and not merely for tidiness — these are verbatim extracts
    from copyrighted journal articles. Teachers do not get this, custom
    approaches have no literature to search, and no student-facing surface may
    reach it (``scripts/check-literature-corpus-isolation.sh``).

    Degrades to an empty list with ``configured: false`` when the corpus is not
    provisioned in this environment. Reported rather than silently empty: "no
    passages" and "no corpus" would otherwise look identical, and the first
    reads as the paper not supporting the claim.
    """
    assert_researcher(user)
    if is_custom_id(framework_id):
        raise HTTPException(
            status_code=400,
            detail="a custom approach has no source literature — it is authored, not drafted from a paper",
        )
    _require(framework_id)

    from db.literature_corpus import get_literature_corpus_name, query_literature

    if not get_literature_corpus_name():
        return {"configured": False, "passages": [], "citations": []}

    passages = await query_literature(body.query, top_k=body.top_k, framework_id=framework_id)
    # The citation is resolved HERE, from the framework's own provenance, rather
    # than stored alongside the text in the corpus. One source of truth for what
    # a paper is called; the corpus holds only the words.
    fw = _require(framework_id)
    return {
        "configured": True,
        "passages": passages,
        "citations": [p.model_dump(by_alias=True, mode="json") for p in fw.provenance],
    }
