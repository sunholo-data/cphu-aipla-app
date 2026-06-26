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


@dataclass(frozen=True)
class RubricResult:
    """One rubric line's verdict for a draft."""

    id: str
    passed: bool
    note: str


@dataclass(frozen=True)
class RubricReport:
    """A draft's score against the whole structure rubric. ``framework_version``
    stamps which framework produced this score (1.1.50 M3 cohort comparability)."""

    framework_version: str
    lines: list[RubricResult]

    @property
    def total(self) -> int:
        return len(self.lines)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.lines if r.passed)


# Per-line keyword cues (Danish + English) for the PLACEHOLDER heuristic judge.
# Crude on purpose — AR's LLM-judge is the real scorer (the human gate). Keyed by
# RubricLine.id so the two stay in lock-step.
_HEURISTIC_CUES: dict[str, tuple[str, ...]] = {
    "objective": ("læringsmål", "mål:", "skal kunne", "objective", "goal", "lære", "forstå"),
    "prior_knowledge": ("allerede", "kender", "tidligere", "husk", "prior", "recall", "already"),
    "socratic_scaffold": ("?", "spørg", "hvorfor", "hvordan", "why", "how", "what"),
    "formative_checkpoint": ("tjek", "opsummer", "checkliste", "check", "summar", "vis at"),
    "curriculum_grounding": ("fagligt mål", "kernestof", "pensum", "syllabus", "curriculum"),
    "level_appropriate": ("niveau", "klasse", "-niveau", "1.g", "2.g", "3.g", "level", "year", "a/b/c"),
}


def _heuristic_judge(line: RubricLine, draft: str) -> tuple[bool, str]:
    """PLACEHOLDER scorer — a keyword presence check per rubric line. Returns
    (passed, note). Replace with AR's LLM-judge via ``score_draft(judge=...)``."""
    text = draft.lower()
    cues = _HEURISTIC_CUES.get(line.id, ())
    hit = next((c for c in cues if c in text), None)
    if hit:
        return True, f"heuristic: cue {hit!r} present"
    return False, "heuristic: no cue found (placeholder — AR LLM-judge is the real bar)"


# A judge maps (rubric line, draft) -> (passed, note). AR's LLM-judge plugs in here.
Judge = "Callable[[RubricLine, str], tuple[bool, str]]"


def score_draft(draft_goal: str, judge=None) -> RubricReport:
    """Score a draft lesson prompt against the structure rubric.

    Args:
        draft_goal: the proposed teaching goal / lesson prompt.
        judge: optional ``(RubricLine, str) -> (passed, note)``; defaults to the
            placeholder heuristic. AR's LLM-judge drops in here unchanged.

    Returns:
        A ``RubricReport`` (per-line verdicts + the framework version stamp)."""
    scorer = judge or _heuristic_judge
    lines = []
    for line in STRUCTURE_RUBRIC:
        passed, note = scorer(line, draft_goal)
        lines.append(RubricResult(id=line.id, passed=bool(passed), note=str(note)))
    return RubricReport(framework_version=FRAMEWORK_VERSION, lines=lines)


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
