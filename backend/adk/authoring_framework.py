"""Teaching-framework layer for the activity-authoring co-pilot (COPILOT-1 M0;
design 1.1.50 authoring-teaching-framework).

The framework is the researcher-owned pedagogy the co-pilot runs on. This module
is the **M0 (static) layer**: the default prompt ships in the
``activity-authoring-assistant`` SKILL.md (git), and the **structure rubric** —
the checkable skeleton a well-formed activity must satisfy — lives here as data so
the M2 eval can score a draft against it.

What is NOT here yet (later sprints): the researcher Firestore override store
(1.1.50 M2, rides 1.1.47 M2 — edit + version without reseed). Until then the
framework is the seeded SKILL.md, swappable by ``make seed``.

**Human gate:** the prompt + rubric below are a *placeholder*
(``FRAMEWORK_IS_PLACEHOLDER``). AR/JB own the real pedagogical content; swapping
it in is one edit to the SKILL.md + this rubric, behind the teacher-tier dark
flag so the manual builder is never affected (Axiom 5).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# Bumped whenever the framework prompt OR rubric changes; stamped onto authored
# activities (1.1.50 M3) so studies can control for which framework produced what.
FRAMEWORK_VERSION = "0.1.0-placeholder"

# True until AR/JB sign off on the real teaching framework. The co-pilot stays
# behind the teacher-tier dark flag while this is True.
FRAMEWORK_IS_PLACEHOLDER = True

_TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent / "skills" / "templates" / "activity-authoring-assistant" / "SKILL.md"
)


@dataclass(frozen=True)
class RubricLine:
    """One checkable structural requirement a well-formed activity must meet.

    ``id`` is stable (the eval keys + reports on it); ``check`` is the
    human-readable criterion (also what an LLM-judge scores against in M2)."""

    id: str
    check: str


# The structure rubric (1.1.50 §2). A *placeholder* skeleton for stx physics —
# AR/JB own the real lines. Each maps to a co-pilot tool it should steer toward
# (see the design doc's "how the framework steers the shipped tools" table).
STRUCTURE_RUBRIC: list[RubricLine] = [
    RubricLine("objective", "States the learning objective up front."),
    RubricLine("prior_knowledge", "Activates the student's prior knowledge before introducing new content."),
    RubricLine("socratic_scaffold", "Scaffolds Socratically — asks guiding questions, never hands over the answer."),
    RubricLine("formative_checkpoint", "Includes a formative checkpoint (a checklist step or a solution element)."),
    RubricLine("curriculum_grounding", "Grounds in the syllabus (fagligt mål / kernestof) at the right A/B/C level."),
    RubricLine("level_appropriate", "Language and difficulty match the stated class level."),
]


def default_framework_prompt() -> str:
    """The git-default framework prompt = the shipped authoring-assistant skill
    instruction (so a researcher override, 1.1.47 M2, layers onto exactly this).

    Reads the SKILL.md template — the single source of the seeded prompt — rather
    than duplicating it here."""
    from admin.platform_seed import _parse_template

    return _parse_template(_TEMPLATE_PATH)["instructions"]


def rubric_ids() -> list[str]:
    """Stable list of rubric line ids (the eval's scoring key)."""
    return [line.id for line in STRUCTURE_RUBRIC]
