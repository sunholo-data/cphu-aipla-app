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

from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, set_document
from frameworks.instruction import build_framework_instruction
from frameworks.loader import load_framework

_COLLECTION = "framework_overrides"

#: Storage allow-list — the route model validates, this stops a widened model
#: silently persisting junk (the ``teacher_prefs`` precedent).
_FIELDS = ("instruction", "updatedBy", "updatedAt", "version")


def get_framework_override(framework_id: str) -> dict[str, Any] | None:
    """The researcher's saved override for this framework, or None."""
    if not framework_id:
        return None
    doc = get_document(_COLLECTION, framework_id) or {}
    if not doc.get("instruction"):
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
        "updatedBy": updated_by,
        "updatedAt": datetime.now(UTC).isoformat(),
        "version": int(current.get("version") or 0) + 1,
    }
    set_document(_COLLECTION, framework_id, row, merge=False)
    return row


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
    if override and override.get("instruction"):
        return str(override["instruction"])
    return default_framework_instruction(framework_id)


__all__ = [
    "clear_framework_override",
    "default_framework_instruction",
    "get_framework_override",
    "resolve_framework_instruction",
    "save_framework_override",
]
