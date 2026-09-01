"""API tests for /api/admin/* endpoints.

Admin routes are authenticated by a Google-signed ID token whose
email claim must appear in the ADMIN_SEED_ALLOWED_SAS env var. This
test suite mocks the Google verifier so it can exercise the allowlist
logic without hitting Google's public keys.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from firebase_admin import auth as fb_auth

from admin.platform_seed import SeedSummary
from admin.routes import router


@pytest.fixture()
def app():
    a = FastAPI()
    a.include_router(router)
    return a


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def allow_env(monkeypatch):
    monkeypatch.setenv(
        "ADMIN_SEED_ALLOWED_SAS",
        "cloudbuild-sa@multivac-deploy-aitana.iam.gserviceaccount.com,ops-sa@aitana-multivac-dev.iam.gserviceaccount.com",
    )


def test_seed_missing_bearer_returns_403(client, allow_env):
    resp = client.post("/api/admin/seed-platform-skills")
    assert resp.status_code == 403


def test_seed_wrong_email_returns_403(client, allow_env):
    with patch("admin.auth.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = {"email": "intruder@evil.example", "email_verified": True}
        resp = client.post(
            "/api/admin/seed-platform-skills",
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 403
    assert "not authorized" in resp.json()["detail"].lower()


def test_seed_allowed_sa_returns_summary(client, allow_env):
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.platform_seed.seed") as mock_seed,
    ):
        mock_verify.return_value = {
            "email": "cloudbuild-sa@multivac-deploy-aitana.iam.gserviceaccount.com",
            "email_verified": True,
        }
        mock_seed.return_value = SeedSummary(created=5, skipped=0, failed=[])
        resp = client.post(
            "/api/admin/seed-platform-skills",
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200
    body = resp.json()
    # AIPLA 2026-05-20: SeedSummary gained a tool_permissions_wildcard_seeded
    # field so the admin endpoint reports back whether the run also wrote
    # the `tool_permissions/*` wildcard rule (anonymous-group support).
    # Assert the skill-related fields strictly; let the new field exist with
    # either bool value depending on test ordering.
    assert body["created"] == 5
    assert body["skipped"] == 0
    assert body["failed"] == []
    assert "tool_permissions_wildcard_seeded" in body


def test_seed_unverified_email_returns_403(client, allow_env):
    with patch("admin.auth.id_token.verify_oauth2_token") as mock_verify:
        mock_verify.return_value = {
            "email": "cloudbuild-sa@multivac-deploy-aitana.iam.gserviceaccount.com",
            "email_verified": False,
        }
        resp = client.post(
            "/api/admin/seed-platform-skills",
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 403


def test_prune_dry_run_default(client, allow_env):
    """POST /api/admin/prune-platform-skills defaults to dry_run=True
    so the first call lists what would be deleted without writing."""
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.platform_seed.prune") as mock_prune,
    ):
        mock_verify.return_value = {
            "email": "cloudbuild-sa@multivac-deploy-aitana.iam.gserviceaccount.com",
            "email_verified": True,
        }
        mock_prune.return_value = {
            "pruned": ["legacy-skill"],
            "kept": ["problem-set-hints"],
            "templates_on_disk": ["problem-set-hints"],
        }
        resp = client.post(
            "/api/admin/prune-platform-skills",
            json={},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200
    assert resp.json()["pruned"] == ["legacy-skill"]
    mock_prune.assert_called_with(dry_run=True)


def test_prune_commits_when_dry_run_false(client, allow_env):
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.platform_seed.prune") as mock_prune,
    ):
        mock_verify.return_value = {
            "email": "cloudbuild-sa@multivac-deploy-aitana.iam.gserviceaccount.com",
            "email_verified": True,
        }
        mock_prune.return_value = {"pruned": ["legacy"], "kept": [], "templates_on_disk": []}
        resp = client.post(
            "/api/admin/prune-platform-skills",
            json={"dry_run": False},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200
    mock_prune.assert_called_with(dry_run=False)


def test_prune_missing_bearer_returns_403(client, allow_env):
    resp = client.post("/api/admin/prune-platform-skills", json={})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# grant/revoke-researcher (sprint 1.1.5)
# ---------------------------------------------------------------------------

_ALLOWED_SA = "cloudbuild-sa@multivac-deploy-aitana.iam.gserviceaccount.com"


def test_grant_researcher_requires_allowlisted_sa(client, allow_env):
    resp = client.post("/api/admin/grant-researcher", json={"uid": "u1"})
    assert resp.status_code == 403


def test_grant_researcher_merges_claim_preserving_others(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {"groupTags": ["beta"]}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user) as mock_get,
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/grant-researcher",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_get.assert_called_once_with("u1")
    # groupTags preserved; role:researcher merged in.
    mock_set.assert_called_once_with("u1", {"groupTags": ["beta"], "role": "researcher"})
    assert resp.json()["role"] == "researcher"


def test_revoke_researcher_strips_only_role(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {"groupTags": ["beta"], "role": "researcher"}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/revoke-researcher",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    # role removed, groupTags preserved.
    mock_set.assert_called_once_with("u1", {"groupTags": ["beta"]})
    assert resp.json()["role"] is None


def test_revoke_researcher_is_noop_for_non_researcher(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {"groupTags": ["beta"]}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/revoke-researcher",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200
    mock_set.assert_called_once_with("u1", {"groupTags": ["beta"]})


# ─── access/password-invite ───────────────────────────────────────────────────
#
# For pilot teachers at schools with no Google identity. The properties worth
# nailing down: no password ever leaves the process, and a credential is only
# minted for someone already on the access register.

_INVITE_URL = "/api/admin/access/password-invite"
_RESET_LINK = "https://aipla-prod-2026.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=stub"


def _fake_grant(*, tier: str = "pilot", active: bool = True):
    return type("G", (), {"tier": tier, "is_active": active})()


def _fake_fb_user(uid: str = "new-uid", providers: tuple[str, ...] = ()):
    return type(
        "U",
        (),
        {"uid": uid, "provider_data": [type("P", (), {"provider_id": p})() for p in providers]},
    )()


def test_password_invite_requires_allowlisted_sa(client, allow_env):
    resp = client.post(_INVITE_URL, json={"email": "lu@o365.favrskov-gym.dk"})
    assert resp.status_code == 403


def test_password_invite_404s_and_creates_nothing_without_a_grant(client, allow_env):
    """The gate that matters: a typo must not conjure an account.

    Asserting the 404 alone would pass even if the user were created first and
    the check ran after, so this pins `create_user` at zero calls.
    """
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("db.teacher_access.get_grant", return_value=None),
        patch("admin.routes.fb_auth.create_user") as mock_create,
        patch("admin.routes.fb_auth.generate_password_reset_link") as mock_link,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            _INVITE_URL,
            json={"email": "stranger@example.dk"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 404
    assert "grant-access" in resp.json()["detail"]
    mock_create.assert_not_called()
    mock_link.assert_not_called()


def test_password_invite_404s_on_a_revoked_grant(client, allow_env):
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("db.teacher_access.get_grant", return_value=_fake_grant(active=False)),
        patch("admin.routes.fb_auth.create_user") as mock_create,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            _INVITE_URL,
            json={"email": "revoked@example.dk"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 404
    mock_create.assert_not_called()


def test_password_invite_creates_user_and_never_returns_the_password(client, allow_env):
    """The security property: the random secret must not reach the caller.

    A future refactor that helpfully echoed the generated password back — so the
    operator could 'just send it to them' — would defeat the entire point of the
    reset-link flow. This test fails if it ever does.
    """
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("db.teacher_access.get_grant", return_value=_fake_grant()),
        patch("admin.routes.fb_auth.get_user_by_email", side_effect=fb_auth.UserNotFoundError("nope")),
        patch("admin.routes.fb_auth.create_user", return_value=_fake_fb_user()) as mock_create,
        patch("admin.routes.fb_auth.generate_password_reset_link", return_value=_RESET_LINK),
        patch("admin.routes._sync_access_claim", return_value="new-uid") as mock_sync,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            _INVITE_URL,
            json={"email": "LU@o365.favrskov-gym.dk", "display_name": "Peter L"},
            headers={"Authorization": "Bearer stub-id-token"},
        )

    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["created"] is True
    assert payload["email"] == "lu@o365.favrskov-gym.dk", "email must be normalised before use"
    assert payload["resetLink"] == _RESET_LINK

    generated = mock_create.call_args.kwargs["password"]
    assert generated, "a password must be set, or the account has no credential at all"
    assert generated not in resp.text, "the generated password must never reach the caller"
    assert not any(isinstance(v, str) and generated in v for v in payload.values())

    # The new uid needs its tier now, not on some later bootstrap.
    mock_sync.assert_called_once_with("lu@o365.favrskov-gym.dk", "pilot")


def test_password_invite_reuses_an_existing_account(client, allow_env):
    """Re-running for someone who already signed in must not create a second
    account — it mints a fresh link and reports what identity it is touching."""
    existing = _fake_fb_user(uid="google-uid", providers=("google.com",))
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("db.teacher_access.get_grant", return_value=_fake_grant()),
        patch("admin.routes.fb_auth.get_user_by_email", return_value=existing),
        patch("admin.routes.fb_auth.create_user") as mock_create,
        patch("admin.routes.fb_auth.generate_password_reset_link", return_value=_RESET_LINK),
        patch("admin.routes._sync_access_claim", return_value="google-uid"),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            _INVITE_URL,
            json={"email": "lb@toerring-gym.dk"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    mock_create.assert_not_called()
    assert payload["created"] is False
    assert payload["uid"] == "google-uid"
    assert payload["providers"] == ["google.com"]


def test_password_invite_passes_continue_url_through(client, allow_env):
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("db.teacher_access.get_grant", return_value=_fake_grant()),
        patch("admin.routes.fb_auth.get_user_by_email", return_value=_fake_fb_user()),
        patch("admin.routes.fb_auth.ActionCodeSettings") as mock_settings,
        patch("admin.routes.fb_auth.generate_password_reset_link", return_value=_RESET_LINK) as mock_link,
        patch("admin.routes._sync_access_claim", return_value="new-uid"),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            _INVITE_URL,
            json={"email": "lb@toerring-gym.dk", "continue_url": "https://aipla.ku.dk/teacher/sign-in"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_settings.assert_called_once_with(url="https://aipla.ku.dk/teacher/sign-in")
    assert mock_link.call_args.kwargs["action_code_settings"] is mock_settings.return_value


# --- Platform-admin claim (P4.4) -------------------------------------------
#
# `firestore.rules::isAdmin` read one hardcoded email address until P4.4. These
# net the claim that replaced it, and specifically the property that made the
# generalised `_set_claim` safe to share with the researcher verbs: grant and
# revoke each touch exactly one key.


def test_grant_admin_requires_allowlisted_sa(client, allow_env):
    resp = client.post("/api/admin/grant-admin", json={"uid": "u1"})
    assert resp.status_code == 403


def test_grant_admin_merges_claim_preserving_role(client, allow_env):
    """A researcher promoted to admin stays a researcher."""
    fake_user = type("U", (), {"custom_claims": {"role": "researcher"}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user) as mock_get,
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/grant-admin",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_get.assert_called_once_with("u1")
    mock_set.assert_called_once_with("u1", {"role": "researcher", "admin": True})
    assert resp.json()["admin"] is True


def test_revoke_admin_strips_only_the_admin_bit(client, allow_env):
    """Revoking admin from a researcher leaves them a researcher."""
    fake_user = type("U", (), {"custom_claims": {"role": "researcher", "admin": True}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/revoke-admin",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_set.assert_called_once_with("u1", {"role": "researcher"})
    assert resp.json()["admin"] is False


def test_revoke_admin_is_noop_for_non_admin(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {"groupTags": ["beta"]}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/revoke-admin",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200
    mock_set.assert_called_once_with("u1", {"groupTags": ["beta"]})


def test_admin_and_researcher_claims_are_independent(client, allow_env):
    """Granting admin must not disturb groupTags, and revoking the researcher
    role must not disturb the admin bit — the two verbs share `_set_claim`."""
    fake_user = type("U", (), {"custom_claims": {"groupTags": ["beta"], "role": "researcher", "admin": True}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/revoke-researcher",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200
    mock_set.assert_called_once_with("u1", {"groupTags": ["beta"], "admin": True})
