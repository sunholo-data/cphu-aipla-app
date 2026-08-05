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

# 1.1.61 — the organising vocabulary now lives in `taxonomy`, because activities
# carry it too and a copy on each side would drift. Re-exported here so every
# existing `from db.models.curriculum import normalize_tags, SUBJECTS, ...`
# keeps working; taxonomy is the source, this is a shim.
from db.models.taxonomy import (
    MAX_SUBJECT_LEN,
    MAX_TAG_LEN,
    MAX_TAGS,
    PHYSICS_AREAS,
    SUBJECTS,
    UNFILED,
    UNFILED_LABEL,
    UNLEVELLED,
    UNLEVELLED_LABEL,
    StxLevel,
    normalize_subject,
    normalize_tags,
)

CurriculumSource = Literal["shared", "teacher_upload"]
CopyrightStatus = Literal["cleared", "teacher_owned", "pending"]

# Sentinel owner_scope for the shared corpus (vs a teacher uid / class tag).
SHARED_SCOPE = "shared"

__all__ = [
    "MAX_SUBJECT_LEN",
    "MAX_TAGS",
    "MAX_TAG_LEN",
    "PHYSICS_AREAS",
    "SHARED_SCOPE",
    "SUBJECTS",
    "UNFILED",
    "UNFILED_LABEL",
    "UNLEVELLED",
    "UNLEVELLED_LABEL",
    "CopyrightStatus",
    "CurriculumDoc",
    "CurriculumFolder",
    "CurriculumSource",
    "StxLevel",
    "normalize_subject",
    "normalize_tags",
]


class CurriculumDoc(BaseModel):
    """One curriculum document's metadata. The parsed text lives in the ADK RAG
    corpus (keyed by ``doc_id``); this row scopes, filters, and cites it."""

    doc_id: str = Field(alias="docId")
    title: str = Field(min_length=1, max_length=300)
    # 1.1.33: optional. A/B/C is the organising axis for the SHARED cleared
    # library, but ad-hoc teacher uploads have no inherent level — None means
    # "unfiled", a teacher may assign A/B/C later from the catalogue. Never
    # auto-assigned (the old forced "B" on upload was a bug).
    level: StxLevel | None = None
    topic: str | None = Field(default=None, max_length=120)
    # 1.1.52 — a 1-2 sentence catalogue blurb (what the doc covers / is useful
    # for), generated at ingest from the parsed text. Lets the authoring co-pilot
    # and the teacher's Materials browse judge relevance WITHOUT opening the doc.
    # Optional: legacy docs have none until the `summarize` backfill runs.
    summary: str = Field(default="", max_length=1000)
    # 1.1.58 M1 — freeform cross-cutting labels (exam-prep, lab, "1.g", chapter
    # refs) the A/B/C level + topic axes don't capture. Owner-set, searchable
    # (folded into the browse haystack), filterable (AND), and surfaced as facet
    # chips. Always stored canonical (see normalize_tags) — apply it on write.
    tags: list[str] = Field(default_factory=list)
    # 1.1.58 M2 / 1.1.60 — the BROAD class from the soft SUBJECTS vocab (Fysik,
    # Matematik, ... — free entry allowed). The top-level facet a teacher filters
    # by; the within-subject taxonomy is the FOLDER, and `topic` stays freeform.
    # Optional — but note NOTHING wrote it before 1.1.60 except the guide seed:
    # the 1.1.58 M2 frontend never sent it at ingest, so every doc uploaded
    # through the teacher UI or the CLI has `subject=None` until the backfill runs.
    subject: str | None = Field(default=None, max_length=MAX_SUBJECT_LEN)
    # 1.1.58 M3 — flat folder membership, denormalised (id + name) like
    # ParsedDocument. The folder's ownerScope MUST equal this doc's ownerScope —
    # enforced on assign so folder ACL can never diverge from doc ACL. None =
    # "unfiled".
    folder_id: str | None = Field(default=None, alias="folderId", max_length=200)
    folder_name: str | None = Field(default=None, alias="folderName", max_length=120)
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


class CurriculumFolder(BaseModel):
    """A flat (non-nested) folder for grouping curriculum docs (1.1.58 M3).

    Keyed by ``owner_scope`` exactly like ``CurriculumDoc`` — a shared folder
    (``owner_scope == SHARED_SCOPE``) groups shared docs, a teacher's private
    folder groups their own — so folder visibility can never diverge from
    document visibility. ``doc_count`` is computed on list (not stored), so it
    can't drift.
    """

    folder_id: str = Field(alias="folderId")
    name: str = Field(min_length=1, max_length=120)
    owner_scope: str = Field(alias="ownerScope", max_length=200)
    created_at: datetime = Field(alias="createdAt")
    # Computed on list; never persisted. Present here so the API response carries it.
    doc_count: int = Field(default=0, alias="docCount")

    model_config = ConfigDict(populate_by_name=True)
