"""Load the YAML teaching-framework catalogue (1.1.91 M0).

Mirrors ``personas/loader.py`` deliberately — same ``yaml.safe_load`` +
``lru_cache`` shape, so the two catalogues stay one pattern rather than two.
Each ``backend/frameworks/*.yaml`` file is one ``TeachingFramework``.

The catalogue is the **git-default** layer. Researcher- and teacher-authored
frameworks land in Firestore at 1.1.91 M1 and layer onto exactly this, the way
``authoring_framework.default_framework_prompt`` reads the seeded SKILL.md.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from db.models.teaching_framework import TeachingFramework

_FRAMEWORK_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def load_frameworks() -> list[TeachingFramework]:
    """Load + validate every YAML framework definition, sorted by id."""
    frameworks: list[TeachingFramework] = []
    for path in sorted(_FRAMEWORK_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        frameworks.append(TeachingFramework.model_validate(data))
    return frameworks


def load_framework(framework_id: str | None) -> TeachingFramework | None:
    """Return one framework by id, or None if absent/unset.

    None-tolerant on purpose (Axiom 5): a tutor with no framework is a valid
    tutor — it simply carries no theory — and an unknown id degrades to the same
    passthrough rather than raising on the agent path.
    """
    if not framework_id:
        return None
    return next((f for f in load_frameworks() if f.id == framework_id), None)


def ready_frameworks() -> list[TeachingFramework]:
    """Frameworks whose pedagogy is drafted — i.e. not bare slots. These are the
    ones a tutor prompt can actually be generated from (1.1.91 M2)."""
    return [f for f in load_frameworks() if not f.is_placeholder]


def framework_ids() -> list[str]:
    """Stable list of catalogue ids."""
    return [f.id for f in load_frameworks()]


__all__ = [
    "framework_ids",
    "load_framework",
    "load_frameworks",
    "ready_frameworks",
]
