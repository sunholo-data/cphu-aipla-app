"""``POST /api/client-errors`` — the browser tells us it broke (1.1.96 M-1).

Design: docs/design/aipla/v1.1.0-feedback/teacher-ui-friction-telemetry.md (M-1)
Sprint: docs/design/aipla/v1.1.0-feedback/client-error-reporting-sprint.md (S1)

**This endpoint takes no auth, and that is a design commitment, not an
oversight.** An error reporter behind a token cannot report the errors that
matter most: a throw during auth bootstrap, a crash on the public ``/project``
pages, a failure before the anonymous group token is minted — or a failure *of
the token mint itself*, which is the single most valuable error we could hear
about. Requiring a token would blind us to exactly the class of bug this
milestone exists to catch.

The price of that is a public write endpoint, so it is shaped defensively:

  1. **Closed enums** for ``kind`` and ``role`` — never free-text categories.
  2. **Hard length caps**, enforced by truncation rather than rejection: a
     truncated report beats no report, and the browser sending a 40 KB stack is
     the one in trouble.
  3. **Per-IP token bucket** (``auth.group_rate_limit``, the same limiter the
     anonymous group-join endpoint uses) so a render loop cannot turn one bug
     into unbounded log spend.
  4. **Redaction server-side** as well as client-side — the client that failed to
     redact is precisely the broken client we are listening for.
  5. **No identity accepted at all.** No uid, no email, no group code; the body
     has no field to put one in. This is why M-1 carries no consent gate where
     M0's friction events do.

Over budget returns **429 with ``Retry-After``**, deliberately not a silent 204.
A limiter that reports success when it dropped the payload is the "a checker
answers when it could not read its subject" footgun in CLAUDE.md, and the
frontend needs a real signal to stop reporting for the rest of the page.
Everything else — including an emitter failure — returns 204: telemetry must
never be the reason a request fails.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from auth.group_rate_limit import RateLimitExceeded, TokenBucketRateLimiter
from observability.client_error import (
    KINDS,
    MAX_MESSAGE_CHARS,
    MAX_STACK_CHARS,
    MAX_URL_CHARS,
    ROLES,
    emit_client_error,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/client-errors", tags=["client-errors"])

# 30 reports / 5 minutes per IP. Sized against the frontend's own limits: the
# reporter caps itself at 10 per page load, so this tolerates a teacher
# reloading a genuinely broken page twice and still refuses a runaway client.
_limiter = TokenBucketRateLimiter(capacity=30, refill_seconds=300.0)


def _client_ip(request: Request) -> str:
    """Best-effort caller IP. Cloud Run / load balancer set X-Forwarded-For.

    Mirrors ``auth.group_routes._client_ip`` — same trust model, same header.
    """
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # First entry is the originating client per RFC 7239.
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class ClientErrorRequest(BaseModel):
    """One browser-side error.

    Every field is capped by ``max_length`` at the *transport* boundary purely to
    reject the absurd (a megabyte body); the semantic truncation to the documented
    caps happens in ``emit_client_error``. The two limits differ on purpose — the
    outer one is a DoS guard, the inner one is the log contract.
    """

    kind: str = Field(default="render", max_length=32)
    message: str = Field(default="", max_length=MAX_MESSAGE_CHARS * 4)
    stack: str = Field(default="", max_length=MAX_STACK_CHARS * 4)
    url: str = Field(default="", max_length=MAX_URL_CHARS * 4)
    role: str = Field(default="anon", max_length=16)

    model_config = {"extra": "ignore"}


@router.post("", status_code=204)
async def post_client_error(body: ClientErrorRequest, request: Request) -> None:
    """Record one client-side error. No auth; per-IP rate-limited.

    Returns 204 on success and on any internal failure. 429 (with
    ``Retry-After``) is the only rejection, and it is the frontend's signal to
    stop reporting for this page load.
    """
    try:
        _limiter.check(_client_ip(request))
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail=f"rate limit exceeded; retry after {exc.retry_after_seconds}s",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    kind = body.kind if body.kind in KINDS else "render"
    role = body.role if body.role in ROLES else "anon"

    try:
        emit_client_error(
            kind=kind,
            message=body.message,
            stack=body.stack,
            url=body.url,
            role=role,
            # From the header, not the body: a field the caller cannot choose is
            # worth more than one it can, on an endpoint with no auth.
            user_agent=request.headers.get("user-agent", ""),
        )
    except Exception as exc:  # pragma: no cover - emit_client_error never raises
        # Belt and braces. The one thing this endpoint must never do is fail.
        logger.warning("client_error_routes: emit raised (suppressed): %s", exc)
    return None


__all__ = ["router"]
