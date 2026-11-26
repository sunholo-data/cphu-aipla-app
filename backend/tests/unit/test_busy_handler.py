"""2026-11-26 — a Google quota error the retries could not absorb is a 503 the
student's page explains, not a bare 500 (prod, 2026-11-25: 53 workbench pushes
500'd for a minute and no student could see or report it)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.genai.errors import ClientError

from observability.busy import BUSY_HEADER, install_busy_handler, is_quota_error

QUOTA = ClientError(
    429,
    {
        "error": {
            "code": 429,
            "message": "Quota exceeded for quota metric 'Session Event Append Requests'",
            "status": "RESOURCE_EXHAUSTED",
        }
    },
)
BAD = ClientError(400, {"error": {"code": 400, "message": "bad request", "status": "INVALID_ARGUMENT"}})


def _app(exc: Exception) -> TestClient:
    app = FastAPI()
    install_busy_handler(app)

    @app.post("/api/sessions/s1/iframe-context")
    async def push():
        raise exc

    return TestClient(app, raise_server_exceptions=False)


def test_a_quota_error_is_a_503_busy_with_a_retry_hint():
    resp = _app(QUOTA).post("/api/sessions/s1/iframe-context")
    assert resp.status_code == 503
    assert resp.headers[BUSY_HEADER] == "1"
    assert resp.headers["Retry-After"] == "30"
    assert resp.json() == {"detail": "busy", "code": "busy"}


def test_any_other_google_error_stays_a_plain_500():
    resp = _app(BAD).post("/api/sessions/s1/iframe-context")
    assert resp.status_code == 500
    assert BUSY_HEADER not in resp.headers


def test_is_quota_error():
    assert is_quota_error(QUOTA)
    assert not is_quota_error(BAD)
    assert not is_quota_error(RuntimeError("wire down"))
    assert is_quota_error(RuntimeError("429 RESOURCE_EXHAUSTED"))


def test_the_app_installs_the_handler():
    """Pinned by source, so importing the whole app (which wants GCP) is not needed."""
    import inspect
    from pathlib import Path

    src = (Path(inspect.getfile(is_quota_error)).parents[1] / "fast_api_app.py").read_text()
    assert "install_busy_handler(app)" in src
