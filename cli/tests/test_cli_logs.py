"""Tests for `aiplatform logs` subcommands (SEQUENCE 1.2, M4)."""

from __future__ import annotations

import httpx
import respx
from click.testing import CliRunner

from aiplatform.cli import main

BASE = "http://localhost:1956"

_SUMMARY = {
    "sessionId": "sess-1",
    "groupCode": "bold-kazoo-87",
    "activityId": "boldkast",
    "startedAt": "2026-05-29T10:00:00Z",
    "endedAt": "2026-05-29T10:01:00Z",
    "durationSeconds": 60,
    "messageCount": 2,
    "simRunCount": 3,
    "conversation": [
        {"timestamp": "2026-05-29T10:00:00Z", "role": "student", "content": "why does it go further at 45?"},
        {"timestamp": "2026-05-29T10:01:00Z", "role": "tutor", "content": "think about the vector parts"},
    ],
}


@respx.mock
def test_logs_tail_prints_turns() -> None:
    respx.get(f"{BASE}/api/reports/groups/bold-kazoo-87").mock(return_value=httpx.Response(200, json=_SUMMARY))
    result = CliRunner().invoke(main, ["--env", "local", "logs", "tail", "bold-kazoo-87"])
    assert result.exit_code == 0, result.output
    assert "messages=2" in result.output
    assert "sim_runs=3" in result.output
    assert "[student] why does it go further at 45?" in result.output
    assert "[tutor] think about the vector parts" in result.output


@respx.mock
def test_logs_tail_empty_group_friendly_message() -> None:
    respx.get(f"{BASE}/api/reports/groups/empty-grp").mock(
        return_value=httpx.Response(404, json={"detail": "no sessions for this group yet"})
    )
    result = CliRunner().invoke(main, ["--env", "local", "logs", "tail", "empty-grp"])
    assert result.exit_code == 0, result.output
    assert "No sessions for group 'empty-grp'" in result.output


@respx.mock
def test_logs_tail_json_flag() -> None:
    respx.get(f"{BASE}/api/reports/groups/bold-kazoo-87").mock(return_value=httpx.Response(200, json=_SUMMARY))
    result = CliRunner().invoke(main, ["--env", "local", "logs", "tail", "bold-kazoo-87", "--json"])
    assert result.exit_code == 0, result.output
    assert '"groupCode": "bold-kazoo-87"' in result.output


@respx.mock
def test_logs_session_prints_report() -> None:
    respx.get(f"{BASE}/api/reports/sessions/sess-1").mock(return_value=httpx.Response(200, json=_SUMMARY))
    result = CliRunner().invoke(main, ["--env", "local", "logs", "session", "sess-1"])
    assert result.exit_code == 0, result.output
    assert "activity=boldkast" in result.output


def test_logs_schema_prints_reference_and_query() -> None:
    result = CliRunner().invoke(main, ["logs", "schema", "--project", "aipla-dev-2026"])
    assert result.exit_code == 0, result.output
    assert "aipla-dev-2026.chat_logs" in result.output
    assert "aipla_chat_turn" in result.output
    assert "aipla_workbench_event" in result.output
    assert "jsonPayload.skill_id = @skill_id" in result.output


@respx.mock
def test_logs_verify_pass() -> None:
    respx.post(f"{BASE}/api/auth/group/join").mock(
        return_value=httpx.Response(200, json={"token": "grp-jwt", "uid": "anon-bold-1", "skill_ids": ["sk-1"]})
    )
    respx.post(url__regex=rf"{BASE}/api/skill/.*/stream").mock(return_value=httpx.Response(200, text="data: {}\n\n"))
    respx.get(url__regex=rf"{BASE}/api/reports/sessions/verify-.*").mock(
        return_value=httpx.Response(200, json=_SUMMARY)
    )
    result = CliRunner().invoke(main, ["--env", "local", "logs", "verify", "bold-kazoo-87"])
    assert result.exit_code == 0, result.output
    assert "PASS" in result.output
    assert "messages=2" in result.output


@respx.mock
def test_logs_verify_fail_on_timeout() -> None:
    respx.post(f"{BASE}/api/auth/group/join").mock(
        return_value=httpx.Response(200, json={"token": "grp-jwt", "uid": "anon-bold-1", "skill_ids": ["sk-1"]})
    )
    respx.post(url__regex=rf"{BASE}/api/skill/.*/stream").mock(return_value=httpx.Response(200, text="data: {}\n\n"))
    # --timeout 0 → skip polling entirely → immediate FAIL (no sleep).
    result = CliRunner().invoke(main, ["--env", "local", "logs", "verify", "bold-kazoo-87", "--timeout", "0"])
    assert result.exit_code != 0
    assert "FAIL" in result.output
