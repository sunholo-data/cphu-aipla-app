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
    updated: int = 0
    skipped: int = 0
    failed: list[str] = field(default_factory=list)
    tool_permissions_wildcard_seeded: bool = False
    # 1.A follow-up (2026-05-26) — demo classes for the dev
    # TEACHER_MOCK_AUTH bypass. Only set when the env flag triggers
    # demo seeding; empty dict on prod / non-bypass paths.
    demo_classes: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "failed": self.failed,
            "tool_permissions_wildcard_seeded": self.tool_permissions_wildcard_seeded,
            "demo_classes": self.demo_classes,
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
        # 1.B follow-up (2026-05-26) — optional cover image for the
        # lesson picker + chat-tab thumbnail. URL string (relative path
        # served from frontend/public, or a full https:// URL). Empty
        # string when omitted; the LessonCard renders an icon
        # placeholder in that case.
        "avatar": (front.get("avatar") or "").strip(),
        # 1.I-PhA — proactive tutor auto-greet opt-in + skill-author
        # opening guidance. Both stored as top-level frontmatter so the
        # template author doesn't have to nest them under `metadata:`.
        "proactiveGreet": bool(front.get("proactiveGreet") or False),
        "openingTemplate": (front.get("openingTemplate") or "").strip(),
        # 1.A M8 — optional accessControl override. Templates that omit
        # it default to public (preserves the existing behaviour).
        # Teacher-only skills like manage-class supply:
        #   accessControl:
        #     type: tagged
        #     tags: [role:teacher]
        "accessControl": front.get("accessControl") or None,
    }


def _existing_platform_skill_names() -> set[str]:
    configs = skill_config.list_skills(owner_id=PLATFORM_OWNER_UID, limit=200)
    return {c.name for c in configs}


def _existing_platform_skills_by_name() -> dict[str, str]:
    """Map skill name → skill_id for every platform-owned skill.

    Used by the upsert path so the seeder can update an existing skill's
    template-sourced fields without creating a duplicate. Platform skills
    are uniquely keyed by ``name`` per the existing idempotency contract.
    """
    configs = skill_config.list_skills(owner_id=PLATFORM_OWNER_UID, limit=200)
    return {c.name: c.skill_id for c in configs}


def _template_updates(parsed: dict[str, Any]) -> dict[str, Any]:
    """Build the partial-update payload for an existing platform skill.

    Includes only the fields the SKILL.md template owns — instructions,
    description, displayName, initialMessage, problemStatement,
    proactiveGreet, openingTemplate. Leaves usage_count, createdAt,
    accessControl, and friends alone (those are platform-managed, not
    template-sourced).

    Camel-cased keys because ``skill_config.update_skill`` writes them
    directly into Firestore, and the Firestore documents use camelCase
    aliases per ``SkillConfig.model_config``.
    """
    updates: dict[str, Any] = {
        "description": parsed["description"],
        "instructions": parsed["instructions"],
    }
    if parsed["displayName"]:
        updates["displayName"] = parsed["displayName"]
    if parsed["initialMessage"]:
        updates["initialMessage"] = parsed["initialMessage"]
    if parsed["problemStatement"]:
        updates["problemStatement"] = parsed["problemStatement"]
    # New flags / templates always apply, including when the source says
    # "off" explicitly — otherwise toggling proactiveGreet off in the
    # template wouldn't ever take effect on existing skills.
    updates["proactiveGreet"] = parsed["proactiveGreet"]
    updates["openingTemplate"] = parsed["openingTemplate"]
    # avatar is unconditional too — template-owned. Setting to "" in the
    # template clears any previously-set URL.
    updates["avatar"] = parsed["avatar"]
    return updates


