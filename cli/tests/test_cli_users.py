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


@respx.mock
def test_list_roles_renders_table() -> None:
    route = respx.get(f"{BASE}/api/admin/list-roles").mock(
        return_value=httpx.Response(
            200,
            json={
                "count": 1,
                "users": [
                    {
                        "uid": "u-9",
                        "email": "m@sunholo.com",
                        "claims": {"role": "researcher"},
                        "isResearcher": True,
                        "isAdmin": False,
                        "isProgrammeAdmin": False,
                        "spend": None,
                    }
                ],
                "researchers": ["m@sunholo.com"],
                "admins": [],
                "programmeAdmins": [],
                "researchersWithoutSpend": ["m@sunholo.com"],
            },
        )
    )
    runner = CliRunner()
    result = runner.invoke(main, ["--env", "local", "users", "list-roles"])
    assert result.exit_code == 0, result.output
    assert route.called
    assert "m@sunholo.com" in result.output
    assert "VISITOR" in result.output
    assert "1 role holder(s)" in result.output
    assert "NOT on the access register" in result.output


def test_list_roles_spend_labels() -> None:
    from aiplatform.commands.users import _spend_label

    assert _spend_label(None) == "VISITOR"
    assert _spend_label({"error": "register unreadable"}) == "CANNOT READ"
    assert _spend_label({"tier": "pilot", "monthlyCapUsd": 100.0}) == "pilot $100"
    assert _spend_label({"tier": "pilot", "monthlyCapUsd": -1}) == "pilot uncapped"


@respx.mock
def test_list_roles_empty() -> None:
    respx.get(f"{BASE}/api/admin/list-roles").mock(
        return_value=httpx.Response(
            200, json={"count": 0, "users": [], "researchers": [], "admins": [], "programmeAdmins": []}
        )
    )
    result = CliRunner().invoke(main, ["--env", "local", "users", "list-roles"])
    assert result.exit_code == 0, result.output
    assert "No one" in result.output


# ─── set-feature / list-access FEATURES (2026-10-26) ─────────────────────────


@respx.mock
def test_set_feature_defaults_to_sim_workshop_on_for_each_email() -> None:
    def _reply(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        return httpx.Response(200, json={"email": body["email"], "features": {body["feature"]: body["enabled"]}})

    route = respx.post(f"{BASE}/api/admin/access/features").mock(side_effect=_reply)
    result = CliRunner().invoke(
        main, ["--env", "local", "users", "set-feature", "idaxmariepalm@gmail.com", "bn@nrgym.dk"]
    )
    assert result.exit_code == 0, result.output
    bodies = [json.loads(c.request.content) for c in route.calls]
    assert bodies == [
        {"email": "idaxmariepalm@gmail.com", "feature": "simWorkshop", "enabled": True},
        {"email": "bn@nrgym.dk", "feature": "simWorkshop", "enabled": True},
    ]
    assert "bn@nrgym.dk: simWorkshop on" in result.output


@respx.mock
def test_set_feature_off() -> None:
    route = respx.post(f"{BASE}/api/admin/access/features").mock(
        return_value=httpx.Response(200, json={"email": "bn@nrgym.dk", "features": {"simWorkshop": False}})
    )
    result = CliRunner().invoke(main, ["--env", "local", "users", "set-feature", "bn@nrgym.dk", "--off"])
    assert result.exit_code == 0, result.output
    assert json.loads(route.calls.last.request.content)["enabled"] is False
    assert "simWorkshop off" in result.output


@respx.mock
def test_set_feature_keeps_going_past_a_failed_email_and_exits_nonzero() -> None:
    def _reply(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body["email"] == "typo@nrgym.dk":
            return httpx.Response(404, json={"detail": "typo@nrgym.dk is not on the access register"})
        return httpx.Response(200, json={"email": body["email"], "features": {"simWorkshop": True}})

    route = respx.post(f"{BASE}/api/admin/access/features").mock(side_effect=_reply)
    result = CliRunner().invoke(main, ["--env", "local", "users", "set-feature", "typo@nrgym.dk", "bn@nrgym.dk"])
    assert result.exit_code != 0
    assert route.call_count == 2
    assert "bn@nrgym.dk: simWorkshop on" in result.output
    assert "1 of 2 not changed" in result.output


@respx.mock
def test_list_access_shows_switched_on_features() -> None:
    respx.get(f"{BASE}/api/admin/access/list").mock(
        return_value=httpx.Response(
            200,
            json={
                "count": 2,
                "grants": [
                    {
                        "email": "bn@nrgym.dk",
                        "tier": "pilot",
                        "monthlyCapUsd": 25,
                        "active": True,
                        "features": {"simWorkshop": True},
                    },
                    {
                        "email": "tw@sag.dk",
                        "tier": "pilot",
                        "monthlyCapUsd": 25,
                        "active": True,
                        "features": {"simWorkshop": False},
                    },
                ],
            },
        )
    )
    result = CliRunner().invoke(main, ["--env", "local", "users", "list-access"])
    assert result.exit_code == 0, result.output
    rows = {line.split()[0]: line for line in result.output.splitlines() if "@" in line}
    assert "simWorkshop" in rows["bn@nrgym.dk"]
    assert "simWorkshop" not in rows["tw@sag.dk"]
