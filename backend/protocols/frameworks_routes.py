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
from pydantic import BaseModel, Field

# Firebase-ONLY verifier, deliberately: this is a researcher surface and an
# anonymous-group student JWT has no business reaching it (see
# scripts/check-auth-dispatcher.sh, where this file is allowlisted with that
# reason). The dispatcher would let a group token through to assert_researcher
# and be denied there instead — safe, but a layer too late and against the
# stated convention.
from auth.firebase_auth import User, get_current_user
from auth.guards import assert_researcher
from db.framework_overrides import (
    clear_framework_override,
    default_framework_instruction,
    effective_framework,
    get_framework_override,
    resolve_framework_instruction,
    save_framework_override,
    save_framework_structure,
)
from db.models.teaching_framework import Construct, Provenance, TeachingFramework
from frameworks.instruction import build_framework_instruction
from frameworks.loader import load_framework, load_frameworks

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research/frameworks", tags=["research", "frameworks"])

# Generous but bounded: the ESRU render is ~2k, and a researcher elaborating on
# four constructs has room. Unbounded free text into a system prompt is not a
# thing to ship.
_MAX_INSTRUCTION = 20000


class InstructionUpdate(BaseModel):
    instruction: str = Field(min_length=1, max_length=_MAX_INSTRUCTION)


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
    """

    summary: str = Field(default="", max_length=800)
    constructs: list[Construct] = Field(default_factory=list, max_length=20)
    provenance: list[Provenance] = Field(default_factory=list, max_length=10)

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


@router.get("/{framework_id}")
async def get_framework_route(
    framework_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    assert_researcher(user)
    return _serialize(_require(framework_id))


@router.put("/{framework_id}/instruction")
async def put_framework_instruction_route(
    framework_id: str = Path(...),
    body: InstructionUpdate = Body(...),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Save a researcher-edited instruction for this framework.

    ``updated_by`` is taken from the VERIFIED token, never from the body:
    provenance on a research instrument is not a client-supplied field.
    """
    assert_researcher(user)
    fw = _require(framework_id)
    save_framework_override(fw.id, body.instruction.strip(), updated_by=user.uid)
    log.info("framework instruction overridden: framework=%s by=%s", fw.id, user.uid)
    return _serialize(fw)


@router.delete("/{framework_id}/instruction")
async def delete_framework_instruction_route(
    framework_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Revert to the instruction rendered from the YAML constructs."""
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
