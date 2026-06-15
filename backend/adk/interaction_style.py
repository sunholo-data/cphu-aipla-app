"""Tutor interaction-style preamble injection (1.1.20).

Selects a teaching-voice preamble for an activity from its
``ActivityConfig.interaction_style`` and appends it to the tutor's system
prompt at agent-instantiation time.

``socratic`` (the default) is a **passthrough** — nothing is injected, so the
current SKILL.md behaviour stands and existing tutors are byte-for-byte
unchanged. The other styles append an override preamble that countermands the
Socratic "end every turn with a question" rule for that one activity.

The Socratic extraction / de-dup (making ``socratic.md`` the single source of
truth and removing the inline block from the tutor SKILL.md files) is a
deliberate follow-up — see ``docs/.../tutor-personas-sprint.md``.

A persona (1.1.12) is a higher-level bundle that *ties* an interaction style to
a voice + avatar + name; it resolves down to the ``interaction_style`` this
module consumes, so this stays the primitive.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from functools import lru_cache
from pathlib import Path

from adk.teacher_focus import resolve_active_config

log = logging.getLogger(__name__)

# backend/adk/interaction_style.py -> backend/skills/preambles/interaction_style/
_PREAMBLE_DIR = Path(__file__).resolve().parents[1] / "skills" / "preambles" / "interaction_style"

# socratic is the untouched default — no preamble is injected for it this sprint.
_PASSTHROUGH = "socratic"

# The teaching-style vocabulary (mirrors db.models.activity_config.InteractionStyle).
_STYLE_IDS = ("socratic", "concise", "rigorous", "warm")
# Internal authoring notes (AR-TODOs, the socratic canonical-source banner) live
# as HTML comments in the preamble files — strip them before surfacing the text
# to teachers.
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


@lru_cache(maxsize=8)
def _load_preamble(style: str) -> str:
    """Read and cache a style preamble. Empty string if the file is missing."""
    path = _PREAMBLE_DIR / f"{style}.md"
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        log.warning("interaction_style preamble missing: %s", path)
        return ""


def inject_interaction_style_preamble(
    instructions: str,
    activity_id: str,
    *,
    group_tags: Iterable[str] | None = None,
) -> str:
    """Append the chosen interaction-style override preamble to a tutor prompt.

    No-op (returns ``instructions`` unchanged) when:
      - no ``ActivityConfig`` resolves (unconfigured activity), or
      - the resolved style is ``socratic`` (the untouched default), or
      - the style is unknown / its preamble file is missing.

    For ``concise`` / ``rigorous`` / ``warm`` the preamble is appended after the
    base instructions (later instruction wins, so it overrides the SKILL.md
    Socratic rule).
    """
    cfg = resolve_active_config(activity_id, group_tags=group_tags)
    style = cfg.interaction_style if cfg else _PASSTHROUGH

    # Per-class persona drives the teaching style too: when the activity has no
    # explicit persona, inherit THIS class's default persona's style (so picking
    # one persona at the class level sets avatar + voice + style together). An
    # activity persona already wrote its style into cfg.interaction_style at save.
    if cfg is not None and not cfg.persona:
        from db.classes import get_class
        from personas.loader import load_persona

        cls = get_class(cfg.class_id)
        if cls is not None and cls.persona:
            p = load_persona(cls.persona)
            if p is not None:
                style = p.interaction_style

    if style == _PASSTHROUGH:
        return instructions

    preamble = _load_preamble(style)
    if not preamble:
        # Unknown style or missing file -> fall back to the socratic default.
        log.info(
            "inject_interaction_style_preamble: no preamble for style=%s activity=%s — passthrough",
            style,
            activity_id,
        )
        return instructions

    log.info(
        "inject_interaction_style_preamble: activity=%s style=%s (+%d chars)",
        activity_id,
        style,
        len(preamble),
    )
    return f"{instructions}\n\n{preamble}"


def list_interaction_styles() -> list[dict]:
    """Return each teaching style's enforced instruction, for teacher visibility.

    A persona's teaching style is enforced as a **prompt**: the ``concise`` /
    ``rigorous`` / ``warm`` styles APPEND an override preamble to the tutor's
    system instructions (``injected=True``); ``socratic`` is the untouched
    default whose "≤3 sentences, end with a question" rule is baked into the
    tutor ``SKILL.md`` itself, so nothing is appended (``injected=False``). The
    text is the single source of truth read from the preamble files, with
    internal HTML comments stripped — so the teacher UI can show exactly what
    the tutor is told without duplicating (and drifting from) the prompt.
    """
    styles: list[dict] = []
    for style in _STYLE_IDS:
        prompt = _COMMENT_RE.sub("", _load_preamble(style)).strip()
        styles.append(
            {
                "id": style,
                "prompt": prompt,
                "injected": style != _PASSTHROUGH,
            }
        )
    return styles


__all__ = ["inject_interaction_style_preamble", "list_interaction_styles"]
