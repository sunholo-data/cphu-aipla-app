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


_INVITE_RESPONSE = {
    "email": "lu@o365.favrskov-gym.dk",
    "uid": "new-uid",
    "created": True,
    "providers": [],
    "tier": "pilot",
    "claimSyncedUid": "new-uid",
    "resetLink": "https://example.firebaseapp.com/__/auth/action?oobCode=stub",
}


@respx.mock
def test_invite_password_prints_the_link_and_omits_optional_fields() -> None:
    """The link is the whole deliverable — if it is not in the output the
    operator has nothing to send. Unset options must not be posted as nulls."""
    route = respx.post(f"{BASE}/api/admin/access/password-invite").mock(
        return_value=httpx.Response(200, json=_INVITE_RESPONSE)
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "users", "invite-password", "lu@o365.favrskov-gym.dk"])
    assert result.exit_code == 0, result.output
    assert json.loads(route.calls.last.request.content) == {"email": "lu@o365.favrskov-gym.dk"}
    assert _INVITE_RESPONSE["resetLink"] in result.output
    assert "CREATED" in result.output


@respx.mock
def test_invite_password_forwards_name_and_continue_url() -> None:
    route = respx.post(f"{BASE}/api/admin/access/password-invite").mock(
        return_value=httpx.Response(200, json=_INVITE_RESPONSE)
    )
    runner = CliRunner()
    result = runner.invoke(
        main,
        [
            "--env",
            "local",
            "users",
            "invite-password",
            "lu@o365.favrskov-gym.dk",
            "--name",
            "Peter L",
            "--continue-url",
            "https://aipla.ku.dk/teacher/sign-in",
        ],
    )
    assert result.exit_code == 0, result.output
    assert json.loads(route.calls.last.request.content) == {
        "email": "lu@o365.favrskov-gym.dk",
        "display_name": "Peter L",
        "continue_url": "https://aipla.ku.dk/teacher/sign-in",
    }


@respx.mock
def test_invite_password_warns_when_adding_to_an_existing_google_identity() -> None:
    """Re-running on a Google-only account changes how they sign in, so the
    output has to say so rather than looking like a fresh invite."""
    route = respx.post(f"{BASE}/api/admin/access/password-invite").mock(
        return_value=httpx.Response(
            200,
            json={**_INVITE_RESPONSE, "created": False, "providers": ["google.com"], "uid": "google-uid"},
        )
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "users", "invite-password", "lb@toerring-gym.dk"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert "already existed" in result.output
    assert "google.com" in result.output
    assert "ADDS a password" in result.output


@respx.mock
def test_grant_admin_posts_uid() -> None:
    route = respx.post(f"{BASE}/api/admin/grant-admin").mock(
        return_value=httpx.Response(200, json={"uid": "u-1", "admin": True})
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "users", "grant-admin", "u-1"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert json.loads(route.calls.last.request.content) == {"uid": "u-1"}


@respx.mock
def test_revoke_admin_posts_uid() -> None:
    route = respx.post(f"{BASE}/api/admin/revoke-admin").mock(
        return_value=httpx.Response(200, json={"uid": "u-1", "admin": False})
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "users", "revoke-admin", "u-1"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert json.loads(route.calls.last.request.content) == {"uid": "u-1"}
