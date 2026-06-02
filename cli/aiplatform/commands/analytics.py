"""``aiplatform analytics`` — exercise the analytics-chat tool surface
without spinning up the frontend.

Three subcommands:

- ``tools`` — ``GET /api/analytics/tools``. Prints the six tool names
  + descriptions a teacher can ask the analytics-chat agent about.
- ``probe`` — ``POST /api/analytics/probe/{tool}`` with a JSON kwargs
  bag. Returns the structured tool output. Cross-tenant attempts
  produce the same ``class not accessible`` error as a missing class
  — that's the HARD GATE from M2 surfaced at the CLI.
- ``ask`` — fire one chat turn at the analytics-chat skill and stream
  the agent's reply to stdout. Mirrors the ``skill probe`` SSE-reader
  but optimised for "did the agent actually call a tool?" inspection.

The CLI is the canonical way to verify the M5 re-seed picked up
SKILL.md's six-tool change against a deployed environment:

    aiplatform --env dev analytics tools
    aiplatform --env dev analytics probe <class-id> count_messages
    aiplatform --env dev analytics ask <class-id> "How many messages this week?"
"""

from __future__ import annotations

import json as _json
import uuid
from typing import Any

import click
import httpx

from aiplatform.http import AIPlatformClient, APIError, resolve_base_url


@click.group()
def analytics() -> None:
    """Inspect the analytics-chat tool surface."""


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


# ---------------------------------------------------------------------------
# `aiplatform analytics tools`
# ---------------------------------------------------------------------------


@analytics.command("tools")
@click.option("--json", "json_output", is_flag=True, help="Emit raw JSON instead of a table.")
@click.pass_context
def tools_cmd(ctx: click.Context, json_output: bool) -> None:
    """List the analytics tools exposed by the backend."""
    payload = _client(ctx).get("/api/analytics/tools")
    items = payload.get("tools", []) if isinstance(payload, dict) else []

    if json_output:
        click.echo(_json.dumps(payload, indent=2, default=str))
        return

    if not items:
        click.secho("No analytics tools registered.", fg="yellow")
        return

    click.echo(f"{'NAME':<28} DESCRIPTION")
    for tool in items:
        name = str(tool.get("name", "?"))
        desc = str(tool.get("description", "")).splitlines()[0][:80]
        click.echo(f"{name:<28} {desc}")


# ---------------------------------------------------------------------------
# `aiplatform analytics probe CLASS_ID TOOL_NAME [--kwarg ...]`
# ---------------------------------------------------------------------------


@analytics.command("probe")
@click.argument("class_id")
@click.argument("tool_name")
@click.option(
    "--kwarg",
    "kwargs_pairs",
    multiple=True,
    help="key=value forwarded to the tool. Repeatable. Strings only; use --kwargs-json for typed values.",
)
@click.option(
    "--kwargs-json",
    "kwargs_json",
    default=None,
    help="JSON object merged into the tool kwargs. Wins over --kwarg on key collisions.",
)
@click.option("--json", "json_output", is_flag=True, help="Emit raw JSON result.")
@click.pass_context
def probe_cmd(
    ctx: click.Context,
    class_id: str,
    tool_name: str,
    kwargs_pairs: tuple[str, ...],
    kwargs_json: str | None,
    json_output: bool,
) -> None:
    """Run one analytics tool against CLASS_ID and print the result.

    Cross-tenant probes (a class you don't own) return the same
    ``class not accessible`` error as a probe against a non-existent
    class — that is the HARD GATE preserved at the REST surface.
    """
    kwargs: dict[str, Any] = {}
    for pair in kwargs_pairs:
        if "=" not in pair:
            raise click.UsageError(f"--kwarg must be key=value, got {pair!r}")
        k, _, v = pair.partition("=")
        kwargs[k] = v
    if kwargs_json:
        try:
            extra = _json.loads(kwargs_json)
        except ValueError as exc:
            raise click.UsageError(f"--kwargs-json is not valid JSON: {exc}") from exc
        if not isinstance(extra, dict):
            raise click.UsageError("--kwargs-json must be a JSON object")
        kwargs.update(extra)

    body = {"class_id": class_id, "kwargs": kwargs}
    payload = _client(ctx).post(f"/api/analytics/probe/{tool_name}", json=body)

    if json_output:
        click.echo(_json.dumps(payload, indent=2, default=str))
        return

    result = payload.get("result") if isinstance(payload, dict) else payload
    click.echo(_json.dumps(result, indent=2, default=str))


