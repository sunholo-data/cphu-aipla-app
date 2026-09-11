"""The generated tutor docs must not go stale on the CALENDAR (1.1.91 TUTOR-5).

`make check-tutor-docs` is CI-gated and compares the rendered document against
the file byte for byte. The generator stamped `reviewed:` with today's date on
every run, so the check passed on the day the docs were generated and failed the
next morning — for every document at once, with no content change behind it.
That is what turned CI red on 2026-09-11, on a commit that touched no framework.

A gate that fails on the passage of time is worse than no gate: it trains people
to regenerate without reading the diff, which is the exact habit this gate exists
to prevent.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "generate_tutor_docs",
    Path(__file__).resolve().parents[2] / "scripts" / "generate_tutor_docs.py",
)
assert _SPEC and _SPEC.loader
gen = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(gen)


def _doc(reviewed: str, body: str = "Same content.") -> str:
    return f'---\ntitle: "T"\nreviewed: "{reviewed}"\nreviewBy: "{reviewed}"\n---\n\n{body}\n'


def test_identical_content_keeps_the_existing_review_date(tmp_path):
    """The whole point: re-running the generator on unchanged content is a no-op."""
    p = tmp_path / "esru.md"
    p.write_text(_doc("2026-01-01"), encoding="utf-8")

    # What the generator would render TODAY — same content, today's date.
    rendered = _doc("2026-09-11")
    assert gen._preserve_review_dates(p, rendered) == _doc("2026-01-01")


def test_a_real_content_change_stamps_the_new_date(tmp_path):
    """`reviewed` still means something — an actual edit re-dates the page."""
    p = tmp_path / "esru.md"
    p.write_text(_doc("2026-01-01", "Old content."), encoding="utf-8")

    rendered = _doc("2026-09-11", "New content.")
    out = gen._preserve_review_dates(p, rendered)
    assert out == rendered
    assert '"2026-09-11"' in out


def test_a_new_page_takes_todays_date(tmp_path):
    rendered = _doc("2026-09-11")
    assert gen._preserve_review_dates(tmp_path / "missing.md", rendered) == rendered


def test_the_comparison_ignores_only_the_date_lines():
    """`_without_dates` must blank the dates and nothing else — blanking too much
    would hide a real content change behind an unchanged-looking document."""
    a = _doc("2026-01-01", "Body A")
    b = _doc("2026-09-11", "Body A")
    c = _doc("2026-01-01", "Body B")
    assert gen._without_dates(a) == gen._without_dates(b)
    assert gen._without_dates(a) != gen._without_dates(c)
