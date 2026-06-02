"""``aiplatform insights`` — eyeball the teacher-insights dashboard
data from a terminal without spinning up the frontend.

Three subcommands:

- ``class CLASS_ID`` — print the per-class KPI grid (six cards) plus a
  hint of the underlying SQL. ``--format json`` prints raw payload.
- ``groups CLASS_ID`` — per-group engagement breakdown (the data the
  in-panel bar chart renders).
- ``compare`` — cross-class comparison table; same data as the
  ``/teacher/insights`` page.

All three honor ``--since 7d|30d|all`` (default 7d) and ``--until ISO``,
matching the M7 REST query parameters. Output defaults to a printable
table; ``--format json`` is the script-friendly path.

Used to verify the M7 routes return real numbers on dev (the design
doc's "per design-doc-creator CLI affordance heuristic"), and as a
debugging tool when a dashboard card shows zero — `aiplatform insights
class <id> --format json` makes the underlying SQL visible.
"""

from __future__ import annotations

import json as _json
from typing import Any

import click

from aiplatform.http import AIPlatformClient


@click.group()
def insights() -> None:
    """Eyeball the teacher-insights dashboard data."""


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


_SINCE_CHOICES = ["7d", "30d", "all"]


def _query_params(since: str, until: str | None) -> dict[str, str]:
    params: dict[str, str] = {"since": since}
    if until:
        params["until"] = until
    return params


# ---------------------------------------------------------------------------
# `aiplatform insights class CLASS_ID`
# ---------------------------------------------------------------------------


@insights.command("class")
@click.argument("class_id")
@click.option("--since", type=click.Choice(_SINCE_CHOICES), default="7d", show_default=True)
@click.option("--until", default=None, help="ISO timestamp; defaults to now.")
@click.option("--format", "fmt", type=click.Choice(["table", "json"]), default="table", show_default=True)
@click.pass_context
def class_cmd(ctx: click.Context, class_id: str, since: str, until: str | None, fmt: str) -> None:
    """Print the six KPI cards for CLASS_ID."""
    payload = _client(ctx).get(f"/api/insights/classes/{class_id}/kpis", params=_query_params(since, until))

    if fmt == "json":
        click.echo(_json.dumps(payload, indent=2, default=str))
        return

    kpis = payload.get("kpis", {}) if isinstance(payload, dict) else {}
    click.echo(f"Class:        {class_id}")
    click.echo(f"Window:       {payload.get('since', '?')}  →  {payload.get('until', '?')}")
    click.echo()
    click.echo(f"  active_groups          {kpis.get('active_groups', '-'):>8}")
    click.echo(f"  total_messages         {kpis.get('total_messages', '-'):>8}")
    click.echo(f"  active_activities      {kpis.get('active_activities', '-'):>8}")
    click.echo(f"  sim_runs               {kpis.get('sim_runs', '-'):>8}")
    click.echo(f"  median_time_on_task_min{kpis.get('median_time_on_task_min', '-'):>8}")
    click.echo(f"  last_activity          {kpis.get('last_activity') or '-'}")


# ---------------------------------------------------------------------------
# `aiplatform insights groups CLASS_ID`
# ---------------------------------------------------------------------------


@insights.command("groups")
@click.argument("class_id")
@click.option("--since", type=click.Choice(_SINCE_CHOICES), default="7d", show_default=True)
@click.option("--until", default=None, help="ISO timestamp; defaults to now.")
@click.option("--format", "fmt", type=click.Choice(["table", "json"]), default="table", show_default=True)
@click.pass_context
def groups_cmd(ctx: click.Context, class_id: str, since: str, until: str | None, fmt: str) -> None:
    """Per-group engagement breakdown for CLASS_ID."""
    payload = _client(ctx).get(
        f"/api/insights/classes/{class_id}/groups",
        params=_query_params(since, until),
    )

    if fmt == "json":
        click.echo(_json.dumps(payload, indent=2, default=str))
        return

    groups = payload.get("groups", []) if isinstance(payload, dict) else []
    if not groups:
        click.secho(f"No group activity for class {class_id} in this window.", fg="yellow")
        return

    click.echo(f"{'GROUP':<24} {'MESSAGES':>10} {'SESSIONS':>10}")
    for g in groups:
        code = str(g.get("group_code", "?"))[:23]
        click.echo(f"{code:<24} {g.get('message_count', 0):>10} {g.get('session_count', 0):>10}")


# ---------------------------------------------------------------------------
# `aiplatform insights compare`
# ---------------------------------------------------------------------------


@insights.command("compare")
@click.option("--since", type=click.Choice(_SINCE_CHOICES), default="7d", show_default=True)
@click.option("--until", default=None, help="ISO timestamp; defaults to now.")
@click.option("--format", "fmt", type=click.Choice(["table", "json"]), default="table", show_default=True)
@click.option(
    "--sort",
    type=click.Choice(["messages", "messages_delta", "sim_runs", "name"]),
    default="messages",
    show_default=True,
    help="Sort the table client-side. JSON output is always API-order.",
)
@click.pass_context
def compare_cmd(ctx: click.Context, since: str, until: str | None, fmt: str, sort: str) -> None:
    """Cross-class comparison table."""
    payload = _client(ctx).get("/api/insights/compare", params=_query_params(since, until))

    if fmt == "json":
        click.echo(_json.dumps(payload, indent=2, default=str))
        return

    rows: list[dict[str, Any]] = list(payload.get("rows", [])) if isinstance(payload, dict) else []
    if not rows:
        click.secho("No classes to compare. Create a class first.", fg="yellow")
        return

    rows.sort(key=lambda r: r.get(sort, 0), reverse=sort != "name")

    click.echo(f"{'CLASS':<24} {'GROUPS':>7} {'MSGS':>6} {'Δ':>6} {'SIMS':>6}  LAST ACTIVITY")
    for r in rows:
        name = str(r.get("name", "?"))[:23]
        delta = r.get("messages_delta", 0)
        delta_str = f"{delta:+d}" if isinstance(delta, int) else "-"
        last = str(r.get("last_activity") or "-")[:19]
        click.echo(
            f"{name:<24} {r.get('active_groups', 0):>7} {r.get('messages', 0):>6} {delta_str:>6} {r.get('sim_runs', 0):>6}  {last}"
        )
