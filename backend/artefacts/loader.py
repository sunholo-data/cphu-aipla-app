"""Load the YAML artefact catalogue (1.1.41).

Mirrors ``personas/loader.py`` (1.1.12): each ``backend/artefacts/*.yaml`` file
is one ``ArtefactMeta``. Cached — the catalogue is static at runtime. Living
backend-side (not under ``infrastructure/``) keeps it deployable with the
backend image; the artefact CODE stays under ``infrastructure/mcp-sandbox`` and
is served by the sandbox service.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from db.models.artefact import ArtefactMeta

_ARTEFACT_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def load_artefacts() -> list[ArtefactMeta]:
    """Load + validate every YAML artefact definition, sorted by id."""
    artefacts: list[ArtefactMeta] = []
    for path in sorted(_ARTEFACT_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        artefacts.append(ArtefactMeta.model_validate(data))
    return artefacts


def load_artefact(artefact_id: str) -> ArtefactMeta | None:
    """Return one artefact by id, or None if absent."""
    return next((a for a in load_artefacts() if a.id == artefact_id), None)


def is_known_artefact(artefact_id: str) -> bool:
    """True when ``artefact_id`` is a catalogued artefact (used to validate the
    activity-config reference — a bounded enum, never free input)."""
    return load_artefact(artefact_id) is not None
