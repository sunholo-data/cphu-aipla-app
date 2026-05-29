"""HTTP client for the Aitana backend.

Authentication precedence:
    1. $AIPLATFORM_ID_TOKEN env var (preferred for CI/tests)
    2. `gcloud auth print-identity-token` (local dev)

Failure to obtain a token surfaces a CLEAR error message, not a silent 401.
"""

from __future__ import annotations

import os
import subprocess
from typing import Any

import click
import httpx

# Default base URLs per --env. Override via env var AIPLATFORM_API_URL (wins over all)
# or per-env AIPLATFORM_API_URL_{ENV}.
# AIPLA backend is served behind the frontend Cloud Run service at /api/proxy
# (there is no separate backend service). dev URL is stable per Cloud Run
# service. test/prod are placeholders until those envs are cut.
_DEFAULT_URLS = {
    "local": "http://localhost:1956",
    "dev": "https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app/api/proxy",
    "test": "https://aipla-v01-frontend-test-placeholder.a.run.app/api/proxy",
    "prod": "https://aipla-v01-frontend-prod-placeholder.a.run.app/api/proxy",
}


class AuthError(click.ClickException):
    """Raised when we cannot obtain a bearer token."""


class APIError(click.ClickException):
    """Raised when the backend returns a non-2xx status."""


def resolve_base_url(env: str) -> str:
    """Resolve the backend base URL for `env`, honoring env-var overrides."""
    override = os.environ.get("AIPLATFORM_API_URL")
    if override:
        return override.rstrip("/")
    per_env = os.environ.get(f"AIPLATFORM_API_URL_{env.upper()}")
    if per_env:
        return per_env.rstrip("/")
    if env not in _DEFAULT_URLS:
        raise click.UsageError(f"Unknown env '{env}'. Use one of: local, dev, test, prod")
    return _DEFAULT_URLS[env]


def get_bearer_token() -> str:
    """Return a Firebase/Google ID token.

    1. $AIPLATFORM_ID_TOKEN env var if set.
    2. `gcloud auth print-identity-token` otherwise.

    Raises AuthError with a clear message on failure — never returns an empty
    string that would surface as an opaque 401 later.
    """
    env_token = os.environ.get("AIPLATFORM_ID_TOKEN")
    if env_token:
        return env_token.strip()

    try:
        result = subprocess.run(  # noqa: S603
            ["gcloud", "auth", "print-identity-token"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except FileNotFoundError as exc:
        raise AuthError(
            "gcloud CLI not found. Either install gcloud "
            "(https://cloud.google.com/sdk/docs/install) or set AIPLATFORM_ID_TOKEN "
            "in your environment."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise AuthError("gcloud auth print-identity-token timed out after 10s.") from exc

    if result.returncode != 0 or not result.stdout.strip():
        stderr = (result.stderr or "").strip() or "(no stderr)"
        raise AuthError(
            "Failed to obtain identity token via `gcloud auth print-identity-token`.\n"
            f"  stderr: {stderr}\n"
            "  Fix: run `gcloud auth login` then `gcloud auth application-default login`, "
            "or set AIPLATFORM_ID_TOKEN directly."
        )
    return result.stdout.strip()


class AIPlatformClient:
    """Thin httpx wrapper that injects the bearer token on every call."""

    def __init__(self, env: str = "local", base_url: str | None = None, token: str | None = None) -> None:
        self.env = env
        self.base_url = (base_url or resolve_base_url(env)).rstrip("/")
        self._token = token  # If provided (e.g. tests), skip auth resolution.

    # --- auth ---

    def _auth_headers(self) -> dict[str, str]:
        token = self._token or get_bearer_token()
        return {"Authorization": f"Bearer {token}"}

    # --- core request ---

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
    ) -> Any:
        url = f"{self.base_url}{path}"
        headers = self._auth_headers()
        try:
            resp = httpx.request(method, url, headers=headers, params=params, json=json, timeout=30.0)
        except httpx.HTTPError as exc:
            raise APIError(f"HTTP transport error calling {method} {url}: {exc}") from exc

        if resp.status_code >= 400:
            detail = resp.text
            try:
                body = resp.json()
                detail = body.get("detail", detail) if isinstance(body, dict) else detail
            except ValueError:
                pass
            raise APIError(f"{method} {path} returned {resp.status_code}: {detail}")

        if resp.status_code == 204 or not resp.content:
            return None
        try:
            return resp.json()
        except ValueError:
            return resp.text

    # --- convenience verbs ---

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.request("POST", path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> Any:
        return self.request("PUT", path, **kwargs)

    def patch(self, path: str, **kwargs: Any) -> Any:
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self.request("DELETE", path, **kwargs)
