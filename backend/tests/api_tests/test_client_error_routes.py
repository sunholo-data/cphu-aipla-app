"""1.1.96 M-1 — ``POST /api/client-errors``.

The endpoint is deliberately unauthenticated (see the module docstring in
``protocols/client_error_routes.py``), so most of what is worth testing is the
defensive shaping: closed enums, truncation-not-rejection, redaction as defence
in depth, a real 429 rather than a reassuring 204, and the invariant that
telemetry never makes a request fail.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from observability import client_error as ce
from protocols import client_error_routes
from protocols.client_error_routes import router


@pytest.fixture
def client(monkeypatch) -> TestClient:
    """A client whose limiter starts empty for every test."""
    client_error_routes._limiter.reset_all()
    test_app = FastAPI()
    test_app.include_router(router)
    return TestClient(test_app)


@pytest.fixture
def emitted(monkeypatch) -> list[dict]:
    """Capture what would have been written to Cloud Logging.

    Patches the *named logger* rather than ``emit_client_error`` so the redaction
    and truncation inside the emitter are still exercised.
    """
    rows: list[dict] = []

    class _FakeLogger:
        def log_struct(self, payload):
            rows.append(payload)

    monkeypatch.setattr(ce, "_get_logger", lambda _log_id: _FakeLogger())
    monkeypatch.setattr(ce, "_version_fields", lambda: {"revision": "rev-1", "app_version": "v0.0.0"})
    return rows


# ─── The happy path ─────────────────────────────────────────────────────────


def test_unauthenticated_post_is_accepted(client, emitted):
    """No Authorization header. This is the whole point of the endpoint — an
    error during auth bootstrap is the most valuable one we could hear about."""
    resp = client.post(
        "/api/client-errors",
        json={
            "kind": "unhandledrejection",
            "message": "Failed to fetch",
            "stack": "at fetchWithAuth (apiClient.ts:42)",
            "url": "/teacher/classes/abc",
            "role": "teacher",
        },
    )
    assert resp.status_code == 204
    assert len(emitted) == 1
    row = emitted[0]
    assert row["kind"] == "unhandledrejection"
    assert row["role"] == "teacher"
    assert row["message"] == "Failed to fetch"
    assert row["path"] == "/teacher/classes/abc"
    assert row["surface"] == "teacher"
    # Version stamped server-side: same container as the frontend (sidecar).
    assert row["revision"] == "rev-1"


def test_user_agent_comes_from_the_header_not_the_body(client, emitted):
    resp = client.post(
        "/api/client-errors",
        json={"kind": "render", "message": "boom", "user_agent": "I am a liar"},
        headers={"User-Agent": "Mozilla/5.0 (real)"},
    )
    assert resp.status_code == 204
    assert emitted[0]["user_agent"] == "Mozilla/5.0 (real)"


# ─── Closed enums ───────────────────────────────────────────────────────────


def test_unknown_kind_and_role_fall_back_to_the_enum(client, emitted):
    """Never free text — an unknown value becomes the safe default, and the
    report is still kept, because a mis-tagged error is still an error."""
    resp = client.post(
        "/api/client-errors",
        json={"kind": "totally-made-up", "message": "boom", "role": "admin"},
    )
    assert resp.status_code == 204
    assert emitted[0]["kind"] == "render"
    assert emitted[0]["role"] == "anon"


# ─── Caps: truncate, do not reject ──────────────────────────────────────────


def test_oversize_message_and_stack_are_truncated_not_rejected(client, emitted):
    resp = client.post(
        "/api/client-errors",
        json={"kind": "render", "message": "x" * 2000, "stack": "y" * 10000},
    )
    assert resp.status_code == 204
    assert len(emitted[0]["message"]) == ce.MAX_MESSAGE_CHARS
    assert len(emitted[0]["stack"]) == ce.MAX_STACK_CHARS


def test_absurd_body_is_rejected_at_the_transport_boundary(client, emitted):
    """The outer Pydantic cap is a DoS guard, distinct from the log contract."""
    resp = client.post(
        "/api/client-errors",
        json={"kind": "render", "message": "x" * 100_000},
    )
    assert resp.status_code == 422
    assert emitted == []


# ─── Privacy ────────────────────────────────────────────────────────────────


def test_query_string_is_stripped_from_the_url(client, emitted):
    """A join link is `…/group?code=XXXX`. A naive URL capture would put live
    class join codes in the log."""
    resp = client.post(
        "/api/client-errors",
        json={"kind": "render", "message": "boom", "url": "/group?code=SECRET1#frag"},
    )
    assert resp.status_code == 204
    assert emitted[0]["path"] == "/group"
    assert "SECRET1" not in str(emitted[0])


@pytest.mark.parametrize(
    "raw",
    [
        "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF-_123",
        "Authorization: Bearer sk-live-abcdefghijklmnop",
        "failed for teacher@ku.dk",
        "GET /api/curriculum?code=SECRET1 failed",
    ],
)
def test_secrets_are_redacted_server_side_too(client, emitted, raw):
    """Defence in depth. The browser redacts first — but the client that failed
    to redact is precisely the broken client we are listening for."""
    resp = client.post("/api/client-errors", json={"kind": "render", "message": raw})
    assert resp.status_code == 204
    row = str(emitted[0])
    assert "[redacted]" in row
    for secret in ("eyJhbGciOiJIUzI1NiJ9", "sk-live-abcdefghijklmnop", "teacher@ku.dk", "SECRET1"):
        assert secret not in row


def test_body_has_no_field_for_an_identity(client, emitted):
    """M-1 carries no uid, email or group code — extra keys are dropped, so a
    future caller cannot smuggle one in and quietly change the consent posture."""
    resp = client.post(
        "/api/client-errors",
        json={"kind": "render", "message": "boom", "uid": "teacher-123", "group_id": "grp-1"},
    )
    assert resp.status_code == 204
    row = str(emitted[0])
    assert "teacher-123" not in row
    assert "grp-1" not in row


# ─── Rate limiting ──────────────────────────────────────────────────────────


def test_rate_limit_returns_429_with_retry_after(client, emitted):
    """Deliberately NOT a silent 204: a limiter that reports success when it
    dropped the payload is the 'checker answers when it could not read its
    subject' footgun, and the frontend needs a real signal to stop."""
    body = {"kind": "render", "message": "boom"}
    headers = {"X-Forwarded-For": "203.0.113.9"}
    for _ in range(30):
        assert client.post("/api/client-errors", json=body, headers=headers).status_code == 204

    resp = client.post("/api/client-errors", json=body, headers=headers)
    assert resp.status_code == 429
    assert int(resp.headers["Retry-After"]) >= 1
    assert len(emitted) == 30


