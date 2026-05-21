"""Tests for `aiplatform sessions` subcommands.

Specifically the `iframe-context` alias added alongside the
human-tool-use-cards sprint (2026-05-21): closes the debug workflow gap
where finding workspace pushes required grepping backend logs.
"""

from __future__ import annotations

import json

import httpx
import respx
from click.testing import CliRunner

from aiplatform.cli import main

BASE = "http://localhost:1956"
SID = "sess-test-1"


@respx.mock
def test_iframe_context_prints_filtered_state() -> None:
    state = {
        "mcp_app_context.boldkast.state": {
            "structuredContent": {"revealedMarkers": ["y_max"], "v0": 15},
            "_pushedAt": 1700000000.0,
        },
        "mcp_app_context.progress.state": {
            "structuredContent": {"done": ["a"], "total": 4},
            "_pushedAt": 1700000001.0,
        },
        # Non-matching key — should be filtered out
        "app:resumed_session": True,
    }
    respx.get(f"{BASE}/api/sessions/{SID}/state").mock(
        return_value=httpx.Response(200, json=state)
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "sessions", "iframe-context", SID])
    assert result.exit_code == 0, result.output

    payload = json.loads(result.output)
    assert "mcp_app_context.boldkast.state" in payload
    assert "mcp_app_context.progress.state" in payload
    assert "app:resumed_session" not in payload
    assert payload["mcp_app_context.boldkast.state"]["structuredContent"]["v0"] == 15


@respx.mock
def test_iframe_context_friendly_message_when_empty() -> None:
    respx.get(f"{BASE}/api/sessions/{SID}/state").mock(return_value=httpx.Response(200, json={}))
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "sessions", "iframe-context", SID])
    assert result.exit_code == 0
    # Empty state should produce a human-readable explanation, not raw JSON
    assert "No keys with prefix" in result.output
    assert "mcp_app_context." in result.output


@respx.mock
def test_iframe_context_friendly_message_when_only_non_namespaced() -> None:
    state = {"app:resumed_session": True, "user:something": "x"}
    respx.get(f"{BASE}/api/sessions/{SID}/state").mock(
        return_value=httpx.Response(200, json=state)
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "sessions", "iframe-context", SID])
    assert result.exit_code == 0
    assert "No keys with prefix" in result.output
    # And no leak of the unrelated keys
    assert "resumed_session" not in result.output
