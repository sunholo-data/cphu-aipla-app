"""Curriculum-library models (1.1.25).

A referenceable A/B/C curriculum corpus for authoring + tutor grounding. The
A/B/C Danish stx level is the primary organising axis (how teachers think + how
access stratifies). Retrieval is ADK RAG (managed, ADR-010); this model is the
Firestore-side metadata that scopes + cites each doc. The first slice ingests
teachers' OWN uploads (``copyright_status="teacher_owned"`` — no clearance
gate); the shared corpus is a later slice.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

StxLevel = Literal["A", "B", "C"]
CurriculumSource = Literal["shared", "teacher_upload"]
CopyrightStatus = Literal["cleared", "teacher_owned", "pending"]

# Sentinel owner_scope for the shared corpus (vs a teacher uid / class tag).
SHARED_SCOPE = "shared"


class CurriculumDoc(BaseModel):
    """One curriculum document's metadata. The parsed text lives in the ADK RAG
    corpus (keyed by ``doc_id``); this row scopes, filters, and cites it."""

    doc_id: str = Field(alias="docId")
    title: str = Field(min_length=1, max_length=300)
    level: StxLevel
    topic: str | None = Field(default=None, max_length=120)
    source: CurriculumSource
    # "shared" | a teacher uid | a class tag "class:<uid>:<id>" — the ACL key.
    owner_scope: str = Field(alias="ownerScope", max_length=200)
    # Provenance for citation (Axiom 2): "uvm.dk", "Haka Fysik", teacher name…
    origin: str = Field(max_length=200)
    # AILANG-Parse artifact id (ingested into the RAG corpus). May be empty until
    # ingestion completes; metadata can exist before the RAG file lands.
    doc_artifact_id: str = Field(default="", alias="docArtifactId", max_length=200)
    copyright_status: CopyrightStatus = Field(alias="copyrightStatus")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)
