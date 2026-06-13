"""`aiplatform users` — researcher-claim admin (sprint 1.1.5).

`grant-researcher` / `revoke-researcher` set the Firebase custom claim
`{"role": "researcher"}` on a target user via the SA-allowlisted admin
endpoints. The claim grants cross-class READ access (Research view + the
cost-dashboard researcher views).

These hit `/api/admin/*`, which require a Google-signed ID token whose
email is in the backend's `ADMIN_SEED_ALLOWED_SAS` allowlist. Run with an
impersonated SA token, e.g.:

    AIPLATFORM_ID_TOKEN=$(gcloud auth print-identity-token \\
        --impersonate-service-account=<seed-sa> \\
        --audiences=<backend-url> --include-email) \\
        aiplatform --env dev users grant-researcher <uid>

(The `--include-email` flag matters — without it the SA token has no
email claim and the admin gate 403s.)
"""

from __future__ import annotations

import json as _json

import click

from aiplatform.http import AIPlatformClient


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group()
def users() -> None:
    """Manage user roles (researcher claim)."""


@users.command("grant-researcher")
@click.argument("uid")
@click.pass_context
def grant_researcher(ctx: click.Context, uid: str) -> None:
    """Grant the researcher claim to the Firebase user UID.

    Takes effect on the user's next ID-token refresh (~1h).
    """
    result = _client(ctx).post("/api/admin/grant-researcher", json={"uid": uid})
    click.echo(_json.dumps(result, indent=2))


@users.command("revoke-researcher")
@click.argument("uid")
@click.pass_context
def revoke_researcher(ctx: click.Context, uid: str) -> None:
    """Revoke the researcher claim from the Firebase user UID."""
    result = _client(ctx).post("/api/admin/revoke-researcher", json={"uid": uid})
    click.echo(_json.dumps(result, indent=2))
