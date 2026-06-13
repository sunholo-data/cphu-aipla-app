"""Tests for `aiplatform users` — researcher-claim admin (sprint 1.1.5).

Asserts the CLI hits the SA-allowlisted admin endpoints with the right
method + payload. Backend auth (SA allowlist) is exercised in the backend
suite; here we only verify the CLI wiring.
"""

from __future__ import annotations

import json

import httpx
import respx
from click.testing import CliRunner

from aiplatform.cli import main

BASE = "http://localhost:1956"


@respx.mock
def test_grant_researcher_posts_uid() -> None:
    route = respx.post(f"{BASE}/api/admin/grant-researcher").mock(
        return_value=httpx.Response(200, json={"uid": "u-1", "role": "researcher"})
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "users", "grant-researcher", "u-1"])
    assert result.exit_code == 0, result.output
    assert route.called
    body = json.loads(route.calls.last.request.content)
    assert body == {"uid": "u-1"}
    assert "researcher" in result.output


@respx.mock
def test_revoke_researcher_posts_uid() -> None:
    route = respx.post(f"{BASE}/api/admin/revoke-researcher").mock(
        return_value=httpx.Response(200, json={"uid": "u-1", "role": None})
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "users", "revoke-researcher", "u-1"])
    assert result.exit_code == 0, result.output
    assert route.called
    body = json.loads(route.calls.last.request.content)
    assert body == {"uid": "u-1"}
