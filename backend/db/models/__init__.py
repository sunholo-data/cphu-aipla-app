"""Pydantic models for all entities.

These define the data contracts between backend components
and map directly to Firestore document schemas.

Skills follow the Agent Skills spec (agentskills.io/specification)
with Aitana platform metadata as a separate layer.
"""

from __future__ import annotations

import re
import time
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator

from config.models import default_model
from db.models.access import AccessControl, AccessType
from db.models.buckets import BucketConfig, BucketFolderConfig

# Agent Skills spec: lowercase kebab-case, no leading/trailing/consecutive hyphens
_NAME_PATTERN = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
_CONSECUTIVE_HYPHENS = re.compile(r"--")

# Slug: 3-60 chars, kebab-case, no leading/trailing hyphens.
_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$")
# Words that would shadow Next.js routes or have reserved meaning in URLs.
RESERVED_SLUGS = frozenset({"new", "settings", "marketplace", "me", "api", "admin", "chat", "skill", "dev"})


# === Layer 1: Agent Skills Spec ===


class SkillMetadata(BaseModel):
    """Agent Skills spec metadata field — platform-specific config stored in SKILL.md frontmatter."""

    author: str = "aitana"
    version: str = "1.0"
    model: str = Field(default_factory=default_model)
    thinking_model: str | None = Field(default=None, alias="thinkingModel")
    tools: list[str] = []
    tool_configs: dict = Field(default_factory=dict, alias="toolConfigs")
    sub_skills: list[str] = Field(default_factory=list, alias="subSkills")

    model_config = {"populate_by_name": True}


# === Layer 2: Aitana Platform Metadata ===
# AccessControl now lives in db/models/access.py and is re-exported above so
# resource-access-control (1A.1b) can share the exact same schema.


class ProtocolConfig(BaseModel):
    enabled: bool = False


class Protocols(BaseModel):
    mcp: ProtocolConfig = ProtocolConfig()
    a2a: ProtocolConfig = ProtocolConfig()
    agui: ProtocolConfig = ProtocolConfig(enabled=True)
    a2ui: ProtocolConfig = ProtocolConfig()
    mcpApps: ProtocolConfig = ProtocolConfig()


# 1.1.11 voice provider abstraction — per-skill voice overrides.
# All four fields are optional; missing fields fall through to env
# (VOICE_TTS_PROVIDER / VOICE_STT_PROVIDER) then to the registry's
# "browser" / "disabled" defaults. Designed flat-shape so a skill author
# can pin "Danish WaveNet voice A at 0.85 rate" without touching env.
# See backend/voice/registry.py for the resolution chain.
class SkillVoiceConfig(BaseModel):
    tts_provider: str | None = Field(default=None, alias="ttsProvider")
    tts_voice: str | None = Field(default=None, alias="ttsVoice")
    stt_provider: str | None = Field(default=None, alias="sttProvider")
    # 1.1.11 follow-up — skill-declared response language. When set, the
    # frontend LangToggle locks to this value (student can't override
    # the skill's commitment to teaching in a specific language). Most
    # physics skills set this because the tutor's system prompt is
    # language-specific (NCERT in English, Danish stx in Danish). Leave
    # unset for skills that respond in whatever language the student
    # types in.
    language: str | None = Field(default=None, max_length=16)
    # 1.0 = Cloud TTS WaveNet's natural pace. Browser Web Speech's
    # Sara voice runs faster and historically wanted 0.85, but that's
    # the browser-path's quirk, not a Cloud TTS one. Skills that want
    # a slower pace for ESL learners can set this per-skill.
    rate: float = Field(default=1.0, ge=0.25, le=4.0)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


# === Combined Skill Document ===


