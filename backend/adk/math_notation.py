r"""Mathematical-notation preamble (teacher feedback 2026-08-21, items 17 + 18).

Two teachers, one session:

    "We do not like asterisks used as multiplication signs."

    "We think there should be units and preferably symbols — writing
    'position = 0.2*time' is not acceptable. At minimum, a unit must be
    attached to 0.2."

Both are about what the tutor *writes*, and neither was covered anywhere. The
tutors carried a decimal-comma rule and, in one case, "SI units explicit" buried
in an anti-pattern list; nothing said anything about the multiplication sign,
and nothing told them to emit LaTeX at all — even though the chat has rendered
it since KaTeX landed (``remarkMath`` + ``rehypeKatex`` in ``ChatMarkdown``).

The argument is the one ``1db461f`` already made for axis labels: a graph with a
bare "tid" axis models bad practice at the moment a student is learning the
habit. ``position = 0.2*time`` is the same failure in prose, and it reaches
every student on every turn rather than only those who look at a plot.

**Why centralised and unconditional.**

Mirrors ``adk.multimodal.inject_image_input_preamble`` and
``adk.interaction_style.inject_interaction_style_preamble`` — the preamble body
lives in ``skills/preambles/math_notation.md``, not in four SKILL.md copies that
would drift.

Unlike those two it is **not opt-in**. How the platform writes mathematics is a
house style, not a per-skill capability, and a gate would be one more
registration site to forget: the next tutor added would silently not get it,
which is the footgun that produced three of the four defects in the 2026-08-21
session. Applying it to every skill is what makes coverage provable. The cost is
~1,000 chars against a 25,000-char instructions cap.

Deliberately an instruction, not a filter over model output. A post-hoc
``*`` → ``\cdot`` rewrite would corrupt a literal asterisk in a code block or a
footnote marker, and it cannot supply the missing *unit* at all. Tests guard the
instruction and the wiring; only an eval can prove the model complies.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

# backend/adk/math_notation.py -> backend/skills/preambles/math_notation.md
_PREAMBLE_PATH = Path(__file__).resolve().parents[1] / "skills" / "preambles" / "math_notation.md"


@lru_cache(maxsize=1)
def _load_preamble() -> str:
    """Read and cache the notation preamble. Empty string if missing."""
    try:
        return _PREAMBLE_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        log.warning("math_notation preamble missing: %s", _PREAMBLE_PATH)
        return ""


def build_math_notation_block() -> str:
    """The notation guidance, as a block to concatenate onto a tutor prompt.

    Returns a leading-newline-separated block so it composes with the other
    ``build_*`` blocks in ``adk.agent``, or ``""`` when the preamble file is
    missing — a lost preamble must degrade to "no guidance", never to a crash
    that takes every skill's agent build down with it (Axiom 5).
    """
    preamble = _load_preamble()
    if not preamble:
        return ""
    return f"\n\n{preamble}"


__all__ = ["build_math_notation_block"]
