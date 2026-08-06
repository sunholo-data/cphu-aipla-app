"""Image-input preamble injection (1.1.7 multimodal upload).

When a skill opts into ``SkillConfig.multimodal_input``, the student composer
exposes an image-upload affordance (paperclip + camera). Uploaded images ride
the turn as native AG-UI ``ImageInputContent`` parts; ``ag_ui_adk`` converts
them to ADK image ``Part``s that persist in session history and are replayed
every turn (no custom injector — the protocol + ADK handle retention).

This module appends the canonical "how to handle an attached photo" guidance
(``skills/preambles/image_input.md``) to the tutor's system prompt at
agent-instantiation time — but ONLY for skills that opt in. It mirrors
``adk.interaction_style.inject_interaction_style_preamble``:

  - Centralising the units-loop / no-solve / privacy guidance keeps it DRY and
    out of every SKILL.md body. This was originally forced by the 10,000-char
    body cap (problem-set-hints sat at 9,876 of it, so an inline block would
    have overflowed). The cap is 25,000 since 2026-08-06 — centralising is now
    a DRY choice, not a workaround.
  - Skills with ``multimodal_input=False`` are byte-for-byte unchanged
    (passthrough), so non-multimodal tutors are unaffected.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path

log = logging.getLogger(__name__)

# backend/adk/multimodal.py -> backend/skills/preambles/image_input.md
_PREAMBLE_PATH = Path(__file__).resolve().parents[1] / "skills" / "preambles" / "image_input.md"


@lru_cache(maxsize=1)
def _load_preamble() -> str:
    """Read and cache the image-input preamble. Empty string if missing."""
    try:
        return _PREAMBLE_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        log.warning("image_input preamble missing: %s", _PREAMBLE_PATH)
        return ""


def inject_image_input_preamble(instructions: str, multimodal_input: bool) -> str:
    """Append the image-input guidance to a tutor prompt when the skill opts in.

    No-op (returns ``instructions`` unchanged) when ``multimodal_input`` is
    False or the preamble file is missing. Appended after the base instructions
    (later instruction wins) so it sits right after the SKILL.md body.
    """
    if not multimodal_input:
        return instructions
    preamble = _load_preamble()
    if not preamble:
        return instructions
    log.info("inject_image_input_preamble: applied (+%d chars)", len(preamble))
    return f"{instructions}\n\n{preamble}"


__all__ = ["inject_image_input_preamble"]
