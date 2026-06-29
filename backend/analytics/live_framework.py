"""Placeholder R1 framework for the live class summary (1.1.31 M1).

R1 (the JB/AR pedagogical decision — ICAP+FCI vs CPS+DRA) gates the *content* of
the rolling class summary. Rather than block M1, we ship a provisional,
**swappable** ``LiveFrameworkConfig``. When R1 is settled with AR, swap the
config object below — the summary generator, endpoint, and UI don't change.

Default (``AIPLA_LIVE_V0``):
  - engagement via **ICAP-lite** (Interactive > Constructive > Active > Passive):
    domain-general, no per-topic concept map needed.
  - concept coverage via **DRA-lite** (seeded from the activity's learning goal);
    degrades to engagement-only when absent.

Swap path:
  - ICAP+FCI  → keep engagement_modes, point concept_source at an FCI item map.
  - CPS+DRA   → replace engagement_modes with the CPS categories, populate the
    real per-topic DRA map.

Design doc: docs/design/aipla/v1.1.0-feedback/teacher-analytics-framework.md
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LiveFrameworkConfig:
    name: str
    engagement_modes: tuple[str, ...]
    concept_source: str  # "activity_goal" | "none"
    prompt_preamble: str


AIPLA_LIVE_V0 = LiveFrameworkConfig(
    name="AIPLA live-summary v0",
    engagement_modes=("Interactive", "Constructive", "Active", "Passive"),
    concept_source="activity_goal",
    prompt_preamble=(
        "You are briefing a physics teacher on how their class is doing RIGHT NOW, "
        "from live per-group signals. Classify each group's engagement on the ICAP "
        "scale (Interactive > Constructive > Active > Passive) and call out any group "
        "that looks stuck. Keep it to 2-3 sentences a teacher can glance at. Refer to "
        "groups by their code only, never individual students. Do not invent any detail "
        "that is not in the signals."
    ),
)

#: The framework the summary generator uses. Swap this when R1 is settled.
DEFAULT_FRAMEWORK = AIPLA_LIVE_V0