# ---------------------------------------------------------------------------
# `aiplatform analytics ask CLASS_ID "<question>"`
# ---------------------------------------------------------------------------

_ANALYTICS_SKILL_ID = "analytics-chat"


@analytics.command("ask")
@click.argument("class_id")
@click.argument("question")
@click.option(
    "--timeout",
    type=float,
    default=120.0,
    show_default=True,
    help="HTTP timeout for the streaming request, in seconds.",
)
@click.pass_context
def ask_cmd(ctx: click.Context, class_id: str, question: str, timeout: float) -> None:
    """Stream a chat answer for QUESTION scoped to CLASS_ID.

    Sends one AG-UI turn to the analytics-chat skill. Prints the
    assistant's text deltas to stdout and lists every tool call the
    agent made. Use ``--env dev`` against the deployed backend to
    verify the re-seeded SKILL.md tools list works end-to-end.
    """
    env = ctx.obj["env"]
    base_url = resolve_base_url(env)
    client = AIPlatformClient(env=env, base_url=base_url)
    headers = client._auth_headers()  # noqa: SLF001  internal helper, intentional
    headers["Accept"] = "text/event-stream"

    thread_id = f"analytics-ask-{uuid.uuid4().hex[:12]}"
    prefixed_question = f"[class_id={class_id}] {question}"
    body = {
        "threadId": thread_id,
        "runId": f"run-{uuid.uuid4().hex[:8]}",
        "messages": [
            {"id": f"msg-{uuid.uuid4().hex[:8]}", "role": "user", "content": prefixed_question},
        ],
        "state": {"class_id": class_id},
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }

    url = f"{base_url}/api/skill/{_ANALYTICS_SKILL_ID}/stream"
    tool_calls: list[str] = []
    error_event: dict[str, Any] | None = None

    try:
        with httpx.stream(
            "POST",
            url,
            headers=headers,
            json=body,
            timeout=timeout,
        ) as resp:
            if resp.status_code >= 400:
                detail = resp.read().decode("utf-8", errors="replace")
                raise APIError(f"POST /api/skill/{_ANALYTICS_SKILL_ID}/stream returned {resp.status_code}: {detail}")
            for line in resp.iter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:") :].strip()
                if not payload:
                    continue
                try:
                    event = _json.loads(payload)
                except ValueError:
                    continue
                etype = event.get("type")
                if etype == "TEXT_MESSAGE_CONTENT":
                    delta = event.get("delta") or ""
                    click.echo(delta, nl=False)
                elif etype == "TOOL_CALL_START":
                    name = event.get("toolCallName") or event.get("name") or "?"
                    tool_calls.append(str(name))
                elif etype == "RUN_ERROR":
                    error_event = event
    except httpx.HTTPError as exc:
        raise APIError(f"HTTP transport error during ask: {exc}") from exc

    click.echo()  # trailing newline after streamed deltas

    if tool_calls:
        click.secho(f"\ntool calls: {', '.join(tool_calls)}", fg="cyan", err=True)
    else:
        click.secho("\ntool calls: (none)", fg="yellow", err=True)

    if error_event is not None:
        click.secho(
            f"RUN_ERROR: {error_event.get('message', '(no message)')}",
            fg="red",
            err=True,
        )
        ctx.exit(1)
