"""Unit tests for the curriculum_content backfill title→source-file resolver."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

# The script lives under backend/scripts (not an importable package) — load it
# by path so the pure resolver can be tested without backend env / ADC.
_SPEC = importlib.util.spec_from_file_location(
    "backfill_curriculum_content",
    Path(__file__).resolve().parents[2] / "scripts" / "backfill_curriculum_content.py",
)
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)  # type: ignore[union-attr]
resolve_source_file = _MOD.resolve_source_file


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Fysik A (læreplan)", "fysik_a_stx_laereplan_2024_da.md"),
        ("Fysik B (læreplan)", "fysik_b_stx_laereplan_2024_da.md"),
        ("Fysik C (læreplan)", "fysik_c_stx_laereplan_2017_da.md"),
        ("Vejledning til Fysik A", "fysik_a_stx_vejledning_2024_da.md"),
        ("Vejledning til Fysik B", "fysik_b_stx_vejledning_2024_da.md"),
        ("Vejledning til Fysik C", "fysik_c_stx_vejledning_2024_da.md"),
    ],
)
def test_resolves_seeded_titles(title, expected):
    assert resolve_source_file(title) == expected


@pytest.mark.parametrize(
    "title",
    [
        "Some teacher upload.pdf",
        "Fysik D (læreplan)",  # no level D
        "Vejledning til Matematik A",
        "fysik a (læreplan)",  # case-sensitive — seed used exact casing
        "",
    ],
)
def test_unmatched_titles_return_none(title):
    assert resolve_source_file(title) is None
