"""Google quota exhaustion → a 503 the student's page can explain (2026-11-26).

On 2026-11-25 one student dragging a sim slider took prod past Agent Engine's
100 session-event appends per minute. Every group's workbench push answered a
bare HTTP 500 for a minute; students saw nothing and nobody could report it.

Writes that hit the quota are retried first (``adk.session._append_with_retry``).
What still fails reaches this handler, which answers **503** with
``X-AIPLA-Busy: 1`` and ``Retry-After``. The student's API client
(``frontend/src/lib/apiClient.ts``) turns that header into a visible "AIPLA is
busy, wait a moment" notice with the time, so it can be reported. Each one is
also logged as ``busy: …``, so ``make log-health`` counts them.

Any other Google API error is logged with its traceback and answered as the
plain 500 it was before.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

log = logging.getLogger(__name__)

BUSY_HEADER = "X-AIPLA-Busy"
RETRY_AFTER_S = 30


def is_quota_error(exc: BaseException) -> bool:
    """A Google 429 / RESOURCE_EXHAUSTED, from any client library."""
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    return code == 429 or "RESOURCE_EXHAUSTED" in str(exc)


def busy_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "busy", "code": "busy"},
        headers={BUSY_HEADER: "1", "Retry-After": str(RETRY_AFTER_S)},
    )


def install_busy_handler(app: FastAPI) -> None:
    """Answer an unhandled Google quota error as 503 busy instead of 500."""
    from google.genai.errors import APIError

    async def _handle(request: Request, exc: Any) -> JSONResponse:
        if is_quota_error(exc):
            log.warning("busy: Google quota exhausted on %s %s (%s)", request.method, request.url.path, str(exc)[:200])
            return busy_response()
        log.error("unhandled Google API error on %s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})

    app.add_exception_handler(APIError, _handle)
