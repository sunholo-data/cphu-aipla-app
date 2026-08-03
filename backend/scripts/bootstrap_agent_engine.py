#!/usr/bin/env python3
"""Bootstrap a Vertex AI Agent Engine for v6 sessions + memory.

The v6 backend uses Agent Engine for session and memory persistence (pay-per-use)
but is deployed on Cloud Run, not on Agent Engine itself. This script creates a
minimal Agent Engine resource and prints its resource ID, which should be stored
in Secret Manager as AGENT_ENGINE_ID.

Idempotent: if an Agent Engine with the target display name already exists, its
resource ID is printed and no new resource is created.

Usage:
    uv run python backend/scripts/bootstrap_agent_engine.py --env prod
    uv run python backend/scripts/bootstrap_agent_engine.py --env prod --allow-create

WHICH PROJECT (2026-08-03). This script used to take the project from ambient
GOOGLE_CLOUD_PROJECT with no way to state it and no validation. Run from a shell
where that pointed at the upstream template's project, it created a live Agent
Engine in `multivac-internal-dev` — an unrelated project — and reported success.
Same shape as the terraform state/var-file mismatch the same day: ambient
context silently deciding WHICH environment you mutate.

So `--env` is the interface: it binds env -> project explicitly, and ambient
GOOGLE_CLOUD_PROJECT is ignored (a mismatch is reported, not obeyed).

CREATION IS OPT-IN. The default is find-or-fail. AIPLA's engines already exist
and are not in Terraform state, so the normal task is "tell me the ID of the
existing one", not "make another". Creating a duplicate session/memory anchor is
silently destructive: the backend would point at an empty engine and every prior
session would appear to vanish. Pass --allow-create only when bootstrapping a
genuinely new environment.
"""

from __future__ import annotations

import argparse
import os
import sys

# Display name used to de-duplicate the Agent Engine across re-runs.
#
# THIS MUST MATCH WHAT IS DEPLOYED. It was "aitana-v6" — the upstream template's
# name — while every AIPLA engine is "aipla-v01" (prod created 2026-07-28, test
# 2026-07-27). The idempotency check is a display-name match, so the wrong
# default did not merely mislabel: it guaranteed a MISS against the real engine
# and a duplicate on every run.
DEFAULT_DISPLAY_NAME = "aipla-v01"

# env -> project. The single input that decides what gets mutated, mirroring
# scripts/tf.sh. Add an env here rather than passing a bare project string.
ENV_PROJECTS = {
    "dev": "aipla-dev-2026",
    "test": "aipla-test-2026",
    "prod": "aipla-prod-2026",
}


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)


def _numeric_id(resource_name: str) -> str:
    """Extract trailing numeric ID from a full Agent Engine resource name.

    ADK's `VertexAiSessionService(agent_engine_id=...)` expects just the numeric
    suffix (e.g. `6224370509212024832`), NOT the full resource path. Passing the
    full path doubles the `reasoningEngines/` prefix in generated URLs → 404.
    """
    return resource_name.rstrip("/").rsplit("/", 1)[-1] if "/" in resource_name else resource_name


def bootstrap(display_name: str, dry_run: bool, env: str, allow_create: bool) -> str:
    """Find (or, with allow_create, create) the Agent Engine; return its numeric ID."""
    project = ENV_PROJECTS[env]
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-west1")

    # Ambient GOOGLE_CLOUD_PROJECT is REPORTED, never obeyed. Silently following
    # it is what put a live Agent Engine in multivac-internal-dev.
    ambient = os.environ.get("GOOGLE_CLOUD_PROJECT")
    if ambient and ambient != project:
        _log(f"NOTE: ignoring ambient GOOGLE_CLOUD_PROJECT={ambient} — --env {env} means {project}")

    _log(f"Project:      {project}")
    _log(f"Location:     {location}")
    _log(f"Display name: {display_name}")

    if dry_run:
        _log("[dry-run] would call vertexai.init + agent_engines.list/create")
        return "<numeric-id>"

    import vertexai
    from vertexai import agent_engines

    staging = os.environ.get("AGENT_ENGINE_STAGING_BUCKET")
    init_kwargs = {"project": project, "location": location}
    if staging:
        init_kwargs["staging_bucket"] = staging
        _log(f"Staging:      {staging}")
    vertexai.init(**init_kwargs)

    # Idempotency: find existing engine by display name.
    for existing in agent_engines.list():
        if getattr(existing, "display_name", None) == display_name:
            resource_name = existing.resource_name
            _log(f"Found existing Agent Engine: {resource_name}")
            return _numeric_id(resource_name)

    if not allow_create:
        raise SystemExit(
            f"No Agent Engine named '{display_name}' in {project} ({location}), and "
            f"--allow-create was not passed.\n"
            f"AIPLA's engines already exist and are not Terraform-managed, so the usual\n"
            f"task is to READ the existing id, not mint a second one — a duplicate anchor\n"
            f"points the backend at empty session/memory storage and every prior session\n"
            f"appears to vanish. If this really is a new environment, re-run with\n"
            f"--allow-create."
        )

    _log("No existing Agent Engine matched display name — creating new one.")

    # Minimal agent_engine payload. We only need the resource to anchor
    # VertexAiSessionService; the Cloud Run backend holds the real agent logic.
    try:
        remote = agent_engines.create(
            display_name=display_name,
            description="Aitana v6 session + memory anchor (backend runs on Cloud Run).",
        )
    except TypeError:
        # Older SDK surfaces require an agent_engine argument; fall back to a no-op wrapper.
        class _NoOpEngine:
            def query(self, **_: object) -> dict[str, str]:
                return {"response": "noop"}

        remote = agent_engines.create(
            agent_engine=_NoOpEngine(),
            display_name=display_name,
            description="Aitana v6 session + memory anchor (backend runs on Cloud Run).",
        )

    resource_name = remote.resource_name
    _log(f"Created Agent Engine: {resource_name}")
    return _numeric_id(resource_name)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env",
        required=True,
        choices=sorted(ENV_PROJECTS),
        help="Which AIPLA environment. Binds the project explicitly; ambient GOOGLE_CLOUD_PROJECT is ignored.",
    )
    parser.add_argument("--display-name", default=DEFAULT_DISPLAY_NAME)
    parser.add_argument(
        "--allow-create",
        action="store_true",
        help="Permit creating a new Agent Engine if none matches. Default is find-or-fail: a duplicate anchor orphans every existing session.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print plan without calling Vertex AI")
    args = parser.parse_args()

    numeric_id = bootstrap(args.display_name, args.dry_run, args.env, args.allow_create)
    # stdout: numeric ID only — callers pipe into gcloud secrets versions add.
    # ADK's VertexAiSessionService requires the trailing numeric ID, not the
    # full resource name. See _numeric_id() docstring.
    print(numeric_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