class SkillConfig(BaseModel):
    """Firestore document model for a skill.

    Layer 1 (Agent Skills spec): name, description, instructions,
    skill_metadata, references, assets.

    Layer 2 (Aitana metadata): skill_id, display_name, avatar,
    owner_email, access_control, protocols, tags, etc.
    """

    # --- Agent Skills spec fields (Layer 1) ---
    name: str
    description: str = ""
    instructions: str = ""
    skill_metadata: SkillMetadata = Field(default_factory=SkillMetadata, alias="skillMetadata")
    references: dict[str, str] = Field(default_factory=dict)
    assets: dict[str, str] = Field(default_factory=dict)

    # --- Aitana platform metadata (Layer 2) ---
    skill_id: str = Field(default_factory=lambda: str(uuid.uuid4()), alias="skillId")
    slug: str | None = None
    display_name: str = Field(default="", alias="displayName")
    avatar: str = ""
    owner_email: str = Field(default="", alias="ownerEmail")
    owner_id: str = Field(default="", alias="ownerId")
    access_control: AccessControl = Field(default_factory=AccessControl, alias="accessControl")
    protocols: Protocols = Field(default_factory=Protocols)
    initial_message: str = Field(default="", alias="initialMessage")
    # AIPLA 2026-05-21 — the full problem text (worksheet) the student is
    # working on, rendered as markdown in the WorkspaceShell. Empty for
    # skills that don't pin to one specific problem; problem-set-hints
    # uses it to surface Opgave 1 — Boldkast (v0.1 demo). v1's
    # problem-set-helper-config will populate this per teacher-config.
    problem_statement: str = Field(default="", alias="problemStatement")
    # AIPLA 1.I Phase A — proactive tutor auto-greet. When true and the
    # session is brand-new (turn_count == 0), the backend fires one
    # agent turn before yielding to the user so the student isn't left
    # staring at a blank chat. Defaults off so existing skills aren't
    # affected. See docs/design/aipla/v1.0.0-pilot/proactive-tutor.md
    # for full rationale.
    proactive_greet: bool = Field(default=False, alias="proactiveGreet")
    # Skill-author guidance text the tutor uses as a seed on its first
    # proactive-greet turn. Authored in SKILL.md under the ``## Opening``
    # section; parsed into this field by the platform-seed step.
    # Ignored when ``proactive_greet`` is False (or this is empty).
    opening_template: str = Field(default="", alias="openingTemplate")
    # AIPLA 1.1.2 — proactive sim-reactive tutor (Phase B, Path A confirmed
    # 2026-06-03). When true, the frontend calls the gate-decision endpoint
    # POST /api/sessions/{id}/proactive-event-check after each meaningful
    # workbench-event commit; if the gates pass, the frontend kicks off an
    # AG-UI run with a synthetic [event_reactive:<kind>] sentinel so the
    # tutor proactively comments on what just happened. See
    # docs/design/aipla/v1.1.0-feedback/proactive-sim-reactive-tutor.md.
    proactive_event_reactive: bool = Field(default=False, alias="proactiveEventReactive")
    # Minimum seconds of student silence (no chat turn) before a meaningful
    # workbench event may trigger a proactive tutor turn. Stops the tutor
    # interrupting a student who's actively typing.
    proactive_heartbeat_seconds: int = Field(default=10, alias="proactiveHeartbeatSeconds")
    # Optional hard cap on proactive tutor turns per session, counting
    # both auto-greet (Phase A) and sim-reactive (Phase B). Default None
    # means no per-session cap — the 90s session-wide cooldown
    # (PROACTIVE_COOLDOWN_SECONDS in protocols/proactive_routes.py) is
    # then the only throttle. JB had not agreed to a numeric cap; the
    # original "max 2" wording was a draft design constraint, retracted
    # 2026-06-03 in favour of "respond to every serious student
    # interaction, cooldown prevents spam". A skill can still set an
    # explicit positive int to opt into a hard cap if its pedagogy
    # requires it.
    proactive_max_per_session: int | None = Field(default=None, alias="proactiveMaxPerSession")
    # Skill-author guidance text the tutor uses as a seed on each
    # sim-reactive proactive turn. Authored in SKILL.md under the
    # ``## Reactive turn`` section; parsed into this field by the
    # platform-seed step. Ignored when ``proactive_event_reactive`` is
    # False (or this is empty).
    reactive_template: str = Field(default="", alias="reactiveTemplate")
    # 1.1.11 — optional per-skill voice provider/voice/rate. None for the
    # whole block means "use env defaults"; individual fields can be left
    # None to mix-and-match (e.g. pick voice but inherit provider from env).
    # See backend/voice/registry.py for the resolution chain.
    voice: SkillVoiceConfig | None = Field(default=None)
    # 1.1.7 — when true, the chat composer shows the photo/doc upload button
    # for this skill. Off by default (text-only skills stay clean). Backend
    # image injection works regardless; this only gates the UI.
    multimodal_input: bool = Field(default=False, alias="multimodalInput")
    tags: list[str] = Field(default_factory=list)
    featured: bool = False
    usage_count: int = Field(default=0, alias="usageCount")
    created_at: float = Field(default_factory=time.time, alias="createdAt")
    updated_at: float = Field(default_factory=time.time, alias="updatedAt")
    v5_assistant_id: str | None = Field(default=None, alias="v5AssistantId")

    model_config = {"populate_by_name": True}

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        if not v or len(v) > 64:
            raise ValueError("name must be 1-64 characters")
        if not _NAME_PATTERN.match(v) or _CONSECUTIVE_HYPHENS.search(v):
            raise ValueError(
                "name must be lowercase kebab-case (a-z, 0-9, hyphens), no leading, trailing, or consecutive hyphens"
            )
        return v

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str) -> str:
        if not v:
            raise ValueError("description must not be empty (1-1024 characters)")
        if len(v) > 1024:
            raise ValueError("description must be at most 1024 characters")
        return v

    @field_validator("instructions")
    @classmethod
    def _validate_instructions(cls, v: str) -> str:
        if len(v) > 10_000:
            raise ValueError("instructions must be at most 10,000 characters")
        return v

    @field_validator("slug")
    @classmethod
    def _validate_slug(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _SLUG_PATTERN.match(v):
            raise ValueError(
                "slug must be 3-60 chars, lowercase kebab-case (a-z, 0-9, hyphens), no leading or trailing hyphens"
            )
        if v in RESERVED_SLUGS:
            raise ValueError(f"slug '{v}' is reserved")
        return v

    @field_validator("tags")
    @classmethod
    def _validate_tags(cls, v: list[str]) -> list[str]:
        if len(v) > 10:
            raise ValueError("maximum 10 tags")
        for tag in v:
            if len(tag) > 50:
                raise ValueError(f"tag '{tag[:20]}...' exceeds 50 characters")
        return v


# === Other entities ===


class Message(BaseModel):
    message_id: str = Field(alias="messageId")
    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: float
    metadata: dict = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class UserProfile(BaseModel):
    user_id: str = Field(alias="userId")
    email: str
    display_name: str = Field(default="", alias="displayName")
    created_at: float = Field(default=0, alias="createdAt")
    last_active: float = Field(default=0, alias="lastActive")

    model_config = {"populate_by_name": True}


# === Document models (see db/models/document.py) ===

from db.models.document import (  # noqa: E402
    Block,
    BlockType,
    DocMetadata,
    DocSummary,
    DocumentStatus,
    EditedBlock,
    ParsedDocument,
)

__all__ = [
    "AccessControl",
    "AccessType",
    "Block",
    "BlockType",
    "BucketConfig",
    "BucketFolderConfig",
    "DocMetadata",
    "DocSummary",
    "DocumentStatus",
    "EditedBlock",
    "Message",
    "ParsedDocument",
    "ProtocolConfig",
    "Protocols",
    "SkillConfig",
    "SkillMetadata",
    "UserProfile",
]
