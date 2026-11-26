"""The log-health sort: real problems stay visible, known noise is labelled.

The failure that matters most is a real problem landing in NOISE, so most cases
here pin that direction: a 5xx, an unexplained error, an unknown app 404.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import log_health as lh  # noqa: E402


def http(status: int, url: str, method: str = "GET") -> dict:
    return {"severity": "WARNING", "httpRequest": {"status": status, "requestMethod": method, "requestUrl": url}}


def text(msg: str, severity: str = "DEFAULT") -> dict:
    return {"severity": severity, "textPayload": msg}


class ProblemsStayVisible(unittest.TestCase):
    def test_any_5xx_is_a_problem_even_on_a_noisy_path(self) -> None:
        for url in ("https://aipla.ku.dk/.env", "https://aipla.ku.dk/api/proxy/api/sessions/x/messages"):
            self.assertEqual(lh.classify(http(500, url))[0], lh.PROBLEM, url)

    def test_an_unexplained_error_line_is_a_problem(self) -> None:
        self.assertEqual(lh.classify(text("ERROR:db.firestore:write failed"))[0], lh.PROBLEM)
        self.assertEqual(lh.classify(text("Traceback (most recent call last):\n  ..."))[0], lh.PROBLEM)
        self.assertEqual(lh.classify(text("something odd", severity="ERROR"))[0], lh.PROBLEM)

    def test_an_unknown_404_on_an_app_path_is_looked_at_not_hidden(self) -> None:
        self.assertEqual(lh.classify(http(404, "https://aipla.ku.dk/api/proxy/api/classes/abc/roster"))[0], lh.LOOK)
        self.assertEqual(lh.classify(http(404, "https://aipla.ku.dk/api/proxy/api/activities/act-1234"))[0], lh.LOOK)

    def test_an_unknown_python_warning_is_looked_at(self) -> None:
        self.assertEqual(lh.classify(text("WARNING:auth.spend:owner unreadable"))[0], lh.LOOK)

    def test_a_401_outside_the_proxy_is_not_waved_through(self) -> None:
        self.assertEqual(lh.classify(http(401, "https://aipla.ku.dk/teacher"))[0], lh.LOOK)


class KnownNoiseIsLabelled(unittest.TestCase):
    def test_bot_probes(self) -> None:
        for path in ("/.env", "/.git/config", "/phpinfo.php", "/backup.tar", "/api/v1/.env", "/wp-login.php"):
            self.assertEqual(lh.classify(http(404, "https://aipla.ku.dk" + path))[0], lh.NOISE, path)

    def test_copilot_thread_not_started(self) -> None:
        kind, label = lh.classify(http(404, "https://aipla.ku.dk/api/proxy/api/sessions/7459d5c7/messages"))
        self.assertEqual(kind, lh.NOISE)
        self.assertIn("co-pilot", label)

    def test_stale_chunk_after_deploy(self) -> None:
        url = "https://aipla.ku.dk/_next/static/chunks/app/error-d0a4.js?dpl=b2026"
        self.assertEqual(lh.classify(http(404, url))[0], lh.NOISE)

    def test_next_nofallback_and_recovered_stalls(self) -> None:
        self.assertEqual(lh.classify(text("Error: Internal: NoFallbackError\n at n", "ERROR"))[0], lh.NOISE)
        stall = "WARNING:adk.resilient_llm:model gemini-3-flash-lite: MODEL_SILENT_STALL (attempt 1) before first token"
        self.assertEqual(lh.classify(text(stall))[0], lh.RECOVERED)
        limited = "WARNING:adk.resilient_llm:model gemini-3.8-flash: MODEL_RATE_LIMITED (attempt 1) before first token"
        self.assertEqual(lh.classify(text(limited))[0], lh.RECOVERED)

    def test_agent_engine_quota(self) -> None:
        """2026-11-26: a retried write is RECOVERED; one a student was told to wait
        for is a PROBLEM (the quota, 100 appends/min, is too small)."""
        retried = "WARNING:adk.session:session: Agent Engine append quota hit; retry 1/4 in 1.1s"
        self.assertEqual(lh.classify(text(retried))[0], lh.RECOVERED)
        told = "WARNING:observability.busy:busy: Google quota exhausted on POST /api/sessions/x/iframe-context (429)"
        self.assertEqual(lh.classify(text(told))[0], lh.PROBLEM)

    def test_uvicorn_access_lines(self) -> None:
        ok = 'INFO:     1.2.3.4:5 - "POST /api/client-errors HTTP/1.1" 204 No Content'
        bad = 'INFO:     1.2.3.4:5 - "GET /api/classes HTTP/1.1" 503 Service Unavailable'
        self.assertEqual(lh.classify(text(ok))[0], lh.SKIP)
        self.assertEqual(lh.classify(text(bad))[0], lh.PROBLEM)


class Summary(unittest.TestCase):
    def test_duplicate_entries_count_once(self) -> None:
        e = {**http(500, "https://aipla.ku.dk/api/x"), "insertId": "a1", "resource": {"labels": {"service_name": "s"}}}
        self.assertEqual(sum(lh.summarise([e, e])[lh.PROBLEM].values()), 1)


if __name__ == "__main__":
    unittest.main()
