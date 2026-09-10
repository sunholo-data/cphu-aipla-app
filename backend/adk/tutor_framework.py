"""Teaching-framework preamble injection (1.1.91 M1).

Sibling of ``adk/interaction_style.py`` and deliberately the same shape: resolve
the activity's choice, append a preamble, and be a **passthrough** when nothing
is chosen. An activity with no ``framework_id`` composes byte-identically to
before this module existed — the 1.1.20 precedent, taken for the same reason
(injecting into every tutor turn at once is a blast radius nobody asked for).

The text comes from ``db.framework_overrides.resolve_framework_instruction``, so
a researcher's edit reaches a live turn without a commit, a deploy or a seed.
That is the whole point of 1.1.91: the people who own the pedagogy cannot write
files in git.

**Ordering against interaction_style.** This preamble is appended AFTER the
style override, on the "later instruction wins" convention the composition chain
already runs on. So where a framework's moves and a voice preset disagree, the
**pedagogy outranks the voice**: ``concise`` says "no follow-up question", ESRU's
Elicit says "ask for an explanation", and a framework the researcher chose
deliberately should win over a tone preset. This is the clash the design doc
parks as M6 (the advisory gatekeeper at assignment time); the runtime precedence
is decided here rather than left to whichever nesting happened to be written.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from adk.teacher_focus import class_id_from_group_tags, resolve_active_config

log = logging.getLogger(__name__)


def resolve_framework_id(
    activity_id: str,
    *,
    group_tags: Iterable[str] | None = None,
) -> str | None:
    """The framework this turn runs on: the activity's, else its class's.

    Mirrors the persona/interaction-style resolution order so a framework set at
    the class level applies to activities that never saved a config — the drift
    ``inject_interaction_style_preamble`` documents having been bitten by.
    """
    from adk.tutor_resolution import resolve_teaching

    cfg = resolve_active_config(activity_id, group_tags=group_tags)
    # 1.1.91 M1: the activity's TUTOR decides first — one bundled choice
    # carrying persona + framework + style — and only then the individual
    # framework_id field that pre-tutor activities use.
    resolution = resolve_teaching(cfg)
    if resolution.framework_id:
        return resolution.framework_id

    class_id = cfg.class_id if cfg is not None else class_id_from_group_tags(group_tags)
    if not class_id:
        return None
    from db.classes import get_class

    cls = get_class(class_id)
    return getattr(cls, "framework_id", None) if cls is not None else None


def inject_framework_preamble(
    instructions: str,
    activity_id: str,
    *,
    group_tags: Iterable[str] | None = None,
) -> str:
    """Append the resolved teaching-framework preamble to a tutor prompt.

    No-op (returns ``instructions`` unchanged) when no framework resolves, when
    the id is unknown, when the framework is still a placeholder, or when its
    resolved instruction is empty. Every one of those is the passthrough case.
    """
    framework_id = resolve_framework_id(activity_id, group_tags=group_tags)
    if not framework_id:
        return instructions

    from db.framework_overrides import resolve_framework_instruction

    preamble = resolve_framework_instruction(framework_id)
    if not preamble:
        log.info(
            "inject_framework_preamble: no instruction for framework=%s activity=%s — passthrough",
            framework_id,
            activity_id,
        )
        return instructions

    log.info(
        "inject_framework_preamble: activity=%s framework=%s (+%d chars)",
        activity_id,
        framework_id,
        len(preamble),
    )
    return f"{instructions}\n\n{preamble}"


__all__ = ["inject_framework_preamble", "resolve_framework_id"]