def test_rate_limit_buckets_per_ip(client, emitted):
    """One noisy client must not silence everyone behind a different address."""
    body = {"kind": "render", "message": "boom"}
    for _ in range(30):
        client.post("/api/client-errors", json=body, headers={"X-Forwarded-For": "203.0.113.9"})
    assert client.post("/api/client-errors", json=body, headers={"X-Forwarded-For": "203.0.113.9"}).status_code == 429
    assert client.post("/api/client-errors", json=body, headers={"X-Forwarded-For": "198.51.100.4"}).status_code == 204


# ─── Telemetry never breaks the request ─────────────────────────────────────


def test_emitter_failure_still_returns_204(client, monkeypatch):
    def _boom(**_kwargs):
        raise RuntimeError("cloud logging is down")

    monkeypatch.setattr(client_error_routes, "emit_client_error", _boom)
    resp = client.post("/api/client-errors", json={"kind": "render", "message": "boom"})
    assert resp.status_code == 204


def test_no_cloud_logger_is_a_silent_no_op(client, monkeypatch):
    """LOCAL_MODE / no creds: the structured emit is skipped, the request still
    succeeds, and the stdlib warning line is the developer's visibility."""
    monkeypatch.setattr(ce, "_get_logger", lambda _log_id: None)
    resp = client.post("/api/client-errors", json={"kind": "render", "message": "boom"})
    assert resp.status_code == 204
