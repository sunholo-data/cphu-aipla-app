"""`aiplatform logs` — inspect the chat-log pipeline (SEQUENCE 1.2).

``tail`` / ``session`` read the teacher-report API (BigQuery-backed, with a
session-state fallback) so a dev can eyeball what landed for a group without
opening the BigQuery console.

``schema`` prints the ``chat_logs`` dataset reference + the canonical
researcher BigQuery query for copy-paste into ``bq`` / the console. Per
ADR-005 researchers query BigQuery directly (a saved query + a Looker board,
not a custom UI) — so this prints a ready-to-run query rather than executing
one from the CLI.

Endpoints used:
    GET /api/reports/groups/{group_code}     — latest session for a group
    GET /api/reports/sessions/{session_id}   — a specific session
"""

from __future__ import annotations

import json as _json
import time

import click
import httpx

from aiplatform.http import AIPlatformClient, APIError, resolve_base_url

CHAT_LOGS_DATASET = "chat_logs"
CHAT_TURN_TABLE = "aipla_chat_turn"
WORKBENCH_EVENT_TABLE = "aipla_workbench_event"


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group()
def logs() -> None:
    """Inspect the chat-log pipeline (turns + workbench events)."""


def _print_summary(summary: dict, limit: int) -> None:
    conv = summary.get("conversation") or []
    shown = conv[-limit:] if limit and limit > 0 else conv
    click.echo(
        f"group={summary.get('groupCode')} activity={summary.get('activityId')} "
        f"messages={summary.get('messageCount')} sim_runs={summary.get('simRunCount')} "
        f"duration={summary.get('durationSeconds')}s"
    )
    if len(shown) < len(conv):
        click.echo(f"(showing last {len(shown)} of {len(conv)} turns)")
    for turn in shown:
        click.echo(f"  [{turn.get('role', '?')}] {turn.get('content', '')}")


@logs.command("tail")
@click.argument("group_code")
@click.option("--limit", type=int, default=20, show_default=True, help="Most-recent turns to show.")
@click.option("--json", "as_json", is_flag=True, help="Print the raw report JSON.")
@click.pass_context
def tail(ctx: click.Context, group_code: str, limit: int, as_json: bool) -> None:
    """Show the latest session's recent turns for GROUP_CODE."""
    client = _client(ctx)
    try:
        summary = client.get(f"/api/reports/groups/{group_code}")
    except APIError as exc:
        if "returned 404" in str(exc):
            click.echo(f"No sessions for group '{group_code}' yet.")
            return
        raise
    if as_json:
        click.echo(_json.dumps(summary, indent=2, default=str))
        return
    _print_summary(summary, limit)


@logs.command("session")
@click.argument("session_id")
@click.option("--limit", type=int, default=0, show_default=True, help="Most-recent turns to show (0 = all).")
@click.option("--json", "as_json", is_flag=True, help="Print the raw report JSON.")
@click.pass_context
def session(ctx: click.Context, session_id: str, limit: int, as_json: bool) -> None:
    """Show the report for a specific SESSION_ID."""
    client = _client(ctx)
    try:
        summary = client.get(f"/api/reports/sessions/{session_id}")
    except APIError as exc:
        if "returned 404" in str(exc):
            click.echo(f"No report for session '{session_id}'.")
            return
        raise
    if as_json:
        click.echo(_json.dumps(summary, indent=2, default=str))
        return
    _print_summary(summary, limit)


_COHORT_QUERY = """\
-- Cohort chat turns for a skill since a date.
-- Run: bq query --use_legacy_sql=false --project_id={project} \\
--   --parameter='skill_id:STRING:boldkast' --parameter='since:TIMESTAMP:2026-08-14 00:00:00'
SELECT timestamp AS ts,
       jsonPayload.group_id AS group_id,
       jsonPayload.role     AS role,
       jsonPayload.content  AS content
FROM `{project}.{dataset}.{turn_table}`
WHERE jsonPayload.skill_id = @skill_id
  AND timestamp >= @since
ORDER BY group_id, ts;"""


