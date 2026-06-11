"""Load the YAML persona catalogue (1.1.12).

Mirrors the SKILL.md frontmatter parsing pattern (``yaml.safe_load``); each
``backend/personas/*.yaml`` file is one Persona. Cached — the catalogue is
static at runtime.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml

from db.models.persona import Persona

_PERSONA_DIR = Path(__file__).resolve().parent

# 1.1.12 default identity: when an activity/skill has no explicit persona, the
# chat falls back to THIS persona's avatar + name + voice, so every conversation
# shows a real educator identity instead of the generic brand mark. Sofie is the
# "allround fysiklærer" — the most neutral of the six. Override per env with
# DEFAULT_PERSONA_ID (e.g. set "" to opt out and keep the brand-mark fallback).
DEFAULT_PERSONA_ID = os.environ.get("DEFAULT_PERSONA_ID", "sofie")


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


def load_default_persona() -> Persona | None:
    """The global fallback persona (``DEFAULT_PERSONA_ID``), or None if the id is
    unset/empty/missing — in which case callers keep the brand-mark fallback."""
    if not DEFAULT_PERSONA_ID:
        return None
    return load_persona(DEFAULT_PERSONA_ID)


def resolve_persona_or_default(persona_id: str | None) -> Persona | None:
    """The explicitly-assigned persona if set + loadable, else the global default."""
    if persona_id:
        p = load_persona(persona_id)
        if p is not None:
            return p
    return load_default_persona()


__all__ = [
    "DEFAULT_PERSONA_ID",
    "load_default_persona",
    "load_persona",
    "load_personas",
    "resolve_persona_or_default",
]
