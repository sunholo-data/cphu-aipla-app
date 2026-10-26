"""The direct-model-call guard must fail on a planted call — witnessed, not assumed."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "check_direct_model_calls", Path(__file__).resolve().parents[1] / "check-direct-model-calls.py"
)
guard = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(guard)


class GuardTest(unittest.TestCase):
    def _scan(self, files: dict[str, str]) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel, text in files.items():
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text(text)
            return guard.check(root)

    def test_genai_client_outside_llm_fails(self):
        found = self._scan({"analytics/x.py": "from google import genai\nclient = genai.Client(vertexai=True)\n"})
        self.assertEqual(found, ["analytics/x.py:2: genai.Client(...)"])

    def test_litellm_call_outside_llm_fails(self):
        found = self._scan({"db/y.py": "import litellm\nasync def f():\n    await litellm.acompletion(model='m')\n"})
        self.assertEqual(found, ["db/y.py:3: litellm.acompletion(...)"])

    def test_allowed_dirs_pass(self):
        call = "from google import genai\ngenai.Client()\n"
        self.assertEqual(self._scan({"llm/generate.py": call, "voice/stt.py": call, "tests/t.py": call}), [])

    def test_a_docstring_naming_the_call_passes(self):
        self.assertEqual(self._scan({"budget/z.py": '"""guards genai.Client(...) calls"""\n# genai.Client()\n'}), [])

    def test_the_real_backend_is_clean(self):
        self.assertEqual(guard.check(guard.REPO / "backend"), [])


if __name__ == "__main__":
    unittest.main()
