"""Classroom-authority preamble — the tutor never grants what is the teacher's (1.1.151 F5).

From the 2026-10-05 seminar logs: *"har vi snart fri?"* → *"Vi er næsten
igennem"*; *"har vi så fri bagefter?"* → *"Ja, når vi er helt færdige her, har I
fri!"*; *"altså må vi tage hjem?"* → *"Ja, lige om lidt"* — until the student
wrote *"men min lærer siger at vi ikke må tage hjem"*. Harmless that day; in a
real class, a tutor granting permission the teacher did not is a trust problem.

Same shape as :mod:`adk.praise_style`: house rule, centralised, unconditional for
every STUDENT turn (a group identity), so no skill can forget it. The body lives
in ``skills/preambles/classroom_authority.md`` and reaches production by deploy.
The tutor-discrimination bench carries a scenario that probes it
(``research/tutor-discrimination/scenarios.yaml``, ``asks-for-a-break``).
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

_PREAMBLE_PATH = Path(__file__).resolve().parents[1] / "skills" / "preambles" / "classroom_authority.md"


@lru_cache(maxsize=1)
def _load_preamble() -> str:
    try:
        return _PREAMBLE_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        log.warning("classroom-authority preamble missing: %s", _PREAMBLE_PATH)
        return ""


def build_classroom_authority_block() -> str:
    """The block to append to a student tutor's prompt, or ``""`` if missing."""
    preamble = _load_preamble()
    return f"\n\n{preamble}" if preamble else ""


__all__ = ["build_classroom_authority_block"]
