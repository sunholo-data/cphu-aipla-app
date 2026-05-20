"""Seed the five default platform-owned skills into Firestore.

Called by POST /api/admin/seed-platform-skills, which is hit once per
deploy by the Cloud Build seed step. Idempotent: any template whose
`name` already exists as a platform-owned skill is skipped, so repeat
runs are safe (and the expected steady state).

Template layout (one directory per skill):
    backend/skills/templates/<name>/SKILL.md    # YAML frontmatter + markdown body

The frontmatter supplies name/description/metadata; the body is the
agent instruction. Platform-owned skills are always created with
owner_id=PLATFORM_OWNER_UID and accessControl={type: public}.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from skills import skill_config
from skills.platform import PLATFORM_OWNER_UID
from skills.slugify import slugify, unique_slug

logger = logging.getLogger(__name__)

# Email recorded as the owner of platform-seeded skills. Override via
# PLATFORM_OWNER_EMAIL env var for downstream forks; default stays Aitana
# so existing dev/test/prod behaviour is unchanged.
PLATFORM_OWNER_EMAIL = os.environ.get("PLATFORM_OWNER_EMAIL", "platform@aitanalabs.com")

# AIPLA fork: matches the PLATFORM_OWNER_UID env override that brands
# the platform-owner namespace. Both env vars come from the deploy
# config (cloudbuild.yaml --set-env-vars) and frontend/.env.local for
# LOCAL_MODE. Test/prod inherit through the same mechanism.
DEFAULT_TEMPLATES_ROOT = Path(__file__).resolve().parent.parent / "skills" / "templates"


@dataclass
class SeedSummary:
    created: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)
    tool_permissions_wildcard_seeded: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "created": self.created,
            "skipped": self.skipped,
            "failed": self.failed,
            "tool_permissions_wildcard_seeded": self.tool_permissions_wildcard_seeded,
        }


def _ensure_tool_permissions_wildcard() -> bool:
    """Idempotently seed a wildcard `*` rule in `tool_permissions`.

    The inherited template seeds this only in LOCAL_MODE via
    `backend/db/local_fixture.py`. Production / deployed paths went
    without it, which caused `auth.permissions.can_use_tool()` to fall
    through to "no rule → deny" for any caller without an explicit
    per-user/per-domain rule. Anonymous-group users (ADR-001) are the
    canonical example: `user_email=""` AND `user_domain=""`, so only
    the wildcard can grant access. Without this, the first chat call
    raises (or returns False) for every anonymous-group user.

    Returns True if we wrote the doc, False if it already existed.

    v1 will switch anonymous-group users to per-group rules keyed on
    `group/<group_id>`. Until that lands, the wildcard is the v0.1
    permission story. See docs/upstream-feedback.md #19 + #20.
    """
    from db import firestore as fs

    existing = fs.get_document("tool_permissions", "*")
    if existing is not None:
        logger.info("platform_seed: tool_permissions/* already exists; skipping wildcard seed")
        return False

    fs.set_document(
        "tool_permissions",
        "*",
        {
            "type": "wildcard",
            "tools": ["*"],
            "denied": [],
            "note": (
                "Seeded by platform_seed. v0.1 grants all tools to all "
                "callers (single-skill demo). Replace with per-group "
                "rules in v1 when teacher-config UI ships."
            ),
        },
    )
    logger.info("platform_seed: seeded tool_permissions/* wildcard")
    return True


def _parse_template(skill_md: Path) -> dict[str, Any]:
    """Parse a SKILL.md file into a dict with `name`, `description`, `instructions`, `metadata`.

    Raises ValueError on malformed frontmatter.
    """
    text = skill_md.read_text()
    if not text.startswith("---"):
        raise ValueError(f"missing frontmatter in {skill_md}")

    # Split on the closing --- of the frontmatter. [0] is "", [1] is the
    # frontmatter YAML, [2]+ is the body.
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise ValueError(f"missing frontmatter close fence in {skill_md}")

    try:
        front = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError as e:
        raise ValueError(f"invalid YAML frontmatter in {skill_md}: {e}") from e

    if "name" not in front:
        raise ValueError(f"frontmatter missing 'name' in {skill_md}")

    return {
        "name": front["name"],
        "description": (front.get("description") or "").strip(),
        "instructions": parts[2].strip(),
        "metadata": front.get("metadata") or {},
        # Optional top-level frontmatter fields. AIPLA addition 2026-05-20
        # — displayName + initialMessage are first-class on SkillConfig
        # but the upstream platform_seed.py only read name/description/
        # instructions/metadata, so seeded skills shipped with empty
        # displayName and no welcome message. See docs/upstream-feedback.md
        # entry #1.
        "displayName": (front.get("displayName") or "").strip(),
        "initialMessage": (front.get("initialMessage") or "").strip(),
        "problemStatement": (front.get("problemStatement") or "").strip(),
    }


def _existing_platform_skill_names() -> set[str]:
    configs = skill_config.list_skills(owner_id=PLATFORM_OWNER_UID, limit=200)
    return {c.name for c in configs}


def seed(templates_root: Path | None = None) -> SeedSummary:
    """Seed platform skills from disk templates. Idempotent by `name`.

    Returns a SeedSummary counting created/skipped/failed entries. A
    malformed template surfaces in `failed` rather than aborting the run
    — the Cloud Build step runs non-fatally and we prefer to partially
    seed over blocking a deploy.
    """
    root = templates_root or DEFAULT_TEMPLATES_ROOT
    summary = SeedSummary()
    existing = _existing_platform_skill_names()

    # Run-once side effect (idempotent): seed the wildcard
    # tool_permissions rule so anonymous-group callers don't fall
    # through to "no rule → deny" on every tool invocation. Failure
    # is logged but not fatal — a malformed wildcard shouldn't block
    # platform-skill seeding.
    try:
        if _ensure_tool_permissions_wildcard():
            summary.tool_permissions_wildcard_seeded = True
    except Exception as e:
        logger.warning("platform_seed: tool_permissions wildcard seed failed: %s", e)

    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.exists():
            continue

        try:
            parsed = _parse_template(skill_md)
        except Exception as e:
            logger.warning("platform_seed: failed to parse %s: %s", skill_md, e)
            summary.failed.append(child.name)
            continue

        if parsed["name"] in existing:
            summary.skipped += 1
            continue

        try:
            # Generate slug at creation time so the friendly URL
            # /chat/@aitana-platform/{slug} works without a follow-up
            # backfill. unique_slug guards against collisions if a
            # template name slugifies to the same value as another
            # platform skill (defensive — current templates don't).
            slug = unique_slug(PLATFORM_OWNER_UID, slugify(parsed["name"]))
            # Only pass optional top-level fields if the SKILL.md declared
            # them — falsy strings collapse to empty values on SkillConfig.
            optional_kwargs: dict[str, Any] = {}
            if parsed["displayName"]:
                optional_kwargs["displayName"] = parsed["displayName"]
            if parsed["initialMessage"]:
                optional_kwargs["initialMessage"] = parsed["initialMessage"]
            if parsed["problemStatement"]:
                optional_kwargs["problemStatement"] = parsed["problemStatement"]
            skill_config.create_skill(
                name=parsed["name"],
                description=parsed["description"],
                instructions=parsed["instructions"],
                owner_id=PLATFORM_OWNER_UID,
                owner_email=PLATFORM_OWNER_EMAIL,
                accessControl={"type": "public"},
                skillMetadata=parsed["metadata"],
                slug=slug,
                **optional_kwargs,
            )
            summary.created += 1
        except Exception as e:
            logger.warning("platform_seed: failed to create %s: %s", parsed["name"], e)
            summary.failed.append(parsed["name"])

    return summary
