"""Screen-size slice of 1.1.96 M0 (2026-09-30) — ``kind: "env"`` on ``/api/client-errors``.

"The UI was a bit cramped on a laptop — what screen sizes are people using?"
The browser sends one env beacon per page session. What matters here:

* it is accepted with a student group token, a teacher token, or no token at
  all — the route is unauthenticated, so an anonymous-group student can never
  401 on it (the dual-auth footgun in CLAUDE.md);
* it lands on its OWN log id, never in the client-error log;
* no user agent, path, role or id reaches the row, even if the client sends one;
* numbers are clamped, not rejected;
* it spends its own rate-limit bucket, not the error reporter's.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from observability import client_error as ce
from protocols import client_error_routes
from protocols.client_error_routes import router

GOOD = {
    "kind": "env",
    "viewportW": 1366,
    "viewportH": 657,
    "screenW": 1366,
    "screenH": 768,
    "dpr": 1,
    "pointer": "fine",
    "surface": "teacher",
    "buildId": "b20260930-abc",
}


@pytest.fixture
def client() -> TestClient:
    client_error_routes._limiter.reset_all()
    client_error_routes._env_limiter.reset_all()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def emitted(monkeypatch) -> dict[str, list[dict]]:
    """Rows per log id, so a test can assert WHICH log a row went to."""
    rows: dict[str, list[dict]] = {}

    class _FakeLogger:
        def __init__(self, log_id: str) -> None:
            self.log_id = log_id

        def log_struct(self, payload):
            rows.setdefault(self.log_id, []).append(payload)

    monkeypatch.setattr(ce, "_get_logger", lambda log_id: _FakeLogger(log_id))
    monkeypatch.setattr(ce, "_version_fields", lambda: {"revision": "rev-1", "app_version": "v0.1.74"})
    return rows


@pytest.mark.parametrize(
    "headers",
    [
        {},  # public page, nobody signed in
        {"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJncm91cCI6ImcifQ.sig"},  # student group JWT
        {"Authorization": "Bearer firebase-teacher-id-token"},  # teacher
    ],
    ids=["no-auth", "student-token", "teacher-token"],
)
def test_env_beacon_accepted_for_every_auth_kind(client, emitted, headers):
    resp = client.post("/api/client-errors", json=GOOD, headers=headers)
    assert resp.status_code == 204
    assert len(emitted[ce.LOG_ID_CLIENT_ENV]) == 1


def test_env_row_goes_to_its_own_log_not_the_error_log(client, emitted):
    client.post("/api/client-errors", json=GOOD)
    assert ce.LOG_ID_CLIENT_ERROR not in emitted
    row = emitted[ce.LOG_ID_CLIENT_ENV][0]
    assert row == {
        "kind": "env",
        "viewport_w": 1366,
        "viewport_h": 657,
        "screen_w": 1366,
        "screen_h": 768,
        "dpr": 1.0,
        "pointer": "fine",
        "surface": "teacher",
        "viewport_bucket": "1280-1439",  # the 1366x768 laptop
        "client_build_id": "b20260930-abc",
        "revision": "rev-1",
        "app_version": "v0.1.74",
    }


def test_no_fingerprint_fields_reach_the_row(client, emitted):
    """A screen size is fine, a fingerprint is not (ADR-001). Even if a client
    sends identity or a UA — and whatever the header says — none of it lands."""
    body = {
        **GOOD,
        "user_agent": "Mozilla/5.0 body",
        "url": "/group?code=SECRET",
        "role": "student",
        "uid": "u-1",
        "groupId": "g-1",
        "email": "teacher@ku.dk",
    }
    client.post("/api/client-errors", json=body, headers={"User-Agent": "Mozilla/5.0 header"})
    row = emitted[ce.LOG_ID_CLIENT_ENV][0]
    for forbidden in ("user_agent", "path", "role", "uid", "groupId", "group_id", "email", "url", "message"):
        assert forbidden not in row
    assert "Mozilla" not in repr(row)
    assert "SECRET" not in repr(row)


def test_values_are_clamped_not_rejected(client, emitted):
    body = {
        "kind": "env",
        "viewportW": 99999,
        "viewportH": -40,
        "screenW": 1920.6,
        "dpr": 50,
        "pointer": "stylus",
        "surface": "admin",
        "buildId": "not a build id; drop table",
    }
    resp = client.post("/api/client-errors", json=body)
    assert resp.status_code == 204
    row = emitted[ce.LOG_ID_CLIENT_ENV][0]
    assert row["viewport_w"] == ce.MAX_DIMENSION_PX
    assert row["viewport_h"] == 0
    assert row["screen_w"] == 1921
    assert row["screen_h"] is None
    assert row["dpr"] == 8.0
    assert row["pointer"] is None
    assert row["surface"] == "unknown"
    assert row["client_build_id"] is None
    assert row["viewport_bucket"] == ">=1920"


@pytest.mark.parametrize(
    ("width", "bucket"),
    [
        (0, "<768"),
        (767, "<768"),
        (768, "768-1279"),
        (1279, "768-1279"),
        (1280, "1280-1439"),
        (1440, "1440-1919"),
        (1919, "1440-1919"),
        (1920, ">=1920"),
        (None, None),
    ],
)
def test_viewport_bucket_edges(width, bucket):
    assert ce.viewport_bucket(width) == bucket


def test_env_beacons_do_not_spend_the_error_budget(client, emitted):
    """A classroom behind one NAT address opening a lesson must not use up the
    budget that a real crash report from that room then needs."""
    for _ in range(40):  # more than the error bucket's 30
        assert client.post("/api/client-errors", json=GOOD).status_code == 204
    resp = client.post("/api/client-errors", json={"kind": "render", "message": "boom"})
    assert resp.status_code == 204
    assert len(emitted[ce.LOG_ID_CLIENT_ERROR]) == 1


def test_env_beacon_over_its_own_budget_is_429(client, emitted):
    for _ in range(300):
        client.post("/api/client-errors", json=GOOD)
    resp = client.post("/api/client-errors", json=GOOD)
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_emitter_failure_still_returns_204(client, monkeypatch):
    class _Broken:
        def log_struct(self, payload):
            raise RuntimeError("logging down")

    monkeypatch.setattr(ce, "_get_logger", lambda _log_id: _Broken())
    assert client.post("/api/client-errors", json=GOOD).status_code == 204


def test_env_log_id_is_not_routed_to_bigquery():
    """Same deliberate scope as the error log: Cloud Logging only."""
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]
    variables = (repo_root / "infrastructure/modules/chat-logs/variables.tf").read_text()
    assert ce.LOG_ID_CLIENT_ENV not in variables
