"""Which deployment am I? — runtime environment identity.

Resolved at REQUEST time from env vars, never baked into the image. AIPLA
promotes ONE built artifact dev -> test -> prod (build-once artifact
promotion, see docs/design/aipla/v1.0.0-pilot/build-once-artifact-promotion.md),
so anything derived at BUILD time is wrong the moment the image is copied:
prod would introduce itself as "test" because that is where its bytes were
built. The trustworthy signals are the env vars Terraform sets per Cloud Run
service — ``GOOGLE_CLOUD_PROJECT`` is set on every environment's sidecar and
differs per project, so it works today with no infra change.

Why this exists at all: on 2026-08-04 a teacher minted group codes on dev and
typed them into the test deployment for ~2 hours, getting 401 on every join
(codes are Firestore documents, and Firestore is per-project). The three
``aipla-v01-frontend-*.run.app`` URLs are indistinguishable at a glance, so the
UI has to say which environment it is. This module is where the answer comes
from — see ``frontend/src/components/EnvironmentBanner.tsx`` for the surface.
"""

from __future__ import annotations

import os
import re

# ``aipla-dev-2026`` / ``aipla-test-2026`` / ``aipla-prod-2026``. The trailing
# year is part of the naming convention, not a version — match it loosely so a
# future ``aipla-prod-2027`` still resolves.
_PROJECT_PATTERN = re.compile(r"^aipla-(dev|test|prod)-\d{4}$")

#: Every name ``environment_name()`` can return. "unknown" is a real answer,
#: not an error case: an unrecognised deployment must still be LABELLED as
#: unrecognised rather than silently passing for production.
KNOWN_ENVIRONMENTS = ("dev", "test", "prod", "local", "unknown")


def environment_name() -> str:
    """Resolve this deployment's environment name.

    Order of trust:
      1. ``AIPLA_ENV`` — explicit override, for deployments whose project id
         doesn't follow the convention. Ignored if it isn't a known name.
      2. ``LOCAL_MODE`` — a laptop, whatever the project id says.
      3. ``GOOGLE_CLOUD_PROJECT`` matching ``aipla-<env>-<year>``.
      4. ``"unknown"``.
    """
    override = (os.getenv("AIPLA_ENV") or "").strip().lower()
    if override in KNOWN_ENVIRONMENTS:
        return override

    # Local import: config.local_mode reads env vars at call time too, and
    # importing it at module scope pulls its dependency graph into anything
    # that only wants the environment name.
    from config.local_mode import is_local_mode

    if is_local_mode():
        return "local"

    project = (os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT") or "").strip()
    match = _PROJECT_PATTERN.match(project)
    if match:
        return match.group(1)

    return "unknown"


def environment_info() -> dict:
    """The payload behind ``GET /api/environment``.

    ``version`` is the release tag Terraform stamps on the service
    (``APP_VERSION``), so a support conversation can pin down exactly what a
    teacher is looking at — "test, v0.1.5" — from one glance at the banner.
    """
    return {
        "env": environment_name(),
        "projectId": (os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT") or "").strip() or None,
        "version": (os.getenv("APP_VERSION") or "").strip() or None,
    }


__all__ = ["KNOWN_ENVIRONMENTS", "environment_info", "environment_name"]
