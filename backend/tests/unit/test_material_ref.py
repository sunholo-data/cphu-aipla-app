"""MaterialRef (1.1.44, 1.1.87) — kind discriminator + per-kind validator.

The activity ``materials`` list carries three kinds of resource: curriculum/RAG
docs (``kind="curriculum"``), teacher-attached images the tutor sees multimodally
(``kind="image"``), and — since 1.1.87 — the task the student is working on
(``kind="context"``), the same document as a curriculum one but inlined every turn
instead of retrieved. Legacy rows have no ``kind`` and must deserialize as
curriculum.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from db.models.activity_config import MaterialRef


def test_curriculum_material_roundtrips_via_alias():
    m = MaterialRef.model_validate({"docId": "doc-1", "origin": "uvm.dk", "studentVisible": True})
    assert m.kind == "curriculum"
    assert m.doc_id == "doc-1"
    dumped = m.model_dump(by_alias=True)
    assert dumped["kind"] == "curriculum"
    assert dumped["docId"] == "doc-1"
    assert dumped["studentVisible"] is True


def test_image_material_roundtrips_via_alias():
    m = MaterialRef.model_validate(
        {"kind": "image", "materialId": "img-1", "mimeType": "image/png", "alt": "free-body diagram"}
    )
    assert m.kind == "image"
    assert m.material_id == "img-1"
    assert m.mime_type == "image/png"
    assert m.alt == "free-body diagram"
    assert m.student_visible is False  # opt-in default, mirrors cited docs
    dumped = m.model_dump(by_alias=True)
    assert dumped["materialId"] == "img-1"
    assert dumped["mimeType"] == "image/png"
    assert dumped["alt"] == "free-body diagram"


def test_default_kind_is_curriculum_for_legacy_rows():
    # Serialized materials written before 1.1.44 have no ``kind`` field.
    m = MaterialRef.model_validate({"docId": "doc-legacy"})
    assert m.kind == "curriculum"


def test_curriculum_requires_doc_id():
    with pytest.raises(ValidationError):
        MaterialRef.model_validate({"kind": "curriculum", "origin": "uvm.dk"})


def test_image_requires_material_id():
    with pytest.raises(ValidationError):
        MaterialRef.model_validate({"kind": "image", "mimeType": "image/png"})


# ---------------------------------------------------------------------------
# 1.1.87 — kind="context"
# ---------------------------------------------------------------------------


def test_context_material_roundtrips_via_alias():
    m = MaterialRef.model_validate(
        {"kind": "context", "docId": "doc-task", "origin": "teacher", "title": "Exam 2019 set 2"}
    )
    assert m.kind == "context"
    assert m.doc_id == "doc-task"
    assert m.title == "Exam 2019 set 2"
    dumped = m.model_dump(by_alias=True)
    assert dumped["kind"] == "context"
    assert dumped["docId"] == "doc-task"


def test_context_requires_doc_id():
    """A context material is a curriculum DOC attached differently — it is
    addressed by doc_id, never by an image material_id."""
    with pytest.raises(ValidationError):
        MaterialRef.model_validate({"kind": "context", "origin": "teacher"})


def test_unknown_kind_is_rejected():
    with pytest.raises(ValidationError):
        MaterialRef.model_validate({"kind": "task", "docId": "doc-1"})
