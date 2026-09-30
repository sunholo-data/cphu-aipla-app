r"""Praise preamble — earned praise only (BENCH-2, JB 2026-09-29).

JB, after his experienced-teacher session: *"Mikkel was too sycophantic."*

The BENCH-2 benchmark (``docs/design/aipla/v1.1.0-feedback/tutor-discrimination-benchmark-sprint.md``)
separated two things that sentence could mean. **Agreeing with a wrong claim:
never** — 0 of 112 tutors did, across four planted misconceptions. **Tone:
constantly** — a stock *"Det er et rigtig godt spørgsmål"* opened nearly every
dialogue, graded *marked* in 21 of 56 flash-lite transcripts. It did not depend
on the teaching approach, so no approach instruction was ever going to remove it.
It is the tutor model's habit, which makes it house style.

**Why centralised and unconditional** — the same argument as
:mod:`adk.math_notation`: how the platform praises is house style, not a per-skill
capability, and an opt-in flag would be one more registration site for the next
tutor to miss. The body lives in ``skills/preambles/praise.md``.

**Consistent with the approaches, not against them.** ESRU's *recognise* step
already asks the tutor to revoice a student without a verdict, and the fidelity
judge (``fidelity-r2``) counts praise as generic at most. This preamble makes that
the default for every tutor, whatever its approach.

**Reaches production by DEPLOY, not by seed** — read from disk at agent-build
time, exactly like the notation preamble.

An instruction, not a filter: rewriting the model's output would be brittle and
cannot tell earned praise from stock praise. The benchmark's tone probe
(``tone-r1``) is how compliance is measured.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

# backend/adk/praise_style.py -> backend/skills/preambles/praise.md
_PREAMBLE_PATH = Path(__file__).resolve().parents[1] / "skills" / "preambles" / "praise.md"


@lru_cache(maxsize=1)
def _load_preamble() -> str:
    """Read and cache the praise preamble. Empty string if missing."""
    try:
        return _PREAMBLE_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        log.warning("praise preamble missing: %s", _PREAMBLE_PATH)
        return ""


def build_praise_block() -> str:
    """The praise guidance, as a block to concatenate onto a tutor prompt.

    Leading-newline-separated so it composes with the other ``build_*`` blocks,
    or ``""`` when the file is missing — a lost preamble degrades to "no
    guidance", never to a crash that takes every agent build down (Axiom 5).
    """
    preamble = _load_preamble()
    if not preamble:
        return ""
    return f"\n\n{preamble}"


__all__ = ["build_praise_block"]
