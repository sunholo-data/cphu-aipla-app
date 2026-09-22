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
    fake_user = type("U", (), {"custom_claims": {"groupTags": ["beta"]}, "email": "r@ind.ku.dk"})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user) as mock_get,
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
        patch("admin.routes._ensure_researcher_can_spend", return_value=None),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/grant-researcher",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_get.assert_called_with("u1")  # once for the merge, once for the email
    # groupTags preserved; role:researcher merged in.
    mock_set.assert_called_with("u1", {"groupTags": ["beta"], "role": "researcher"})
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


# ─── user-roles ────────────────────────────────────────────────────────────────
#
# Read-only claim check (2026-09-15) — added after a researcher-gated skill
# 404'd on prod with a message pointing at the seed script, when the real
# cause was that role:researcher had only ever been granted on test. Claims
# are per-Firebase-project; this is the fast path to "does this person have
# it HERE" instead of a Firebase Console trip or a raw Identity Toolkit call.


def test_user_roles_requires_allowlisted_sa(client, allow_env):
    resp = client.get("/api/admin/user-roles", params={"uid": "u1"})
    assert resp.status_code == 403


def test_user_roles_reports_researcher_claim(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {"role": "researcher"}, "email": "m@sunholo.com"})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user) as mock_get,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.get(
            "/api/admin/user-roles",
            params={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_get.assert_called_once_with("u1")
    body = resp.json()
    assert body["isResearcher"] is True
    assert body["isAdmin"] is False
    assert body["isProgrammeAdmin"] is False
    assert body["email"] == "m@sunholo.com"


def test_user_roles_reports_no_claims(client, allow_env):
    fake_user = type("U", (), {"custom_claims": None, "email": "nobody@ind.ku.dk"})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.get(
            "/api/admin/user-roles",
            params={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["isResearcher"] is False
    assert body["claims"] == {}


def test_user_roles_accepts_email_and_resolves_to_uid(client, allow_env):
    fake_by_email = type("U", (), {"uid": "resolved-uid-9"})()
    fake_user = type("U", (), {"custom_claims": {"role": "researcher"}, "email": "m@sunholo.com"})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user_by_email", return_value=fake_by_email) as mock_by_email,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user) as mock_get,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.get(
            "/api/admin/user-roles",
            params={"uid": "m@sunholo.com"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_by_email.assert_called_once_with("m@sunholo.com")
    mock_get.assert_called_once_with("resolved-uid-9")
    assert resp.json()["uid"] == "resolved-uid-9"


def test_user_roles_404s_on_unknown_email(client, allow_env):
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user_by_email", side_effect=fb_auth.UserNotFoundError("nope")),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.get(
            "/api/admin/user-roles",
            params={"uid": "nobody@ind.ku.dk"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 404
    assert "nobody@ind.ku.dk" in resp.json()["detail"]


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


# ─── uid-or-email resolution (`_resolve_uid`) ────────────────────────────────
#
# Every claim-grant verb used to take a raw UID only, so granting someone
# required already knowing their UID out-of-band. An email (contains "@") is
# now resolved via fb_auth.get_user_by_email before the claim is touched.


def test_grant_researcher_accepts_email_and_resolves_to_uid(client, allow_env):
    fake_by_email = type("U", (), {"uid": "resolved-uid-1"})()
    fake_user = type("U", (), {"custom_claims": {}, "email": "m@sunholo.com"})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user_by_email", return_value=fake_by_email) as mock_by_email,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user) as mock_get,
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
        patch("admin.routes._ensure_researcher_can_spend", return_value=None),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/grant-researcher",
            json={"uid": "jb@ind.ku.dk"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_by_email.assert_called_once_with("jb@ind.ku.dk")
    mock_get.assert_called_with("resolved-uid-1")
    mock_set.assert_called_once_with("resolved-uid-1", {"role": "researcher"})
    assert resp.json()["uid"] == "resolved-uid-1"


def test_grant_researcher_404s_on_unknown_email(client, allow_env):
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user_by_email", side_effect=fb_auth.UserNotFoundError("nope")),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/grant-researcher",
            json={"uid": "nobody@ind.ku.dk"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 404
    assert "nobody@ind.ku.dk" in resp.json()["detail"]


def test_grant_admin_accepts_email_and_resolves_to_uid(client, allow_env):
    fake_by_email = type("U", (), {"uid": "resolved-uid-2"})()
    fake_user = type("U", (), {"custom_claims": {}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user_by_email", return_value=fake_by_email) as mock_by_email,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/grant-admin",
            json={"uid": "m@sunholo.com"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_by_email.assert_called_once_with("m@sunholo.com")
    mock_set.assert_called_once_with("resolved-uid-2", {"admin": True})
    assert resp.json()["uid"] == "resolved-uid-2"


# ─── programme-admin claim (PROGADMIN-1 — 1.1.76) ────────────────────────────
#
# No direct endpoint coverage existed before this — only an unrelated router
# test asserting these paths were absent from the SA-only route list.


def test_grant_programme_admin_requires_allowlisted_sa(client, allow_env):
    resp = client.post("/api/admin/grant-programme-admin", json={"uid": "u1"})
    assert resp.status_code == 403


def test_grant_programme_admin_merges_claim_preserving_role(client, allow_env):
    """A researcher granted programme-admin stays a researcher."""
    fake_user = type("U", (), {"custom_claims": {"role": "researcher"}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user) as mock_get,
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/grant-programme-admin",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_get.assert_called_once_with("u1")
    mock_set.assert_called_once_with("u1", {"role": "researcher", "programmeAdmin": True})
    assert resp.json()["programmeAdmin"] is True


def test_revoke_programme_admin_strips_only_the_bit(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {"role": "researcher", "programmeAdmin": True}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/revoke-programme-admin",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_set.assert_called_once_with("u1", {"role": "researcher"})
    assert resp.json()["programmeAdmin"] is False


def test_grant_programme_admin_accepts_email_and_resolves_to_uid(client, allow_env):
    fake_by_email = type("U", (), {"uid": "resolved-uid-3"})()
    fake_user = type("U", (), {"custom_claims": {}})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user_by_email", return_value=fake_by_email) as mock_by_email,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims") as mock_set,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.post(
            "/api/admin/grant-programme-admin",
            json={"uid": "jbruun@ind.ku.dk"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    assert resp.status_code == 200, resp.text
    mock_by_email.assert_called_once_with("jbruun@ind.ku.dk")
    mock_set.assert_called_once_with("resolved-uid-3", {"programmeAdmin": True})
    assert resp.json()["uid"] == "resolved-uid-3"


# ─── list-roles ────────────────────────────────────────────────────────────────
#
# "Who are the researchers on prod?" — the per-uid check above cannot answer
# it, and a Firebase Console trip per environment is what it cost before.


def _fake_user(uid: str, email: str | None, claims: dict | None):
    return type("U", (), {"uid": uid, "email": email, "custom_claims": claims})()


class _FakePage:
    """A firebase_admin ListUsersPage stand-in: `.users` + `.get_next_page()`."""

    def __init__(self, users, next_page=None):
        self.users = users
        self._next = next_page

    def get_next_page(self):
        return self._next


def _fake_pages(*pages):
    head = None
    for users in reversed(pages):
        head = _FakePage(users, head)
    return head


def test_list_roles_requires_allowlisted_sa(client, allow_env):
    assert client.get("/api/admin/list-roles").status_code == 403


def test_list_roles_keeps_only_claim_holders_across_pages(client, allow_env):
    first = _fake_pages(
        [
            _fake_user("u-teacher", "teacher@ind.ku.dk", None),
            _fake_user("u-res", "m@sunholo.com", {"role": "researcher"}),
        ],
        [
            _fake_user("u-admin", "admin@ind.ku.dk", {"admin": True, "programmeAdmin": True}),
            _fake_user("u-empty", "visitor@ind.ku.dk", {}),
        ],
    )
    pilot = type("G", (), {"is_active": True, "effective_tier": "pilot", "monthly_cap_usd": 25.0, "expires_at": None})()
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.list_users", return_value=first),
        # The admin is on the register; the researcher is NOT — the drift this
        # endpoint exists to expose.
        patch("db.teacher_access.grant_for_uid", side_effect=lambda uid: pilot if uid == "u-admin" else None),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.get("/api/admin/list-roles", headers={"Authorization": "Bearer stub-id-token"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["count"] == 2
    assert [u["uid"] for u in body["users"]] == ["u-admin", "u-res"]  # sorted by email
    assert body["researchers"] == ["m@sunholo.com"]
    assert body["admins"] == ["admin@ind.ku.dk"]
    assert body["programmeAdmins"] == ["admin@ind.ku.dk"]
    assert body["users"][0]["spend"] == {"tier": "pilot", "monthlyCapUsd": 25.0, "expiresAt": None}
    assert body["users"][1]["spend"] is None
    assert body["researchersWithoutSpend"] == ["m@sunholo.com"]


def test_list_roles_reports_an_unreadable_register_as_such(client, allow_env):
    """A broken register read must not read as 'visitor' — the reassuring
    answer is the one a failed read produces (deploy-status footgun)."""
    page = _fake_pages([_fake_user("u-res", "m@sunholo.com", {"role": "researcher"})])
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.list_users", return_value=page),
        patch("db.teacher_access.grant_for_uid", side_effect=RuntimeError("firestore down")),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.get("/api/admin/list-roles", headers={"Authorization": "Bearer stub-id-token"})
    body = resp.json()
    assert body["users"][0]["spend"] == {"error": "register unreadable"}
    assert body["researchersWithoutSpend"] == []


def test_list_roles_empty_tenant(client, allow_env):
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.list_users", return_value=_fake_pages([])),
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        resp = client.get("/api/admin/list-roles", headers={"Authorization": "Bearer stub-id-token"})
    assert resp.status_code == 200
    assert resp.json() == {
        "count": 0,
        "users": [],
        "researchers": [],
        "admins": [],
        "programmeAdmins": [],
        "researchersWithoutSpend": [],
    }


# ─── grant-researcher registers spend ──────────────────────────────────────────
#
# 2026-09-15: m@sunholo.com and SH were researchers on prod with no register
# row, so both got the recorded demonstration instead of a live tutor. Role
# and spend are separate axes, but a researcher we invited must be able to
# spend — so the grant writes the row when none is active.


def _grant_researcher(client, fake_user, **register_patches):
    with (
        patch("admin.auth.id_token.verify_oauth2_token") as mock_verify,
        patch("admin.routes.fb_auth.get_user", return_value=fake_user),
        patch("admin.routes.fb_auth.set_custom_user_claims"),
        patch("admin.routes._sync_access_claim", return_value="u1"),
        patch("admin.routes._invalidate_spend_cache"),
        patch("db.teacher_access.get_grant", return_value=register_patches.get("existing")),
        patch("db.teacher_access.grant_access") as mock_grant,
    ):
        mock_verify.return_value = {"email": _ALLOWED_SA, "email_verified": True}
        mock_grant.return_value = type(
            "G",
            (),
            {"email": "r@ind.ku.dk", "tier": "pilot", "monthly_cap_usd": 25.0, "expires_at": "2027-09-15T00:00:00Z"},
        )()
        resp = client.post(
            "/api/admin/grant-researcher",
            json={"uid": "u1"},
            headers={"Authorization": "Bearer stub-id-token"},
        )
    return resp, mock_grant


def test_grant_researcher_auto_registers_when_not_on_the_register(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {}, "email": "r@ind.ku.dk"})()
    resp, mock_grant = _grant_researcher(client, fake_user, existing=None)
    assert resp.status_code == 200, resp.text
    mock_grant.assert_called_once()
    kwargs = mock_grant.call_args.kwargs
    assert kwargs["tier"] == "pilot"
    assert kwargs["monthly_cap_usd"] == 25.0  # the default — never uncapped from here
    assert kwargs["granted_by"] == _ALLOWED_SA
    body = resp.json()
    assert body["register"]["autoRegistered"] is True
    assert body["register"]["tier"] == "pilot"


def test_grant_researcher_leaves_an_existing_active_row_alone(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {}, "email": "jb@ind.ku.dk"})()
    existing = type(
        "G",
        (),
        {"is_active": True, "email": "jb@ind.ku.dk", "tier": "pilot", "monthly_cap_usd": 100.0, "expires_at": None},
    )()
    resp, mock_grant = _grant_researcher(client, fake_user, existing=existing)
    assert resp.status_code == 200, resp.text
    mock_grant.assert_not_called()  # a deliberate $100 cap is never overwritten
    assert resp.json()["register"] == {
        "email": "jb@ind.ku.dk",
        "tier": "pilot",
        "monthlyCapUsd": 100.0,
        "expiresAt": None,
        "autoRegistered": False,
    }


def test_grant_researcher_re_registers_a_revoked_row(client, allow_env):
    fake_user = type("U", (), {"custom_claims": {}, "email": "r@ind.ku.dk"})()
    revoked = type("G", (), {"is_active": False})()
    resp, mock_grant = _grant_researcher(client, fake_user, existing=revoked)
    assert resp.status_code == 200, resp.text
    mock_grant.assert_called_once()


# -----------------------------------------------------------------------------
# /api/admin/access/unregistered — who is being REFUSED right now (1.1.124)
# -----------------------------------------------------------------------------
#
# The register answers "who did we invite?". These tests pin the other question,
# which is the one that cost a month: a teacher invited as x@school.dk whose
# browser hands Google a personal Gmail is refused on every paid surface and
# appears in no listing anywhere. Six of them had accumulated on prod.


class _StubMeta:
    def __init__(self, created: int, last: int) -> None:
        self.creation_timestamp = created
        self.last_sign_in_timestamp = last


class _StubUser:
    def __init__(self, email: str, uid: str, name: str, created: int, last: int) -> None:
        self.email = email
        self.uid = uid
        self.display_name = name
        self.user_metadata = _StubMeta(created, last)


class _StubPage:
    def __init__(self, users, next_page_token=None) -> None:
        self.users = users
        self.next_page_token = next_page_token


def _sa_token():
    return {
        "email": "cloudbuild-sa@multivac-deploy-aitana.iam.gserviceaccount.com",
        "email_verified": True,
    }


def test_unregistered_lists_only_accounts_without_an_active_grant(client, allow_env):
    """The invited-and-working teacher is omitted; the refused one is named."""
    users = [
        _StubUser("ok@school.dk", "uid-ok", "Registered Teacher", 1_000, 2_000),
        _StubUser("stray@gmail.com", "uid-stray", "Refused Teacher", 3_000, 4_000),
    ]

    class _Grant:
        is_active = True

    def fake_get_grant(email):
        return _Grant() if email == "ok@school.dk" else None

    with (
        patch("admin.auth.id_token.verify_oauth2_token", return_value=_sa_token()),
        patch.object(fb_auth, "list_users", return_value=_StubPage(users)),
        patch("db.teacher_access.get_grant", side_effect=fake_get_grant),
    ):
        resp = client.get(
            "/api/admin/access/unregistered",
            headers={"Authorization": "Bearer stub-id-token"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == 1
    assert [a["email"] for a in body["accounts"]] == ["stray@gmail.com"]
    assert body["accounts"][0]["displayName"] == "Refused Teacher"
    # No row at all is an OVERSIGHT; a revoked row is a DECISION. Keep them apart.
    assert body["accounts"][0]["hasInactiveRow"] is False


def test_unregistered_distinguishes_a_revoked_row_from_no_row(client, allow_env):
    """A revoked teacher is listed but flagged — re-granting undoes a choice."""
    users = [_StubUser("revoked@school.dk", "uid-r", "Revoked", 1, 2)]

    class _Inactive:
        is_active = False

    with (
        patch("admin.auth.id_token.verify_oauth2_token", return_value=_sa_token()),
        patch.object(fb_auth, "list_users", return_value=_StubPage(users)),
        patch("db.teacher_access.get_grant", return_value=_Inactive()),
    ):
        resp = client.get(
            "/api/admin/access/unregistered",
            headers={"Authorization": "Bearer stub-id-token"},
        )

    assert resp.status_code == 200
    assert resp.json()["accounts"][0]["hasInactiveRow"] is True


def test_unregistered_503s_rather_than_reporting_an_empty_list(client, allow_env):
    """A failed read must NEVER look like "nobody is refused".

    The reassuring answer is exactly the one a broken read produces — the same
    footgun as deploy-status.sh reporting parity it never checked.
    """
    with (
        patch("admin.auth.id_token.verify_oauth2_token", return_value=_sa_token()),
        patch.object(fb_auth, "list_users", side_effect=RuntimeError("identity store down")),
    ):
        resp = client.get(
            "/api/admin/access/unregistered",
            headers={"Authorization": "Bearer stub-id-token"},
        )

    assert resp.status_code == 503
    assert "could not read" in resp.json()["detail"].lower()


def test_unregistered_flags_a_truncated_page(client, allow_env):
    """A partial list must say so, or it understates who is locked out."""
    users = [_StubUser("a@b.dk", "uid-a", "A", 1, 2)]

    with (
        patch("admin.auth.id_token.verify_oauth2_token", return_value=_sa_token()),
        patch.object(fb_auth, "list_users", return_value=_StubPage(users, next_page_token="more")),
        patch("db.teacher_access.get_grant", return_value=None),
    ):
        resp = client.get(
            "/api/admin/access/unregistered",
            headers={"Authorization": "Bearer stub-id-token"},
        )

    assert resp.json()["truncated"] is True


def test_unregistered_requires_the_service_account_allowlist(client, allow_env):
    resp = client.get("/api/admin/access/unregistered")
    assert resp.status_code == 403
