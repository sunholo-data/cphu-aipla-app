"""`aiplatform users` — role + access-register admin.

Two things live here, both behind the same SA-allowlisted `/api/admin/*` gate:

  * the researcher claim (sprint 1.1.5) — cross-class READ access;
  * the access register (ACCESS-1 M1) — who may SPEND money.

They are independent: a researcher is not automatically a pilot, and a pilot is
not automatically a researcher.

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
    """Manage user roles (researcher claim) and the access register."""


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


# ─── Access register (ACCESS-1 M1) ───────────────────────────────────────────
#
# Who may spend money. `aipla.ku.dk` is public and Google sign-in is
# unrestricted, so every identity is a `visitor` (full navigation, recorded demo
# tutor, no live model, no student join codes) until someone named here grants
# them `pilot`.
#
# Named invites only — deliberately no domain wildcard. A domain rule cannot
# carry a per-person cap, and "one leaked link inside UCPH" would be unbounded.


@users.command("grant-access")
@click.argument("email")
@click.option("--cap", type=float, default=None, help="Monthly cap in USD (default: the backend's default).")
@click.option(
    "--expires",
    default=None,
    help=(
        "ISO-8601 expiry, e.g. 2026-09-15T00:00:00Z. Recommended: the contract "
        "boundary, so forgetting to clean up means access LAPSES rather than persists."
    ),
)
@click.option("--note", default="", help="Why this person was invited (shown in `list-access`).")
@click.option("--tier", default="pilot", type=click.Choice(["pilot", "visitor"]), help="Tier to grant.")
@click.pass_context
def grant_access(
    ctx: click.Context,
    email: str,
    cap: float | None,
    expires: str | None,
    note: str,
    tier: str,
) -> None:
    """Invite EMAIL onto the access register so they can spend.

    Keyed by email, not uid — the point is to authorise someone BEFORE they have
    ever signed in. If they already have an account the claim is pushed
    immediately; otherwise their first app load picks it up.

    Idempotent, and doubles as un-revoke.

    Note the email must match what the identity provider returns EXACTLY (case
    and whitespace aside). There is no plus-address or dot folding: inventing
    equivalences would create a way to be admitted under an address nobody
    invited, so a typo fails visibly instead.
    """
    body: dict = {"email": email, "tier": tier, "note": note}
    if cap is not None:
        body["monthly_cap_usd"] = cap
    if expires:
        body["expires_at"] = expires
    result = _client(ctx).post("/api/admin/access/grant", json=body)
    click.echo(_json.dumps(result, indent=2))


@users.command("revoke-access")
@click.argument("email")
@click.pass_context
def revoke_access(ctx: click.Context, email: str) -> None:
    """Revoke EMAIL's spend authority and drop their outstanding sessions.

    Unlike the researcher claim, this does NOT wait for the next token refresh:
    the backend also calls `revoke_refresh_tokens`, so the revocation bites
    immediately rather than riding a stale token for up to an hour.
    """
    result = _client(ctx).post("/api/admin/access/revoke", json={"email": email})
    click.echo(_json.dumps(result, indent=2))


@users.command("list-access")
@click.option("--include-revoked", is_flag=True, help="Also show revoked rows (the audit trail).")
@click.option("--json", "as_json", is_flag=True, help="Raw JSON instead of the table.")
@click.pass_context
def list_access(ctx: click.Context, include_revoked: bool, as_json: bool) -> None:
    """Everyone on the access register, newest grant first."""
    result = _client(ctx).get(
        "/api/admin/access/list",
        params={"include_revoked": "true" if include_revoked else "false"},
    )
    if as_json:
        click.echo(_json.dumps(result, indent=2))
        return

    grants = result.get("grants", [])
    if not grants:
        click.echo("No one is on the access register — every account is a visitor.")
        return

    click.echo(f"{'EMAIL':<34} {'TIER':<8} {'CAP':>8}  {'ACTIVE':<7} {'EXPIRES':<26} NOTE")
    for g in grants:
        click.echo(
            f"{g.get('email', ''):<34} "
            f"{g.get('tier', ''):<8} "
            f"{g.get('monthlyCapUsd', 0):>8.2f}  "
            f"{'yes' if g.get('active') else 'NO':<7} "
            f"{(g.get('expiresAt') or 'never'):<26} "
            f"{g.get('note', '')}"
        )
    click.echo(f"\n{result.get('count', len(grants))} row(s).")


@users.command("list-requests")
@click.option(
    "--status",
    default="pending",
    type=click.Choice(["pending", "granted", "declined", "all"]),
    help="Which requests to show.",
)
@click.option("--json", "as_json", is_flag=True, help="Raw JSON instead of the table.")
@click.pass_context
def list_requests(ctx: click.Context, status: str, as_json: bool) -> None:
    """People who have asked to join the programme (ACCESS-1 M4).

    Grant from this queue with `grant-access <email>` — a successful grant marks
    the matching request granted, so the queue drains as you work it.
    """
    result = _client(ctx).get("/api/admin/access/requests", params={"status": status})
    if as_json:
        click.echo(_json.dumps(result, indent=2))
        return

    requests = result.get("requests", [])
    if not requests:
        click.echo(f"No {status} access requests.")
        return

    for r in requests:
        click.echo(f"\n{r.get('email', '?')}  [{r.get('status', '?')}]  {r.get('requestedAt', '')}")
        if r.get("name"):
            click.echo(f"  name:        {r['name']}")
        if r.get("institution"):
            click.echo(f"  institution: {r['institution']}")
        if r.get("message"):
            click.echo(f"  message:     {r['message']}")
        click.echo(f"  grant with:  aiplatform --env <env> users grant-access {r.get('email', '')}")
    click.echo(f"\n{result.get('count', len(requests))} request(s).")
