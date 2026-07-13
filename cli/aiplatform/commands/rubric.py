"""`aiplatform rubric` — run the 1.1.57 competency-rubric judges from a terminal.

RUBRIC-1 M1: judge iteration shouldn't need a deployed UI session. Wraps the
researcher-gated /api/research endpoints (your token needs the `role:researcher`
claim — 1.1.5), so scores never leave the R1 quarantine.

    aiplatform rubric score <group-code|session-id> --lens maps
    aiplatform rubric anchors validate <activity-id>
"""

from __future__ import annotations

from typing import Any

import click

from aiplatform.http import AIPlatformClient


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group()
def rubric() -> None:
    """Competency-rubric judges (MAPS / SAAR) — researcher role required."""


@rubric.command("score")
@click.argument("target")
@click.option("--rubric", "rubric_id", default="maps", show_default=True, help="Rubric id (maps, saar, or a free-form one).")
@click.pass_context
def score(ctx: click.Context, target: str, rubric_id: str) -> None:
    """Score TARGET with one rubric; prints the profile + evidence partition.

    TARGET is a group join code (``crisp-pebble-21`` — resolved to the group's
    latest session) or a raw session id. Researchers use group codes.

    --rubric accepts any registered rubric id (the seed ``maps``/``saar`` or a
    free-form one made with ``rubric new``).

    An abstain (no anchor pack, no student-initiated evidence, disabled rubric)
    is a DESIGNED outcome, not an error — the reason is printed.
    """
    result = _client(ctx).post("/api/research/rubric-score", json={"target": target, "rubric": rubric_id})

    part = result.get("partitionSummary", {})
    click.echo(f"session   {result.get('sessionId')}  activity {result.get('activityId')}")
    click.echo(f"lens      {result.get('lensId')}  prompt {result.get('promptVersion')}  model {result.get('model')}")
    click.echo(
        f"evidence  student-initiated={part.get('student_initiated', 0)}  "
        f"tutor-prompted={part.get('tutor_prompted', 0)} (excluded from scoring)"
    )
    if result.get("abstained"):
        click.echo(f"ABSTAINED — {result.get('abstainReason')}")
        return
    click.echo("profile:")
    for category, entry in (result.get("profile") or {}).items():
        click.echo(f"  {category:<26} {entry.get('score')!s:<10} {entry.get('rationale', '')}")


@rubric.command("list")
@click.pass_context
def list_(ctx: click.Context) -> None:
    """List every scorable rubric — seed lenses + free-form researcher ones."""
    body = _client(ctx).get("/api/research/rubrics")
    for r in body.get("rubrics", []):
        kind = "seed" if r.get("is_seed") else "custom"
        keys = ",".join(r.get("output_keys") or []) or "(builtin)"
        flag = "" if r.get("enabled", True) else " [disabled]"
        click.echo(f"{r.get('lens_id'):<20} {kind:<7} {r.get('prompt_version'):<14} {r.get('label')}{flag}")
        if not r.get("is_seed"):
            click.echo(f"    keys: {keys}   anchors-required: {r.get('requires_anchors')}")


@rubric.command("show")
@click.argument("rubric_id")
@click.pass_context
def show(ctx: click.Context, rubric_id: str) -> None:
    """Print RUBRIC_ID's effective config + its judge prompt."""
    r = _client(ctx).get(f"/api/research/rubrics/{rubric_id}").get("rubric", {})
    click.echo(f"{r.get('lens_id')}  ({'seed' if r.get('is_seed') else 'custom'})  {r.get('prompt_version')}")
    click.echo(f"label   {r.get('label')}")
    click.echo(f"model   {r.get('model')}   anchors-required: {r.get('requires_anchors')}")
    if r.get("output_keys"):
        click.echo(f"keys    {', '.join(r['output_keys'])}   scale: {r.get('score_scale') or '(unset)'}")
    click.echo("prompt:")
    click.echo(r.get("prompt_override") or r.get("default_prompt") or "(none)")


@rubric.command("new")
@click.argument("rubric_id")
@click.option("--label", required=True, help="Human-readable name.")
@click.option("--prompt-file", type=click.File("r"), required=True, help="File holding the judge prompt (the framework).")
@click.option("--output-keys", required=True, help="Comma-separated score keys, e.g. clarity,reasoning,evidence.")
@click.option("--family", default="", help="Free-form grouping tag.")
@click.option("--score-scale", default="", help='e.g. "0-5" or "0-3" (informational, rides the prompt).')
@click.option("--model", default=None, help="Judge model id (defaults to gemini-2.5-flash).")
@click.option("--requires-anchors", is_flag=True, default=False, help="Abstain unless the activity has an anchor pack.")
@click.pass_context
def new(
    ctx: click.Context,
    rubric_id: str,
    label: str,
    prompt_file: Any,
    output_keys: str,
    family: str,
    score_scale: str,
    model: str | None,
    requires_anchors: bool,
) -> None:
    """Create or update a free-form rubric RUBRIC_ID from a prompt file.

    A new framework is just data — no code change. Re-running with an edited
    prompt bumps the version so past scores stay interpretable.
    """
    keys = [k.strip() for k in output_keys.split(",") if k.strip()]
    payload = {
        "label": label,
        "prompt": prompt_file.read(),
        "outputKeys": keys,
        "family": family,
        "scoreScale": score_scale,
        "requiresAnchors": requires_anchors,
    }
    if model:
        payload["model"] = model
    r = _client(ctx).put(f"/api/research/rubrics/{rubric_id}", json=payload).get("rubric", {})
    click.echo(f"saved {r.get('lens_id')} version {r.get('prompt_version')} — keys: {', '.join(r.get('output_keys', []))}")


@rubric.group()
def anchors() -> None:
    """Anchor-pack tooling (the AR/JB calibration inputs)."""


@anchors.command("validate")
@click.argument("activity_id")
@click.pass_context
def validate(ctx: click.Context, activity_id: str) -> None:
    """Lint ACTIVITY_ID's anchor pack against the calibration floor."""
    body = _client(ctx).get(f"/api/research/anchor-packs/{activity_id}/validate")
    click.echo(f"activity  {body.get('activityId')}  anchors={body.get('anchors', 0)}")
    if body.get("ok"):
        click.echo("OK — pack meets the calibration floor")
        return
    for problem in body.get("problems", []):
        click.echo(f"  ✗ {problem}")
    raise SystemExit(1)
