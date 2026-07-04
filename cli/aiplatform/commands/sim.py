"""``aiplatform sim`` — sim onboarding affordances.

Today: a single ``scaffold`` command that instantiates the
``frontend/src/_sim-template/`` files for a new sim with placeholder
substitution. Saves ~10 minutes of copy-paste-and-rename per sim
onboarding (Pendul, Kredsløb, Videoanalyse, GPS Fart, Frekvensanalysator
queued under 1.I).

The frontend wiring is one of several touchpoints. After this command
runs, the next steps are:

  * **Artefact code** — author ``infrastructure/mcp-sandbox/artefacts/<name>/v1/``
    per the ``mcp-app-artefact`` skill
  * **Skill template** — author ``backend/skills/templates/<your-skill>/SKILL.md``
    with ``tool_configs.mcp.servers: [<name>]`` and
    ``allow_context_writes: [<name>]``
  * **Chat-page mount** — wire the new hook + frame into the
    ``showAiplaWorkspace && skillSlug === ...`` block of
    ``frontend/src/app/chat/[...path]/page.tsx``
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import click


def _find_repo_root() -> Path:
    """Walk up from CWD looking for the sim template directory.

    Raises ClickException if not found within 6 levels — the CLI is
    typically invoked from inside the repo so a 6-level walk-up covers
    any reasonable working directory.
    """
    here = Path.cwd().resolve()
    for parent in (here, *here.parents)[:7]:
        if (parent / "frontend" / "src" / "_sim-template").is_dir():
            return parent
    raise click.ClickException(
        "Could not find frontend/src/_sim-template/. Run this command from inside the cphu-aipla-app repository."
    )


def _to_pascal(kebab: str) -> str:
    """boldkast -> Boldkast, led-planck -> LedPlanck, gps-fart -> GpsFart."""
    return "".join(part.capitalize() for part in kebab.split("-"))


def _substitute(text: str, replacements: dict[str, str]) -> str:
    for placeholder, value in replacements.items():
        text = text.replace(placeholder, value)
    return text


def _validate_name(name: str) -> str:
    if not re.fullmatch(r"[a-z][a-z0-9]*(-[a-z0-9]+)*", name):
        raise click.BadParameter(
            f"name must be kebab-case (lowercase letters, digits, hyphens). Got: {name!r}",
        )
    return name


@click.group()
def sim() -> None:
    """Sim onboarding affordances (frontend scaffolds)."""


@sim.command()
@click.argument("name")
@click.option(
    "--title",
    default=None,
    help="Display title shown in the sim header. Default: '<Pascal> — simulator'.",
)
@click.option("--close-label", default="Close", show_default=True, help="Close button text.")
@click.option(
    "--close-aria",
    default=None,
    help="Close button aria-label. Default: 'Close <name>'.",
)
@click.option(
    "--fullscreen-aria",
    default="Toggle fullscreen",
    show_default=True,
    help="Fullscreen toggle aria-label.",
)
@click.option(
    "--server-id",
    default=None,
    help="MCP server id. Must match tool_configs.mcp.servers in the skill template. Default: <name>.",
)
@click.option(
    "--force",
    is_flag=True,
    help="Overwrite existing files instead of refusing.",
)
def scaffold(
    name: str,
    title: str | None,
    close_label: str,
    close_aria: str | None,
    fullscreen_aria: str,
    server_id: str | None,
    force: bool,
) -> None:
    """Scaffold a new sim from frontend/src/_sim-template/.

    NAME is the kebab-case sim id (e.g. 'pendul', 'led-planck'). Two
    files are generated:

      \b
      frontend/src/hooks/use<Pascal>Snapshot.ts
      frontend/src/components/workspace/<Pascal>Frame.tsx

    The MCP App artefact, skill template, and chat-page mount are NOT
    generated — see the `mcp-app-artefact` skill for those steps.
    """
    name = _validate_name(name)
    pascal = _to_pascal(name)
    server = server_id or name
    display_title = title or f"{pascal} — simulator"
    close_aria_label = close_aria or f"Close {name}"

    repo_root = _find_repo_root()
    template_dir = repo_root / "frontend" / "src" / "_sim-template"
    hook_template = template_dir / "useExampleSimSnapshot.ts.template"
    frame_template = template_dir / "ExampleSimFrame.tsx.template"

    if not hook_template.is_file() or not frame_template.is_file():
        raise click.ClickException(
            f"Template files missing under {template_dir}. Has the _sim-template directory been removed?"
        )

    hook_dest = repo_root / "frontend" / "src" / "hooks" / f"use{pascal}Snapshot.ts"
    frame_dest = repo_root / "frontend" / "src" / "components" / "workspace" / f"{pascal}Frame.tsx"

    for dest in (hook_dest, frame_dest):
        if dest.exists() and not force:
            raise click.ClickException(
                f"Refusing to overwrite existing file: {dest.relative_to(repo_root)}\n"
                "Pass --force to overwrite, or pick a different name."
            )

    replacements = {
        "__NAME__": pascal,
        "__name__": name,
        "__SERVER_ID__": server,
        "__TITLE__": display_title,
        "__CLOSE_LABEL__": close_label,
        "__CLOSE_ARIA__": close_aria_label,
        "__FULLSCREEN_ARIA__": fullscreen_aria,
    }

    hook_dest.write_text(_substitute(hook_template.read_text(), replacements))
    frame_dest.write_text(_substitute(frame_template.read_text(), replacements))

    click.echo(f"Created {hook_dest.relative_to(repo_root)}")
    click.echo(f"Created {frame_dest.relative_to(repo_root)}")
    click.echo("")
    click.echo("Next steps (not done by this command):")
    click.echo(f"  1. Customise the event types + reducer in use{pascal}Snapshot.ts to match your artefact")
    click.echo(f"  2. Customise handleStructuredContent in {pascal}Frame.tsx to dispatch typed events")
    click.echo(
        f"  3. Author the artefact at infrastructure/mcp-sandbox/artefacts/{name}/v1/ (see the mcp-app-artefact skill)"
    )
    click.echo(
        f"  4. Author a skill template at backend/skills/templates/<skill>/SKILL.md "
        f"with tool_configs.mcp.servers: [{server!r}] + allow_context_writes: [{server!r}]"
    )
    click.echo(
        f"  5. Mount {pascal}Frame in frontend/src/app/chat/[...path]/page.tsx "
        "alongside the existing Boldkast / LED-Planck / KineBot branches"
    )


@sim.command()
@click.option(
    "--check",
    is_flag=True,
    help="Verify (don't write) that every artefact's inlined bridge matches the canonical source. Exit 1 on drift.",
)
def build(check: bool) -> None:
    """Inline the canonical MCP App guest bridge into every artefact.

    The bridge is the single source of truth at
    ``infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js``; this stamps it into
    each artefact's ``index.html`` between the ``@aipla-bridge`` markers so all
    sims speak both the AIPLA app (SEP-1865 postMessage) and ChatGPT
    (``window.openai``). Thin wrapper over ``scripts/build-artefact-bridge.mjs``
    (same script Make + CI run). Run after editing the bridge.

    ``--check`` is the drift guard: it writes nothing and exits non-zero if any
    inlined copy has diverged from the canonical source.
    """
    node = shutil.which("node")
    if node is None:
        raise click.ClickException("`node` not found on PATH — required to run the bridge build script.")

    repo_root = _find_repo_root()
    script = repo_root / "scripts" / "build-artefact-bridge.mjs"
    if not script.is_file():
        raise click.ClickException(f"Build script missing: {script}")

    cmd = [node, str(script)]
    if check:
        cmd.append("--check")

    result = subprocess.run(cmd, cwd=repo_root, capture_output=True, text=True)  # noqa: S603
    if result.stdout:
        click.echo(result.stdout, nl=False)
    if result.stderr:
        click.echo(result.stderr, nl=False, err=True)
    if result.returncode != 0:
        raise click.exceptions.Exit(result.returncode)
