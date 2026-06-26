"""Eval scaffold for the activity-authoring co-pilot's structure rubric
(COPILOT-1 M2; 1.1.39 testing strategy + 1.1.50 §2).

This is the harness AR plugs the real LLM-judge + real teacher-request fixtures
into to score whether the co-pilot's drafted lesson prompts satisfy the teaching
framework. The SHIPPED default judge is a placeholder heuristic — AR owns the real
scoring key (the human gate).

Not a pytest module (no ``test_`` prefix → not auto-collected). Run directly:

    cd backend && uv run python tests/eval/authoring_rubric_eval.py

or import ``run()`` from an evalset runner. The harness assertions live in
``tests/unit/test_authoring_rubric.py``.
"""

from __future__ import annotations

from dataclasses import dataclass

from adk.authoring_framework import RubricReport, score_draft


@dataclass(frozen=True)
class DraftFixture:
    """A (teacher-request → drafted lesson prompt) case to score. AR replaces
    these placeholders with real co-pilot outputs over real teacher requests."""

    label: str
    request: str
    draft: str


# Placeholder fixtures — a clearly-structured draft and a thin one, so the harness
# visibly discriminates. AR swaps in real co-pilot drafts.
FIXTURES: list[DraftFixture] = [
    DraftFixture(
        label="energy-conservation-B (structured)",
        request="Energibevarelse for en B-klasse, vi har en rampe og en fotoport.",
        draft=(
            "Læringsmål: eleven skal kunne forklare energibevarelse på en rampe. "
            "Begynd med hvad eleven allerede ved om energi. Stil spørgsmål — hvor "
            "bliver energien af? Afslut med et tjek af forståelsen. Knyt til "
            "fagligt mål på B-niveau."
        ),
    ),
    DraftFixture(
        label="thin draft (should score low)",
        request="Lav noget om energi.",
        draft="Tal om energi.",
    ),
]


def run(judge=None) -> list[tuple[str, RubricReport]]:
    """Score every fixture; return (label, report). Pass AR's judge to override
    the placeholder heuristic."""
    results: list[tuple[str, RubricReport]] = []
    for fx in FIXTURES:
        report = score_draft(fx.draft, judge=judge)
        results.append((fx.label, report))
    return results


def main() -> None:
    print("Authoring rubric eval (placeholder heuristic judge)\n")
    for label, report in run():
        print(f"  {label}: {report.passed}/{report.total} (framework {report.framework_version})")
        for line in report.lines:
            mark = "✓" if line.passed else "·"
            print(f"      {mark} {line.id}: {line.note}")
        print()


if __name__ == "__main__":
    main()
