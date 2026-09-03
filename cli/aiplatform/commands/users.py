"""`aiplatform users` — role + access-register admin.

Three things live here, all behind the same SA-allowlisted `/api/admin/*` gate:

  * the researcher claim (sprint 1.1.5) — cross-class READ access;
  * the access register (ACCESS-1 M1) — who may SPEND money;
  * the platform-admin claim (P4.4) — what `firestore.rules::isAdmin` reads.

They are independent: a researcher is not automatically a pilot, a pilot is not
automatically a researcher, and neither is automatically an admin.

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
    """Manage user roles (researcher, platform-admin, programme-admin claims)
    and the access register."""


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


# ─── Platform admin claim (P4.4) ─────────────────────────────────────────────
#
# `firestore.rules::isAdmin` used to compare against one hardcoded email
# address, so admin was one named person and changing that meant editing
# security rules. It now reads the `admin:true` custom claim these two verbs
# set. Grant it on EVERY environment (dev, test, prod) — Firebase identities
# and their claims are per-project.


@users.command("grant-admin")
@click.argument("uid")
@click.pass_context
def grant_admin(ctx: click.Context, uid: str) -> None:
    """Grant the platform-admin claim to the Firebase user UID.

    This is what `firestore.rules::isAdmin` reads — direct client-SDK
    Firestore access to platform-owned collections. It does NOT grant access
    to `/api/admin/*`, which stays behind the service-account allowlist.

    Takes effect on the user's next ID-token refresh (~1h); sign out and in
    to force it.
    """
    result = _client(ctx).post("/api/admin/grant-admin", json={"uid": uid})
    click.echo(_json.dumps(result, indent=2))


@users.command("revoke-admin")
@click.argument("uid")
@click.pass_context
def revoke_admin(ctx: click.Context, uid: str) -> None:
    """Revoke the platform-admin claim from the Firebase user UID.

    Preserves other claims — revoking admin from a researcher leaves them a
    researcher.
    """
    result = _client(ctx).post("/api/admin/revoke-admin", json={"uid": uid})
    click.echo(_json.dumps(result, indent=2))


# ─── Delegated programme administration (PROGADMIN-1 — 1.1.76) ───────────────
#
# THE ONLY WAY TO MINT `programmeAdmin`, and it is behind the service-account
# allowlist on purpose. A programme admin who could mint the claim they hold
# would be an unbounded admin — the classic escalation, closed by construction:
# `/api/programme/*`, the surface the claim unlocks, has no route that reaches
# these endpoints.
#
# What the claim buys: admitting a teacher to the register and setting their
# cap, IN THE APP at /teacher/programme, bounded in amount
# (PROGRAMME_ADMIN_MAX_CAP_USD) and audience (PROGRAMME_ADMIN_EMAIL_DOMAINS).
# Anything outside those bounds still needs the service-account path below.
#
# Per environment, like every other claim — Firebase identities are per-project.


@users.command("grant-programme-admin")
@click.argument("uid")
@click.pass_context
def grant_programme_admin(ctx: click.Context, uid: str) -> None:
    """Grant the programme-admin claim to the Firebase user UID.

    Lets them admit teachers to the access register from inside the app,
    without a service-account impersonation. Before 1.1.76 exactly one human
    could do that on prod.

    Idempotent, and preserves other claims — granting this to a researcher
    leaves them a researcher. Takes effect on their next ID-token refresh
    (~1h), so tell them to reload.
    """
    result = _client(ctx).post("/api/admin/grant-programme-admin", json={"uid": uid})
    click.echo(_json.dumps(result, indent=2))


@users.command("revoke-programme-admin")
@click.argument("uid")
@click.pass_context
def revoke_programme_admin(ctx: click.Context, uid: str) -> None:
    """Revoke the programme-admin claim from the Firebase user UID.

    Takes effect on their next token refresh, so revocation is NOT instant.
    For an urgent revocation, revoke their refresh tokens too.
    """
    result = _client(ctx).post("/api/admin/revoke-programme-admin", json={"uid": uid})
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
@click.option(
    "--cap",
    type=float,
    default=None,
    help=(
        "Monthly cap in USD. Omit for the register default — NEVER uncapped. "
        "0 means a ZERO cap (spend suspended, grant intact), not 'no limit'. "
        "Use --uncapped to remove the limit entirely."
    ),
)
@click.option(
    "--uncapped",
    is_flag=True,
    help=(
        "Remove the per-teacher limit entirely. Explicit on purpose: an uncapped teacher is "
        "bounded only by the SHARED project quota and can starve every other teacher on it."
    ),
)
@click.option(
    "--expires",
    default=None,
    help=(
        "ISO-8601 expiry, e.g. 2027-09-15T00:00:00Z. Recommended: the engagement "
        "boundary, so forgetting to clean up means access LAPSES rather than persists. "
        "Currently 2027-09-15 (end of the 2026/27 school year, inside the extension "
        "running to at least April 2027) — NOT the original 2026-09-15 contract date."
    ),
)
@click.option("--note", default="", help="Why this person was invited (shown in `list-access`).")
@click.option("--tier", default="pilot", type=click.Choice(["pilot", "visitor"]), help="Tier to grant.")
@click.pass_context
def grant_access(
    ctx: click.Context,
    email: str,
    cap: float | None,
    uncapped: bool,
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
    if uncapped:
        body["monthly_cap_usd"] = -1.0  # db.teacher_access.UNCAPPED
    elif cap is not None:
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


@users.command("invite-password")
@click.argument("email")
@click.option("--name", "display_name", default=None, help="Display name for a newly created account.")
@click.option(
    "--continue-url",
    default=None,
    help=(
        "Where to land them after they set a password, e.g. "
        "https://aipla.ku.dk/teacher/sign-in. Must be a Firebase authorized domain."
    ),
)
@click.pass_context
def invite_password(ctx: click.Context, email: str, display_name: str | None, continue_url: str | None) -> None:
    """Mint an email/password login for EMAIL and print a link for them to set it.

    For teachers whose school has no Google identity (a Microsoft 365 tenant, say),
    where "Sign in with Google" can never return their institutional address.

    Send them the LINK. No password is generated for you to pass on, because a
    password you have to send over some channel is the problem this avoids — the
    account is created with a random secret nobody ever learns, and they choose
    their own on Firebase's page.

    Requires an active register grant first (`grant-access <email>`): minting a
    credential for an address nobody invited is not a thing this should enable.

    Re-run it freely — idempotent, and the way to handle "the link expired".
    These links are short-lived, so mint one when the teacher is ready to use it
    rather than in advance.
    """
    body: dict = {"email": email}
    if display_name:
        body["display_name"] = display_name
    if continue_url:
        body["continue_url"] = continue_url
    result = _client(ctx).post("/api/admin/access/password-invite", json=body)

    link = result.get("resetLink", "")
    created = result.get("created")
    providers = result.get("providers") or []
    click.echo(f"\n{result.get('email', email)}  uid={result.get('uid', '?')}  tier={result.get('tier', '?')}")
    click.echo(f"  account:   {'CREATED' if created else 'already existed'}")
    click.echo(f"  providers: {', '.join(providers) if providers else '(none yet)'}")
    if not created and "password" not in " ".join(providers):
        click.echo("  note:      this link ADDS a password to an identity they already sign in with.")
    click.echo("\nSend them this link (it expires — re-run this command for a fresh one):\n")
    click.echo(f"  {link}\n")


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
