"""Load the YAML persona catalogue (1.1.12).

Mirrors the SKILL.md frontmatter parsing pattern (``yaml.safe_load``); each
``backend/personas/*.yaml`` file is one Persona. Cached — the catalogue is
static at runtime.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from db.models.persona import Persona

_PERSONA_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def load_personas() -> list[Persona]:
    """Load + validate every YAML persona definition, sorted by id."""
    personas: list[Persona] = []
    for path in sorted(_PERSONA_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        personas.append(Persona.model_validate(data))
    return personas


def load_persona(persona_id: str) -> Persona | None:
    """Return one persona by id, or None if absent."""
    return next((p for p in load_personas() if p.id == persona_id), None)


__all__ = ["load_persona", "load_personas"]
