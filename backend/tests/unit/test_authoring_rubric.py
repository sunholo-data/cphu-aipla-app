"""Unit tests for the structure-rubric scoring harness (COPILOT-1 M2; 1.1.50 §2).

The harness scores a draft activity against the framework's STRUCTURE_RUBRIC. The
real scorer is an LLM-judge AR owns (the human gate); the harness is **judge-
pluggable** so AR's judge drops in without touching the structure. The shipped
default is a crude keyword heuristic — enough to prove the harness discriminates
a structured draft from an empty one + to run the eval scaffold.
"""

from __future__ import annotations

from adk.authoring_framework import (
    FRAMEWORK_VERSION,
    score_draft,
)
from adk.authoring_framework import (
    rubric_ids as _rubric_ids,
)

_STRONG = (
    "Læringsmål: eleven skal kunne forklare energibevarelse. Begynd med hvad "
    "eleven allerede kender om energi. Stil spørgsmål — hvorfor bevares energien? "
    "Afslut med et lille tjek af forståelsen. Knyt til fagligt mål på B-niveau "
    "for klassen."
)


def test_report_is_well_formed_and_version_stamped():
    report = score_draft(_STRONG)
    assert report.framework_version == FRAMEWORK_VERSION
    assert [line.id for line in report.lines] == _rubric_ids()
    assert report.total == len(_rubric_ids())
    assert 0 <= report.passed <= report.total


def test_empty_draft_scores_lower_than_a_structured_one():
    assert score_draft("").passed < score_draft(_STRONG).passed


def test_a_structured_draft_passes_most_lines():
    # The heuristic is crude, but a draft hitting objective/prior-knowledge/
    # Socratic/checkpoint/grounding/level should clear a majority.
    report = score_draft(_STRONG)
    assert report.passed >= 4


def test_judge_is_pluggable_for_ARs_real_scorer():
    # AR swaps in an LLM-judge here without changing the harness. A judge that
    # passes everything → full marks; one that fails everything → zero.
    full = score_draft(_STRONG, judge=lambda line, draft: (True, "stub"))
    none = score_draft(_STRONG, judge=lambda line, draft: (False, "stub"))
    assert full.passed == full.total
    assert none.passed == 0


def test_every_result_carries_an_id_and_note():
    for line in score_draft(_STRONG).lines:
        assert line.id and isinstance(line.passed, bool) and line.note
