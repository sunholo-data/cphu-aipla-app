"""``aiplatform activity`` — author teacher activities (TAA-1 M0.3).

Subcommands:
    new      Create a teacher-authored activity (the backend mints its id).
    list     List the teacher's activities (optionally scoped to a class).
    library  Browse the class-independent activity library, faceted (1.1.61).
    file     Set an activity's subject / level / tags (1.1.61).

``new`` and ``list`` wrap the LEGACY ``/api/activity-configs`` (per-class
composite key). ``library`` and ``file`` speak the current
``/api/activities`` resource — the class-independent Activity that the web
UI has used since ALS-1. They are separate commands rather than flags on
``list`` precisely because the two endpoints return different things;
silently repointing ``list`` would change what an existing script gets back. ``new`` omits ``activityId`` so the
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


@activity.command("manifest")
@click.argument("activity_id")
@click.option("--class", "class_id", required=True, help="The class the activity config belongs to.")
@click.option("--full", is_flag=True, help="Print the whole resolved focus, not just the element manifest.")
@click.pass_context
def activity_manifest(ctx: click.Context, activity_id: str, class_id: str, full: bool) -> None:
    """Show what the TUTOR is told about this activity (1.1.62 M1).

    The element-blindness bug survived six weeks because nothing rendered the
    composed prompt — every element rendered, pushed and carded correctly, while
    the tutor's system prompt never mentioned any of them. This is the command
    that makes that visible.
    """
    result = _client(ctx).get(f"/api/activity-configs/resolved-focus/{class_id}/{activity_id}")

    counts = result.get("elementCounts") or {}
    click.echo(f"activity : {result.get('activityId')}")
    click.echo(f"language : {result.get('language')}")
    click.echo(f"elements : {', '.join(f'{k}={v}' for k, v in counts.items()) if counts else '(none authored)'}")
    click.echo(f"focus    : {result.get('focusChars')} chars")
    click.echo("")

    if full:
        click.echo(result.get("resolvedFocus") or "(empty)")
        ilo = result.get("iloPrecedence")
        if ilo:
            click.echo(ilo)
        return

    manifest = result.get("manifest") or ""
    if manifest:
        click.echo(manifest)
    else:
        click.echo("(no element manifest — this activity has no workbench elements)")
        click.echo("The tutor will not mention any workbench tools. Use --full to see the whole focus.")


_LEVELS = ["A", "B", "C"]
_UNLEVELLED = "__unlevelled__"


@activity.command("library")
@click.option(
    "--level", type=click.Choice([*_LEVELS, _UNLEVELLED]), default=None, help="Filter by level (or no level)."
)
@click.option("-q", "--query", "q", default=None, help="Free-text search (title + goal + own AND inherited tags).")
@click.option("--tag", "tags", multiple=True, help="Filter by tag (repeatable — AND).")
@click.option("--subject", default=None, help="Filter by subject (exact).")
@click.option("--published", is_flag=True, help="The cross-teacher shared catalogue instead of your own library.")
@click.option("--facets", "want_facets", is_flag=True, help="Show facet options + narrowed counts instead of rows.")
@click.option("--limit", type=click.IntRange(1, 200), default=50, show_default=True)
@click.option("--offset", type=click.IntRange(0), default=0, show_default=True)
@click.pass_context
def library(
    ctx: click.Context,
    level: str | None,
    q: str | None,
    tags: tuple[str, ...],
    subject: str | None,
    published: bool,
    want_facets: bool,
    limit: int,
    offset: int,
) -> None:
    """Browse the activity library, faceted the same way as the web UI.

    Most facets are INHERITED from the curriculum documents an activity cites,
    so filing a document in ``aiplatform curriculum set`` changes what shows up
    here — with no edit to the activity itself.
    """
    params: dict[str, object] = {k: v for k, v in (("level", level), ("q", q), ("subject", subject)) if v}
    if tags:
        params["tags"] = list(tags)
    if published:
        params["published"] = "true"
    else:
        params["owner"] = "me"
    if not want_facets:
        params["limit"] = limit
        params["offset"] = offset
    path = "/api/activities/facets" if want_facets else "/api/activities"
    result = _client(ctx).get(path, params=params or None)
    click.echo(_json.dumps(result, indent=2))


@activity.command("file")
@click.argument("activity_id")
@click.option("--subject", default=None, help="Set the subject (empty string clears it).")
@click.option("--level", type=click.Choice([*_LEVELS, ""]), default=None, help="Set the level (empty string clears).")
@click.option("--tag", "add_tags", multiple=True, help="Add a tag (repeatable).")
@click.option("--untag", "remove_tags", multiple=True, help="Remove a tag (repeatable).")
@click.pass_context
def file_activity(
    ctx: click.Context,
    activity_id: str,
    subject: str | None,
    level: str | None,
    add_tags: tuple[str, ...],
    remove_tags: tuple[str, ...],
) -> None:
    """Set an activity's OWN subject / level / tags.

    Inherited facets are not settable — they belong to the cited documents. To
    change those, re-file the document (``aiplatform curriculum set``) or cite a
    different one.

    Uses the facets-only PATCH, which cannot touch elements or materials: the
    full-payload update is a complete overwrite and would wipe anything this
    command does not send.
    """
    payload: dict[str, object] = {}
    if subject is not None:
        # Empty string is an explicit clear; JSON null is indistinguishable from
        # "not sent", so the API takes a separate flag.
        payload["subject"] = subject if subject else None
        if not subject:
            payload["clearSubject"] = True
    if level is not None:
        payload["level"] = level if level else None
        if not level:
            payload["clearLevel"] = True
    if add_tags:
        payload["addTags"] = list(add_tags)
    if remove_tags:
        payload["removeTags"] = list(remove_tags)
    if not payload:
        raise click.UsageError("give --subject, --level, --tag and/or --untag (use '' to clear a field)")
    result = _client(ctx).patch(f"/api/activities/{activity_id}/facets", json=payload)
    click.echo(_json.dumps(result, indent=2))


__all__ = ["activity"]