def seed(templates_root: Path | None = None) -> SeedSummary:
    """Seed platform skills from disk templates. Idempotent by `name`.

    Returns a SeedSummary counting created/skipped/failed entries. A
    malformed template surfaces in `failed` rather than aborting the run
    — the Cloud Build step runs non-fatally and we prefer to partially
    seed over blocking a deploy.
    """
    root = templates_root or DEFAULT_TEMPLATES_ROOT
    summary = SeedSummary()
    # Map name → skill_id so the upsert path can update existing rows
    # without creating duplicates. Earlier idempotency was "skip if
    # exists" which silently ignored template changes — broke when
    # 1.I-PhA added proactiveGreet + openingTemplate to the template
    # of an already-deployed problem-set-hints skill.
    existing_by_name = _existing_platform_skills_by_name()

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

        existing_skill_id = existing_by_name.get(parsed["name"])
        if existing_skill_id is not None:
            # Upsert path — sync template-sourced fields without
            # touching usage_count / createdAt / accessControl. This is
            # safe for platform skills because the SKILL.md template IS
            # the canonical definition; teachers fork to their own
            # owner_id rather than modify the platform copy.
            try:
                skill_config.update_skill(existing_skill_id, _template_updates(parsed))
                summary.updated += 1
                logger.info(
                    "platform_seed: updated existing skill %s (id=%s) from template",
                    parsed["name"],
                    existing_skill_id,
                )
            except Exception as e:
                logger.warning(
                    "platform_seed: failed to update %s (id=%s): %s",
                    parsed["name"],
                    existing_skill_id,
                    e,
                )
                summary.failed.append(child.name)
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
            if parsed["proactiveGreet"]:
                optional_kwargs["proactiveGreet"] = parsed["proactiveGreet"]
            if parsed["openingTemplate"]:
                optional_kwargs["openingTemplate"] = parsed["openingTemplate"]
            if parsed["avatar"]:
                optional_kwargs["avatar"] = parsed["avatar"]
            access_control = parsed["accessControl"] or {"type": "public"}
            skill_config.create_skill(
                name=parsed["name"],
                description=parsed["description"],
                instructions=parsed["instructions"],
                owner_id=PLATFORM_OWNER_UID,
                owner_email=PLATFORM_OWNER_EMAIL,
                accessControl=access_control,
                skillMetadata=parsed["metadata"],
                slug=slug,
                **optional_kwargs,
            )
            summary.created += 1
        except Exception as e:
            logger.warning("platform_seed: failed to create %s: %s", parsed["name"], e)
            summary.failed.append(parsed["name"])

    # 1.A follow-up (2026-05-26): when AIPLA_TEACHER_MOCK_AUTH=1 is set
    # on the service, also seed demo classes so the bypass /teacher/*
    # surface has content. Idempotent — running the platform-seed
    # endpoint repeatedly produces zero duplicates. Skipped silently
    # on prod (env unset). Failures don't block platform-skill seed.
    if os.environ.get("AIPLA_TEACHER_MOCK_AUTH") == "1":
        try:
            from admin.demo_classes import seed_demo_classes

            summary.demo_classes = seed_demo_classes()
            logger.info("platform_seed: demo classes seeded: %s", summary.demo_classes)
        except Exception as e:
            logger.warning("platform_seed: demo classes seed failed: %s", e)

    return summary


def prune(templates_root: Path | None = None, *, dry_run: bool = True) -> dict[str, list[str]]:
    """Delete platform-owned Firestore skills whose template no longer
    exists on disk.

    Idempotent. Dry-run by default — returns the set of skills that
    would be deleted without actually deleting. Pass ``dry_run=False``
    to commit the deletions.

    Use when culling generic/inherited templates (e.g. 1.B follow-up
    on 2026-05-26: removed workspace-demo/code-assistant/etc.). The
    seeder doesn't auto-delete because the absence of a template
    doesn't imply intent — a typo in the template dir name shouldn't
    nuke production skills. Prune is the explicit cleanup verb.

    Returns ``{"pruned": [<name>, ...], "kept": [<name>, ...]}``.
    """
    root = templates_root or DEFAULT_TEMPLATES_ROOT
    on_disk = {child.name for child in root.iterdir() if child.is_dir() and (child / "SKILL.md").exists()}
    # Parse each on-disk template to get the canonical skill `name`
    # (template dir name and skill name may differ — though for AIPLA
    # they currently match).
    template_skill_names: set[str] = set()
    for child in root.iterdir():
        skill_md = child / "SKILL.md"
        if child.is_dir() and skill_md.exists():
            try:
                template_skill_names.add(_parse_template(skill_md)["name"])
            except Exception:
                # Malformed template — assume it'll be fixed; don't
                # let a parse error mass-delete skills.
                logger.warning("platform_seed.prune: skipping malformed template %s", skill_md)
                template_skill_names.add(child.name)
    by_name = _existing_platform_skills_by_name()
    pruned: list[str] = []
    kept: list[str] = []
    for name, skill_id in by_name.items():
        if name in template_skill_names:
            kept.append(name)
            continue
        if dry_run:
            logger.info("platform_seed.prune (dry-run): would delete %s (id=%s)", name, skill_id)
        else:
            skill_config.delete_skill(skill_id)
            logger.info("platform_seed.prune: deleted %s (id=%s)", name, skill_id)
        pruned.append(name)
    return {"pruned": pruned, "kept": kept, "templates_on_disk": sorted(on_disk)}
