"""Auth for /api/admin/* endpoints.

Admin routes are NOT callable by end users. They're meant to be hit by
trusted service accounts (Cloud Build, ops scripts) using Google-signed
ID tokens. We verify the token signature, then gate on an allowlist of
service-account emails supplied via the ADMIN_SEED_ALLOWED_SAS env var
(comma-separated).

The allowlist lives in env (not code) so rotating an SA is a Cloud Run
env-var update, not a deploy.
"""

from __future__ import annotations

import logging
import os

from fastapi import HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

logger = logging.getLogger(__name__)


def _allowed_emails() -> set[str]:
    raw = os.environ.get("ADMIN_SEED_ALLOWED_SAS", "")
    return {email.strip() for email in raw.split(",") if email.strip()}


def _assert_caller_is_service_account(request: Request) -> str:
    """Verify the bearer token and confirm its email is in the allowlist.

    Returns the verified email on success. Raises HTTPException(403)
    on missing token, bad signature, unverified email, or non-allowlisted
    email. Never returns a 401 — we treat every failure as "not
    authorized to use admin API" to avoid leaking which SAs are valid.

    Each failure path logs a WARNING with enough context to recover —
    historically these 403s were generic and the underlying cause
    (audience mismatch, expired token, allowlist drift) stayed hidden.
    Discovered 2026-05-25 when seed-platform-skills + a new
    upsert-demo-codes both 403'd silently across multiple Cloud Build
    deploys, leaving the deployed dev with stale skill metadata.
    """
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        logger.warning("admin auth: missing/invalid Authorization header")
        raise HTTPException(status_code=403, detail="Not authorized (missing bearer)")

    token = header[len("Bearer ") :].strip()
    if not token:
        logger.warning("admin auth: empty bearer token")
        raise HTTPException(status_code=403, detail="Not authorized (empty bearer)")

    try:
        claims = id_token.verify_oauth2_token(token, google_requests.Request())
    except Exception as e:
        logger.warning(
            "admin auth: verify_oauth2_token failed: %s: %s",
            type(e).__name__,
            e,
        )
        raise HTTPException(
            status_code=403,
            detail=f"Not authorized (verify failed: {type(e).__name__})",
        ) from e

    email = claims.get("email", "")
    if not claims.get("email_verified"):
        logger.warning("admin auth: email_verified=False email=%r claims=%s", email, claims)
        raise HTTPException(status_code=403, detail="Not authorized (email not verified)")

    allowed = _allowed_emails()
    if email not in allowed:
        logger.warning("admin auth: email %r not in allowlist (%d entries)", email, len(allowed))
        raise HTTPException(
            status_code=403,
            detail=f"Not authorized: {email} not in ADMIN_SEED_ALLOWED_SAS",
        )

    return email
