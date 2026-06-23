"""Artefact catalogue model (1.1.41).

One sandboxed MCP-App artefact (a simulation) a teacher can attach to an
activity. The artefact is a **reusable resource**: the same artefact appears in
many activities with different per-activity pedagogy (goal + 1.1.38 elements).

The artefact-intrinsic ``tutor_block`` (what the sim is / what its events mean —
NOT the per-activity lesson goal) is injected into the sim-activity tutor at
session-start (1.1.41 M2). It is **server-side only** — never serialized to the
public catalogue API (see ``public()``).

Loaded from ``backend/artefacts/*.yaml`` (mirrors the persona catalogue, 1.1.12)
so the catalogue deploys with the backend image.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from db.models.curriculum import StxLevel

ArtefactStatus = Literal["live", "beta", "deprecated"]


class ArtefactMeta(BaseModel):
    """A vetted MCP-App artefact in the catalogue."""

    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")
    version: str = Field(default="v1", max_length=16, pattern=r"^v[0-9]+$")
    display_name: str = Field(alias="displayName", min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    topics: list[str] = Field(default_factory=list, max_length=12)
    levels: list[StxLevel] = Field(default_factory=list)
    language: str = Field(default="da", max_length=8)
    event_vocabulary: list[str] = Field(default_factory=list, alias="eventVocabulary", max_length=40)
    # Artefact-intrinsic tutor instructions (NOT the per-activity lesson goal).
    # Injected into the sim-activity tutor at session-start; SERVER-SIDE ONLY —
    # excluded from the public catalogue view.
    tutor_block: str = Field(default="", alias="tutorBlock", max_length=2000)
    status: ArtefactStatus = "live"

    model_config = ConfigDict(populate_by_name=True)

    @property
    def artefact_path(self) -> str:
        """The sandbox path the frontend ``StaticArtefactFrame`` mounts (e.g. ``boldkast/v1``)."""
        return f"{self.id}/{self.version}"

    def public(self) -> dict:
        """Teacher-facing view: what the picker + the artefact frame need, minus
        the server-side ``tutor_block``."""
        return {
            "id": self.id,
            "version": self.version,
            "displayName": self.display_name,
            "description": self.description,
            "topics": self.topics,
            "levels": self.levels,
            "language": self.language,
            "artefactPath": self.artefact_path,
            "status": self.status,
        }


__all__ = ["ArtefactMeta", "ArtefactStatus"]
