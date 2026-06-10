"""Persona — a named teaching character that bundles configs (1.1.12).

A Persona ties together the configs that give a tutor an identity: a name +
title + avatar (display), an ``interaction_style`` (1.1.20 — how it teaches),
and a ``voice`` (1.1.11 — how it sounds). A teacher picks a persona on an
activity and those tied configs come from it; the per-activity
``interaction_style`` stays independently overridable (the hybrid).

Defaults ship as YAML in ``backend/personas/*.yaml`` (Danish-educator theme).
Firestore-custom personas are a v1.2 follow-up — hence the ``source`` marker.
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
    bio: str | None = Field(default=None, max_length=500)
    source: Literal["yaml"] = "yaml"

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


__all__ = ["Persona"]
