"""``aiplatform activity`` — author teacher activities (TAA-1 M0.3).

Subcommands:
    new   Create a teacher-authored activity (the backend mints its id).
    list  List the teacher's activities (optionally scoped to a class).

Wraps ``/api/activity-configs``. ``new`` omits ``activityId`` so the
backend mints a ``teacher:``-namespaced id (a from-scratch activity).
A workbench type of ``none`` is the chat-only Socratic concept activity
— the v1.1 teacher-authoring headline. Authenticates as the teacher's
Firebase token via the existing ``aiplatform auth login`` flow.
"""

from __future__ import annotations

import json as _json

import click

from aiplatform.http import AIPlatformClient

_WORKBENCH_TYPES = ["none", "app", "drawing", "sensor", "video", "notebook"]


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group(name="activity")
def activity() -> None:
    """Author student activities (create / list)."""


@activity.command("new")
@click.option("--class", "class_id", required=True, help="Class id this activity belongs to.")
@click.option("--title", required=True, help="Human-readable activity name.")
@click.option("--goal", "teaching_goal", required=True, help="Socratic lesson prompt (teaching goal).")
@click.option(
    "--type",
    "workbench_type",
    type=click.Choice(_WORKBENCH_TYPES),
    default="none",
    show_default=True,
    help="Workbench type. 'none' = chat-only Socratic concept activity.",
)
@click.pass_context
def new_activity(
    ctx: click.Context,
    class_id: str,
    title: str,
    teaching_goal: str,
    workbench_type: str,
) -> None:
    """Create a teacher-authored activity. The backend mints its id."""
    payload = {
        "classId": class_id,
        "title": title,
        "teachingGoal": teaching_goal,
        "workbenchType": workbench_type,
    }
    result = _client(ctx).post("/api/activity-configs", json=payload)
    click.echo(_json.dumps(result, indent=2))


@activity.command("list")
@click.option("--class", "class_id", default=None, help="Only list activities in this class.")
@click.pass_context
def list_activities(ctx: click.Context, class_id: str | None) -> None:
    """List the current teacher's activities."""
    params = {"classId": class_id} if class_id else None
    result = _client(ctx).get("/api/activity-configs", params=params)
    click.echo(_json.dumps(result, indent=2))


__all__ = ["activity"]