@logs.command("schema")
@click.option("--project", default="aipla-dev-2026", show_default=True, help="GCP project for the example query.")
def schema(project: str) -> None:
    """Print the chat_logs dataset reference + the canonical researcher BQ query."""
    click.echo(f"dataset:  {project}.{CHAT_LOGS_DATASET}   (location: europe-north1)")
    click.echo(f"raw tables (sink-created on first write): {CHAT_TURN_TABLE}, {WORKBENCH_EVENT_TABLE}")
    click.echo(
        "chat_turn jsonPayload keys: group_id, session_id, skill_id, turn_index, "
        "role, content, model, token_in, token_out, latency_ms, teacher_focus"
    )
    click.echo("workbench_event jsonPayload keys: group_id, session_id, skill_id, server, tool, field, value")
    click.echo("\n" + _COHORT_QUERY.format(project=project, dataset=CHAT_LOGS_DATASET, turn_table=CHAT_TURN_TABLE))


@logs.command("verify")
@click.argument("group_code")
@click.option("--skill", default="problem-set-hints", show_default=True, help="Skill to drive the turn through.")
@click.option(
    "--message",
    default="Why does a projectile travel furthest at 45 degrees?",
    show_default=True,
    help="Message to send as the student turn.",
)
@click.option("--timeout", type=int, default=90, show_default=True, help="Seconds to wait for the BigQuery row.")
@click.pass_context
def verify(ctx: click.Context, group_code: str, skill: str, message: str, timeout: int) -> None:
    """End-to-end smoke: join GROUP_CODE, drive a turn, confirm it reached BigQuery.

    Proves the chat-log pipeline (emit -> Cloud Logging sink -> BigQuery) by
    polling the report's BQ-only mode (``?source=bq``), which does NOT fall back
    to live session state. Exit 0 = PASS, exit 1 = FAIL.
    """
    env = ctx.obj["env"]
    base = resolve_base_url(env)

    # 1. Join the group (anonymous; no auth needed).
    click.echo(f"[1/3] joining group {group_code!r} on {env} ...")
    jr = httpx.post(f"{base}/api/auth/group/join", json={"group_id": group_code}, timeout=30.0)
    if jr.status_code != 200:
        raise click.ClickException(f"join failed ({jr.status_code}): {jr.text[:300]}")
    token = jr.json()["token"]

    # 2. Drive a real turn (SSE; drain to completion so the after-agent emit fires).
    session_id = f"verify-{int(time.time())}"
    click.echo(f"[2/3] sending a turn to skill {skill!r} (session {session_id}) ...")
    with httpx.stream(
        "POST",
        f"{base}/api/skill/{skill}/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": message, "sessionId": session_id},
        timeout=60.0,
    ) as resp:
        if resp.status_code != 200:
            body = resp.read().decode("utf-8", "replace")
            raise click.ClickException(f"stream failed ({resp.status_code}): {body[:300]}")
        for _ in resp.iter_lines():
            pass  # drain until the turn completes server-side

    # 3. Poll the BQ-only report until the row lands (accounts for sink ingestion lag).
    client = AIPlatformClient(env=env, token=token)
    click.echo(f"[3/3] polling BigQuery (?source=bq) up to {timeout}s ...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            summary = client.get(f"/api/reports/sessions/{session_id}", params={"source": "bq"})
        except APIError as exc:
            if "returned 404" in str(exc):
                time.sleep(5)
                continue
            raise
        click.echo(
            f"PASS — pipeline verified. group={summary.get('groupCode')} "
            f"messages={summary.get('messageCount')} sim_runs={summary.get('simRunCount')}"
        )
        for turn in (summary.get("conversation") or [])[:4]:
            click.echo(f"  [{turn.get('role')}] {turn.get('content', '')[:80]}")
        return

    raise click.ClickException(
        f"FAIL — no BigQuery row for session {session_id} after {timeout}s. "
        "Check the deploy + sink (gcloud logging sinks describe aipla-chat-logs --project=aipla-dev-2026)."
    )
