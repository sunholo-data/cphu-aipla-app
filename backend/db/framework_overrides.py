"""Researcher-edited teaching-framework instructions (1.1.91 M1).

One Firestore doc per framework at ``framework_overrides/{framework_id}``,
holding the instruction a researcher edited by hand. Missing doc ⇒ the
instruction rendered from the YAML framework ⇒ the system behaves exactly as if
this feature did not exist.

That layering is the pattern ``adk/authoring_framework.py`` already describes for
the co-pilot's own framework — *"the researcher Firestore override store … the
git default is the seeded prompt"* — applied to the tutor side. The YAML stays
the source of the DEFAULT; Firestore holds only the delta a human chose.

``version`` increments on every save. It is the same reason ``Tutor.version``
exists: 1.1.92 attributes a scored session to what actually ran, and an
instruction edited in place makes earlier sessions unattributable.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, set_document
from db.models.teaching_framework import TeachingFramework
from frameworks.instruction import build_framework_instruction
from frameworks.loader import load_framework

log = logging.getLogger(__name__)

_COLLECTION = "framework_overrides"

#: Storage allow-list — the route model validates, this stops a widened model
#: silently persisting junk (the ``teacher_prefs`` precedent).
_FIELDS = ("instruction", "structure", "mode", "updatedBy", "updatedAt", "version")

#: Which edit produced the current row. ``text`` is the original 1.1.91 M1
#: behaviour — a researcher edits the RENDERED instruction. ``structured`` is
#: 1.1.91 TUTOR-4 — they edit the constructs, behaviours and citations, and the
#: instruction is regenerated from them.
#:
#: These are two modes of one field rather than two layers, and the row records
#: which one it is in. A row carrying both an ``instruction`` and a
#: ``structure`` would otherwise have no defined answer to "which is live", and
#: the answer would be discovered in production.
OverrideMode = str


def get_framework_override(framework_id: str) -> dict[str, Any] | None:
    """The researcher's saved override for this framework, or None.

    A row counts as an override only if it actually carries an edit — text in
    ``instruction`` or a body in ``structure``. An empty row is not an override,
    which is what makes deleting one a clean revert.
    """
    if not framework_id:
        return None
    doc = get_document(_COLLECTION, framework_id) or {}
    if not doc.get("instruction") and not doc.get("structure"):
        return None
    return {k: doc[k] for k in _FIELDS if k in doc}


def save_framework_override(framework_id: str, instruction: str, *, updated_by: str) -> dict[str, Any]:
    """Store an edited instruction; returns the saved row.

    ``updated_by`` is the VERIFIED caller uid — provenance on a research
    instrument is not optional, and the route never lets the client supply it.
    """
    current = get_framework_override(framework_id) or {}
    row = {
        "instruction": instruction,
        "mode": "text",
        "updatedBy": updated_by,
        "updatedAt": datetime.now(UTC).isoformat(),
        "version": int(current.get("version") or 0) + 1,
    }
    # merge=False: writing a text edit DROPS any structure the row held. The two
    # are alternative answers to "what is this framework", not layers, and a
    # stale structure left underneath a hand-written instruction is a trap for
    # whoever opens the structural editor next.
    set_document(_COLLECTION, framework_id, row, merge=False)
    return row


def save_framework_structure(
    framework_id: str,
    structure: dict[str, Any],
    *,
    updated_by: str,
) -> dict[str, Any]:
    """Store an edited framework STRUCTURE — constructs, behaviours, citations.

    This is what keeps a researcher's edit reviewable. Editing the rendered text
    (``save_framework_override``) can say anything at all; editing the structure
    means the instruction is still GENERATED from constructs that each trace to
    a source, which is the property 1.1.91 exists to preserve.

    ``structure`` must already have been validated against ``TeachingFramework``
    by the caller — the route does it, which is where ``Provenance.vouched_by``
    (no default, min length 1) makes an unvouched citation unconstructable.
    """
    current = get_framework_override(framework_id) or {}
    row = {
        "structure": structure,
        "mode": "structured",
        "updatedBy": updated_by,
        "updatedAt": datetime.now(UTC).isoformat(),
        "version": int(current.get("version") or 0) + 1,
    }
    set_document(_COLLECTION, framework_id, row, merge=False)
    return row


def effective_framework(framework_id: str | None) -> TeachingFramework | None:
    """The framework as it currently stands — YAML with any structural edit applied.

    Everything that needs to know what a framework SAYS should read this rather
    than ``load_framework``, which returns the git default and is now only half
    the answer.

    A malformed stored structure degrades to the YAML base and logs, rather than
    raising: this sits on the agent path, and a bad row must not take a lesson
    down (Axiom 5). It must not vanish silently either, hence the log with the id.
    """
    base = load_framework(framework_id) if framework_id else None
    if base is None:
        return None
    row = get_document(_COLLECTION, framework_id) or {}
    if row.get("mode") != "structured" or not row.get("structure"):
        return base
    try:
        merged = base.model_dump(by_alias=True, mode="json")
        merged.update(row["structure"])
        # id and source are the store's to state, never the payload's.
        merged["id"] = base.id
        merged["source"] = "firestore"
        return TeachingFramework.model_validate(merged)
    except Exception as exc:
        log.warning(
            "framework_overrides: structure for %s is malformed, using the YAML default: %s",
            framework_id,
            exc,
        )
        return base


def clear_framework_override(framework_id: str) -> None:
    """Revert to the YAML-rendered default by deleting the override."""
    if framework_id:
        delete_document(_COLLECTION, framework_id)


def default_framework_instruction(framework_id: str | None) -> str:
    """The instruction rendered from the git YAML — the reverted state."""
    return build_framework_instruction(load_framework(framework_id))


def resolve_framework_instruction(framework_id: str | None) -> str:
    """What the tutor actually gets: the override if one exists, else the render.

    Empty string when the framework is unset, unknown, a placeholder, or has no
    drafted behaviours — every one of which is a passthrough for the caller.
    """
    if not framework_id:
        return ""
    override = get_framework_override(framework_id)
    if override:
        if override.get("mode") == "structured":
            # Regenerated from the edited constructs, so a structural edit
            # reaches the tutor by the same path the git default does.
            return build_framework_instruction(effective_framework(framework_id))
        if override.get("instruction"):
            return str(override["instruction"])
    return default_framework_instruction(framework_id)


__all__ = [
    "clear_framework_override",
    "default_framework_instruction",
    "effective_framework",
    "get_framework_override",
    "resolve_framework_instruction",
    "save_framework_override",
    "save_framework_structure",
]
