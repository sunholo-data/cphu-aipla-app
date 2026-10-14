"""Load the artefact catalogue (1.1.41; teacher sims since in-app-sim-authoring M6).

Two halves:

- **Built-in** sims: each ``backend/artefacts/*.yaml`` file is one ``ArtefactMeta``
  (mirrors ``personas/loader.py``). Static at runtime, so cached for the process.
  Living backend-side (not under ``infrastructure/``) keeps it deployable with
  the backend image; the artefact CODE stays under ``infrastructure/mcp-sandbox``
  and is served by the sandbox service.
- **Teacher-published** sims from the Sim workshop (``db/teacher_sims.py``), read
  from Firestore with a short cache. If Firestore does not answer, the catalogue
  is the built-in half alone and the failure is logged: a blip must not take the
  built-in sims away from a lesson.

``load_artefact`` resolves either kind, whatever its level, so a class already
running a teacher sim keeps its frame and tutor block. Who may ATTACH a teacher
sim is a separate question, answered by ``can_attach``.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

import yaml

from artefacts.screenshots import builtin_screenshot_path, thumbnail_url
from db.models.artefact import ArtefactMeta

logger = logging.getLogger(__name__)

_ARTEFACT_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def builtin_artefacts() -> list[ArtefactMeta]:
    """Load + validate every YAML artefact definition, sorted by id."""
    artefacts: list[ArtefactMeta] = []
    for path in sorted(_ARTEFACT_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        meta = ArtefactMeta.model_validate(data)
        update: dict = {"source": "builtin"}
        if not meta.thumbnail and builtin_screenshot_path(meta.id, "700"):
            update["thumbnail"] = thumbnail_url(meta.id)
        artefacts.append(meta.model_copy(update=update))
    return artefacts


def _teacher_artefacts() -> list[ArtefactMeta]:
    try:
        from db.teacher_sims import live_metas

        builtin_ids = {a.id for a in builtin_artefacts()}
        return [m for m in live_metas() if m.id not in builtin_ids]
    except Exception:
        logger.warning("teacher sims unreadable; serving the built-in catalogue only", exc_info=True)
        return []


def load_artefacts(for_uid: str | None = None) -> list[ArtefactMeta]:
    """The catalogue a caller may choose from: every built-in sim, every
    shared-library teacher sim, and ``for_uid``'s own class-level sims."""
    teacher = [m for m in _teacher_artefacts() if m.scope == "library" or (for_uid and m.owner_uid == for_uid)]
    return builtin_artefacts() + sorted(teacher, key=lambda m: m.id)


def load_artefact(artefact_id: str) -> ArtefactMeta | None:
    """Return one artefact by id (built-in or live teacher sim), or None if absent."""
    found = next((a for a in builtin_artefacts() if a.id == artefact_id), None)
    if found is not None:
        return found
    return next((m for m in _teacher_artefacts() if m.id == artefact_id), None)


def is_known_artefact(artefact_id: str) -> bool:
    """True when ``artefact_id`` is a catalogued artefact (used to validate the
    activity-config reference — a bounded enum, never free input)."""
    return load_artefact(artefact_id) is not None


def can_attach(artefact_id: str, uid: str | None, *, is_researcher: bool = False) -> bool:
    """May this caller attach the sim to an activity? Built-in and library sims:
    anyone. A class-level teacher sim: its own teacher (the reviewer of record for
    their classes only), or a researcher."""
    meta = load_artefact(artefact_id)
    if meta is None:
        return False
    if meta.source != "teacher" or meta.scope == "library" or is_researcher:
        return True
    return bool(uid) and meta.owner_uid == uid
