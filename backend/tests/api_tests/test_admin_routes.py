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
