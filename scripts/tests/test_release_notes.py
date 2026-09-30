"""Grouping and exclusion for scripts/release_notes.py, on a fixture log.

    python3 -m unittest discover -s scripts/tests      (make test-release-notes)

No git needed: the fixture is subject lines, and the rendering is a pure function.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "release_notes", Path(__file__).resolve().parents[1] / "release_notes.py"
)
rn = importlib.util.module_from_spec(_SPEC)
sys.modules["release_notes"] = rn  # dataclasses resolve annotations through it
assert _SPEC.loader is not None
_SPEC.loader.exec_module(rn)

FIXTURE = """\
feat(classes): concepts across the class at the top of the class page (1.1.139 M2 first slice)
feat(tutors): earned praise only — a house-style praise preamble for every tutor
feat(bench-2): column-normalised headline, tone probe, retries, n=8 scenarios
feat(1.1.92 M0): every scored result carries the tutor arm it ran under
feat(1.1.108 M2): the teacher screens speak the teacher's language
feat(chat): tell the student when a started tutor run stalls (1.1.131 M2)
feat(review): researchers can read every group's work (1.1.136 M3)
feat(review): the transcript shows the work beside the words (1.1.136 M1)
fix(reports): take the group report's BigQuery off the event loop (1.1.131 M3)
fix(test): the group-report tests race the first fetch
feat(telemetry): screen-size beacon + make screen-sizes
build: make test-frontend-ci-node — run the frontend suite on CI's Node
refactor(bench): use lane 1's analysis_model directly
docs(sprint): BENCH-1 built — both lanes merged
test: add a fixture
chore: bump deps
Merge branch 'dev' of https://github.com/x/y into dev
not a conventional subject
"""


def entries(include_all: bool = False) -> list:
    return [e for s in FIXTURE.splitlines() if (e := rn.parse(s, include_all))]


def by_text(include_all: bool = False) -> dict[str, str]:
    return {e.text: e.audience for e in entries(include_all)}


class Grouping(unittest.TestCase):
    def test_scopes_and_keywords_route_to_audiences(self) -> None:
        got = by_text()
        self.assertEqual(got["Concepts across the class at the top of the class page"], "Teachers")
        self.assertEqual(got["Earned praise only — a house-style praise preamble for every tutor"], "Students")
        self.assertEqual(got["Tell the student when a started tutor run stalls"], "Students")
        self.assertEqual(got["Column-normalised headline, tone probe, retries, n=8 scenarios"], "Researchers")
        # A design-doc-number scope falls through to keywords; research words beat "tutor".
        self.assertEqual(got["Every scored result carries the tutor arm it ran under"], "Researchers")
        self.assertEqual(got["The teacher screens speak the teacher's language"], "Teachers")
        # A shared scope: keywords decide, the soft default catches the rest.
        self.assertEqual(got["Researchers can read every group's work"], "Researchers")
        self.assertEqual(got["The transcript shows the work beside the words"], "Teachers")

    def test_plumbing_lands_behind_the_scenes(self) -> None:
        got = by_text()
        for text in (
            "Fixed: the group-report tests race the first fetch",
            "Fixed: take the group report's BigQuery off the event loop",
            "Screen-size beacon + make screen-sizes",
            "Make test-frontend-ci-node — run the frontend suite on CI's Node",
            "Use lane 1's analysis_model directly",
        ):
            self.assertEqual(got[text], "Behind the scenes", text)


class Exclusion(unittest.TestCase):
    def test_docs_test_chore_merges_and_nonconventional_are_dropped(self) -> None:
        texts = " ".join(by_text())
        self.assertNotIn("BENCH-1 built", texts)
        self.assertNotIn("add a fixture", texts)
        self.assertNotIn("bump deps", texts)
        self.assertNotIn("Merge", texts)
        self.assertNotIn("not a conventional subject", texts)
        self.assertEqual(len(entries()), 13)

    def test_all_keeps_them_except_merges(self) -> None:
        texts = " ".join(by_text(include_all=True))
        self.assertIn("Built — both lanes merged", texts)
        self.assertIn("Add a fixture", texts)
        self.assertIn("not a conventional subject", texts)
        self.assertNotIn("Merge branch", texts)


class Cleaning(unittest.TestCase):
    def test_design_doc_numbers_and_sprint_codes_are_stripped(self) -> None:
        self.assertEqual(rn.clean("tell the student (1.1.131 M2)"), "Tell the student")
        self.assertEqual(rn.clean("BENCH-2 judge calibration — fidelity-r2"), "Judge calibration — fidelity-r2")
        self.assertEqual(rn.clean("a class list (1.1.137 M0-M2)"), "A class list")
        self.assertEqual(rn.clean("preview on a model (BENCH-1)"), "Preview on a model")
        # Plain parentheses survive.
        self.assertEqual(rn.clean("exports (CSV and JSON)"), "Exports (CSV and JSON)")
        # An identifier keeps its case.
        self.assertEqual(rn.clean("analysis_model() — the model"), "analysis_model() — the model")


class Rendering(unittest.TestCase):
    def test_sections_in_audience_order_and_empty_release_says_so(self) -> None:
        out = rn.render("v1", "v3", [("v3 (2026-09-30)", entries()), ("v2 (2026-09-29)", [])], "2026-09-30")
        self.assertTrue(out.startswith("## AIPLA release notes: v1 → v3"))
        order = [out.index(f"**{a}**") for a in rn.AUDIENCES]
        self.assertEqual(order, sorted(order))
        self.assertLess(out.index("### v3"), out.index("### v2"))
        self.assertIn("_Maintenance only", out.split("### v2")[1])


if __name__ == "__main__":
    unittest.main()
