"""Persona — a named teaching character that bundles configs (1.1.12).

A Persona ties together the configs that give a tutor an identity: a name +
title + avatar (display), an ``interaction_style`` (1.1.20 — how it teaches),
and a ``voice`` (1.1.11 — how it sounds). A teacher picks a persona on an
activity and those tied configs come from it; the per-activity
``interaction_style`` stays independently overridable (the hybrid).

Defaults ship as YAML in ``backend/personas/*.yaml`` (Danish-educator theme).
**The Firestore layer arrived in TUTOR-2 M3** — the follow-up this docstring
marked as v1.2, and the reason ``source`` existed before anything used it.

Layered exactly as ``authored_frameworks`` layers over the framework YAML and
``tutors`` over the base catalogue: git holds the defaults, Firestore holds only
what a person deliberately made. That is the third instance of one pattern
rather than a fourth mechanism.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from db.models import SkillVoiceConfig
from db.models.activity_config import InteractionStyle


class Persona(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    title: str | None = Field(default=None, max_length=120)
    # Avatar path/url. Empty -> the UI renders an initials fallback until the
    # generated images land (the Danish-educator avatar prompt set).
    avatar: str = Field(default="", max_length=400)
    language: str = Field(default="da", max_length=16)
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")
    voice: SkillVoiceConfig | None = None
    # Voice direction / "Style Instructions" (1.1.12 follow-up). A natural-
    # language steer ("Tal i en varm, opmuntrende tone…") passed to Gemini-TTS
    # voices (provider gcp_gemini) so the spoken delivery matches the persona's
    # character. Ignored by non-Gemini tiers (Chirp3-HD/WaveNet reject prompts).
    voice_prompt: str | None = Field(default=None, alias="voicePrompt", max_length=600)
    bio: str | None = Field(default=None, max_length=500)
    source: Literal["yaml", "firestore"] = "yaml"

    # TUTOR-2 M3 — ownership and visibility, same two states and the same
    # absent rule as Tutor: ABSENT IS NOT PRIVATE, it is what a row meant
    # before the field existed. Always None on the six YAML personas, which are
    # shared by definition and have no row to carry it.
    author_uid: str | None = Field(default=None, alias="authorUid", max_length=128)
    visibility: Literal["private", "shared"] | None = None

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    def visible_to(self, uid: str | None, *, see_all: bool = False) -> bool:
        """Whether this persona belongs in ``uid``'s picker (TUTOR-2 M3).

        A YAML persona is always visible — it ships with the product. The
        researcher bypass is the same one tutors and approaches carry.
        """
        if self.source == "yaml" or see_all or (self.visibility or "shared") == "shared":
            return True
        return bool(uid) and self.author_uid == uid


__all__ = ["Persona"]
