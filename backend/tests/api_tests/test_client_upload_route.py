"""Upload outcomes (2026-11-09) — ``kind: "upload"`` on ``/api/client-errors``.

At the 3 Nov Bohr workshop a photo "didn't upload from the phone". The server
could only see what arrived; whether a photo is sent at all is decided in the
browser (person screen, cap, type, decode). The browser now reports each
outcome. What matters here:

* accepted with any token or none, so an anonymous student never 401s on it;
* its own log id, never the error log or the env log;
* no file name, user agent, path, role or id reaches the row;
* closed enums: an unknown value falls back or is dropped, never logged raw;
* it spends the beacon bucket, not the error reporter's.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from observability import client_error as ce
from protocols import client_error_routes
from protocols.client_error_routes import router

BLOCKED = {
    "kind": "upload",
    "outcome": "blocked_person",
    "where": "solution",
    "mime": "jpeg",
    "sizeKb": 3412,
    "encodedKb": None,
    "encoding": None,
    "screen": "blocked",
    "pointer": "coarse",
    "buildId": "b20261109-abc",
}


@pytest.fixture
def client(monkeypatch) -> TestClient:
    for limiter in (client_error_routes._limiter, client_error_routes._env_limiter):
        limiter.reset_all()
        monkeypatch.setattr(limiter, "time_provider", lambda: 1_000.0)
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture
def emitted(monkeypatch) -> dict[str, list[dict]]:
    rows: dict[str, list[dict]] = {}

    class _FakeLogger:
        def __init__(self, log_id: str) -> None:
            self.log_id = log_id

        def log_struct(self, payload):
            rows.setdefault(self.log_id, []).append(payload)

    monkeypatch.setattr(ce, "_get_logger", lambda log_id: _FakeLogger(log_id))
    monkeypatch.setattr(ce, "_version_fields", lambda: {"revision": "rev-1", "app_version": "v0.1.107"})
    return rows


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJncm91cCI6ImcifQ.sig"},
        {"Authorization": "Bearer firebase-teacher-id-token"},
    ],
    ids=["no-auth", "student-token", "teacher-token"],
)
def test_upload_beacon_accepted_for_every_auth_kind(client, emitted, headers):
    assert client.post("/api/client-errors", json=BLOCKED, headers=headers).status_code == 204
    assert len(emitted[ce.LOG_ID_CLIENT_UPLOAD]) == 1


def test_upload_row_goes_to_its_own_log(client, emitted):
    client.post("/api/client-errors", json=BLOCKED)
    assert set(emitted) == {ce.LOG_ID_CLIENT_UPLOAD}
    assert emitted[ce.LOG_ID_CLIENT_UPLOAD][0] == {
        "kind": "upload",
        "outcome": "blocked_person",
        "where": "solution",
        "mime": "jpeg",
        "size_kb": 3412,
        "encoded_kb": None,
        "encoding": None,
        "screen": "blocked",
        "pointer": "coarse",
        "client_build_id": "b20261109-abc",
        "revision": "rev-1",
        "app_version": "v0.1.107",
    }


def test_staged_row_carries_encoding_and_size(client, emitted):
    body = {**BLOCKED, "outcome": "staged", "screen": "degraded", "encoding": "original_type", "encodedKb": 4100}
    client.post("/api/client-errors", json=body)
    row = emitted[ce.LOG_ID_CLIENT_UPLOAD][0]
    assert (row["outcome"], row["screen"], row["encoding"], row["encoded_kb"]) == (
        "staged",
        "degraded",
        "original_type",
        4100,
    )


def test_no_identity_or_file_name_reaches_the_row(client, emitted):
    body = {
        **BLOCKED,
        "name": "Nanna_Jensen.jpg",
        "fileName": "Nanna_Jensen.jpg",
        "user_agent": "Mozilla/5.0 body",
        "url": "/group?code=SECRET",
        "role": "student",
        "groupId": "g-1",
    }
    client.post("/api/client-errors", json=body, headers={"User-Agent": "Mozilla/5.0 header"})
    row = emitted[ce.LOG_ID_CLIENT_UPLOAD][0]
    for forbidden in ("name", "fileName", "user_agent", "path", "role", "group_id", "groupId", "url"):
        assert forbidden not in row
    for leaked in ("Nanna", "Mozilla", "SECRET"):
        assert leaked not in repr(row)


def test_unknown_enum_values_fall_back_and_unknown_outcome_is_dropped(client, emitted):
    odd = {**BLOCKED, "where": "desk", "mime": "image/x-weird", "screen": "maybe", "encoding": "zip", "pointer": "?"}
    client.post("/api/client-errors", json=odd)
    row = emitted[ce.LOG_ID_CLIENT_UPLOAD][0]
    assert (row["where"], row["mime"], row["screen"], row["encoding"], row["pointer"]) == (
        "chat",
        "other",
        None,
        None,
        None,
    )
    assert client.post("/api/client-errors", json={**BLOCKED, "outcome": "uploaded!"}).status_code == 204
    assert len(emitted[ce.LOG_ID_CLIENT_UPLOAD]) == 1


def test_sizes_are_clamped(client, emitted):
    client.post("/api/client-errors", json={**BLOCKED, "sizeKb": -5, "encodedKb": 10**12})
    row = emitted[ce.LOG_ID_CLIENT_UPLOAD][0]
    assert (row["size_kb"], row["encoded_kb"]) == (0, ce.MAX_UPLOAD_KB)


def test_upload_beacons_do_not_spend_the_error_budget(client, emitted):
    for _ in range(40):
        assert client.post("/api/client-errors", json=BLOCKED).status_code == 204
    assert client.post("/api/client-errors", json={"kind": "render", "message": "boom"}).status_code == 204
    assert len(emitted[ce.LOG_ID_CLIENT_ERROR]) == 1


def test_upload_log_id_is_not_routed_to_bigquery():
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]
    variables = (repo_root / "infrastructure/modules/chat-logs/variables.tf").read_text()
    assert ce.LOG_ID_CLIENT_UPLOAD not in variables
