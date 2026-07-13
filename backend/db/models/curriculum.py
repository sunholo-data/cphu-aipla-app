"""Curriculum-library models (1.1.25).

A referenceable A/B/C curriculum corpus for authoring + tutor grounding. The
A/B/C Danish stx level is the primary organising axis (how teachers think + how
access stratifies). Retrieval is ADK RAG (managed, ADR-010); this model is the
Firestore-side metadata that scopes + cites each doc. The first slice ingests
teachers' OWN uploads (``copyright_status="teacher_owned"`` — no clearance
gate); the shared corpus is a later slice.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

StxLevel = Literal["A", "B", "C"]
CurriculumSource = Literal["shared", "teacher_upload"]
CopyrightStatus = Literal["cleared", "teacher_owned", "pending"]

# Sentinel owner_scope for the shared corpus (vs a teacher uid / class tag).
SHARED_SCOPE = "shared"

# 1.1.58 M1 — tag validation. Tags are freeform teacher labels; we keep the store
# in ONE canonical form so filter/facet/search never have to case-fold at read.
MAX_TAGS = 20
MAX_TAG_LEN = 40

# 1.1.58 M2 — subject is a SOFT vocabulary: these seed the facet chips, but free
# entry is allowed so a teacher is never blocked on a missing category. Danish stx
# physics areas. Distinct from `topic` (freeform, fine-grained) — subject is the
# coarse facet a teacher filters by.
MAX_SUBJECT_LEN = 60
SUBJECTS = [
    "Mekanik",
    "Termodynamik",
    "Elektromagnetisme",
    "Bølger og optik",
    "Atom- og kernefysik",
    "Kvantefysik",
    "Astrofysik",
    "Relativitet",
    "Eksperimentel metode",
]


def normalize_subject(subject: str | None) -> str | None:
    """Trim a subject to ``MAX_SUBJECT_LEN``; empty/whitespace → None. Case is
    PRESERVED (unlike tags) — subjects are display-cased vocabulary terms."""
    if subject is None:
        return None
    s = subject.strip()[:MAX_SUBJECT_LEN].strip()
    return s or None


def normalize_tags(tags: Iterable[str] | None) -> list[str]:
    """Canonicalise a tag list: lowercase, trim, drop empties, de-dupe (order-
    preserving), truncate each to ``MAX_TAG_LEN`` and the list to ``MAX_TAGS``.

    Applied on EVERY write path (ingest, PATCH) so the stored form is canonical
    and downstream filter/facet/search can compare with plain equality/substring.
    """
    if not tags:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for raw in tags:
        t = (raw or "").strip().lower()[:MAX_TAG_LEN].strip()
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= MAX_TAGS:
            break
    return out


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
    # 1.1.58 M2 — a coarse subject area from the soft SUBJECTS vocab (free entry
    # allowed). The facet a teacher filters by; complements `topic` (freeform).
    # Optional — legacy/unfiled docs have none.
    subject: str | None = Field(default=None, max_length=MAX_SUBJECT_LEN)
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
