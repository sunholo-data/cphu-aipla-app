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
    get_framework_override,
    save_framework_override,
)
from db.models.teaching_framework import TeachingFramework
from frameworks.loader import load_framework, load_frameworks

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/research/frameworks", tags=["research", "frameworks"])

# Generous but bounded: the ESRU render is ~2k, and a researcher elaborating on
# four constructs has room. Unbounded free text into a system prompt is not a
# thing to ship.
_MAX_INSTRUCTION = 20000


class InstructionUpdate(BaseModel):
    instruction: str = Field(min_length=1, max_length=_MAX_INSTRUCTION)


def _serialize(fw: TeachingFramework) -> dict:
    """One framework, with its default render and any researcher override."""
    override = get_framework_override(fw.id)
    default = default_framework_instruction(fw.id)
    return {
        **fw.model_dump(by_alias=True, mode="json"),
        # What the tutor actually receives right now.
        "instruction": (override or {}).get("instruction") or default,
        # What it would receive with no override — always sent, so the editor can
        # show the delta and offer a truthful Revert.
        "defaultInstruction": default,
        "isOverridden": override is not None,
        "overriddenBy": (override or {}).get("updatedBy"),
        "overriddenAt": (override or {}).get("updatedAt"),
        "overrideVersion": (override or {}).get("version"),
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
