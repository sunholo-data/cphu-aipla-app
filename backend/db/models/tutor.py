"""Tutor — a teaching identity that carries its theory (1.1.91 M0).

Today a tutor is a file in git (``backend/skills/templates/*/SKILL.md``) and the
people who own the pedagogy cannot write files in git, so "can we try a tutor
built on ESRU?" is a ticket. This is the object that fixes that: a tutor becomes
data, carrying a ``TeachingFramework`` (its theory), a ``Persona`` (its identity)
and an ``interaction_style`` (its voice) — each by REFERENCE to the shipped
thing, not by copy.

What this module deliberately does NOT do:

* **Re-declare name/avatar/voice.** The 1.1.91 M0 sketch gave ``Tutor`` its own
  ``name, displayName, avatar, voice`` as "what SKILL.md already carries". But
  ``db/models/persona.py`` (1.1.12) already carries exactly that bundle, six
  personas ship as YAML, and ``personas/loader.resolve_persona_chain`` already
  resolves activity > class > default. Duplicating the fields would give one
  avatar two sources of truth. ``persona_id`` references it instead.
* **Introduce a second interaction-style enum.** ``interaction_style`` is the
  SHIPPED ``InteractionStyle`` from ``activity_config`` (1.1.20), resolving to
  the same four preambles ``adk/interaction_style.py`` already injects.
* **Reach the agent path.** M0 is the object; the store is M1, the co-pilot M2,
  and nothing here changes a live turn.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from db.models.activity_config import InteractionStyle

# ``draft`` — being authored. ``ready`` — publishable. ``in-use`` — attached to a
# live activity/class, so edits must fork a version rather than mutate (see
# ``version``).
TutorStatus = Literal["draft", "ready", "in-use"]

# Who authored it. Researchers may author a framework from scratch; teachers get
# VARIANTS of an existing tutor (1.1.91 M1) — deliberately, because a tutor with
# a theory field and no theory in it makes an unfounded claim look founded.
AuthorRole = Literal["researcher", "teacher"]

# How the prompt came to exist — the reviewability marker. ``generated`` means it
# was built FROM the framework's constructs, so it is traceable to the theory;
# ``edited`` means a human has since changed it and the trace is partial.
PromptProvenance = Literal["generated", "edited", "authored"]


class TutorLineage(BaseModel):
    """Variant-of, as ALS-SHARE already does it for activities.

    Lineage is not bookkeeping — it is the research finding. "SDT as designed vs
    SDT as thirty teachers actually adapted it" is only askable if the delta is
    recorded.
    """

    kind: Literal["original", "variant-of"] = "original"
    parent_tutor_id: str | None = Field(default=None, alias="parentTutorId", max_length=64)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @model_validator(mode="after")
    def _parent_matches_kind(self) -> TutorLineage:
        if self.kind == "variant-of" and not self.parent_tutor_id:
            raise ValueError("lineage kind 'variant-of' requires parent_tutor_id")
        if self.kind == "original" and self.parent_tutor_id:
            raise ValueError("lineage kind 'original' must not carry parent_tutor_id")
        return self


class Tutor(BaseModel):
    """A tutor as data: identity + theory + voice, each by reference."""

    id: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=120, alias="displayName")
    summary: str | None = Field(default=None, max_length=600)

    # References into the shipped catalogues. Both optional and both None-safe:
    # a tutor with neither is valid and behaves exactly as today (Axiom 5).
    persona_id: str | None = Field(default=None, alias="personaId", max_length=64)
    framework_id: str | None = Field(default=None, alias="frameworkId", max_length=64)
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")

    prompt: str = Field(default="", max_length=20000)
    prompt_provenance: PromptProvenance = Field(default="authored", alias="promptProvenance")

    lineage: TutorLineage = Field(default_factory=TutorLineage)

    # Answers 1.1.91 open question 4 in M0 rather than after sessions exist.
    # 1.1.92 attributes a scored session to (tutor_id, version); if an edit
    # mutates a tutor in place, every earlier session becomes unattributable.
    # An int now is free; a migration later is not.
    version: int = Field(default=1, ge=1)

    status: TutorStatus = "draft"
    author_uid: str | None = Field(default=None, alias="authorUid", max_length=128)
    author_role: AuthorRole = Field(default="researcher", alias="authorRole")

    created_at: datetime | None = Field(default=None, alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    @property
    def is_variant(self) -> bool:
        return self.lineage.kind == "variant-of"

    def next_version(self) -> Tutor:
        """A copy bumped one version — the shape an M1 edit takes on an in-use
        tutor, so earlier scored sessions keep pointing at what actually ran."""
        return self.model_copy(update={"version": self.version + 1})


def resolve_tutor_framework(tutor: Tutor):
    """The tutor's ``TeachingFramework``, or None if unset/unknown.

    Import is local: ``db.models`` must not depend on the ``frameworks`` package
    at import time (the persona models keep the same discipline)."""
    from frameworks.loader import load_framework

    return load_framework(tutor.framework_id)


def resolve_tutor_persona(tutor: Tutor, *fallback_persona_ids: str | None):
    """The tutor's ``Persona`` through the SHIPPED resolution chain.

    Extra ids are the existing activity > class > default order, so a tutor's
    persona simply becomes the highest-priority link rather than a second,
    competing mechanism."""
    from personas.loader import resolve_persona_chain

    return resolve_persona_chain(tutor.persona_id, *fallback_persona_ids)


__all__ = [
    "AuthorRole",
    "PromptProvenance",
    "Tutor",
    "TutorLineage",
    "TutorStatus",
    "resolve_tutor_framework",
    "resolve_tutor_persona",
]
