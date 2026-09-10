"""Load the YAML base-tutor catalogue (1.1.91 M1).

Third instance of the same pattern as ``personas/loader.py`` and
``frameworks/loader.py`` — ``yaml.safe_load`` + ``lru_cache``, one file per
entry. Kept identical on purpose: three catalogues that behave the same way are
one thing to learn.

**What a base tutor is.** One per shipped persona, carrying that persona's
identity and teaching style and **no framework**. Selecting one therefore
composes byte-identically to how that persona behaved before tutors existed,
which is what lets the picker replace two controls without changing any
activity's behaviour.

**Why no base tutor carries a framework.** "Sofie teaches with ESRU" is a
pedagogical claim, and this catalogue does not make claims nobody signed off —
the same rule that keeps five of seven frameworks as empty slots. A
framework-bearing tutor is a **variant**, created deliberately by a researcher,
with lineage back to its base (``db/tutors.py``).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from db.models.tutor import Tutor

_TUTOR_DIR = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def load_base_tutors() -> list[Tutor]:
    """Load + validate every YAML base tutor, sorted by id."""
    tutors: list[Tutor] = []
    for path in sorted(_TUTOR_DIR.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        tutors.append(Tutor.model_validate(data))
    return tutors


def load_base_tutor(tutor_id: str | None) -> Tutor | None:
    """One base tutor by id, or None. None-tolerant: no tutor is a valid state."""
    if not tutor_id:
        return None
    return next((t for t in load_base_tutors() if t.id == tutor_id), None)


def base_tutor_ids() -> list[str]:
    return [t.id for t in load_base_tutors()]


__all__ = ["base_tutor_ids", "load_base_tutor", "load_base_tutors"]
