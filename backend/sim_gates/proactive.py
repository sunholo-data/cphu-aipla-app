"""Which emitted verbs wake the tutor.

The kind's last dot-segment is split on ``-`` and ``_``; if any token (or the
whole suffix) is a keyword, the event maps to that category. Completion is
checked first. Anything else maps to None and never triggers a proactive turn.

Two other copies exist and must agree with this one — a drift silently hides
proactive turns: ``frontend/src/lib/proactiveEventCheck.ts`` (the real gate) and
``.claude/skills/mcp-app-artefact/scripts/verify_sim.mjs``.
``tests/unit/test_sim_gates.py`` parses both and fails on any difference.
"""

from __future__ import annotations

import re

PROACTIVE_TOKENS: dict[str, tuple[str, ...]] = {
    "completion": ("complete", "completed", "finished", "solved", "submitted", "mission_complete", "answered_all"),
    "sim_run": ("play", "run", "simulate", "afspil"),
    "step_advance": ("step", "next", "advance", "placed", "calibrated"),
    "measurement_commit": ("measure", "record", "commit", "show_value", "reading", "fit", "spectrum"),
}


def proactive_category(kind: str) -> str | None:
    suffix = kind.rsplit(".", 1)[-1].lower()
    if not suffix:
        return None
    tokens = [t for t in re.split(r"[-_]", suffix) if t]
    for category, keywords in PROACTIVE_TOKENS.items():
        if suffix in keywords or suffix.replace("-", "_") in keywords:
            return category
        if any(t in keywords for t in tokens):
            return category
    return None
