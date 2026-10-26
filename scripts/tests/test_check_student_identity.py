"""scripts/check-student-identity-fields.py FAILS on a planted field, passes clean.

    python3 -m unittest discover -s scripts/tests -p 'test_check_student_identity.py'

A guard that has never been seen to fail has not been shown to check anything
(the audit_artefact.sh gate-1 lesson, 2026-10-12) — so each test plants the
exact shape the guard exists to stop and asserts a non-zero exit.
"""

from __future__ import annotations

import importlib.util
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[1] / "check-student-identity-fields.py"
_SPEC = importlib.util.spec_from_file_location("check_student_identity", _SCRIPT)
guard = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(guard)

CLEAN = """
from pydantic import BaseModel, Field

class Class(BaseModel):
    name: str
    display_name: str = Field(alias="displayName")
    group_codes: list[str] = Field(default_factory=list, alias="groupCodes")
    relevant_concepts: list[str] = []
"""


def run(models: Path, allowlist: Path) -> tuple[int, str]:
    buf = io.StringIO()
    with redirect_stdout(buf):
        rc = guard.main(["--models", str(models), "--allowlist", str(allowlist)])
    return rc, buf.getvalue()


class StudentIdentityGuard(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.models = self.root / "models"
        self.models.mkdir()
        self.allow = self.root / "allow.txt"
        self.allow.write_text("# empty\n")
        (self.models / "class_.py").write_text(CLEAN)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def plant(self, line: str) -> None:
        (self.models / "class_.py").write_text(CLEAN + f"    {line}\n")

    def test_clean_fixture_passes(self) -> None:
        self.assertEqual(run(self.models, self.allow)[0], 0)

    def test_real_tree_passes(self) -> None:
        self.assertEqual(guard.main([]), 0)

    def test_each_identity_shape_fails(self) -> None:
        for line in (
            "student_name: str = ''",
            "studentNames: list[str] = []",
            "names: dict[str, str] = {}",
            "roster: list[str] = []",
            "pupil_ids: list[str] = []",
            "elever: list[str] = []",
            "first_name: str = ''",
            'code_map: dict = Field(default_factory=dict, alias="studentName")',
        ):
            with self.subTest(line=line):
                self.plant(line)
                rc, out = run(self.models, self.allow)
                self.assertEqual(rc, 1, out)
                self.assertIn("STUDENT IDENTITY FIELD", out)

    def test_allowlist_entry_with_dpia_reason_permits_it(self) -> None:
        self.plant("roster: list[str] = []")
        self.allow.write_text("class_.py:Class.roster | DPIA 2027-01 approved by JB\n")
        self.assertEqual(run(self.models, self.allow)[0], 0)

    def test_allowlist_entry_without_dpia_reason_is_rejected(self) -> None:
        self.plant("roster: list[str] = []")
        self.allow.write_text("class_.py:Class.roster | teachers asked for it\n")
        self.assertEqual(run(self.models, self.allow)[0], 2)


if __name__ == "__main__":
    unittest.main()
