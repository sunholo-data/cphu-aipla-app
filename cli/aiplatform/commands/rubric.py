"""`aiplatform rubric` — run the 1.1.57 competency-rubric judges from a terminal.

RUBRIC-1 M1: judge iteration shouldn't need a deployed UI session. Wraps the
researcher-gated /api/research endpoints (your token needs the `role:researcher`
claim — 1.1.5), so scores never leave the R1 quarantine.

    aiplatform rubric score <session-id> --lens maps
    aiplatform rubric anchors validate <activity-id>
"""

from __future__ import annotations

import click

from aiplatform.http import AIPlatformClient


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group()
def rubric() -> None:
    """Competency-rubric judges (MAPS / SAAR) — researcher role required."""


@rubric.command("score")
@click.argument("session_id")
@click.option("--lens", type=click.Choice(["maps", "saar"]), default="maps", show_default=True)
@click.pass_context
def score(ctx: click.Context, session_id: str, lens: str) -> None:
    """Score SESSION_ID with one lens; prints the profile + evidence partition.

    An abstain (no anchor pack, no student-initiated evidence, disabled lens)
    is a DESIGNED outcome, not an error — the reason is printed.
    """
    result = _client(ctx).post("/api/research/rubric-score", json={"sessionId": session_id, "lens": lens})

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
