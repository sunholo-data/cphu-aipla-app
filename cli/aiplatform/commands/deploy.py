"""``aiplatform deploy`` — build-once artifact promotion + deploy status.

Wraps ``scripts/promote-env.sh`` (the single promotion implementation) and
``gcloud``. Promotion = build once on a tag (test), then COPY the tested
backend image to prod (no rebuild); the frontend is rebuilt from the same
tag with the target env's config. See
docs/design/aipla/v1.0.0-pilot/build-once-artifact-promotion.md.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import click

_REGION = "europe-north1"
_SERVICE = "aipla-v01-frontend"
_ENVS = ["dev", "test", "prod"]


def _repo_root() -> Path:
    """Walk up from CWD to the repo root (the dir holding scripts/promote-env.sh).

    Promotion submits the local source for the frontend rebuild, so it must be
    run from a repo checkout (ideally at the release tag).
    """
    for d in [Path.cwd(), *Path.cwd().parents]:
        if (d / "scripts" / "promote-env.sh").exists():
            return d
    raise click.ClickException("run this from the repo checkout (scripts/promote-env.sh not found above CWD)")


def _run(cmd: list[str], *, stream: bool = True) -> subprocess.CompletedProcess:
    try:
        if stream:
            return subprocess.run(cmd, check=False)  # noqa: S603 — inherit stdio for interactive confirm + build logs
        return subprocess.run(cmd, check=False, capture_output=True, text=True)  # noqa: S603
    except FileNotFoundError as exc:
        raise click.ClickException(f"command not found: {cmd[0]} ({exc})") from exc


@click.group()
def deploy() -> None:
    """Deploy + build-once artifact promotion (tag->test, copy->prod)."""


@deploy.command("promote")
@click.option("--from", "from_env", required=True, type=click.Choice(["dev", "test"]))
@click.option("--to", "to_env", required=True, type=click.Choice(["test", "prod"]))
@click.option("--version", required=True, help="Release tag to promote, e.g. v1.1.40.")
@click.option("--dry-run", is_flag=True, help="Print the gcloud plan and exit; no mutation.")
@click.option("--yes", is_flag=True, help="Skip the confirm prompt + the HEAD==tag check.")
def promote(from_env: str, to_env: str, version: str, dry_run: bool, yes: bool) -> None:
    """Promote a released version by COPYING the tested backend artifact.

    No backend rebuild — the prod backend is the exact digest that passed test.
    The frontend is rebuilt from the same tag with the target env's config.
    """
    script = _repo_root() / "scripts" / "promote-env.sh"
    cmd = ["bash", str(script), "--from", from_env, "--to", to_env, "--version", version]
    if dry_run:
        cmd.append("--dry-run")
    if yes:
        cmd.append("--yes")
    result = _run(cmd)
    if result.returncode != 0:
        raise click.ClickException(f"promote-env.sh exited {result.returncode}")


@deploy.command("status")
@click.option(
    "--env",
    "env",
    type=click.Choice(_ENVS),
    default=None,
    help="Env to inspect (default: the global --env, else dev).",
)
@click.pass_context
def status(ctx: click.Context, env: str | None) -> None:
    """Show the live Cloud Run revision + image per env.

    Run for two envs to confirm test and prod are on the SAME backend digest
    (i.e. promoted by copy, not rebuilt).
    """
    target = env or (ctx.obj.get("env") if ctx.obj else None)
    if target in (None, "local"):
        target = "dev"
    project = f"aipla-{target}-2026"
    cmd = [
        "gcloud",
        "run",
        "services",
        "describe",
        _SERVICE,
        f"--project={project}",
        f"--region={_REGION}",
        "--format=value(status.latestReadyRevisionName, spec.template.spec.containers.image)",
    ]
    result = _run(cmd, stream=False)
    if result.returncode != 0:
        raise click.ClickException(f"gcloud describe failed: {(result.stderr or '').strip()}")
    click.echo(f"{target} ({project}):")
    click.echo((result.stdout or "").strip())


@deploy.command("release")
@click.option("--version", required=True, help="New release tag to cut, e.g. v1.1.40.")
@click.option("--yes", is_flag=True, help="Skip the confirm prompt.")
def release(version: str, yes: bool) -> None:
    """Tag the current HEAD and push the tag (fires the test-release build)."""
    _repo_root()  # ensure we're in a repo checkout
    if not yes:
        click.confirm(f"Tag HEAD as {version} and push origin {version}?", abort=True)
    for cmd in (
        ["git", "tag", "-a", version, "-m", f"release {version}"],
        ["git", "push", "origin", version],
    ):
        result = _run(cmd, stream=False)
        if result.returncode != 0:
            raise click.ClickException(f"{' '.join(cmd)} failed: {(result.stderr or '').strip()}")
    click.echo(f"Tagged + pushed {version} -> fires aipla-test-release.")


__all__ = ["deploy"]
