"""``aiplatform class`` — six subcommands wrapping /api/classes/* (1.A M9).

Subcommands:
    new      Create a class as the authenticated teacher.
    list     List the teacher's classes.
    get      Show one class with full detail.
    lessons  Add or remove skills from a class.
    groups   Mint / list / revoke group codes under a class.
    delete   Soft-delete a class.

The CLI authenticates as the teacher's Firebase token via the existing
``aiplatform auth login`` flow — no new auth path. All requests go
through ``AIPlatformClient`` so env (local / dev / test / prod) selects
the right host.

Module name has a trailing underscore (``class_.py``) because ``class``
is a Python reserved word.
"""

from __future__ import annotations

import json as _json

import click

from aiplatform.http import AIPlatformClient


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group(name="class")
def class_group() -> None:
    """Manage teacher classes (create / list / lessons / groups / delete)."""


# ---------------------------------------------------------------------------
# new
# ---------------------------------------------------------------------------


@class_group.command("new")
@click.option("--name", required=True, help="Human-readable class name.")
@click.option(
    "--description",
    default=None,
    help="Optional one-line description (max 2000 chars).",
)
@click.pass_context
def new_class(ctx: click.Context, name: str, description: str | None) -> None:
    """Create a class as the authenticated teacher."""
    payload: dict = {"name": name}
    if description is not None:
        payload["description"] = description
    result = _client(ctx).post("/api/classes", json=payload)
    click.echo(_json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------


@class_group.command("list")
@click.pass_context
def list_classes(ctx: click.Context) -> None:
    """List classes owned by the current teacher (excludes revoked)."""
    result = _client(ctx).get("/api/classes")
    click.echo(_json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# get
# ---------------------------------------------------------------------------


@class_group.command("get")
@click.argument("class_id")
@click.pass_context
def get_class(ctx: click.Context, class_id: str) -> None:
    """Show full class detail by id."""
    result = _client(ctx).get(f"/api/classes/{class_id}")
    click.echo(_json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# lessons
# ---------------------------------------------------------------------------


@class_group.command("lessons")
@click.argument("class_id")
@click.option(
    "--add",
    "add_ids",
    multiple=True,
    help="Skill id(s) to add. Repeatable: --add s1 --add s2.",
)
@click.option(
    "--remove",
    "remove_ids",
    multiple=True,
    help="Skill id(s) to remove. Repeatable.",
)
@click.pass_context
def manage_lessons(
    ctx: click.Context,
    class_id: str,
    add_ids: tuple[str, ...],
    remove_ids: tuple[str, ...],
) -> None:
    """Add or remove skills from a class's lessons.

    Idempotent both directions. Adding a skill switches its access
    control to tagged with this class's namespace; removing reverses
    the binding.
    """
    if not add_ids and not remove_ids:
        raise click.UsageError("provide at least one --add or --remove")
    payload: dict = {}
    if add_ids:
        payload["add"] = list(add_ids)
    if remove_ids:
        payload["remove"] = list(remove_ids)
    result = _client(ctx).patch(f"/api/classes/{class_id}/lessons", json=payload)
    click.echo(_json.dumps(result, indent=2))


# ---------------------------------------------------------------------------
# groups
# ---------------------------------------------------------------------------


@class_group.command("groups")
@click.argument("class_id")
@click.option(
    "--mint",
    "mint_count",
    type=int,
    default=None,
    help="Mint N new group codes under this class (1-50).",
)
@click.option(
    "--list",
    "list_codes",
    is_flag=True,
    default=False,
    help="List existing group codes for this class.",
)
@click.option(
    "--revoke",
    "revoke_code",
    default=None,
    help="Revoke a single group code.",
)
@click.pass_context
def manage_groups(
    ctx: click.Context,
    class_id: str,
    mint_count: int | None,
    list_codes: bool,
    revoke_code: str | None,
) -> None:
    """Mint / list / revoke group codes under a class.

    Pick exactly one of --mint, --list, --revoke per invocation.
    """
    actions = [
        bool(mint_count),
        bool(list_codes),
        bool(revoke_code),
    ]
    if sum(actions) != 1:
        raise click.UsageError("pick exactly one of --mint <N>, --list, or --revoke <code>")

    client = _client(ctx)

    if mint_count:
        result = client.post(
            f"/api/classes/{class_id}/groups",
            json={"count": mint_count},
        )
        click.echo(_json.dumps(result, indent=2))
    elif list_codes:
        # The class detail GET carries groupCodes — reuse it rather than
        # adding a dedicated /groups list endpoint.
        result = client.get(f"/api/classes/{class_id}")
        codes = result.get("groupCodes", []) if isinstance(result, dict) else []
        click.echo(_json.dumps({"classId": class_id, "codes": codes}, indent=2))
    elif revoke_code:
        client.delete(f"/api/classes/{class_id}/groups/{revoke_code}")
        click.echo(f"Revoked code={revoke_code} from class={class_id}")


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


@class_group.command("delete")
@click.argument("class_id")
@click.pass_context
def delete_class(ctx: click.Context, class_id: str) -> None:
    """Soft-delete a class. Idempotent."""
    result = _client(ctx).delete(f"/api/classes/{class_id}")
    click.echo(_json.dumps(result, indent=2))


__all__ = ["class_group"]
